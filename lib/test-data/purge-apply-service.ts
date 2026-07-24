import { createHash, randomUUID } from "node:crypto";
import {
  MAX_PURGE_AUTH_USERS,
  MAX_PURGE_FIRESTORE_DOCUMENTS,
  MAX_PURGE_STORAGE_BYTES,
  MAX_PURGE_STORAGE_OBJECTS,
  expectedPurgeConfirmation,
  firestoreTargetCount,
  isDeferredStep6Item,
  isMasterOrControlTarget,
  orderedFirestoreTargets,
  phaseForPurgeItem,
  reviewItemCount,
  storageByteCount,
} from "@/lib/test-data/purge-apply-policy";
import type {
  PurgeApplyRequest,
  PurgeApplyResult,
  PurgeAuditRecord,
  PurgeControlStore,
  PurgeExternalExecutor,
  PurgeExternalItemStatus,
  PurgeExternalOperationResult,
  PurgeFailedItem,
  PurgeFirestoreExecutor,
  PurgeJobRecord,
  PurgeJobPhase,
  PurgeOrphanVerifier,
} from "@/lib/test-data/purge-job-types";
import type {
  PurgeManifest,
  PurgeManifestItem,
} from "@/lib/test-data/purge-types";
import type { PurgeScanService } from "@/lib/test-data/purge-scan-service";

const DEFAULT_MAX_ITEMS_PER_RUN = 250;
const LOCK_LEASE_MS = 5 * 60 * 1_000;

export type PurgeApplyConfiguration = {
  enabled: boolean;
  productionEnabled: boolean;
  allowedProjectId: string;
  maxItemsPerRun?: number;
};

export class PurgeApplyService {
  private readonly store: PurgeControlStore;
  private readonly executor: PurgeFirestoreExecutor;
  private readonly scanner: PurgeScanService;
  private readonly configuration: PurgeApplyConfiguration;
  private readonly externalExecutor?: PurgeExternalExecutor;
  private readonly orphanVerifier?: PurgeOrphanVerifier;

  constructor(input: {
    store: PurgeControlStore;
    executor: PurgeFirestoreExecutor;
    scanner: PurgeScanService;
    configuration: PurgeApplyConfiguration;
    externalExecutor?: PurgeExternalExecutor;
    orphanVerifier?: PurgeOrphanVerifier;
  }) {
    this.store = input.store;
    this.executor = input.executor;
    this.scanner = input.scanner;
    this.configuration = input.configuration;
    this.externalExecutor = input.externalExecutor;
    this.orphanVerifier = input.orphanVerifier;
  }

  async registerManifest(input: {
    manifest: PurgeManifest;
    approvedBy: string;
    approvedByEmail?: string;
    environment: string;
    projectId: string;
    now?: string;
  }) {
    const now = input.now ?? new Date().toISOString();
    this.validateEnvironment(input.environment, input.projectId);
    this.validateManifestForApply(input.manifest, {
      environment: input.environment,
      projectId: input.projectId,
      confirmation: expectedPurgeConfirmation(input.manifest),
      now,
    });
    const current = await this.scanner.scan({
      institutionId: input.manifest.institutionId,
      mode: "DRY_RUN",
      generatedBy: input.manifest.generatedBy,
      environment: input.environment,
      projectId: input.projectId,
      now,
    });
    if (
      current.checksum !== input.manifest.checksum ||
      manifestSecurityShape(current) !== manifestSecurityShape(input.manifest)
    ) {
      throw new PurgeApplyError("manifest_checksum_mismatch", 409);
    }
    return this.store.registerManifest({
      manifest: input.manifest,
      approvedBy: input.approvedBy,
      approvedByEmail: input.approvedByEmail,
      approvedAt: now,
    });
  }

  async previewRegisteredManifest(input: {
    manifestId: string;
    environment: string;
    projectId: string;
    now?: string;
  }) {
    const now = input.now ?? new Date().toISOString();
    this.validateEnvironment(input.environment, input.projectId);
    const registered = await this.requireRegisteredManifest(input.manifestId);
    this.validateManifestForApply(registered.manifest, {
      environment: input.environment,
      projectId: input.projectId,
      confirmation: expectedPurgeConfirmation(registered.manifest),
      now,
    });
    return {
      manifestId: registered.manifest.manifestId,
      institutionId: registered.manifest.institutionId,
      institutionName: registered.manifest.institutionName,
      confirmation: expectedPurgeConfirmation(registered.manifest),
      firestoreTargetCount: firestoreTargetCount(registered.manifest),
      pendingAuthCount: registered.manifest.authUsers.filter(
        (item) => item.classification === "CONFIRMED_TEST" && item.exists !== false,
      ).length,
      pendingStorageCount: registered.manifest.storageObjects.filter(
        (item) => item.classification === "CONFIRMED_TEST" && item.exists !== false,
      ).length,
      expiresAt: registered.manifest.expiresAt,
      checksum: registered.manifest.checksum,
    };
  }

