import { z } from "zod";
import {
  AUDIT_EVALUATION_CASE_STATUSES,
  NORMALIZED_AUDIT_QUOTE_FIELDS,
  type AuditEvaluationActor,
  type AuditEvaluationCase,
  type AuditEvaluationCaseStatus,
  type AuditQuoteCorrectionRecord,
  type EvaluationScoreResult,
  type FeeAnalysisResult,
  type NormalizedAuditQuote,
  type QuoteEvidenceValue,
} from "@/lib/audit-evaluation/types";

const resourceId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const instant = z.string().datetime({ offset: true });

const evidenceValue: z.ZodType<QuoteEvidenceValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.string().max(10_000),
    z.number().finite(),
    z.boolean(),
    z.array(evidenceValue).max(100),
    z.record(z.string().max(128), evidenceValue),
  ]),
);

export const adminCorrectionRequestSchema = z
  .object({
    field: z.enum(NORMALIZED_AUDIT_QUOTE_FIELDS),
    correctedValue: evidenceValue,
    reason: z.string().trim().min(2).max(1_000),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export const adminDocumentReprocessRequestSchema = z
  .object({ confirm: z.literal(true) })
  .strict();

export const adminReportRegenerationRequestSchema = z
  .object({
    confirm: z.literal(true),
    expectedSourceVersion: z.number().int().positive(),
  })
  .strict();

export const adminAccessReissueRequestSchema = z
  .object({
    confirm: z.literal(true),
    extendDays: z.number().int().min(1).max(30),
    expectedExpiresAt: instant,
  })
  .strict();

export type AdminAuditEvaluationCaseFilters = {
  status?: AuditEvaluationCaseStatus;
  fiscalYear?: number;
  cooperativeName?: string;
  createdFrom?: string;
  createdTo?: string;
  hasError?: boolean;
  reportCompleted?: boolean;
};

export type AdminAuditEvaluationListItem = {
  id: string;
  cooperativeName: string;
  fiscalYear: number;
  quoteCount: number;
  customerConfirmationStatus:
    | "NOT_STARTED"
    | "PENDING"
    | "PARTIAL"
    | "CONFIRMED";
  processingStatus: AuditEvaluationCaseStatus;
  reportGeneratedAt: string | null;
  reportCompleted: boolean;
  hasError: boolean;
  updatedAt: string;
  createdAt: string;
};

export type AdminAuditEvaluationDetail = {
  case: AuditEvaluationCase;
  documents: Array<{
    id: string;
    safeDisplayName: string;
    uploadStatus: string;
    scanStatus: string;
    parsingStatus: string;
    integrityStatus: string;
    matchStatus: string | null;
    matchedQuoteDocumentId: string | null;
    uploadedAt: string;
  }>;
  normalizedQuotes: NormalizedAuditQuote[];
  corrections: {
    customer: AuditQuoteCorrectionRecord[];
    admin: AuditQuoteCorrectionRecord[];
  };
  latestEvaluation: {
    reportVersion: number;
    scoreBreakdown: EvaluationScoreResult | null;
    feeAnalysis: FeeAnalysisResult | null;
  } | null;
  reportVersions: Array<{
    reportVersion: number;
    confirmationVersion: number;
    status: string;
    requestedAt: string | null;
    generatedAt: string | null;
    failureCode: string | null;
  }>;
  confirmations: Array<{
    id: string;
    version: number;
    quoteCount: number;
    inputHash: string;
    confirmedBy: AuditEvaluationActor;
    confirmedAt: string;
  }>;
  processingTimeline: Array<{
    occurredAt: string;
    type: string;
    status: string;
    targetId: string | null;
    detail: string | null;
    errorCode: string | null;
  }>;
  accessExpiry: string;
  reportRegenerationRequired: boolean;
};

export const ADMIN_AUDIT_ERROR_TYPES = [
  "UPLOAD",
  "PARSING",
  "DOCUMENT_MISMATCH",
  "REPORT_GENERATION",
  "PDF_GENERATION",
  "EMAIL_LINK",
] as const;

export type AdminAuditErrorType =
  (typeof ADMIN_AUDIT_ERROR_TYPES)[number];

export type AdminAuditEvaluationErrorItem = {
  id: string;
  type: AdminAuditErrorType;
  customerImpact: string;
  occurredAt: string;
  retryCount: number;
  resolution: string;
  caseId: string;
  documentId: string | null;
  reportVersion: number | null;
  errorCode: string;
  internalDetail: {
    code: string;
    failureMessage: string | null;
  };
};

export type AdminAuditLogFilters = {
  action?: string;
  caseId?: string;
  from?: string;
  to?: string;
};

export type AdminAuditLogItem = {
  id: string;
  action: string;
  actor: AuditEvaluationActor;
  target: {
    caseId: string | null;
    documentId: string | null;
    reportVersion: number | null;
  };
  detail: string;
  occurredAt: string;
  errorCode: string | null;
  retryCount: number | null;
};

export function parseAdminCaseFilters(
  searchParams: URLSearchParams,
): AdminAuditEvaluationCaseFilters {
  const status = searchParams.get("status")?.trim();
  const fiscalYear = optionalInteger(searchParams.get("fiscalYear"));
  return {
    status: status && AUDIT_EVALUATION_CASE_STATUSES.includes(
      status as AuditEvaluationCaseStatus,
    )
      ? status as AuditEvaluationCaseStatus
      : undefined,
    fiscalYear,
    cooperativeName:
      searchParams.get("cooperativeName")?.trim().slice(0, 200) || undefined,
    createdFrom: optionalInstant(searchParams.get("createdFrom")),
    createdTo: optionalInstant(searchParams.get("createdTo")),
    hasError: optionalBoolean(searchParams.get("hasError")),
    reportCompleted: optionalBoolean(
      searchParams.get("reportCompleted"),
    ),
  };
}

export function parseAdminAuditLogFilters(
  searchParams: URLSearchParams,
): AdminAuditLogFilters {
  const caseId = searchParams.get("caseId")?.trim();
  return {
    action: searchParams.get("action")?.trim().slice(0, 100) || undefined,
    caseId: caseId && resourceId.safeParse(caseId).success
      ? caseId
      : undefined,
    from: optionalInstant(searchParams.get("from")),
    to: optionalInstant(searchParams.get("to")),
  };
}

function optionalInteger(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 2_000 && parsed <= 9_999
    ? parsed
    : undefined;
}

function optionalBoolean(value: string | null) {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function optionalInstant(value: string | null) {
  if (!value) return undefined;
  return instant.safeParse(value).success ? value : undefined;
}
