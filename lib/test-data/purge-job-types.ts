import type {
  PurgeManifest,
  PurgeManifestItem,
} from "@/lib/test-data/purge-types";

export const PURGE_MANIFEST_COLLECTION = "testDataPurgeManifests";
export const PURGE_JOB_COLLECTION = "testDataPurgeJobs";
export const PURGE_LOCK_COLLECTION = "testDataPurgeLocks";
export const PURGE_AUDIT_COLLECTION = "testDataPurgeAuditLogs";

export type PurgeJobStatus =
  | "CREATED"
  | "VALIDATING"
  | "RUNNING"
  | "PARTIALLY_FAILED"
  | "COMPLETED"
  | "BLOCKED"
  | "CANCELLED";

export type PurgeJobPhase =
  | "VALIDATING_MANIFEST"
  | "LOCKING_INSTITUTION"
  | "DISABLE_AUTH_USERS"
  | "REVOKE_SESSIONS"
  | "DELETE_FIRESTORE_DATA"
  | "DELETE_STORAGE_OBJECTS"
  | "DELETE_AUTH_USERS"
  | "RESET_INSTITUTION"
  | "VERIFY_ORPHANS"
  | "COMPLETE"
  | "DELETING_ACCESS_RECORDS"
  | "DELETING_EVALUATION_DATA"
  | "DELETING_QUOTES"
  | "DELETING_CONSULTATIONS"
  | "DELETING_AUDIT_INTAKE"
  | "DELETING_ACTIVITY"
  | "DELETING_POINTS"
  | "DELETING_MEMBERSHIPS"
  | "DELETING_USERS"
  | "DELETING_ORGANIZATION"
  | "RESETTING_SIGNUP_STATE"
  | "AWAITING_AUTH_STORAGE"
  | "FINALIZING"
  | "DONE";

export type PurgeItemStatus =
  | "DELETED"
  | "NOT_FOUND"
  | "FAILED_RETRYABLE"
  | "BLOCKED_STALE"
  | "DEFERRED_STEP_6";

export type PurgeExternalItemStatus =
  | "PENDING"
  | "VALIDATED"
  | "DISABLED"
  | "SESSIONS_REVOKED"
  | "DELETED"
  | "NOT_FOUND"
  | "FAILED_RETRYABLE"
  | "BLOCKED";

export type PurgePhaseResult = {
  startedAt?: string;
  completedAt?: string;
  successCount: number;
  failureCount: number;
  retryable: boolean;
};

export type PurgeAuthItemResult = {
  validated: PurgeExternalItemStatus;
  disabled: PurgeExternalItemStatus;
  sessionsRevoked: PurgeExternalItemStatus;
  deleted: PurgeExternalItemStatus;
};

export type PurgeOrphanFindingType =
  | "PROFILE_WITHOUT_AUTH"
  | "AUTH_WITHOUT_PROFILE"
  | "MEMBERSHIP_WITHOUT_ORGANIZATION"
  | "ANSWER_WITHOUT_REQUEST"
  | "POINT_BALANCE_MISMATCH"
  | "STORAGE_WITHOUT_METADATA"
  | "DELETED_UID_REFERENCE"
  | "ACTIVE_TENANT_AFTER_RESET"
  | "NEW_UNCONFIRMED_DATA";

export type PurgeOrphanFinding = {
  type: PurgeOrphanFindingType;
  resourcePath: string;
  severity: "WARNING" | "BLOCKER";
  detailCode: string;
};

export type PurgeOrphanVerificationReport = {
  generatedAt: string;
  checks: Record<string, number>;
  findings: PurgeOrphanFinding[];
  blockerCount: number;
  passed: boolean;
};

export type PurgeFailedItem = {
  resourcePath: string;
  phase: PurgeJobPhase;
  code: string;
  retryable: boolean;
  occurredAt: string;
};

export type PurgeResetResult = {
  status: "NOT_STARTED" | "APPLIED" | "NOT_REQUIRED" | "FAILED";
  resetFields: string[];
  masterPreserved: boolean;
  completedAt?: string;
  errorCode?: string;
};