  async apply(request: PurgeApplyRequest): Promise<PurgeApplyResult> {
    const now = request.now ?? new Date().toISOString();
    this.validateEnvironment(request.environment, request.projectId);
    const registered = await this.requireRegisteredManifest(request.manifestId);
    const manifest = registered.manifest;
    this.validateManifestForApply(manifest, {
      environment: request.environment,
      projectId: request.projectId,
      confirmation: request.confirmation,
      now,
    });

    const started = await this.store.beginOrResumeJob({
      manifest,
      requestedBy: request.requestedBy,
      requestedByEmail: request.requestedByEmail,
      requestId: request.requestId,
      now,
      lockLeaseExpiresAt: new Date(
        Date.parse(now) + LOCK_LEASE_MS,
      ).toISOString(),
    });
    let job = started.job;
    if (started.idempotentReplay && job.status === "COMPLETED") {
      return {
        job,
        idempotentReplay: true,
        continuationRequired: false,
      };
    }
    if (
      job.status === "PARTIALLY_FAILED" &&
      job.currentPhase === "AWAITING_AUTH_STORAGE" &&
      !this.externalExecutor
    ) {
      return {
        job,
        idempotentReplay: true,
        continuationRequired: false,
      };
    }
    if (
      started.idempotentReplay &&
      job.status === "PARTIALLY_FAILED" &&
      job.currentPhase === "AWAITING_AUTH_STORAGE" &&
      this.externalExecutor
    ) {
      job = {
        ...job,
        status: "VALIDATING",
        currentPhase: "VALIDATING_MANIFEST",
        requestId: request.requestId,
        requestedBy: request.requestedBy,
        requestedByEmail: request.requestedByEmail,
        attemptCount: job.attemptCount + 1,
        updatedAt: now,
      };
      await this.store.updateJob(job);
    }

    try {
      const current = await this.scanner.scan({
        institutionId: manifest.institutionId,
        mode: "DRY_RUN",
        generatedBy: manifest.generatedBy,
        environment: request.environment,
        projectId: request.projectId,
        now,
      });
      this.validateCurrentSnapshot(manifest, current, job);
    } catch (error) {
      job = await this.blockJob(
        job,
        error instanceof PurgeApplyError ? error.code : "manifest_revalidation_failed",
        now,
      );
      await this.store.releaseLock(job, now);
      await this.writeAudit(job, now);
      if (error instanceof PurgeApplyError) throw error;
      throw new PurgeApplyError("manifest_revalidation_failed", 409);
    }

    if (this.externalExecutor) {
      job = await this.runAuthPhase(
        job,
        manifest,
        "VALIDATING_MANIFEST",
        "validated",
        (uid) => this.externalExecutor!.validateAuthTarget(manifest, uid),
        now,
      );
      const authValidationFailure = await this.finishExternalFailure(job, now);
      if (authValidationFailure) return authValidationFailure;

      job = await this.runStoragePhase(
        job,
        manifest,
        "VALIDATING_MANIFEST",
        true,
        (path) => this.externalExecutor!.validateStorageTarget(manifest, path),
        now,
      );
      const storageValidationFailure = await this.finishExternalFailure(job, now);
      if (storageValidationFailure) return storageValidationFailure;

      job = await this.runAuthPhase(
        job,
        manifest,
        "DISABLE_AUTH_USERS",
        "disabled",
        (uid) => this.externalExecutor!.disableAuthUser(uid),
        now,
      );
      const disableFailure = await this.finishExternalFailure(job, now);
      if (disableFailure) return disableFailure;

      job = await this.runAuthPhase(
        job,
        manifest,
        "REVOKE_SESSIONS",
        "sessionsRevoked",
        (uid) => this.externalExecutor!.revokeAuthSessions(uid),
        now,
      );
      const revokeFailure = await this.finishExternalFailure(job, now);
      if (revokeFailure) return revokeFailure;
    }

    job = {
      ...job,
      status: "RUNNING",
      currentPhase: this.externalExecutor
        ? "DELETE_FIRESTORE_DATA"
        : "DELETING_ACCESS_RECORDS",
      updatedAt: now,
    };
    if (this.externalExecutor) {
      job = this.startPhase(job, "DELETE_FIRESTORE_DATA", now);
    }
    await this.store.updateJob(job);

    const targets = orderedFirestoreTargets(manifest);
    let processedThisRun = 0;
    for (const item of targets) {
      if (
        job.itemResults[item.resourcePath] === "DELETED" ||
        job.itemResults[item.resourcePath] === "NOT_FOUND" ||
        job.itemResults[item.resourcePath] === "DEFERRED_STEP_6"
      ) {
        continue;
      }
      if (isDeferredStep6Item(item)) {
        job = this.recordItem(job, item, "DEFERRED_STEP_6", now);
        continue;
      }
      if (processedThisRun >=
          (this.configuration.maxItemsPerRun ?? DEFAULT_MAX_ITEMS_PER_RUN)) {
        job = {
          ...job,
          status: "PARTIALLY_FAILED",
          updatedAt: now,
        };
        await this.store.updateJob(job);
        await this.writeAudit(job, now);
        return {
          job,
          idempotentReplay: false,
          continuationRequired: true,
        };
      }
      if (isMasterOrControlTarget(item)) {
        job = await this.blockJob(job, "master_or_control_target_forbidden", now);
        await this.writeAudit(job, now);
        throw new PurgeApplyError("master_or_control_target_forbidden", 409);
      }
      const phase = phaseForPurgeItem(item);
      if (phase === "DELETING_ORGANIZATION") {
        await this.revalidateRemainingOrBlock(manifest, job, request, now);
      }
      if (job.currentPhase !== phase) {
        job = { ...job, currentPhase: phase, updatedAt: now };
        await this.store.updateJob(job);
      }
      const result = await this.executor.deleteManifestItem(item);
      processedThisRun += 1;
      if (result.status === "DELETED" || result.status === "NOT_FOUND") {
        job = this.recordItem(job, item, result.status, now);
        await this.store.updateJob(job);
        continue;
      }
      if (result.status === "STALE") {
        job = this.recordFailure(
          job,
          item,
          phase,
          "stale_document_precondition",
          false,
          now,
          "BLOCKED",
        );
        await this.store.updateJob(job);
        await this.writeAudit(job, now);
        throw new PurgeApplyError("stale_document_precondition", 409);
      }
      job = this.recordFailure(
        job,
        item,
        phase,
        result.code,
        result.retryable,
        now,
        "PARTIALLY_FAILED",
      );
      await this.store.updateJob(job);
      await this.writeAudit(job, now);
      return {
        job,
        idempotentReplay: false,
        continuationRequired: result.retryable,
      };
    }

    await this.revalidateRemainingOrBlock(manifest, job, request, now);

    if (this.externalExecutor) {
      job = this.finishPhase(
        job,
        "DELETE_FIRESTORE_DATA",
        Object.values(job.itemResults).filter(
          (status) => status === "DELETED" || status === "NOT_FOUND",
        ).length,
        now,
      );
      await this.store.updateJob(job);

      job = await this.runStoragePhase(
        job,
        manifest,
        "DELETE_STORAGE_OBJECTS",
        false,
        (path) => this.externalExecutor!.deleteStorageObject(manifest, path),
        now,
      );
      const storageDeleteFailure = await this.finishExternalFailure(job, now);
      if (storageDeleteFailure) return storageDeleteFailure;

      job = await this.runAuthPhase(
        job,
        manifest,
        "DELETE_AUTH_USERS",
        "deleted",
        (uid) => this.externalExecutor!.deleteAuthUser(uid),
        now,
      );
      const authDeleteFailure = await this.finishExternalFailure(job, now);
      if (authDeleteFailure) return authDeleteFailure;

      job = await this.deleteDeferredAuthRegistries(manifest, job, now);
      const registryFailure = await this.finishExternalFailure(job, now);
      if (registryFailure) return registryFailure;

      job = this.startPhase(job, "RESET_INSTITUTION", now);
      await this.store.updateJob(job);
      const resetResult = await this.executor.resetInstitution(
        manifest,
        request.requestedBy,
        now,
      );
      job = { ...job, resetResult, updatedAt: now };
      if (resetResult.status === "FAILED") {
        job = this.recordPhaseFailure(
          job,
          "RESET_INSTITUTION",
          manifest.institutionId,
          resetResult.errorCode ?? "signup_state_reset_failed",
          true,
          now,
        );
        await this.store.updateJob(job);
        await this.writeAudit(job, now);
        return {
          job,
          idempotentReplay: false,
          continuationRequired: true,
        };
      }
      job = this.finishPhase(job, "RESET_INSTITUTION", 1, now);
      await this.store.updateJob(job);

      if (!this.orphanVerifier) {
        job = this.recordPhaseFailure(
          job,
          "VERIFY_ORPHANS",
          manifest.institutionId,
          "orphan_verifier_not_configured",
          false,
          now,
          "BLOCKED",
        );
        await this.store.updateJob(job);
        await this.writeAudit(job, now);
        throw new PurgeApplyError("orphan_verifier_not_configured", 500);
      }
      job = this.startPhase(job, "VERIFY_ORPHANS", now);
      await this.store.updateJob(job);
      const orphanVerification = await this.orphanVerifier.verify(
        manifest,
        job,
        now,
      );
      job = { ...job, orphanVerification, updatedAt: now };
      if (!orphanVerification.passed) {
        const hasNewUnconfirmedData = orphanVerification.findings.some(
          (finding) => finding.type === "NEW_UNCONFIRMED_DATA",
        );
        job = this.recordPhaseFailure(
          job,
          "VERIFY_ORPHANS",
          manifest.institutionId,
          hasNewUnconfirmedData
            ? "new_unconfirmed_data_after_manifest"
            : "orphan_verification_failed",
          !hasNewUnconfirmedData,
          now,
          hasNewUnconfirmedData ? "BLOCKED" : "PARTIALLY_FAILED",
        );
        await this.store.updateJob(job);
        await this.writeAudit(job, now);
        return {
          job,
          idempotentReplay: false,
          continuationRequired: !hasNewUnconfirmedData,
        };
      }
      job = this.finishPhase(job, "VERIFY_ORPHANS", 1, now);
      job = this.startPhase(job, "COMPLETE", now);
      job = this.finishPhase(job, "COMPLETE", 1, now);
      job = {
        ...job,
        status: "COMPLETED",
        currentPhase: "COMPLETE",
        completedAt: now,
        updatedAt: now,
      };
      job = await this.persistCompletedJob(job, now);
      return {
        job,
        idempotentReplay: false,
        continuationRequired: false,
      };
    }

    const hasStep6Pending =
      job.pendingAuthUids.length > 0 ||
      job.pendingStoragePaths.length > 0 ||
      Object.values(job.itemResults).includes("DEFERRED_STEP_6");
    if (hasStep6Pending) {
      job = {
        ...job,
        status: "PARTIALLY_FAILED",
        currentPhase: "AWAITING_AUTH_STORAGE",
        updatedAt: now,
      };
      await this.store.updateJob(job);
      await this.writeAudit(job, now);
      return {
        job,
        idempotentReplay: false,
        continuationRequired: false,
      };
    }

    job = {
      ...job,
      currentPhase: "RESETTING_SIGNUP_STATE",
      updatedAt: now,
    };
    await this.store.updateJob(job);
    const resetResult = await this.executor.resetInstitution(
      manifest,
      request.requestedBy,
      now,
    );
    job = { ...job, resetResult, updatedAt: now };
    if (resetResult.status === "FAILED") {
      job = {
        ...job,
        status: "PARTIALLY_FAILED",
        failedItems: [
          ...job.failedItems.filter(
            (item) => item.resourcePath !== manifest.institutionId,
          ),
          {
            resourcePath: manifest.institutionId,
            phase: "RESETTING_SIGNUP_STATE",
            code: resetResult.errorCode ?? "signup_state_reset_failed",
            retryable: true,
            occurredAt: now,
          },
        ],
      };
      await this.store.updateJob(job);
      await this.writeAudit(job, now);
      return {
        job,
        idempotentReplay: false,
        continuationRequired: true,
      };
    }

    job = {
      ...job,
      status: "COMPLETED",
      currentPhase: "DONE",
      completedAt: now,
      updatedAt: now,
    };
    job = await this.persistCompletedJob(job, now);
    return {
      job,
      idempotentReplay: false,
      continuationRequired: false,
    };
  }

