import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import {
  applyCanonicalMasterRecord,
  mergeAdminMasterSearchRecords,
} from "@/lib/cooperatives/catalog";
import { readProductionMastersForQuery } from "@/lib/cooperatives/catalog-query";
import {
  DEMO_COOPERATIVE_COLLECTION,
  TEST_COOPERATIVE_DEFINITIONS,
  parseTestCooperativeMaster,
  type DemoCooperativeMasterRecord,
} from "@/lib/cooperatives/demo-cooperative";
import {
  COOPERATIVE_MASTER_COLLECTION,
  COOPERATIVE_MASTER_CONFIG_COLLECTION,
  COOPERATIVE_MASTER_CONFIG_ID,
  normalizeCooperativeSearchText,
  parseProductionCooperativeMaster,
} from "@/lib/cooperatives/master";
import { adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import { nonghyupMaster } from "@/lib/platform";
import {
  PURGE_AUDIT_COLLECTION,
  PURGE_JOB_COLLECTION,
  PURGE_LOCK_COLLECTION,
  PURGE_MANIFEST_COLLECTION,
  type PurgeJobRecord,
} from "@/lib/test-data/purge-job-types";
import { expectedPurgeConfirmation } from "@/lib/test-data/purge-apply-policy";
import { FirestorePurgeControlStore } from "@/lib/test-data/purge-firestore-executor";
import { buildPurgeManifest } from "@/lib/test-data/purge-manifest";
import { FirestorePurgeScanDataSource } from "@/lib/test-data/purge-firestore-source";
import type {
  PurgeManifest,
  PurgeScanDataSource,
  ScanDocument,
} from "@/lib/test-data/purge-types";

export const PURGE_ADMIN_EVENT_COLLECTION = "testDataPurgeAdminEvents";

export type PurgeInstitutionListItem = {
  institutionId: string;
  institutionName: string;
  institutionCode: string;
  institutionType: string;
  isDemoInstitution: boolean;
  signupStatus: string;
  dataClassification: "DEMO" | "PRODUCTION";
  resettable: boolean;
};

export type PurgeInstitutionSummary = PurgeInstitutionListItem & {
  connectedCustomerAccounts: number;
  connectedOrganizations: number;
  hasExplicitTestMarker: boolean;
  lastActivityAt?: string;
  classificationStatus:
    | "CONFIRMED_TEST"
    | "REVIEW_REQUIRED"
    | "PRESERVE"
    | "BLOCKED";
  activeJob?: Pick<
    PurgeJobRecord,
    "purgeJobId" | "status" | "currentPhase" | "updatedAt"
  >;
  activeLock?: {
    purgeJobId: string;
    status: string;
    leaseExpiresAt?: string;
  };
};

export type PurgeAdminHistoryItem = {
  id: string;
  eventType: "SCAN" | "MANIFEST_APPROVED" | "PURGE_RESULT";
  actorId: string;
  actorEmail?: string;
  institutionId: string;
  institutionName: string;
  status: string;
  occurredAt: string;
  purgeJobId?: string;
  manifestId?: string;
};

export class PurgeAdminReadService {
  private readonly db: Firestore;
  private readonly source: PurgeScanDataSource;

  constructor(
    db: Firestore = adminDb(),
    source: PurgeScanDataSource = new FirestorePurgeScanDataSource(),
  ) {
    this.db = db;
    this.source = source;
  }

  async searchInstitutions(
    query: string,
    limit = 20,
  ): Promise<PurgeInstitutionListItem[]> {
    const normalized = normalizeCooperativeSearchText(query);
    const configSnapshot = await this.db
      .collection(COOPERATIVE_MASTER_CONFIG_COLLECTION)
      .doc(COOPERATIVE_MASTER_CONFIG_ID)
      .get();
    const usesFirestoreMaster =
      configSnapshot.exists &&
      configSnapshot.data()?.mode === "FIRESTORE" &&
      configSnapshot.data()?.status === "ACTIVE";
    let realItems: PurgeInstitutionListItem[];
    if (usesFirestoreMaster) {
      const { firestoreRecords } = normalized
        ? await readProductionMastersForQuery(this.db, query, limit)
        : {
            firestoreRecords: (
              await this.db
                .collection(COOPERATIVE_MASTER_COLLECTION)
                .orderBy("cooperativeName")
                .limit(limit)
                .get()
            ).docs.flatMap((document) => {
              const item = parseProductionCooperativeMaster(document.data());
              return item ? [item] : [];
            }),
          };
      const records = normalized
        ? mergeAdminMasterSearchRecords({
            query,
            firestoreRecords,
          }).slice(0, limit)
        : firestoreRecords.map(applyCanonicalMasterRecord);
      realItems = records.map((item) => ({
        institutionId: item.cooperativeId,
        institutionName: item.cooperativeName,
        institutionCode: item.cooperativeId,
        institutionType: item.cooperativeType,
        isDemoInstitution: false,
        signupStatus: item.status === "active" ? "AVAILABLE" : "PENDING",
        dataClassification: "PRODUCTION" as const,
        resettable: false,
      }));
    } else {
      realItems = nonghyupMaster
        .filter((item) => {
          if (!normalized) return true;
          return [
            item.cooperative_id,
            item.cooperative_name,
            item.cooperative_type,
            item.sido,
            item.sigungu,
          ].some((value) =>
            normalizeCooperativeSearchText(value).includes(normalized),
          );
        })
        .slice(0, limit)
        .map((item): PurgeInstitutionListItem => ({
          institutionId: item.cooperative_id,
          institutionName: item.cooperative_name,
          institutionCode: item.cooperative_id,
          institutionType: item.cooperative_type,
          isDemoInstitution: false,
          signupStatus: "AVAILABLE",
          dataClassification: "PRODUCTION",
          resettable: false,
        }));
    }
    let demos: DemoCooperativeMasterRecord[] = [];
    try {
      const demoSnapshots = await Promise.all(
        TEST_COOPERATIVE_DEFINITIONS.map((definition) =>
          this.db
            .collection(DEMO_COOPERATIVE_COLLECTION)
            .doc(definition.cooperativeId)
            .get(),
        ),
      );
      demos = demoSnapshots.flatMap((snapshot) => {
        if (!snapshot.exists) return [];
        const parsed = parseTestCooperativeMaster(snapshot.data(), snapshot.id);
        return parsed ? [parsed] : [];
      });
    } catch (error) {
      console.error("Test data admin demo cooperative lookup failed.", error);
    }
    const demoItems: PurgeInstitutionListItem[] = demos
      .filter(
        (demo) =>
          !normalized ||
          demo.cooperativeName.toLocaleLowerCase("ko-KR").includes(normalized) ||
          demo.cooperativeId.toLocaleLowerCase("ko-KR").includes(normalized) ||
          demo.internalCode.toLocaleLowerCase("ko-KR").includes(normalized),
      )
      .map((demo) => ({
            institutionId: demo.cooperativeId,
            institutionName: demo.cooperativeName,
            institutionCode: demo.internalCode,
            institutionType: demo.cooperativeType,
            isDemoInstitution: true,
            signupStatus: demo.signupStatus,
            dataClassification: "DEMO",
            resettable: demo.resettable,
          }));
    return [...demoItems, ...realItems].slice(0, limit);
  }

  async getInstitutionSummary(input: {
    institutionId: string;
    generatedBy: string;
    environment: string;
    projectId: string;
  }): Promise<PurgeInstitutionSummary> {
    const snapshot = await this.source.loadSnapshot(input.institutionId);
    const manifest = buildPurgeManifest(
      {
        institutionId: input.institutionId,
        mode: "SCAN",
        generatedBy: input.generatedBy,
        environment: input.environment,
        projectId: input.projectId,
      },
      snapshot,
    );
    const customerAccounts = snapshot.documents.filter(
      (document) => document.collection === "users",
    );
    const organizations = snapshot.documents.filter((document) =>
      ["organizations", "tenants"].includes(document.collection)
    );
    const latestJob = await this.latestJob(input.institutionId);
    const lockSnapshot = await this.db
      .collection(PURGE_LOCK_COLLECTION)
      .doc(input.institutionId)
      .get();
    const lock = lockSnapshot.exists
      ? lockSnapshot.data() as Record<string, unknown>
      : null;
    const institutionCode = snapshot.institution.isDemoInstitution
      ? String(snapshot.institution.masterData.internalCode ?? input.institutionId)
      : String(
          snapshot.institution.masterData.cooperative_id ?? input.institutionId,
        );
    const demoSignupStatus = snapshot.institution.masterData.signupStatus;
    const signupStatus =
      typeof demoSignupStatus === "string"
        ? demoSignupStatus
        : customerAccounts.length > 0 || organizations.length > 0
          ? "CONNECTED"
          : "AVAILABLE";
    return {
      institutionId: snapshot.institution.id,
      institutionName: snapshot.institution.name,
      institutionCode,
      institutionType: snapshot.institution.type,
      isDemoInstitution: snapshot.institution.isDemoInstitution,
      signupStatus,
      dataClassification: snapshot.institution.isDemoInstitution
        ? "DEMO"
        : "PRODUCTION",
      resettable: snapshot.institution.isDemoInstitution &&
        snapshot.institution.masterData.resettable === true,
      connectedCustomerAccounts: customerAccounts.length,
      connectedOrganizations: organizations.length,
      hasExplicitTestMarker: snapshot.documents.some(hasExplicitTestMarker),
      lastActivityAt: latestActivity(snapshot.documents),
      classificationStatus: manifestClassification(manifest),
      activeJob: latestJob &&
        ["CREATED", "VALIDATING", "RUNNING", "PARTIALLY_FAILED"].includes(
          latestJob.status,
        )
        ? {
            purgeJobId: latestJob.purgeJobId,
            status: latestJob.status,
            currentPhase: latestJob.currentPhase,
            updatedAt: latestJob.updatedAt,
          }
        : undefined,
      activeLock:
        lock?.status === "ACTIVE"
          ? {
              purgeJobId: String(lock.purgeJobId ?? ""),
              status: String(lock.status),
              leaseExpiresAt:
                typeof lock.leaseExpiresAt === "string"
                  ? lock.leaseExpiresAt
                  : undefined,
            }
          : undefined,
    };
  }

  async getJob(purgeJobId: string) {
    if (!/^purge-job-[a-f0-9]{20,40}$/.test(purgeJobId)) return null;
    const jobSnapshot = await this.db
      .collection(PURGE_JOB_COLLECTION)
      .doc(purgeJobId)
      .get();
    if (!jobSnapshot.exists) return null;
    const job = jobSnapshot.data() as PurgeJobRecord;
    const registered = await new FirestorePurgeControlStore(this.db)
      .getManifest(job.manifestId);
    const lockSnapshot = await this.db
      .collection(PURGE_LOCK_COLLECTION)
      .doc(job.institutionId)
      .get();
    const lock = lockSnapshot.exists
      ? lockSnapshot.data() as Record<string, unknown>
      : null;
    return {
      job,
      preview: registered
        ? {
            manifestId: registered.manifest.manifestId,
            institutionId: registered.manifest.institutionId,
            institutionName: registered.manifest.institutionName,
            confirmation: expectedPurgeConfirmation(registered.manifest),
            firestoreTargetCount: registered.manifest.totalTargetCount,
            pendingAuthCount: registered.manifest.authUsers.filter(
              (candidate) =>
                candidate.classification === "CONFIRMED_TEST",
            ).length,
            pendingStorageCount: registered.manifest.storageObjects.filter(
              (candidate) =>
                candidate.classification === "CONFIRMED_TEST",
            ).length,
            resetFields: registered.manifest.resetFields,
            preservedFields: registered.manifest.preservedFields,
            expiresAt: registered.manifest.expiresAt,
            checksum: registered.manifest.checksum,
          }
        : undefined,
      lock: lock
        ? {
            status: String(lock.status ?? ""),
            leaseExpiresAt:
              typeof lock.leaseExpiresAt === "string"
                ? lock.leaseExpiresAt
                : undefined,
          }
        : null,
    };
  }

  async listHistory(
    institutionId: string,
    limit = 50,
  ): Promise<PurgeAdminHistoryItem[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const [events, manifests, audits] = await Promise.all([
      this.db.collection(PURGE_ADMIN_EVENT_COLLECTION)
        .where("institutionId", "==", institutionId)
        .limit(safeLimit)
        .get(),
      this.db.collection(PURGE_MANIFEST_COLLECTION)
        .where("institutionId", "==", institutionId)
        .limit(safeLimit)
        .get(),
      this.db.collection(PURGE_AUDIT_COLLECTION)
        .where("institutionId", "==", institutionId)
        .limit(safeLimit)
        .get(),
    ]);
    const items: PurgeAdminHistoryItem[] = [
      ...events.docs.map((document) => {
        const data = document.data();
        return {
          id: document.id,
          eventType: "SCAN" as const,
          actorId: String(data.actorId ?? ""),
          actorEmail:
            typeof data.actorEmail === "string" ? data.actorEmail : undefined,
          institutionId: String(data.institutionId ?? ""),
          institutionName: String(data.institutionName ?? ""),
          status: String(data.status ?? "SCANNED"),
          occurredAt: String(data.occurredAt ?? ""),
          manifestId:
            typeof data.manifestId === "string"
              ? data.manifestId
              : undefined,
        };
      }),
      ...manifests.docs.map((document) => {
        const data = document.data();
        return {
          id: document.id,
          eventType: "MANIFEST_APPROVED" as const,
          actorId: String(data.approvedBy ?? ""),
          actorEmail:
            typeof data.approvedByEmail === "string"
              ? data.approvedByEmail
              : undefined,
          institutionId: String(data.institutionId ?? ""),
          institutionName: String(data.institutionName ?? ""),
          status: "APPROVED",
          occurredAt: String(data.approvedAt ?? ""),
          manifestId: String(data.manifestId ?? document.id),
        };
      }),
      ...audits.docs.map((document) => {
        const data = document.data();
        return {
          id: document.id,
          eventType: "PURGE_RESULT" as const,
          actorId: String(data.actorId ?? ""),
          actorEmail:
            typeof data.actorEmail === "string" ? data.actorEmail : undefined,
          institutionId: String(data.institutionId ?? ""),
          institutionName: String(data.institutionName ?? ""),
          status: String(data.resultStatus ?? ""),
          occurredAt: String(data.completedAt ?? data.startedAt ?? ""),
          purgeJobId:
            typeof data.purgeJobId === "string"
              ? data.purgeJobId
              : undefined,
          manifestId:
            typeof data.manifestId === "string"
              ? data.manifestId
              : undefined,
        };
      }),
    ];
    return items
      .filter((item) => item.occurredAt)
      .sort((left, right) =>
        right.occurredAt.localeCompare(left.occurredAt)
      )
      .slice(0, safeLimit);
  }

  async recordScan(input: {
    actorId: string;
    manifest: PurgeManifest;
  }) {
    const eventId = `scan-${randomUUID()}`;
    await this.db.collection(PURGE_ADMIN_EVENT_COLLECTION).doc(eventId).set(
      withoutUndefined({
        schemaVersion: 1,
        eventType: "SCAN",
        actorId: input.actorId,
        institutionId: input.manifest.institutionId,
        institutionName: input.manifest.institutionName,
        manifestId: input.manifest.manifestId,
        status: input.manifest.executionStatus,
        occurredAt: input.manifest.generatedAt,
      }),
    );
  }

  private async latestJob(institutionId: string) {
    const snapshot = await this.db.collection(PURGE_JOB_COLLECTION)
      .where("institutionId", "==", institutionId)
      .limit(20)
      .get();
    return snapshot.docs
      .map((document) => document.data() as PurgeJobRecord)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  }
}

function hasExplicitTestMarker(document: ScanDocument) {
  return (
    document.data.testData === true ||
    document.data.dataClassification === "DEMO" ||
    document.data.dataClassification === "TEST" ||
    typeof document.data.testScenarioId === "string"
  );
}

function manifestClassification(
  manifest: PurgeManifest,
): PurgeInstitutionSummary["classificationStatus"] {
  if (manifest.executionStatus === "BLOCKED") return "BLOCKED";
  if (Object.values(manifest.reviewByCollection).flat().length > 0) {
    return "REVIEW_REQUIRED";
  }
  if (Object.values(manifest.targetsByCollection).flat().length > 0) {
    return "CONFIRMED_TEST";
  }
  return "PRESERVE";
}

function latestActivity(documents: ScanDocument[]) {
  let latest = "";
  for (const document of documents) {
    for (const field of [
      "updatedAt",
      "createdAt",
      "completedAt",
      "registeredAt",
      "activatedAt",
      "lastActivityAt",
    ]) {
      const value = instant(document.data[field]);
      if (value && value > latest) latest = value;
    }
  }
  return latest || undefined;
}

function instant(value: unknown): string | undefined {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  return undefined;
}
