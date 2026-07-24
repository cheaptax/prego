import {
  AuditEvaluationUploadError,
  auditEvaluationUploadErrorStatus,
} from "@/lib/audit-evaluation/upload-service";

const CUSTOMER_UPLOAD_ERRORS = new Set([
  "unsupported_file_type",
  "empty_file",
  "file_too_large",
  "corrupt_pdf",
  "encrypted_pdf",
  "upload_mismatch",
  "upload_not_found",
  "too_many_files",
  "duplicate_document",
  "wrong_case",
  "upload_intent_expired",
  "document_not_found",
  "idempotency_conflict",
  "case_not_uploadable",
]);

export function auditEvaluationUploadApiError(error: unknown) {
  if (
    error instanceof AuditEvaluationUploadError &&
    CUSTOMER_UPLOAD_ERRORS.has(error.code)
  ) {
    return {
      error: error.code,
      status: auditEvaluationUploadErrorStatus(error.code),
    };
  }
  return { error: "upload_failed", status: 500 };
}