  private async runAuthPhase(
    job: PurgeJobRecord,
    manifest: PurgeManifest,
    phase: PurgeJobPhase,
    field: "validated" | "disabled" | "sessionsRevoked" | "deleted",
    operation: (uid: string) => Promise<PurgeExternalOperationResult>,
    now: string,
  ) {
    let current = this.startPhase(job, phase, now);
    await this.store.updateJob(current);
    let successCount = 0;
    const candidates = manifest.authUsers.filter(
      (item) =>
        item.classification === "CONFIRMED_TEST" &&
        item.exists !== false,
    );
    for (const candidate of candidates) {
      const existing = current.authResults?.[candidate.uid] ?? {
        validated: "PENDING" as const,
        disabled: "PENDING" as const,
        sessionsRevoked: "PENDING" as const,
        deleted: "PENDING" as const,
      };
      if (
        existing[field] === terminalAuthStatus(field) ||
        existing[field] === "NOT_FOUND"
      ) {
        successCount += 1;
        continue;
      }
      const result = await operation(candidate.uid);
      if (result.status === "SUCCESS" || result.status === "NOT_FOUND") {
        const status: PurgeExternalItemStatus =
          result.status === "NOT_FOUND"
            ? "NOT_FOUND"
            : terminalAuthStatus(field);
        current = {
          ...current,
          authResults: {
            ...current.authResults,
            [candidate.uid]: { ...existing, [field]: status },
          },
          pendingAuthUids:
            field === "deleted"
              ? current.pendingAuthUids.filter((uid) => uid !== candidate.uid)
              : current.pendingAuthUids,
          deletedCounts: {
            ...current.deletedCounts,
            firebaseAuth:
              field === "deleted" && result.status === "SUCCESS"
                ? (current.deletedCounts.firebaseAuth ?? 0) + 1
                : (current.deletedCounts.firebaseAuth ?? 0),
          },
          failedItems: current.failedItems.filter(
            (item) =>
              item.resourcePath !== `firebaseAuth/${candidate.uid}` ||
              item.phase !== phase,
          ),
          updatedAt: now,
        };
        successCount += 1;
        await this.store.updateJob(current);
        continue;
      }
      current = {
        ...current,
        authResults: {
          ...current.authResults,
          [candidate.uid]: {
            ...existing,
            [field]:
              result.status === "BLOCKED" ? "BLOCKED" : "FAILED_RETRYABLE",
          },
        },
      };
      current = this.recordPhaseFailure(
        current,
        phase,
        `firebaseAuth/${candidate.uid}`,
        result.code,
        result.status === "FAILED" && result.retryable,
        now,
        result.status === "BLOCKED" ||
          (result.status === "FAILED" && !result.retryable)
          ? "BLOCKED"
          : "PARTIALLY_FAILED",
      );
      await this.store.updateJob(current);
      return current;
    }
    current = this.finishPhase(current, phase, successCount, now);
    await this.store.updateJob(current);
    return current;
  }

