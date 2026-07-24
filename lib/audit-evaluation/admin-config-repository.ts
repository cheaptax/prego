import { randomUUID } from "node:crypto";
import type {
  Firestore,
  Query,
  Transaction,
} from "firebase-admin/firestore";
import {
  AdminConfigValidationError,
  buildPatchedDraft,
  createPublishedCandidate,
  periodsOverlap,
  type AdminConfigValidationIssue,
  type AdminConfigValidationResult,
  validateEvaluationConfigForPublish,
} from "@/lib/audit-evaluation/admin-config-validation";
import { AUDIT_EVALUATION_COLLECTIONS } from "@/lib/audit-evaluation/collections";
import { createDefaultAuditQualityDraft } from "@/lib/audit-evaluation/default-evaluation-draft";
import { evaluationConfigSchema } from "@/lib/audit-evaluation/schemas";
import type { EvaluationConfig } from "@/lib/audit-evaluation/types";
import { CMS_COLLECTIONS } from "@/lib/cms/constants";
import { cmsAssetSchema } from "@/lib/cms/schemas";
import { adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";

export type AuditEvaluationLogoAsset = {
  assetId: string;
  originalFileName: string;
  alt: string;
};

export class AdminConfigRepositoryError extends Error {
  constructor(
    readonly code:
      | "config_not_found"
      | "draft_not_found"
      | "draft_revision_conflict"
      | "published_version_immutable"
      | "republish_source_not_published"
      | "validation_failed"
      | "warnings_confirmation_required"
      | "data_integrity_error",
    readonly validation?: AdminConfigValidationResult,
  ) {
    super(code);
    this.name = "AdminConfigRepositoryError";
  }
}

export interface AuditEvaluationAdminConfigRepository {
  listVersions(): Promise<EvaluationConfig[]>;
  listPublishedLogoAssets(): Promise<AuditEvaluationLogoAsset[]>;
  getVersion(configId: string, version: number): Promise<EvaluationConfig | null>;
  createDefaultDraft(actorUid: string, now?: string): Promise<EvaluationConfig>;
  cloneVersion(input: {
    configId: string;
    version: number;
    actorUid: string;
    action: "cloneVersion" | "republishVersion";
    now?: string;
  }): Promise<EvaluationConfig>;
  patchDraft(input: {
    configId: string;
    version: number;
    expectedDraftRevision: number;
    changes: Parameters<typeof buildPatchedDraft>[0]["changes"];
    actorUid: string;
    now?: string;
  }): Promise<EvaluationConfig>;
  publishDraft(input: {
    configId: string;
    version: number;
    expectedDraftRevision: number;
    confirmWarnings: boolean;
    actorUid: string;
    now?: string;
  }): Promise<{
    config: EvaluationConfig;
    validation: AdminConfigValidationResult;
  }>;
}

export class FirestoreAuditEvaluationAdminConfigRepository
  implements AuditEvaluationAdminConfigRepository
{
  constructor(private readonly db: Firestore = adminDb()) {}

  async listVersions() {
    const snapshot = await this.configCollection().get();
    return snapshot.docs
      .map((document) => parseStoredConfig(document.data(), document.id))
      .sort(compareNewest);
  }

  async listPublishedLogoAssets() {
    const snapshot = await this.db
      .collection(CMS_COLLECTIONS.assets)
      .where("status", "==", "published")
      .get();
    return snapshot.docs
      .flatMap((document) => {
        const parsed = cmsAssetSchema.safeParse(document.data());
        if (
          !parsed.success ||
          (parsed.data.mimeType !== "image/png" &&
            parsed.data.mimeType !== "image/jpeg")
        ) {
          return [];
        }
        return [{
          assetId: parsed.data.assetId,
          originalFileName: parsed.data.originalFileName,
          alt: parsed.data.alt,
        }];
      })
      .sort((left, right) =>
        left.originalFileName.localeCompare(right.originalFileName, "ko")
      );
  }

  async getVersion(configId: string, version: number) {
    const snapshot = await this.versionRef(configId, version).get();
    if (snapshot.exists) {
      return parseStoredConfig(snapshot.data(), snapshot.id);
    }
    const legacySnapshot = await this.configCollection()
      .where("id", "==", configId)
      .get();
    const legacy = legacySnapshot.docs.find((document) => {
      const parsed = evaluationConfigSchema.safeParse(document.data());
      return parsed.success && parsed.data.version === version;
    });
    return legacy ? parseStoredConfig(legacy.data(), legacy.id) : null;
  }

  async createDefaultDraft(actorUid: string, now = new Date().toISOString()) {
    return this.db.runTransaction(async (transaction) => {
      const base = createDefaultAuditQualityDraft({
        createdBy: actorUid,
        createdAt: now,
      });
      const versions = await this.readVersions(transaction, base.id);
      const config = evaluationConfigSchema.parse({
        ...base,
        version: nextVersion(versions),
        draftRevision: 1,
        updatedBy: actorUid,
        updatedAt: now,
      });
      transaction.create(this.versionRef(config.id, config.version), config);
      this.writeMutationAuditLog(transaction, {
        actorUid,
        action: "CONFIG_DEFAULT_DRAFT_CREATED",
        occurredAt: now,
        config,
      });
      return config;
    });
  }

  async cloneVersion(input: {
    configId: string;
    version: number;
    actorUid: string;
    action: "cloneVersion" | "republishVersion";
    now?: string;
  }) {
    const now = input.now ?? new Date().toISOString();
    return this.db.runTransaction(async (transaction) => {
      const sourceSnapshot = await this.findVersionSnapshot(
        transaction,
        input.configId,
        input.version,
      );
      if (!sourceSnapshot) {
        throw new AdminConfigRepositoryError("config_not_found");
      }
      const source = parseStoredConfig(
        sourceSnapshot.data(),
        sourceSnapshot.id,
      );
      if (
        input.action === "republishVersion" &&
        source.status !== "PUBLISHED"
      ) {
        throw new AdminConfigRepositoryError(
          "republish_source_not_published",
        );
      }
      const versions = await this.readVersions(transaction, input.configId);
      const config = evaluationConfigSchema.parse({
        ...source,
        version: nextVersion(versions),
        status: "DRAFT",
        createdBy: input.actorUid,
        createdAt: now,
        draftRevision: 1,
        updatedBy: input.actorUid,
        updatedAt: now,
        publishedBy: null,
        publishedAt: null,
      });
      transaction.create(this.versionRef(config.id, config.version), config);
      this.writeMutationAuditLog(transaction, {
        actorUid: input.actorUid,
        action: input.action === "republishVersion"
          ? "CONFIG_REPUBLISH_DRAFT_CREATED"
          : "CONFIG_VERSION_CLONED",
        occurredAt: now,
        config,
        detail: `source=${source.id}:v${source.version}`,
      });
      return config;
    });
  }

  async patchDraft(input: {
    configId: string;
    version: number;
    expectedDraftRevision: number;
    changes: Parameters<typeof buildPatchedDraft>[0]["changes"];
    actorUid: string;
    now?: string;
  }) {
    const now = input.now ?? new Date().toISOString();
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await this.findVersionSnapshot(
        transaction,
        input.configId,
        input.version,
      );
      if (!snapshot) {
        throw new AdminConfigRepositoryError("draft_not_found");
      }
      const reference = snapshot.ref;
      const existing = parseStoredConfig(snapshot.data(), snapshot.id);
      if (existing.status !== "DRAFT") {
        throw new AdminConfigRepositoryError("published_version_immutable");
      }
      if (
        (existing.draftRevision ?? 1) !== input.expectedDraftRevision
      ) {
        throw new AdminConfigRepositoryError("draft_revision_conflict");
      }
      let config: EvaluationConfig;
      try {
        config = buildPatchedDraft({
          existing,
          changes: input.changes,
          actorUid: input.actorUid,
          now,
        });
      } catch (error) {
        if (error instanceof AdminConfigValidationError) {
          throw new AdminConfigRepositoryError(
            error.code,
            validationFromIssues(existing, error.issues),
          );
        }
        throw error;
      }
      transaction.set(reference, withoutUndefined(config));
      this.writeMutationAuditLog(transaction, {
        actorUid: input.actorUid,
        action: "CONFIG_DRAFT_UPDATED",
        occurredAt: now,
        config,
      });
      return config;
    });
  }

  async publishDraft(input: {
    configId: string;
    version: number;
    expectedDraftRevision: number;
    confirmWarnings: boolean;
    actorUid: string;
    now?: string;
  }) {
    const now = input.now ?? new Date().toISOString();
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await this.findVersionSnapshot(
        transaction,
        input.configId,
        input.version,
      );
      if (!snapshot) {
        throw new AdminConfigRepositoryError("draft_not_found");
      }
      const reference = snapshot.ref;
      const draft = parseStoredConfig(snapshot.data(), snapshot.id);
      if (draft.status !== "DRAFT") {
        throw new AdminConfigRepositoryError("published_version_immutable");
      }
      if ((draft.draftRevision ?? 1) !== input.expectedDraftRevision) {
        throw new AdminConfigRepositoryError("draft_revision_conflict");
      }
      const publishedSnapshot = await transaction.get(
        this.configCollection().where("status", "==", "PUBLISHED"),
      );
      const publishedVersions = publishedSnapshot.docs.map((document) =>
        parseStoredConfig(document.data(), document.id)
      );
      const validation = validateEvaluationConfigForPublish(
        draft,
        publishedVersions,
      );
      if (!validation.valid) {
        throw new AdminConfigRepositoryError("validation_failed", validation);
      }
      if (
        validation.issues.some((issue) => issue.severity === "warning") &&
        !input.confirmWarnings
      ) {
        throw new AdminConfigRepositoryError(
          "warnings_confirmation_required",
          validation,
        );
      }
      const config = createPublishedCandidate({
        draft,
        actorUid: input.actorUid,
        now,
      });
      for (const document of publishedSnapshot.docs) {
        const published = parseStoredConfig(document.data(), document.id);
        if (
          published.id === config.id &&
          published.version !== config.version &&
          periodsOverlap(config, published)
        ) {
          transaction.set(
            document.ref,
            withoutUndefined({
              ...published,
              status: "ARCHIVED",
              updatedBy: input.actorUid,
              updatedAt: now,
            }),
            { merge: false },
          );
        }
      }
      transaction.set(reference, withoutUndefined(config));
      this.writeMutationAuditLog(transaction, {
        actorUid: input.actorUid,
        action: "CONFIG_VERSION_PUBLISHED",
        occurredAt: now,
        config,
      });
      return { config, validation };
    });
  }

  private configCollection() {
    return this.db.collection(AUDIT_EVALUATION_COLLECTIONS.configVersions);
  }

  private versionRef(configId: string, version: number) {
    return this.configCollection().doc(
      auditEvaluationConfigVersionDocumentId(configId, version),
    );
  }

  private async readVersions(
    transaction: Transaction,
    configId: string,
  ) {
    const query: Query = this.configCollection().where("id", "==", configId);
    const snapshot = await transaction.get(query);
    return snapshot.docs.map((document) =>
      parseStoredConfig(document.data(), document.id)
    );
  }

  private async findVersionSnapshot(
    transaction: Transaction,
    configId: string,
    version: number,
  ) {
    const canonical = this.versionRef(configId, version);
    const canonicalSnapshot = await transaction.get(canonical);
    if (canonicalSnapshot.exists) return canonicalSnapshot;
    const snapshot = await transaction.get(
      this.configCollection().where("id", "==", configId),
    );
    return snapshot.docs.find((document) => {
      const parsed = evaluationConfigSchema.safeParse(document.data());
      return parsed.success && parsed.data.version === version;
    }) ?? null;
  }

  private writeMutationAuditLog(
    transaction: Transaction,
    input: {
      actorUid: string;
      action: string;
      occurredAt: string;
      config: EvaluationConfig;
      detail?: string;
    },
  ) {
    const id = `ael_${randomUUID()}`;
    const reference = this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.auditLogs)
      .doc(id);
    transaction.create(reference, {
      id,
      caseId: null,
      reportVersion: null,
      action: input.action,
      actor: { type: "ADMIN", uid: input.actorUid },
      occurredAt: input.occurredAt,
      detail:
        input.detail ??
        `config=${input.config.id}:v${input.config.version}:revision=${input.config.draftRevision ?? 1}`,
    });
  }
}