export type PurgeJobRecord = {
  schemaVersion: 1;
  purgeJobId: string;
  manifestId: string;
  manifestChecksum: string;
  institutionId: string;
  institutionName: string;
  requestedBy: string;
  requestedByEmail?: string;
  requestId: string;
  status: PurgeJobStatus;
  currentPhase: PurgeJobPhase;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  attemptCount: number;
  progress: {
    totalFirestoreTargets: number;
    processedFirestoreTargets: number;
    deferredStep6Targets: number;
  };
  deletedCounts: Record<string, number>;
  itemResults: Record<string, PurgeItemStatus>;
  failedItems: PurgeFailedItem[];
  resetResult: PurgeResetResult;
  pendingAuthUids: string[];
  pendingStoragePaths: string[];
  phaseResults?: Partial<Record<PurgeJobPhase, PurgePhaseResult>>;
  authResults?: Record<string, PurgeAuthItemResult>;
  storageResults?: Record<string, PurgeExternalItemStatus>;
  orphanVerification?: PurgeOrphanVerificationReport;
};

export type RegisteredPurgeManifest = {
  manifest: PurgeManifest;
  approvedBy: string;
  approvedByEmail?: string;
  approvedAt: string;
};

export type PurgeApplyRequest = {
  manifestId: string;
  confirmation: string;
  requestedBy: string;
  requestedByEmail?: string;
  requestId: string;
  environment: string;
  projectId: string;
  now?: string;
};

export type PurgeApplyResult = {
  job: PurgeJobRecord;
  idempotentReplay: boolean;
  continuationRequired: boolean;
};

export type PurgeAuditRecord = {
  schemaVersion: 1;
  auditId: string;
  actorId: string;
  manifestId: string;
  purgeJobId: string;
  institutionId: string;
  institutionName: string;
  deletedCounts: Record<string, number>;
  resetFields: string[];
  failedCount: number;
  startedAt?: string;
  completedAt: string;
  resultStatus: PurgeJobStatus;
  requestId: string;
};

export type PurgeDocumentDeleteResult =
  | { status: "DELETED" }
  | { status: "NOT_FOUND" }
  | { status: "STALE" }
  | { status: "FAILED"; code: string; retryable: boolean };

export type PurgeExternalOperationResult =
  | { status: "SUCCESS" }
  | { status: "NOT_FOUND" }
  | { status: "BLOCKED"; code: string }
  | { status: "FAILED"; code: string; retryable: boolean };

export interface PurgeControlStore {
  registerManifest(
    record: RegisteredPurgeManifest,
  ): Promise<RegisteredPurgeManifest>;
  getManifest(manifestId: string): Promise<RegisteredPurgeManifest | null>;
  beginOrResumeJob(input: {
    manifest: PurgeManifest;
    requestedBy: string;
    requestedByEmail?: string;
    requestId: string;
    now: string;
    lockLeaseExpiresAt: string;
  }): Promise<{ job: PurgeJobRecord; idempotentReplay: boolean }>;
  updateJob(job: PurgeJobRecord): Promise<void>;
  releaseLock(job: PurgeJobRecord, now: string): Promise<void>;
  writeAudit(record: PurgeAuditRecord): Promise<void>;
}

export interface PurgeFirestoreExecutor {
  deleteManifestItem(
    item: PurgeManifestItem,
  ): Promise<PurgeDocumentDeleteResult>;
  resetInstitution(
    manifest: PurgeManifest,
    actorId: string,
    now: string,
  ): Promise<PurgeResetResult>;
}

export interface PurgeExternalExecutor {
  validateAuthTarget(
    manifest: PurgeManifest,
    uid: string,
  ): Promise<PurgeExternalOperationResult>;
  disableAuthUser(uid: string): Promise<PurgeExternalOperationResult>;
  revokeAuthSessions(uid: string): Promise<PurgeExternalOperationResult>;
  deleteAuthUser(uid: string): Promise<PurgeExternalOperationResult>;
  validateStorageTarget(
    manifest: PurgeManifest,
    path: string,
  ): Promise<PurgeExternalOperationResult>;
  deleteStorageObject(
    manifest: PurgeManifest,
    path: string,
  ): Promise<PurgeExternalOperationResult>;
}

export interface PurgeOrphanVerifier {
  verify(
    manifest: PurgeManifest,
    job: PurgeJobRecord,
    now: string,
  ): Promise<PurgeOrphanVerificationReport>;
}