  private async runStoragePhase(
    job: PurgeJobRecord,
    manifest: PurgeManifest,
    phase: PurgeJobPhase,
    validationOnly: boolean,
    operation: (path: string) => Promise<PurgeExternalOperationResult>,
    now: string,
  ) {
    let current = this.startPhase(job, phase, now);
    await this.store.updateJob(current);
    let successCount = 0;
    const candidates = manifest.storageObjects.filter(
      (item) =>
        item.classification === "CONFIRMED_TEST" &&
        item.exists !== false,
    );
    for (const candidate of candidates) {
      const previous = current.storageResults?.[candidate.path] ?? "PENDING";
      if (
        (validationOnly && previous === "VALIDATED") ||
        (!validationOnly &&
          (previous === "DELETED" || previous === "NOT_FOUND"))
      ) {
        successCount += 1;
        continue;
      }
      const result = await operation(candidate.path);
      if (result.status === "SUCCESS" || result.status === "NOT_FOUND") {
        const status: PurgeExternalItemStatus =
          result.status === "NOT_FOUND"
            ? "NOT_FOUND"
            : validationOnly ? "VALIDATED" : "DELETED";
        current = {
          ...current,
          storageResults: {
            ...current.storageResults,
            [candidate.path]: status,
          },
          pendingStoragePaths:
            validationOnly
              ? current.pendingStoragePaths
              : current.pendingStoragePaths.filter(
                  (path) => path !== candidate.path,
                ),
          deletedCounts: {
            ...current.deletedCounts,
            storageObjects:
              !validationOnly && result.status === "SUCCESS"
                ? (current.deletedCounts.storageObjects ?? 0) + 1
                : (current.deletedCounts.storageObjects ?? 0),
          },
          failedItems: current.failedItems.filter(
            (item) =>
              item.resourcePath !== `firebaseStorage/${candidate.path}` ||
              item.phase !== phase,
          ),
          updatedAt: now,
        };
        successCount += 1;
        await this.store.updateJob(current);
        continue;
      }
      current = {
        ...current,
        storageResults: {
          ...current.storageResults,
          [candidate.path]:
            result.status === "BLOCKED" ? "BLOCKED" : "FAILED_RETRYABLE",
        },
      };
      current = this.recordPhaseFailure(
        current,
        phase,
        `firebaseStorage/${candidate.path}`,
        result.code,
        result.status === "FAILED" && result.retryable,
        now,
        result.status === "BLOCKED" ||
          (result.status === "FAILED" && !result.retryable)
          ? "BLOCKED"
          : "PARTIALLY_FAILED",
      );
      await this.store.updateJob(current);
      return current;
    }
    current = this.finishPhase(current, phase, successCount, now);
    await this.store.updateJob(current);
    return current;
  }

