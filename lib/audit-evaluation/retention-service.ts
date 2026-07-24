import "server-only";

import { createHash } from "node:crypto";
import type {
  DocumentData,
  DocumentReference,
  Firestore,
} from "firebase-admin/firestore";
import { AUDIT_EVALUATION_COLLECTIONS } from "@/lib/audit-evaluation/collections";
import { evaluationConfigSchema } from "@/lib/audit-evaluation/schemas";
import type {
  AuditEvaluationActor,
  EvaluationConfig,
  RetentionPolicy,
} from "@/lib/audit-evaluation/types";
import { adminDb, adminStorage } from "@/lib/firebase/admin";

const MAX_PLAN_ITEMS = 200;
const MANUAL_PLAN_LIFETIME_MS = 15 * 60 * 1_000;

export const RETENTION_CATEGORIES = [
  "SOURCE_DOCUMENT",
  "INTERMEDIATE_DATA",
  "REPORT",
  "EXPIRED_ACCESS",
  "AUDIT_LOG",
] as const;

export type RetentionCategory = (typeof RETENTION_CATEGORIES)[number];

type InternalRetentionItem = {
  category: RetentionCategory;
  recordId: string;
  caseId: string | null;
  reference: DocumentReference<DocumentData>;
  storagePaths: string[];
  impact: "SOURCE_ONLY" | "INTERMEDIATE_ONLY" | "REPORT_UNAVAILABLE" |
    "ACCESS_RECORD_ONLY" | "AUDIT_HISTORY_ONLY";
};

export type RetentionPreviewItem = Pick<
  InternalRetentionItem,
  "category" | "recordId" | "caseId" | "impact"
> & {
  storageObjectCount: number;
};

export type AuditEvaluationRetentionPreview = {
  asOf: string;
  planHash: string;
  policy: Required<RetentionPolicy>;
  automaticDeletionEnabled: boolean;
  truncated: boolean;
  items: RetentionPreviewItem[];
  counts: Record<RetentionCategory, number>;
};

export class AuditEvaluationRetentionError extends Error {
  constructor(
    readonly code:
      | "retention_config_not_found"
      | "invalid_retention_as_of"
      | "retention_plan_expired"
      | "retention_plan_changed",
  ) {
    super(code);
    this.name = "AuditEvaluationRetentionError";
  }
}

export class AuditEvaluationRetentionService {
  constructor(
    private readonly db: Firestore = adminDb(),
    private readonly bucket: {
      file(path: string): {
        delete(options: { ignoreNotFound: boolean }): Promise<unknown>;
      };
    } =
      adminStorage().bucket(),
  ) {}

  async preview(asOf = new Date().toISOString()) {
    const plan = await this.buildPlan(asOf);
    return publicPreview(plan);
  }

  async execute(input: {
    asOf: string;
    expectedPlanHash?: string;
    actor: AuditEvaluationActor;
    automatic: boolean;
  }) {
    const asOfMs = Date.parse(input.asOf);
    const now = new Date().toISOString();
    if (!Number.isFinite(asOfMs)) {
      throw new AuditEvaluationRetentionError("invalid_retention_as_of");
    }
    if (
      !input.automatic &&
      Date.now() - asOfMs > MANUAL_PLAN_LIFETIME_MS
    ) {
      throw new AuditEvaluationRetentionError("retention_plan_expired");
    }
    const plan = await this.buildPlan(input.asOf);
    if (
      input.expectedPlanHash &&
      input.expectedPlanHash !== plan.planHash
    ) {
      throw new AuditEvaluationRetentionError("retention_plan_changed");
    }
    if (input.automatic && !plan.policy.deleteAfterExpiry) {
      return {
        ...publicPreview(plan),
        executed: false,
        deletedCount: 0,
        failedCount: 0,
      };
    }

    const deletable: InternalRetentionItem[] = [];
    const failures: InternalRetentionItem[] = [];
    for (const item of plan.items) {
      try {
        for (const storagePath of item.storagePaths) {
          await this.bucket.file(storagePath).delete({ ignoreNotFound: true });
        }
        deletable.push(item);
      } catch {
        failures.push(item);
      }
    }

    const batch = this.db.batch();
    for (const item of deletable) {
      batch.delete(item.reference);
      writeRetentionLog(batch, this.db, {
        item,
        actor: input.actor,
        occurredAt: now,
        result: "DELETED",
      });
    }
    for (const item of failures) {
      writeRetentionLog(batch, this.db, {
        item,
        actor: input.actor,
        occurredAt: now,
        result: "STORAGE_DELETE_FAILED",
      });
    }
    await batch.commit();
    await this.repairLatestReportPointers(
      deletable.filter(({ category }) => category === "REPORT"),
      now,
    );

    return {
      ...publicPreview(plan),
      executed: true,
      deletedCount: deletable.length,
      failedCount: failures.length,
    };
  }

