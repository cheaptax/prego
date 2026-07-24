import { createHmac, randomBytes } from "node:crypto";

const SAFE_RESOURCE_ID = /^[a-z][a-z0-9_-]{8,90}$/i;

export const AUDIT_EVALUATION_STORAGE_PREFIXES = {
  originals: "audit-evaluation/originals",
  quarantine: "audit-evaluation/quarantine",
  reports: "audit-evaluation/reports",
  temporary: "audit-evaluation/temp",
} as const;

export function createUploadedQuoteDocumentId() {
  return `aud_${randomBytes(18).toString("base64url")}`;
}

export function createUploadIntentId(
  caseId: string,
  idempotencyKey: string,
  secret: string,
) {
  const digest = createHmac("sha256", secret)
    .update(`upload-intent|${caseId}|${idempotencyKey.trim()}`, "utf8")
    .digest("base64url");
  return `aui_${digest}`;
}

export function hashUploadIdempotencyKey(
  caseId: string,
  idempotencyKey: string,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update(`upload-idempotency|${caseId}|${idempotencyKey.trim()}`, "utf8")
    .digest("hex");
}

export function quarantineUploadPath(caseId: string, intentId: string) {
  assertSafeResourceId(caseId);
  assertSafeResourceId(intentId);
  return `${AUDIT_EVALUATION_STORAGE_PREFIXES.quarantine}/${caseId}/${intentId}/source.pdf`;
}

export function originalUploadPath(caseId: string, documentId: string) {
  assertSafeResourceId(caseId);
  assertSafeResourceId(documentId);
  return `${AUDIT_EVALUATION_STORAGE_PREFIXES.originals}/${caseId}/${documentId}/source.pdf`;
}

export function reportStoragePath(
  caseId: string,
  reportVersion: number,
  attempt?: number,
) {
  assertSafeResourceId(caseId);
  if (!Number.isInteger(reportVersion) || reportVersion <= 0) {
    throw new Error("invalid_report_version");
  }
  if (attempt !== undefined) {
    assertSafePositiveInteger(attempt, "invalid_report_attempt");
    return `${AUDIT_EVALUATION_STORAGE_PREFIXES.reports}/${caseId}/v${reportVersion}/attempt-${attempt}/report.pdf`;
  }
  return `${AUDIT_EVALUATION_STORAGE_PREFIXES.reports}/${caseId}/v${reportVersion}/report.pdf`;
}

export function reportPayloadStoragePath(
  caseId: string,
  reportVersion: number,
  attempt?: number,
) {
  assertSafeResourceId(caseId);
  if (!Number.isInteger(reportVersion) || reportVersion <= 0) {
    throw new Error("invalid_report_version");
  }
  if (attempt !== undefined) {
    assertSafePositiveInteger(attempt, "invalid_report_attempt");
    return `${AUDIT_EVALUATION_STORAGE_PREFIXES.reports}/${caseId}/v${reportVersion}/attempt-${attempt}/view-model.json`;
  }
  return `${AUDIT_EVALUATION_STORAGE_PREFIXES.reports}/${caseId}/v${reportVersion}/view-model.json`;
}

export function temporaryRenderPath(
  caseId: string,
  jobId: string,
  fileName: string,
) {
  assertSafeResourceId(caseId);
  assertSafeResourceId(jobId);
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(fileName)) {
    throw new Error("invalid_temporary_file_name");
  }
  return `${AUDIT_EVALUATION_STORAGE_PREFIXES.temporary}/${caseId}/${jobId}/${fileName}`;
}

function assertSafeResourceId(value: string) {
  if (!SAFE_RESOURCE_ID.test(value)) {
    throw new Error("invalid_storage_resource_id");
  }
}

function assertSafePositiveInteger(value: number, message: string) {
  if (!Number.isInteger(value) || value <= 0 || value > 10_000) {
    throw new Error(message);
  }
}