  private async deleteDeferredAuthRegistries(
    manifest: PurgeManifest,
    job: PurgeJobRecord,
    now: string,
  ) {
    let current = this.startPhase(job, "DELETE_AUTH_USERS", now);
    let successCount = 0;
    for (const item of orderedFirestoreTargets(manifest).filter(
      (target) => isDeferredStep6Item(target),
    )) {
      const previous = current.itemResults[item.resourcePath];
      if (previous === "DELETED" || previous === "NOT_FOUND") {
        successCount += 1;
        continue;
      }
      const result = await this.executor.deleteManifestItem(item);
      if (result.status === "DELETED" || result.status === "NOT_FOUND") {
        const deletedCounts = { ...current.deletedCounts };
        if (result.status === "DELETED") {
          deletedCounts[item.collection] =
            (deletedCounts[item.collection] ?? 0) + 1;
        }
        current = {
          ...current,
          deletedCounts,
          itemResults: {
            ...current.itemResults,
            [item.resourcePath]: result.status,
          },
          failedItems: current.failedItems.filter(
            (failed) => failed.resourcePath !== item.resourcePath,
          ),
          updatedAt: now,
        };
        successCount += 1;
        await this.store.updateJob(current);
        continue;
      }
      const code = result.status === "STALE"
        ? "stale_auth_registry_precondition"
        : result.code;
      const retryable = result.status === "FAILED" && result.retryable;
      current = this.recordPhaseFailure(
        current,
        "DELETE_AUTH_USERS",
        item.resourcePath,
        code,
        retryable,
        now,
        result.status === "STALE" || !retryable
          ? "BLOCKED"
          : "PARTIALLY_FAILED",
      );
      await this.store.updateJob(current);
      return current;
    }
    current = this.finishPhase(
      current,
      "DELETE_AUTH_USERS",
      (current.phaseResults?.DELETE_AUTH_USERS?.successCount ?? 0) +
        successCount,
      now,
    );
    await this.store.updateJob(current);
    return current;
  }

  private startPhase(
    job: PurgeJobRecord,
    phase: PurgeJobPhase,
    now: string,
  ): PurgeJobRecord {
    const existing = job.phaseResults?.[phase];
    return {
      ...job,
      status: "RUNNING",
      currentPhase: phase,
      phaseResults: {
        ...job.phaseResults,
        [phase]: {
          startedAt: existing?.startedAt ?? now,
          completedAt: undefined,
          successCount: existing?.successCount ?? 0,
          failureCount: existing?.failureCount ?? 0,
          retryable: existing?.retryable ?? false,
        },
      },
      updatedAt: now,
    };
  }

  private finishPhase(
    job: PurgeJobRecord,
    phase: PurgeJobPhase,
    successCount: number,
    now: string,
  ): PurgeJobRecord {
    const existing = job.phaseResults?.[phase];
    return {
      ...job,
      currentPhase: phase,
      phaseResults: {
        ...job.phaseResults,
        [phase]: {
          startedAt: existing?.startedAt ?? now,
          completedAt: now,
          successCount: Math.max(existing?.successCount ?? 0, successCount),
          failureCount: existing?.failureCount ?? 0,
          retryable: existing?.retryable ?? false,
        },
      },
      updatedAt: now,
    };
  }

  private recordPhaseFailure(
    job: PurgeJobRecord,
    phase: PurgeJobPhase,
    resourcePath: string,
    code: string,
    retryable: boolean,
    now: string,
    status: "PARTIALLY_FAILED" | "BLOCKED" = "PARTIALLY_FAILED",
  ): PurgeJobRecord {
    const existing = job.phaseResults?.[phase];
    return {
      ...job,
      status,
      currentPhase: phase,
      failedItems: [
        ...job.failedItems.filter(
          (item) =>
            item.resourcePath !== resourcePath || item.phase !== phase,
        ),
        { resourcePath, phase, code, retryable, occurredAt: now },
      ],
      phaseResults: {
        ...job.phaseResults,
        [phase]: {
          startedAt: existing?.startedAt ?? now,
          completedAt: now,
          successCount: existing?.successCount ?? 0,
          failureCount: (existing?.failureCount ?? 0) + 1,
          retryable,
        },
      },
      updatedAt: now,
    };
  }

  private async finishExternalFailure(
    job: PurgeJobRecord,
    now: string,
  ): Promise<PurgeApplyResult | null> {
    if (job.status === "BLOCKED") {
      await this.writeAudit(job, now);
      const failure = job.failedItems[job.failedItems.length - 1];
      throw new PurgeApplyError(failure?.code ?? "external_target_blocked", 409);
    }
    if (job.status === "PARTIALLY_FAILED") {
      await this.writeAudit(job, now);
      return {
        job,
        idempotentReplay: false,
        continuationRequired: job.failedItems.some((item) => item.retryable),
      };
    }
    return null;
  }

  private validateEnvironment(environment: string, projectId: string) {
    if (!this.configuration.enabled) {
      throw new PurgeApplyError("test_data_purge_disabled", 403);
    }
    if (
      !projectId ||
      projectId !== this.configuration.allowedProjectId
    ) {
      throw new PurgeApplyError("purge_project_mismatch", 403);
    }
    if (environment === "production" && !this.configuration.productionEnabled) {
      throw new PurgeApplyError("production_purge_disabled", 403);
    }
  }