  private async buildPlan(asOf: string) {
    const asOfMs = Date.parse(asOf);
    if (!Number.isFinite(asOfMs)) {
      throw new AuditEvaluationRetentionError("invalid_retention_as_of");
    }
    const [config, snapshots] = await Promise.all([
      this.loadPublishedConfig(asOf),
      this.loadRetentionSnapshots(),
    ]);
    if (!config) {
      throw new AuditEvaluationRetentionError("retention_config_not_found");
    }
    const policy = resolveRetentionPolicy(config.retentionPolicy);
    const caseCreatedAt = new Map(
      snapshots.cases.docs.map((document) => [
        document.id,
        readInstant(document.data(), ["createdAt", "updatedAt"]),
      ]),
    );
    const items: InternalRetentionItem[] = [];
    const push = (item: InternalRetentionItem, occurredAt: string | null, days: number) => {
      if (
        occurredAt &&
        Date.parse(occurredAt) <= asOfMs - days * 86_400_000
      ) {
        items.push(item);
      }
    };

    for (const document of snapshots.documents.docs) {
      const data = document.data();
      const caseId = readId(data.caseId);
      push({
        category: "SOURCE_DOCUMENT",
        recordId: document.id,
        caseId,
        reference: document.ref,
        storagePaths: storagePaths(data, ["storagePath"]),
        impact: "SOURCE_ONLY",
      }, readInstant(data, ["uploadedAt", "createdAt"]) ??
        (caseId ? caseCreatedAt.get(caseId) ?? null : null),
      policy.sourceDocumentDays);
    }

    for (const source of snapshots.intermediates) {
      for (const document of source.docs) {
        const data = document.data();
        const caseId = readId(data.caseId);
        push({
          category: "INTERMEDIATE_DATA",
          recordId: document.id,
          caseId,
          reference: document.ref,
          storagePaths: storagePaths(data, ["quarantineStoragePath"]),
          impact: "INTERMEDIATE_ONLY",
        }, readInstant(data, [
          "completedAt",
          "updatedAt",
          "correctedAt",
          "confirmedAt",
          "createdAt",
        ]) ?? (caseId ? caseCreatedAt.get(caseId) ?? null : null),
        policy.normalizedDataDays);
      }
    }

    for (const document of snapshots.reports.docs) {
      const data = document.data();
      const caseId = readId(data.caseId);
      const rendering = isRecord(data.renderingReference)
        ? data.renderingReference
        : {};
      const reportPolicy = resolveRetentionPolicy(
        isRecord(data.evaluationConfigSnapshot) &&
            isRecord(data.evaluationConfigSnapshot.retentionPolicy)
          ? data.evaluationConfigSnapshot.retentionPolicy as RetentionPolicy
          : config.retentionPolicy,
      );
      push({
        category: "REPORT",
        recordId: document.id,
        caseId,
        reference: document.ref,
        storagePaths: storagePaths({
          pdf: data.pdfStoragePath,
          html: data.htmlStoragePath,
          payload: rendering.payloadStoragePath,
        }, ["pdf", "html", "payload"]),
        impact: "REPORT_UNAVAILABLE",
      }, readInstant(data, ["generatedAt", "requestedAt"]) ??
        (caseId ? caseCreatedAt.get(caseId) ?? null : null),
      reportPolicy.reportDays);
    }

    for (const source of [snapshots.tokens, snapshots.sessions]) {
      for (const document of source.docs) {
        const data = document.data();
        const expiresAt = readInstant(data, ["expiresAt"]);
        if (
          expiresAt &&
          Date.parse(expiresAt) <=
            asOfMs - policy.expiredAccessTokenDays * 86_400_000
        ) {
          items.push({
            category: "EXPIRED_ACCESS",
            recordId: document.id,
            caseId: readId(data.caseId),
            reference: document.ref,
            storagePaths: [],
            impact: "ACCESS_RECORD_ONLY",
          });
        }
      }
    }
    for (const document of snapshots.rateLimits.docs) {
      const data = document.data();
      const expiresAt = readInstant(data, ["expiresAt"]);
      if (expiresAt && Date.parse(expiresAt) <= asOfMs) {
        items.push({
          category: "EXPIRED_ACCESS",
          recordId: document.id,
          caseId: null,
          reference: document.ref,
          storagePaths: [],
          impact: "ACCESS_RECORD_ONLY",
        });
      }
    }

    for (const document of snapshots.auditLogs.docs) {
      const data = document.data();
      push({
        category: "AUDIT_LOG",
        recordId: document.id,
        caseId: readId(data.caseId),
        reference: document.ref,
        storagePaths: [],
        impact: "AUDIT_HISTORY_ONLY",
      }, readInstant(data, ["occurredAt"]), policy.auditLogDays);
    }

    const sorted = items.sort((left, right) =>
      `${left.category}:${left.recordId}`.localeCompare(
        `${right.category}:${right.recordId}`,
      )
    );
    const selected = sorted.slice(0, MAX_PLAN_ITEMS);
    return {
      asOf,
      policy,
      automaticDeletionEnabled: policy.deleteAfterExpiry,
      truncated: sorted.length > selected.length,
      items: selected,
      planHash: retentionPlanHash(asOf, config, selected),
    };
  }

