import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  Timestamp,
  type DocumentData,
  type Firestore,
  type UpdateData,
} from "firebase-admin/firestore";
import {
  DEMO_COOPERATIVE_COLLECTION,
  getTestCooperativeDefinition,
} from "@/lib/cooperatives/demo-cooperative";
import { adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import {
  PURGE_AUDIT_COLLECTION,
  PURGE_JOB_COLLECTION,
  PURGE_LOCK_COLLECTION,
  PURGE_MANIFEST_COLLECTION,
  type PurgeAuditRecord,
  type PurgeControlStore,
  type PurgeDocumentDeleteResult,
  type PurgeFirestoreExecutor,
  type PurgeJobRecord,
  type PurgeResetResult,
  type RegisteredPurgeManifest,
} from "@/lib/test-data/purge-job-types";
import type {
  PurgeManifest,
  PurgeManifestItem,
} from "@/lib/test-data/purge-types";
import { isActivePurgeLock } from "@/lib/test-data/purge-lock";

const CHUNK_SIZE = 700_000;
const ALLOWED_RESET_FIELDS = new Set([
  "isRegistered",
  "signupStatus",
  "claimedBy",
  "ownerUid",
  "customerId",
  "organizationId",
  "tenantId",
  "membershipId",
  "registeredAt",
  "activatedAt",
  "registrationEmail",
]);

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function manifestChunks(manifest: PurgeManifest) {
  const encoded = gzipSync(JSON.stringify(manifest)).toString("base64");
  const chunks: string[] = [];
  for (let offset = 0; offset < encoded.length; offset += CHUNK_SIZE) {
    chunks.push(encoded.slice(offset, offset + CHUNK_SIZE));
  }
  return chunks;
}

function jobIdFor(manifestId: string) {
  return `purge-job-${sha256(manifestId).slice(0, 28)}`;
}

function retryableFirestoreCode(code: unknown) {
  return [4, 8, 10, 13, 14, "deadline-exceeded", "resource-exhausted",
    "aborted", "internal", "unavailable"].includes(code as never);
}

export class FirestorePurgeControlStore implements PurgeControlStore {
  private readonly db: Firestore;

  constructor(db: Firestore = adminDb()) {
    this.db = db;
  }

  async registerManifest(
    record: RegisteredPurgeManifest,
  ): Promise<RegisteredPurgeManifest> {
    const ref = this.db
      .collection(PURGE_MANIFEST_COLLECTION)
      .doc(record.manifest.manifestId);
    const existing = await ref.get();
    if (existing.exists) {
      const stored = await this.getManifest(record.manifest.manifestId);
      if (stored?.manifest.checksum !== record.manifest.checksum) {
        throw new PurgeStoreError("manifest_id_collision", 409);
      }
      return stored;
    }
    const chunks = manifestChunks(record.manifest);
    if (chunks.length > 499) {
      throw new PurgeStoreError("manifest_too_large", 413);
    }
    const batch = this.db.batch();
    batch.create(ref, {
      schemaVersion: 1,
      manifestId: record.manifest.manifestId,
      checksum: record.manifest.checksum,
      institutionId: record.manifest.institutionId,
      institutionName: record.manifest.institutionName,
      projectId: record.manifest.projectId,
      environment: record.manifest.environment,
      generatedAt: record.manifest.generatedAt,
      expiresAt: record.manifest.expiresAt,
      approvedBy: record.approvedBy,
      approvedByEmail: record.approvedByEmail ?? null,
      approvedAt: record.approvedAt,
      chunkCount: chunks.length,
      encoding: "gzip-base64-json",
    });
    chunks.forEach((data, index) => {
      batch.create(ref.collection("chunks").doc(String(index).padStart(4, "0")), {
        index,
        data,
      });
    });
    await batch.commit();
    return record;
  }

  async getManifest(
    manifestId: string,
  ): Promise<RegisteredPurgeManifest | null> {
    const ref = this.db.collection(PURGE_MANIFEST_COLLECTION).doc(manifestId);
    const header = await ref.get();
    if (!header.exists) return null;
    const headerData = header.data() as Record<string, unknown>;
    const chunkCount = Number(headerData.chunkCount ?? 0);
    if (!Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > 499) {
      throw new PurgeStoreError("invalid_registered_manifest", 409);
    }
    const chunkSnapshots = await Promise.all(
      Array.from({ length: chunkCount }, (_, index) =>
        ref.collection("chunks").doc(String(index).padStart(4, "0")).get()
      ),
    );
    if (chunkSnapshots.some((snapshot) => !snapshot.exists)) {
      throw new PurgeStoreError("incomplete_registered_manifest", 409);
    }
    const encoded = chunkSnapshots
      .map((snapshot) => String(snapshot.data()?.data ?? ""))
      .join("");
    let manifest: PurgeManifest;
    try {
      manifest = JSON.parse(
        gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"),
      ) as PurgeManifest;
    } catch {
      throw new PurgeStoreError("invalid_registered_manifest", 409);
    }
    if (
      manifest.manifestId !== manifestId ||
      manifest.checksum !== headerData.checksum
    ) {
      throw new PurgeStoreError("registered_manifest_checksum_mismatch", 409);
    }
    return {
      manifest,
      approvedBy: String(headerData.approvedBy ?? ""),
      approvedByEmail:
        typeof headerData.approvedByEmail === "string"
          ? headerData.approvedByEmail
          : undefined,
      approvedAt: String(headerData.approvedAt ?? ""),
    };
  }

  async beginOrResumeJob(input: {
    manifest: PurgeManifest;
    requestedBy: string;
    requestedByEmail?: string;
    requestId: string;
    now: string;
    lockLeaseExpiresAt: string;
  }) {
    const purgeJobId = jobIdFor(input.manifest.manifestId);
    const jobRef = this.db.collection(PURGE_JOB_COLLECTION).doc(purgeJobId);
    const lockRef = this.db
      .collection(PURGE_LOCK_COLLECTION)
      .doc(input.manifest.institutionId);
    return this.db.runTransaction(async (transaction) => {
      const [jobSnapshot, lockSnapshot] = await Promise.all([
        transaction.get(jobRef),
        transaction.get(lockRef),
      ]);
      if (jobSnapshot.exists) {
        const existing = jobSnapshot.data() as PurgeJobRecord;
        if (existing.manifestId !== input.manifest.manifestId) {
          throw new PurgeStoreError("purge_job_manifest_mismatch", 409);
        }
        if (existing.status === "COMPLETED") {
          return { job: existing, idempotentReplay: true };
        }
        if (
          existing.status === "PARTIALLY_FAILED" &&
          existing.currentPhase === "AWAITING_AUTH_STORAGE"
        ) {
          return { job: existing, idempotentReplay: true };
        }
        if (
          existing.status === "RUNNING" ||
          existing.status === "VALIDATING"
        ) {
          throw new PurgeStoreError("manifest_already_running", 409);
        }
        if (existing.status === "BLOCKED" || existing.status === "CANCELLED") {
          throw new PurgeStoreError("purge_job_not_resumable", 409);
        }
        const resumed: PurgeJobRecord = {
          ...existing,
          status: "VALIDATING",
          currentPhase: "VALIDATING_MANIFEST",
          requestId: input.requestId,
          requestedBy: input.requestedBy,
          requestedByEmail: input.requestedByEmail,
          updatedAt: input.now,
          attemptCount: existing.attemptCount + 1,
        };
        transaction.set(jobRef, withoutUndefined(resumed));
        transaction.set(lockRef, {
          schemaVersion: 1,
          institutionId: input.manifest.institutionId,
          purgeJobId,
          manifestId: input.manifest.manifestId,
          status: "ACTIVE",
          ownerRequestId: input.requestId,
          acquiredAt: input.now,
          leaseExpiresAt: input.lockLeaseExpiresAt,
        });
        return { job: resumed, idempotentReplay: false };
      }

      if (lockSnapshot.exists) {
        const lock = lockSnapshot.data() as Record<string, unknown>;
        if (isActivePurgeLock(lock, Date.parse(input.now))) {
          throw new PurgeStoreError("institution_purge_locked", 409);
        }
      }
      const totalFirestoreTargets = Object.values(
        input.manifest.targetsByCollection,
      ).flat().length;
      const job: PurgeJobRecord = {
        schemaVersion: 1,
        purgeJobId,
        manifestId: input.manifest.manifestId,
        manifestChecksum: input.manifest.checksum,
        institutionId: input.manifest.institutionId,
        institutionName: input.manifest.institutionName,
        requestedBy: input.requestedBy,
        requestedByEmail: input.requestedByEmail,
        requestId: input.requestId,
        status: "VALIDATING",
        currentPhase: "VALIDATING_MANIFEST",
        createdAt: input.now,
        startedAt: input.now,
        updatedAt: input.now,
        attemptCount: 1,
        progress: {
          totalFirestoreTargets,
          processedFirestoreTargets: 0,
          deferredStep6Targets: 0,
        },
        deletedCounts: {},
        itemResults: {},
        failedItems: [],
        resetResult: {
          status: "NOT_STARTED",
          resetFields: [],
          masterPreserved: true,
        },
        pendingAuthUids: input.manifest.authUsers
          .filter(
            (item) =>
              item.classification === "CONFIRMED_TEST" &&
              item.exists !== false,
          )
          .map((item) => item.uid),
        pendingStoragePaths: input.manifest.storageObjects
          .filter(
            (item) =>
              item.classification === "CONFIRMED_TEST" &&
              item.exists !== false,
          )
          .map((item) => item.path),
      };
      transaction.create(jobRef, withoutUndefined(job));
      transaction.set(lockRef, {
        schemaVersion: 1,
        institutionId: input.manifest.institutionId,
        purgeJobId,
        manifestId: input.manifest.manifestId,
        status: "ACTIVE",
        ownerRequestId: input.requestId,
        acquiredAt: input.now,
        leaseExpiresAt: input.lockLeaseExpiresAt,
      });
      return { job, idempotentReplay: false };
    });
  }

  async updateJob(job: PurgeJobRecord) {
    await this.db
      .collection(PURGE_JOB_COLLECTION)
      .doc(job.purgeJobId)
      .set(withoutUndefined(job));
  }

  async releaseLock(job: PurgeJobRecord, now: string) {
    const ref = this.db.collection(PURGE_LOCK_COLLECTION).doc(job.institutionId);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return;
      const data = snapshot.data() as Record<string, unknown>;
      if (data.purgeJobId !== job.purgeJobId) return;
      transaction.set(ref, {
        ...data,
        status: "RELEASED",
        releasedAt: now,
      });
    });
  }

  async writeAudit(record: PurgeAuditRecord) {
    await this.db
      .collection(PURGE_AUDIT_COLLECTION)
      .doc(record.auditId)
      .set(withoutUndefined(record));
    console.info("test_data_purge_audit", JSON.stringify(record));
  }
}