  private validateManifestForApply(
    manifest: PurgeManifest,
    context: {
      environment: string;
      projectId: string;
      confirmation: string;
      now: string;
    },
  ) {
    if (!isPurgeManifest(manifest)) {
      throw new PurgeApplyError("invalid_manifest", 400);
    }
    if (manifest.mode !== "DRY_RUN" ||
        manifest.executionStatus !== "DRY_RUN_READY") {
      throw new PurgeApplyError("manifest_not_ready", 409);
    }
    if (context.confirmation !== expectedPurgeConfirmation(manifest)) {
      throw new PurgeApplyError("confirmation_mismatch", 400);
    }
    if (Date.parse(context.now) >= Date.parse(manifest.expiresAt)) {
      throw new PurgeApplyError("manifest_expired", 409);
    }
    if (manifest.blockedReasons.length > 0 || manifest.blockedItems.length > 0) {
      throw new PurgeApplyError("manifest_blocked", 409);
    }
    if (reviewItemCount(manifest) > 0) {
      throw new PurgeApplyError("manifest_review_required", 409);
    }
    if (
      manifest.environment !== context.environment ||
      manifest.projectId !== context.projectId
    ) {
      throw new PurgeApplyError("manifest_environment_mismatch", 409);
    }
    const targets = orderedFirestoreTargets(manifest);
    if (
      targets.some(
        (item) =>
          item.classification !== "CONFIRMED_TEST" ||
          item.targetType !== "FIRESTORE_DOCUMENT",
      )
    ) {
      throw new PurgeApplyError("manifest_contains_unconfirmed_target", 409);
    }
    if (targets.some(isMasterOrControlTarget)) {
      throw new PurgeApplyError("master_or_control_target_forbidden", 409);
    }
    if (targets.some((item) => !validManifestPath(item))) {
      throw new PurgeApplyError("invalid_manifest_target_path", 409);
    }
    const preservedMaster = manifest.preservedItems.some(
      (item) =>
        item.classificationMethod === "MASTER_ALWAYS_PRESERVED" &&
        item.resourceId === manifest.institutionId,
    );
    if (!preservedMaster) {
      throw new PurgeApplyError("institution_master_not_preserved", 409);
    }
    const authTargets = manifest.authUsers.filter(
      (item) => item.classification === "CONFIRMED_TEST" && item.exists !== false,
    );
    const storageTargets = manifest.storageObjects.filter(
      (item) => item.classification === "CONFIRMED_TEST" && item.exists !== false,
    );
    if (
      targets.length > MAX_PURGE_FIRESTORE_DOCUMENTS ||
      authTargets.length > MAX_PURGE_AUTH_USERS ||
      storageTargets.length > MAX_PURGE_STORAGE_OBJECTS ||
      storageByteCount(manifest) > MAX_PURGE_STORAGE_BYTES
    ) {
      throw new PurgeApplyError("purge_safety_limit_exceeded", 409);
    }
    if (
      manifest.totalTargetCount !==
        targets.length +
          manifest.authUsers.filter(
            (item) => item.classification === "CONFIRMED_TEST",
          ).length +
          manifest.storageObjects.filter(
            (item) => item.classification === "CONFIRMED_TEST",
          ).length
    ) {
      throw new PurgeApplyError("manifest_target_count_mismatch", 409);
    }
  }

  private validateCurrentSnapshot(
    original: PurgeManifest,
    current: PurgeManifest,
    job: PurgeJobRecord,
  ) {
    if (
      current.institutionId !== original.institutionId ||
      current.institutionName !== original.institutionName
    ) {
      throw new PurgeApplyError("institution_master_identity_mismatch", 409);
    }
    if (
      unexpectedBlockedReasons(current, job).length > 0 ||
      current.blockedItems.length > 0 ||
      reviewItemCount(current) > 0
    ) {
      throw new PurgeApplyError("current_data_blocked_or_review_required", 409);
    }
    const externalMutationStarted =
      Object.values(job.authResults ?? {}).some(
        (result) =>
          result.disabled === "DISABLED" ||
          result.sessionsRevoked === "SESSIONS_REVOKED" ||
          result.deleted === "DELETED" ||
          result.deleted === "NOT_FOUND",
      ) ||
      Object.values(job.storageResults ?? {}).some(
        (result) => result === "DELETED" || result === "NOT_FOUND",
      );
    if (
      job.progress.processedFirestoreTargets === 0 &&
      !externalMutationStarted
    ) {
      if (
        current.checksum !== original.checksum ||
        manifestSecurityShape(current) !== manifestSecurityShape(original)
      ) {
        throw new PurgeApplyError("manifest_checksum_mismatch", 409);
      }
      return;
    }
    const originalTargets = new Map(
      orderedFirestoreTargets(original).map((item) => [item.resourcePath, item]),
    );
    const currentTargets = orderedFirestoreTargets(current);
    for (const item of currentTargets) {
      const expected = originalTargets.get(item.resourcePath);
      if (!expected) {
        throw new PurgeApplyError("new_target_outside_manifest", 409);
      }
      if (
        !job.itemResults[item.resourcePath] &&
        expected.changeToken !== item.changeToken
      ) {
        throw new PurgeApplyError("manifest_checksum_mismatch", 409);
      }
    }
    const originalAuth = new Map(
      original.authUsers
        .filter((item) => item.classification === "CONFIRMED_TEST")
        .map((item) => [item.uid, item]),
    );
    for (const item of current.authUsers.filter(
      (candidate) => candidate.classification === "CONFIRMED_TEST",
    )) {
      const expected = originalAuth.get(item.uid);
      const authResult = job.authResults?.[item.uid];
      const changedByPurge =
        authResult?.disabled === "DISABLED" ||
        authResult?.sessionsRevoked === "SESSIONS_REVOKED" ||
        authResult?.deleted === "DELETED" ||
        authResult?.deleted === "NOT_FOUND";
      if (
        !expected ||
        (!changedByPurge && expected.changeToken !== item.changeToken) ||
        (changedByPurge &&
          JSON.stringify(expected.providerIds) !==
            JSON.stringify(item.providerIds))
      ) {
        throw new PurgeApplyError("manifest_checksum_mismatch", 409);
      }
    }
    const originalStorage = new Map(
      original.storageObjects
        .filter((item) => item.classification === "CONFIRMED_TEST")
        .map((item) => [item.path, item]),
    );
    for (const item of current.storageObjects.filter(
      (candidate) => candidate.classification === "CONFIRMED_TEST",
    )) {
      const expected = originalStorage.get(item.path);
      const storageResult = job.storageResults?.[item.path];
      const deletedByPurge =
        storageResult === "DELETED" || storageResult === "NOT_FOUND";
      if (
        !expected ||
        (!deletedByPurge &&
          (expected.generation !== item.generation ||
            expected.exists !== item.exists))
      ) {
        throw new PurgeApplyError("manifest_checksum_mismatch", 409);
      }
    }
  }

