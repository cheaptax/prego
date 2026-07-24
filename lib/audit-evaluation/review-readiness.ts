import type {
  AuditEvaluationCase,
  EvaluationConfig,
  NormalizedAuditQuote,
  NormalizedAuditQuoteField,
  UploadedQuoteDocument,
} from "@/lib/audit-evaluation/types";

export const AUDIT_EVALUATION_READINESS_CODES = [
  "NOT_ENOUGH_DISTINCT_FIRMS",
  "REQUIRED_FIELD_MISSING",
  "DOCUMENT_REVIEW_INCOMPLETE",
  "DOCUMENT_SECURITY_SCAN_INCOMPLETE",
  "SEVERE_INTEGRITY_ERROR",
  "ADMIN_REVIEW_PENDING",
  "CUSTOMER_CONFIRMATION_REQUIRED",
  "CONFIG_NOT_PUBLISHED",
  "CONFIG_NOT_EFFECTIVE",
  "QUOTE_REVISION_CONFLICT",
] as const;

export type AuditEvaluationReadinessCode =
  (typeof AUDIT_EVALUATION_READINESS_CODES)[number];

export type AuditEvaluationReadinessIssue = {
  code: AuditEvaluationReadinessCode;
  quoteId: string | null;
  field: NormalizedAuditQuoteField | null;
};

export type AuditEvaluationReadinessResult = {
  ready: boolean;
  minimumQuoteCount: number;
  distinctFirmCount: number;
  issues: AuditEvaluationReadinessIssue[];
};

export function evaluateAuditEvaluationReadiness(input: {
  evaluationCase: AuditEvaluationCase;
  config: EvaluationConfig;
  quotes: readonly NormalizedAuditQuote[];
  documents: readonly UploadedQuoteDocument[];
  now: string;
  requireCustomerConfirmation: boolean;
  expectedQuoteRevisions?: Readonly<Record<string, number>>;
}): AuditEvaluationReadinessResult {
  const issues: AuditEvaluationReadinessIssue[] = [];
  const minimumQuoteCount = Math.max(2, input.config.minimumQuoteCount);
  const distinctFirmCount = new Set(
    input.quotes
      .map(({ accountingFirmName }) => normalizeFirmName(accountingFirmName))
      .filter(Boolean),
  ).size;
  if (
    input.quotes.length < minimumQuoteCount ||
    distinctFirmCount < minimumQuoteCount
  ) {
    issues.push(issue("NOT_ENOUGH_DISTINCT_FIRMS"));
  }

  for (const quote of input.quotes) {
    for (const field of input.config.requiredFields) {
      if (!isQuoteFieldPresent(quote, field)) {
        issues.push({
          code: "REQUIRED_FIELD_MISSING",
          quoteId: quote.quoteId,
          field,
        });
      }
    }
    if ((quote.pendingAdminReviewFields?.length ?? 0) > 0) {
      for (const field of quote.pendingAdminReviewFields ?? []) {
        issues.push({
          code: "ADMIN_REVIEW_PENDING",
          quoteId: quote.quoteId,
          field,
        });
      }
    }
    if (input.requireCustomerConfirmation && !quote.confirmedByCustomer) {
      issues.push({
        code: "CUSTOMER_CONFIRMATION_REQUIRED",
        quoteId: quote.quoteId,
        field: null,
      });
    }
    const expectedRevision = input.expectedQuoteRevisions?.[quote.quoteId];
    if (
      expectedRevision !== undefined &&
      expectedRevision !== (quote.revision ?? 0)
    ) {
      issues.push({
        code: "QUOTE_REVISION_CONFLICT",
        quoteId: quote.quoteId,
        field: null,
      });
    }
  }

  const quoteDocumentIds = new Set(
    input.quotes.map(({ documentId }) => documentId),
  );
  if (
    input.documents.some(
      (document) =>
        !quoteDocumentIds.has(document.id) ||
        ["PENDING", "PARSING", "FAILED"].includes(document.parsingStatus),
    )
  ) {
    issues.push(issue("DOCUMENT_REVIEW_INCOMPLETE"));
  }
  if (input.documents.some((document) => document.scanStatus !== "CLEAN")) {
    issues.push(issue("DOCUMENT_SECURITY_SCAN_INCOMPLETE"));
  }
  if (input.documents.some(hasSevereIntegrityError)) {
    issues.push(issue("SEVERE_INTEGRITY_ERROR"));
  }
  if (input.config.status !== "PUBLISHED") {
    issues.push(issue("CONFIG_NOT_PUBLISHED"));
  } else if (!isConfigEffective(input.config, input.now)) {
    issues.push(issue("CONFIG_NOT_EFFECTIVE"));
  }

  return {
    ready: issues.length === 0,
    minimumQuoteCount,
    distinctFirmCount,
    issues: deduplicateIssues(issues),
  };
}

export function isQuoteFieldPresent(
  quote: NormalizedAuditQuote,
  field: NormalizedAuditQuoteField,
) {
  const value = quote[field];
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (field === "requiredProposalItems") {
    return (
      Object.keys(quote.requiredProposalItems).length > 0 &&
      Object.values(quote.requiredProposalItems).every(({ present }) => present)
    );
  }
  if (
    field === "taxAgencyExperience" ||
    field === "subsidySettlementExperience"
  ) {
    const experience = field === "taxAgencyExperience"
      ? quote.taxAgencyExperience
      : quote.subsidySettlementExperience;
    return typeof experience.hasExperience === "boolean";
  }
  return true;
}

function hasSevereIntegrityError(document: UploadedQuoteDocument) {
  return (
    document.uploadStatus === "FAILED" ||
    document.integrityStatus === "FAILED" ||
    document.integrityStatus === "DUPLICATE" ||
    document.integrityStatus === "MISMATCH" ||
    document.matchStatus === "INVALID_SIGNATURE" ||
    document.matchStatus === "WRONG_CASE" ||
    document.matchStatus === "DUPLICATE"
  );
}

function isConfigEffective(config: EvaluationConfig, now: string) {
  const nowMs = Date.parse(now);
  return (
    Number.isFinite(nowMs) &&
    (!config.effectiveFrom || Date.parse(config.effectiveFrom) <= nowMs) &&
    (!config.effectiveTo || Date.parse(config.effectiveTo) > nowMs)
  );
}

function normalizeFirmName(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();
}

function issue(
  code: AuditEvaluationReadinessCode,
): AuditEvaluationReadinessIssue {
  return { code, quoteId: null, field: null };
}

function deduplicateIssues(
  issues: readonly AuditEvaluationReadinessIssue[],
) {
  return [...new Map(
    issues.map((item) => [
      `${item.code}|${item.quoteId ?? ""}|${item.field ?? ""}`,
      item,
    ]),
  ).values()];
}