export function auditEvaluationConfigVersionDocumentId(
  configId: string,
  version: number,
) {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("invalid_config_version");
  }
  return `${Buffer.from(configId, "utf8").toString("base64url")}.v${version}`;
}

function parseStoredConfig(value: unknown, _documentId: string) {
  if (_documentId.length === 0) {
    throw new AdminConfigRepositoryError("data_integrity_error");
  }
  const parsed = evaluationConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw new AdminConfigRepositoryError("data_integrity_error");
  }
  return parsed.data;
}

function nextVersion(versions: readonly EvaluationConfig[]) {
  return versions.reduce(
    (maximum, config) => Math.max(maximum, config.version),
    0,
  ) + 1;
}

function compareNewest(left: EvaluationConfig, right: EvaluationConfig) {
  const leftTime = Date.parse(left.updatedAt ?? left.createdAt);
  const rightTime = Date.parse(right.updatedAt ?? right.createdAt);
  if (leftTime !== rightTime) return rightTime - leftTime;
  if (left.id !== right.id) return left.id < right.id ? -1 : 1;
  return right.version - left.version;
}

function validationFromIssues(
  config: EvaluationConfig,
  issues: AdminConfigValidationIssue[],
): AdminConfigValidationResult {
  const base = validateEvaluationConfigForPublish(config);
  return { ...base, valid: false, issues };
}