  private validateRemainingFirestoreSnapshot(
    original: PurgeManifest,
    current: PurgeManifest,
    job: PurgeJobRecord,
  ) {
    if (
      current.institutionId !== original.institutionId ||
      current.institutionName !== original.institutionName
    ) {
      throw new PurgeApplyError("institution_master_identity_mismatch", 409);
    }
    if (unexpectedBlockedReasons(current, job).length > 0) {
      throw new PurgeApplyError(
        `current_data_blocked:${unexpectedBlockedReasons(current, job).join(",")}`,
        409,
      );
    }
    if (current.blockedItems.length > 0) {
      throw new PurgeApplyError("current_data_contains_blocked_items", 409);
    }
    if (reviewItemCount(current) > 0) {
      throw new PurgeApplyError("current_data_blocked_or_review_required", 409);
    }
    const originalTargets = new Map(
      orderedFirestoreTargets(original).map((item) => [item.resourcePath, item]),
    );
    for (const item of orderedFirestoreTargets(current)) {
      const expected = originalTargets.get(item.resourcePath);
      if (!expected) {
        throw new PurgeApplyError("new_target_outside_manifest", 409);
      }
      const previousResult = job.itemResults[item.resourcePath];
      if (previousResult === "DELETED" || previousResult === "NOT_FOUND") {
        throw new PurgeApplyError("recreated_target_after_delete", 409);
      }
      if (
        previousResult !== "DEFERRED_STEP_6" &&
        expected.changeToken !== item.changeToken
      ) {
        throw new PurgeApplyError("manifest_checksum_mismatch", 409);
      }
    }
  }

  private async revalidateRemainingOrBlock(
    manifest: PurgeManifest,
    job: PurgeJobRecord,
    request: PurgeApplyRequest,
    now: string,
  ) {
    try {
      const current = await this.scanner.scan({
        institutionId: manifest.institutionId,
        mode: "DRY_RUN",
        generatedBy: manifest.generatedBy,
        environment: request.environment,
        projectId: request.projectId,
        now,
      });
      this.validateRemainingFirestoreSnapshot(manifest, current, job);
    } catch (error) {
      const blocked = await this.blockJob(
        job,
        error instanceof PurgeApplyError
          ? error.code
          : "manifest_revalidation_failed",
        now,
      );
      await this.writeAudit(blocked, now);
      if (error instanceof PurgeApplyError) throw error;
      throw new PurgeApplyError("manifest_revalidation_failed", 409);
    }
  }

  private recordItem(
    job: PurgeJobRecord,
    item: PurgeManifestItem,
    status: "DELETED" | "NOT_FOUND" | "DEFERRED_STEP_6",
    now: string,
  ): PurgeJobRecord {
    const deletedCounts = { ...job.deletedCounts };
    if (status === "DELETED") {
      deletedCounts[item.collection] = (deletedCounts[item.collection] ?? 0) + 1;
    }
    return {
      ...job,
      progress: {
        ...job.progress,
        processedFirestoreTargets:
          job.progress.processedFirestoreTargets + 1,
        deferredStep6Targets:
          job.progress.deferredStep6Targets +
          (status === "DEFERRED_STEP_6" ? 1 : 0),
      },
      deletedCounts,
      itemResults: {
        ...job.itemResults,
        [item.resourcePath]: status,
      },
      failedItems: job.failedItems.filter(
        (failed) => failed.resourcePath !== item.resourcePath,
      ),
      updatedAt: now,
    };
  }

  private recordFailure(
    job: PurgeJobRecord,
    item: PurgeManifestItem,
    phase: PurgeJobRecord["currentPhase"],
    code: string,
    retryable: boolean,
    now: string,
    status: "PARTIALLY_FAILED" | "BLOCKED",
  ): PurgeJobRecord {
    const failure: PurgeFailedItem = {
      resourcePath: item.resourcePath,
      phase,
      code,
      retryable,
      occurredAt: now,
    };
    return {
      ...job,
      status,
      itemResults: {
        ...job.itemResults,
        [item.resourcePath]:
          status === "BLOCKED" ? "BLOCKED_STALE" : "FAILED_RETRYABLE",
      },
      failedItems: [
        ...job.failedItems.filter(
          (failed) => failed.resourcePath !== item.resourcePath,
        ),
        failure,
      ],
      updatedAt: now,
    };
  }

  private async blockJob(
    job: PurgeJobRecord,
    code: string,
    now: string,
  ) {
    const blocked: PurgeJobRecord = {
      ...job,
      status: "BLOCKED",
      failedItems: [
        ...job.failedItems,
        {
          resourcePath: job.manifestId,
          phase: "VALIDATING_MANIFEST",
          code,
          retryable: false,
          occurredAt: now,
        },
      ],
      updatedAt: now,
    };
    await this.store.updateJob(blocked);
    return blocked;
  }

