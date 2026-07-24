import type { UploadedQuoteDocument } from "@/lib/audit-evaluation/types";

export const AUDIT_QUOTE_CUSTOMER_STATUSES = [
  "UPLOADED",
  "CHECKING",
  "NEEDS_INFORMATION",
  "READY",
  "FAILED",
] as const;

export type AuditQuoteCustomerStatus =
  (typeof AUDIT_QUOTE_CUSTOMER_STATUSES)[number];

export function resolveAuditQuoteCustomerStatus(
  document: UploadedQuoteDocument,
): AuditQuoteCustomerStatus {
  if (
    document.uploadStatus === "FAILED" ||
    document.scanStatus === "REJECTED" ||
    document.scanStatus === "QUARANTINED" ||
    document.scanStatus === "FAILED" ||
    document.parsingStatus === "FAILED" ||
    document.integrityStatus === "FAILED"
  ) {
    return "FAILED";
  }
  if (
    document.parsingStatus === "PARSING" ||
    document.scanStatus === "SCANNING"
  ) {
    return "CHECKING";
  }
  if (
    document.parsingStatus === "NEEDS_REVIEW" ||
    (
      document.parsingStatus === "PARSED" &&
      document.scanStatus === "UNAVAILABLE"
    ) ||
    document.integrityStatus === "MISMATCH"
  ) {
    return "NEEDS_INFORMATION";
  }
  if (document.parsingStatus === "PARSED") {
    return "READY";
  }
  return "UPLOADED";
}