  private async loadPublishedConfig(asOf: string) {
    const asOfMs = Date.parse(asOf);
    const snapshot = await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.configVersions)
      .where("status", "==", "PUBLISHED")
      .get();
    return snapshot.docs
      .flatMap((document) => {
        const parsed = evaluationConfigSchema.safeParse(document.data());
        if (!parsed.success) return [];
        const config = parsed.data;
        return (!config.effectiveFrom ||
            Date.parse(config.effectiveFrom) <= asOfMs) &&
            (!config.effectiveTo || Date.parse(config.effectiveTo) > asOfMs)
          ? [config]
          : [];
      })
      .sort((left, right) => {
        const published = (right.publishedAt ?? "").localeCompare(
          left.publishedAt ?? "",
        );
        return published || right.version - left.version;
      })[0] ?? null;
  }

  private async loadRetentionSnapshots() {
    const collection = (name: string) =>
      this.db.collection(name).orderBy("__name__").limit(1_000).get();
    const [
      cases,
      documents,
      normalizedQuotes,
      parsingQueue,
      extractionRuns,
      uploadIntents,
      corrections,
      confirmations,
      reports,
      tokens,
      sessions,
      rateLimits,
      auditLogs,
    ] = await Promise.all([
      collection(AUDIT_EVALUATION_COLLECTIONS.cases),
      collection(AUDIT_EVALUATION_COLLECTIONS.documents),
      collection(AUDIT_EVALUATION_COLLECTIONS.normalizedQuotes),
      collection(AUDIT_EVALUATION_COLLECTIONS.parsingQueue),
      collection(AUDIT_EVALUATION_COLLECTIONS.extractionRuns),
      collection(AUDIT_EVALUATION_COLLECTIONS.uploadIntents),
      collection(AUDIT_EVALUATION_COLLECTIONS.corrections),
      collection(AUDIT_EVALUATION_COLLECTIONS.confirmations),
      collection(AUDIT_EVALUATION_COLLECTIONS.reportRuns),
      collection(AUDIT_EVALUATION_COLLECTIONS.accessTokens),
      collection(AUDIT_EVALUATION_COLLECTIONS.sessions),
      collection(AUDIT_EVALUATION_COLLECTIONS.rateLimits),
      collection(AUDIT_EVALUATION_COLLECTIONS.auditLogs),
    ]);
    return {
      cases,
      documents,
      intermediates: [
        normalizedQuotes,
        parsingQueue,
        extractionRuns,
        uploadIntents,
        corrections,
        confirmations,
      ],
      reports,
      tokens,
      sessions,
      rateLimits,
      auditLogs,
    };
  }

  private async repairLatestReportPointers(
    deletedReports: InternalRetentionItem[],
    now: string,
  ) {
    for (const caseId of new Set(
      deletedReports
        .map(({ caseId }) => caseId)
        .filter((value): value is string => Boolean(value)),
    )) {
      const remaining = await this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.reportRuns)
        .where("caseId", "==", caseId)
        .get();
      const latest = remaining.docs
        .map((document) => Number(document.data().reportVersion))
        .filter((version) => Number.isInteger(version) && version > 0)
        .sort((left, right) => right - left)[0] ?? null;
      await this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.cases)
        .doc(caseId)
        .set({
          latestReportVersion: latest,
          updatedAt: now,
        }, { merge: true });
    }
  }
}