export class FirestorePurgeExecutor implements PurgeFirestoreExecutor {
  private readonly db: Firestore;

  constructor(db: Firestore = adminDb()) {
    this.db = db;
  }

  async deleteManifestItem(
    item: PurgeManifestItem,
  ): Promise<PurgeDocumentDeleteResult> {
    const segments = item.resourcePath.split("/");
    if (
      segments.length < 2 ||
      segments.length % 2 !== 0 ||
      segments.some((segment) => !segment)
    ) {
      return { status: "FAILED", code: "invalid_document_path", retryable: false };
    }
    const ref = this.db.doc(item.resourcePath);
    try {
      const snapshot = await ref.get();
      if (!snapshot.exists) return { status: "NOT_FOUND" };
      const actualChangeToken = snapshot.updateTime?.toDate().toISOString();
      if (!item.changeToken || actualChangeToken !== item.changeToken) {
        return { status: "STALE" };
      }
      await ref.delete({
        lastUpdateTime:
          snapshot.updateTime ??
          Timestamp.fromDate(new Date(item.changeToken)),
      });
      return { status: "DELETED" };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === 5 || code === "not-found") return { status: "NOT_FOUND" };
      if (code === 9 || code === 10 || code === "failed-precondition") {
        return { status: "STALE" };
      }
      return {
        status: "FAILED",
        code: typeof code === "string" || typeof code === "number"
          ? String(code)
          : "firestore_delete_failed",
        retryable: retryableFirestoreCode(code),
      };
    }
  }

  async resetInstitution(
    manifest: PurgeManifest,
    _actorId: string,
    now: string,
  ): Promise<PurgeResetResult> {
    if (!getTestCooperativeDefinition(manifest.institutionId)) {
      return {
        status: "NOT_REQUIRED",
        resetFields: [],
        masterPreserved: true,
        completedAt: now,
      };
    }
    const ref = this.db
      .collection(DEMO_COOPERATIVE_COLLECTION)
      .doc(manifest.institutionId);
    try {
      const resetFields = await this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) {
          throw new PurgeStoreError("institution_master_not_found", 409);
        }
        const data = snapshot.data() as Record<string, unknown>;
        if (
          data.cooperativeId !== manifest.institutionId ||
          data.cooperativeName !== manifest.institutionName ||
          data.isDemoInstitution !== true ||
          data.dataClassification !== "DEMO" ||
          data.resettable !== true
        ) {
          throw new PurgeStoreError("institution_master_identity_mismatch", 409);
        }
        const patch: Record<string, unknown> = {};
        for (const preview of manifest.resetFields) {
          if (
            ALLOWED_RESET_FIELDS.has(preview.field) &&
            Object.hasOwn(data, preview.field)
          ) {
            patch[preview.field] = preview.expectedValue;
          }
        }
        if (Object.keys(patch).length > 0) {
          transaction.update(ref, patch as UpdateData<DocumentData>);
        }
        return Object.keys(patch).sort();
      });
      return {
        status: resetFields.length > 0 ? "APPLIED" : "NOT_REQUIRED",
        resetFields,
        masterPreserved: true,
        completedAt: now,
      };
    } catch (error) {
      return {
        status: "FAILED",
        resetFields: [],
        masterPreserved: true,
        completedAt: now,
        errorCode:
          error instanceof PurgeStoreError
            ? error.code
            : "signup_state_reset_failed",
      };
    }
  }
}

export class PurgeStoreError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "PurgeStoreError";
    this.code = code;
    this.status = status;
  }
}