  private async persistCompletedJob(job: PurgeJobRecord, now: string) {
    const completed: PurgeJobRecord = {
      ...job,
      failedItems: job.failedItems.filter(
        (item) => item.code !== "purge_audit_write_failed",
      ),
    };
    try {
      await this.writeAudit(completed, now);
    } catch {
      const partial: PurgeJobRecord = {
        ...completed,
        status: "PARTIALLY_FAILED",
        currentPhase: "FINALIZING",
        completedAt: undefined,
        updatedAt: now,
        failedItems: [
          ...completed.failedItems,
          {
            resourcePath: completed.purgeJobId,
            phase: "FINALIZING",
            code: "purge_audit_write_failed",
            retryable: true,
            occurredAt: now,
          },
        ],
      };
      await this.store.updateJob(partial);
      throw new PurgeApplyError("purge_audit_write_failed", 503);
    }
    await this.store.updateJob(completed);
    await this.store.releaseLock(completed, now);
    return completed;
  }

  private async writeAudit(job: PurgeJobRecord, now: string) {
    const audit: PurgeAuditRecord = {
      schemaVersion: 1,
      auditId: `${job.purgeJobId}-${job.attemptCount}-${job.status.toLowerCase()}`,
      actorId: job.requestedBy,
      manifestId: job.manifestId,
      purgeJobId: job.purgeJobId,
      institutionId: job.institutionId,
      institutionName: job.institutionName,
      deletedCounts: job.deletedCounts,
      resetFields: job.resetResult.resetFields,
      failedCount: job.failedItems.length,
      startedAt: job.startedAt,
      completedAt: now,
      resultStatus: job.status,
      requestId: job.requestId,
    };
    await this.store.writeAudit(audit);
  }

  private async requireRegisteredManifest(manifestId: string) {
    if (!/^purge_[A-Za-z0-9_-]{10,200}$/.test(manifestId)) {
      throw new PurgeApplyError("invalid_manifest_id", 400);
    }
    const registered = await this.store.getManifest(manifestId);
    if (!registered) throw new PurgeApplyError("manifest_not_found", 404);
    if (registered.manifest.manifestId !== manifestId) {
      throw new PurgeApplyError("registered_manifest_id_mismatch", 409);
    }
    return registered;
  }
}

function manifestSecurityShape(manifest: PurgeManifest) {
  return JSON.stringify({
    institutionId: manifest.institutionId,
    institutionName: manifest.institutionName,
    institutionType: manifest.institutionType,
    isDemoInstitution: manifest.isDemoInstitution,
    targetsByCollection: manifest.targetsByCollection,
    reviewByCollection: manifest.reviewByCollection,
    preservedItems: manifest.preservedItems,
    blockedItems: manifest.blockedItems,
    authUsers: manifest.authUsers,
    storageObjects: manifest.storageObjects,
    resetFields: manifest.resetFields,
    preservedFields: manifest.preservedFields,
    totalTargetCount: manifest.totalTargetCount,
    blockedReasons: manifest.blockedReasons,
    checksum: manifest.checksum,
  });
}

function validManifestPath(item: PurgeManifestItem) {
  const segments = item.resourcePath.split("/");
  return (
    segments.length >= 2 &&
    segments.length % 2 === 0 &&
    segments.every(Boolean) &&
    segments[segments.length - 2] === item.collection
  );
}

function terminalAuthStatus(
  field: "validated" | "disabled" | "sessionsRevoked" | "deleted",
): PurgeExternalItemStatus {
  if (field === "validated") return "VALIDATED";
  if (field === "disabled") return "DISABLED";
  if (field === "sessionsRevoked") return "SESSIONS_REVOKED";
  return "DELETED";
}

function unexpectedBlockedReasons(
  manifest: PurgeManifest,
  job: PurgeJobRecord,
) {
  const userProfilesWereDeleted = Object.entries(job.itemResults).some(
    ([path, status]) =>
      path.startsWith("users/") &&
      (status === "DELETED" || status === "NOT_FOUND"),
  );
  return manifest.blockedReasons.filter(
    (reason) =>
      !(
        reason === "AUTH_IDENTITY_CONFLICT" &&
        userProfilesWereDeleted &&
        job.pendingAuthUids.length > 0
      ),
  );
}

export function isPurgeManifest(value: unknown): value is PurgeManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<PurgeManifest>;
  return (
    manifest.schemaVersion === 1 &&
    typeof manifest.manifestId === "string" &&
    typeof manifest.institutionId === "string" &&
    typeof manifest.institutionName === "string" &&
    typeof manifest.environment === "string" &&
    typeof manifest.projectId === "string" &&
    typeof manifest.generatedAt === "string" &&
    typeof manifest.expiresAt === "string" &&
    typeof manifest.checksum === "string" &&
    /^[a-f0-9]{64}$/.test(manifest.checksum) &&
    Boolean(manifest.targetsByCollection) &&
    typeof manifest.targetsByCollection === "object" &&
    Boolean(manifest.reviewByCollection) &&
    typeof manifest.reviewByCollection === "object" &&
    Array.isArray(manifest.preservedItems) &&
    Array.isArray(manifest.blockedItems) &&
    Array.isArray(manifest.authUsers) &&
    Array.isArray(manifest.storageObjects) &&
    Array.isArray(manifest.resetFields) &&
    Array.isArray(manifest.blockedReasons)
  );
}

export class PurgeApplyError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "PurgeApplyError";
    this.code = code;
    this.status = status;
  }
}

export function defaultPurgeConfiguration(): PurgeApplyConfiguration {
  return {
    enabled: process.env.TEST_DATA_PURGE_ENABLED === "true",
    productionEnabled:
      process.env.TEST_DATA_PURGE_PRODUCTION_ENABLED === "true",
    allowedProjectId:
      process.env.TEST_DATA_PURGE_ALLOWED_PROJECT_ID?.trim() ?? "",
  };
}

export function purgeRequestId() {
  return `purge-request-${createHash("sha256")
    .update(randomUUID())
    .digest("hex")
    .slice(0, 24)}`;
}