function publicPreview(plan: {
  asOf: string;
  planHash: string;
  policy: Required<RetentionPolicy>;
  automaticDeletionEnabled: boolean;
  truncated: boolean;
  items: InternalRetentionItem[];
}): AuditEvaluationRetentionPreview {
  const counts = Object.fromEntries(
    RETENTION_CATEGORIES.map((category) => [category, 0]),
  ) as Record<RetentionCategory, number>;
  const items = plan.items.map((item) => {
    counts[item.category] += 1;
    return {
      category: item.category,
      recordId: item.recordId,
      caseId: item.caseId,
      impact: item.impact,
      storageObjectCount: item.storagePaths.length,
    };
  });
  return { ...plan, items, counts };
}

function resolveRetentionPolicy(
  policy: RetentionPolicy,
): Required<RetentionPolicy> {
  return {
    ...policy,
    expiredAccessTokenDays: policy.expiredAccessTokenDays ?? 30,
    auditLogDays: policy.auditLogDays ?? 2_555,
  };
}

function retentionPlanHash(
  asOf: string,
  config: EvaluationConfig,
  items: InternalRetentionItem[],
) {
  return createHash("sha256").update(JSON.stringify({
    asOf,
    config: `${config.id}:${config.version}`,
    items: items.map((item) => ({
      category: item.category,
      recordId: item.recordId,
      paths: item.storagePaths,
    })),
  })).digest("hex");
}

function writeRetentionLog(
  batch: ReturnType<Firestore["batch"]>,
  db: Firestore,
  input: {
    item: InternalRetentionItem;
    actor: AuditEvaluationActor;
    occurredAt: string;
    result: "DELETED" | "STORAGE_DELETE_FAILED";
  },
) {
  const reference = db
    .collection(AUDIT_EVALUATION_COLLECTIONS.auditLogs)
    .doc();
  batch.create(reference, {
    id: reference.id,
    caseId: input.item.caseId,
    reportVersion: null,
    documentId:
      input.item.category === "SOURCE_DOCUMENT"
        ? input.item.recordId
        : null,
    action: "RETENTION_EXPIRED",
    actor: input.actor,
    occurredAt: input.occurredAt,
    detail: [
      input.item.category,
      input.item.recordId,
      input.result,
    ].join(":"),
    errorCode:
      input.result === "DELETED" ? null : input.result,
    retryCount: null,
  });
}

function storagePaths(
  value: Record<string, unknown>,
  keys: string[],
) {
  return keys.flatMap((key) => {
    const path = value[key];
    return typeof path === "string" &&
      path.startsWith("audit-evaluation/")
      ? [path]
      : [];
  });
}

function readInstant(
  value: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const candidate = value[key];
    if (
      typeof candidate === "string" &&
      Number.isFinite(Date.parse(candidate))
    ) {
      return candidate;
    }
    if (
      candidate &&
      typeof candidate === "object" &&
      "toDate" in candidate &&
      typeof candidate.toDate === "function"
    ) {
      return candidate.toDate().toISOString();
    }
  }
  return null;
}

function readId(value: unknown) {
  return typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
