import { normalizeWonAmount } from "@/lib/audit-evaluation/money";
import { normalizedAuditQuoteSchema } from "@/lib/audit-evaluation/quote-extraction-schemas";
import type {
  AuditEvaluationCase,
  NormalizedAuditQuote,
} from "@/lib/audit-evaluation/types";
import type { QuoteRecord } from "@/lib/firebase/schema";
import {
  isSentPartnerQuote,
  pickLatestSentQuote,
} from "@/lib/quotes/quote-revision";
import { quoteRequestIdFor } from "@/lib/quotes/quote-requests";

export class InboxReportBridgeError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "InboxReportBridgeError";
    this.code = code;
  }
}

/**
 * Latest sent NH-audit quotes per assignment (void/superseded versions excluded).
 */
export function selectNhAuditQuotesForReport(
  quotes: readonly QuoteRecord[],
): QuoteRecord[] {
  const assignmentIds = [
    ...new Set(
      quotes
        .filter((quote) => isSentPartnerQuote(quote) && quote.nhAuditV2)
        .map((quote) => quote.quoteAssignmentId),
    ),
  ];
  return assignmentIds
    .map((assignmentId) => pickLatestSentQuote(quotes, assignmentId))
    .filter((quote): quote is QuoteRecord =>
      Boolean(quote?.nhAuditV2 && isSentPartnerQuote(quote))
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function partnerQuoteRequestIdsForCase(
  evaluationCase: Pick<AuditEvaluationCase, "quoteRequestId">,
) {
  return uniqueNonEmpty([
    quoteRequestIdFor("audit_quote", evaluationCase.quoteRequestId),
    evaluationCase.quoteRequestId,
  ]);
}

export function normalizedQuoteFromPartnerNhAuditQuote(input: {
  quote: QuoteRecord;
  caseId: string;
  now: string;
}): NormalizedAuditQuote {
  const { quote, caseId, now } = input;
  if (quote.auditEvaluation?.normalizedQuote) {
    return normalizedAuditQuoteSchema.parse({
      ...quote.auditEvaluation.normalizedQuote,
      quoteId: quote.id,
      caseId,
      documentId: quote.id,
      confirmedByCustomer: true,
      confirmedAt: now,
      revision: (quote.auditEvaluation.normalizedQuote.revision ?? 0) + 1,
      updatedAt: now,
      pendingAdminReviewFields: [],
    });
  }
  const submission = quote.nhAuditV2?.submission;
  if (!submission) {
    throw new InboxReportBridgeError("quote_missing_nh_audit");
  }
  return normalizedAuditQuoteSchema.parse({
    quoteId: quote.id,
    caseId,
    documentId: quote.id,
    accountingFirmId: quote.partnerId,
    accountingFirmName:
      submission.accountingFirmName ||
      quote.supplierName ||
      quote.partnerName,
    auditFee: normalizeWonAmount(submission.auditFeeWon),
    vatIncluded: quote.vatIncluded,
    accountingFirmRevenue: normalizeWonAmount(
      submission.accountingFirmRevenueWon,
    ),
    recentNonghyupAuditCount: submission.localNonghyupAuditCount2025,
    auditedNonghyupTypes: [...submission.auditedNonghyupTypes2025],
    taxAgencyExperience: {
      hasExperience: submission.nonghyupTaxAgencyPerformed2025,
      descriptions: [],
    },
    subsidySettlementExperience: {
      hasExperience: submission.nonghyupSubsidySettlementPerformed2025,
      descriptions: [],
    },
    engagementPartner: {
      name: submission.engagementPartnerName,
      title: null,
      yearsOfExperience: null,
    },
    engagementTeam: [],
    totalPlannedHours: null,
    partnerHours: null,
    auditSchedule: [],
    qualityControlPlan: [],
    requiredProposalItems: {},
    missingFields: [],
    warnings: [],
    confidenceByField: {},
    evidenceByField: {},
    source: {
      accountingFirmId: "TRUSTED_SERVER_RECORD",
      accountingFirmName: "TRUSTED_SERVER_RECORD",
      auditFee: "TRUSTED_SERVER_RECORD",
      vatIncluded: "TRUSTED_SERVER_RECORD",
      accountingFirmRevenue: "TRUSTED_SERVER_RECORD",
      recentNonghyupAuditCount: "TRUSTED_SERVER_RECORD",
      auditedNonghyupTypes: "TRUSTED_SERVER_RECORD",
      taxAgencyExperience: "TRUSTED_SERVER_RECORD",
      subsidySettlementExperience: "TRUSTED_SERVER_RECORD",
      engagementPartner: "TRUSTED_SERVER_RECORD",
    },
    confirmedByCustomer: true,
    confirmedAt: now,
    revision: 1,
    updatedAt: now,
    pendingAdminReviewFields: [],
  });
}

export function isReportWorkspaceReady(
  status: string | null | undefined,
): boolean {
  return (
    status === "READY" ||
    status === "GENERATING" ||
    status === "COMPLETED"
  );
}

export function resolveInboxCooperativeName(
  preferred: string | undefined,
  quotes: readonly QuoteRecord[],
  fallback: string,
) {
  const fromQuote = quotes
    .map((quote) => quote.nhAuditV2?.submission.targetCooperative.name?.trim())
    .find((name) => Boolean(name));
  return (preferred?.trim() || fromQuote || fallback || "").slice(0, 500);
}

export function resolveInboxFiscalYear(
  preferred: number | undefined,
  quotes: readonly QuoteRecord[],
  fallback: number,
) {
  if (
    Number.isInteger(preferred) &&
    preferred !== undefined &&
    preferred >= 2_000 &&
    preferred <= 9_999
  ) {
    return preferred;
  }
  const fromQuote = quotes
    .map((quote) => quote.nhAuditV2?.submission.fiscalYear)
    .find(
      (year) =>
        Number.isInteger(year) &&
        year !== undefined &&
        year >= 2_000 &&
        year <= 9_999,
    );
  return fromQuote ?? fallback;
}

function uniqueNonEmpty(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
