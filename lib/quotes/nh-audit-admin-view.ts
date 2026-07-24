import { formatExactScoreOneDecimal } from "@/lib/audit-evaluation/nh-audit-v2-engine";
import type {
  NhAuditCriterionInputValue,
  NhAuditEligibilityStatus,
  NhAuditEvaluationReasonCode,
  NhAuditQualityCriterionId,
} from "@/lib/audit-evaluation/nh-audit-v2-types";
import type {
  QuoteRecord,
  QuoteRequestRecord,
} from "@/lib/firebase/schema";
import { resolveNhAuditQuoteCompatibility } from "@/lib/quotes/nh-audit-quote-server";

export type AdminNhAuditCriterionView = {
  criterionId: NhAuditQualityCriterionId;
  inputValue: NhAuditCriterionInputValue;
  weightPoints: number;
  appliedBandId: string;
  recognitionRateBasisPoints: number;
  earnedScoreOneDecimal: string;
};

export type AdminNhAuditQuoteView = {
  id: string;
  quoteRequestId: string;
  quoteAssignmentId: string;
  version: number;
  deliveryStatus: QuoteRecord["status"];
  targetCooperativeName: string | null;
  fiscalYear: number | null;
  accountingFirmName: string | null;
  engagementPartnerName: string | null;
  proposerType: "ACCOUNTING_FIRM" | "AUDIT_GROUP" | null;
  submittedAt: string | null;
  partnerOrganizationId: string;
  partnerAccountId: string | null;
  cost: {
    auditFeeWon: string;
    expenseBillingMode:
      | "INCLUDED_IN_AUDIT_FEE"
      | "SEPARATELY_BILLED";
    expectedExpenseWon: string;
    supplyAmountWon: string;
    vatWon: string;
    expectedTotalBurdenWon: string;
  } | null;
  evaluationInput: {
    localNonghyupAuditCount2025: number;
    certifiedPublicAccountantCount: number;
    accountingFirmRevenueWon: string;
    auditedNonghyupTypes2025: string[];
    nonghyupTaxAgencyPerformed2025: boolean;
    nonghyupSubsidySettlementPerformed2025: boolean;
    factsConfirmed: boolean;
  } | null;
  quality: {
    scoreOneDecimal: string;
    criteria: AdminNhAuditCriterionView[];
  } | null;
  eligibilityStatus: NhAuditEligibilityStatus;
  reasonCodes: NhAuditEvaluationReasonCode[];
  evaluationStandardVersion: string | null;
  evaluatedAt: string | null;
  missingFields: string[];
  includedInOverallRanking: boolean;
};

export function buildAdminNhAuditQuoteView(
  quote: QuoteRecord,
  quoteRequest: QuoteRequestRecord,
): AdminNhAuditQuoteView | null {
  if (quoteRequest.sourceType !== "audit_quote") return null;
  const compatibility = resolveNhAuditQuoteCompatibility(
    quote,
    quoteRequest.sourceType,
  );
  const snapshot = quote.nhAuditV2;
  if (
    !snapshot ||
    !compatibility ||
    compatibility.status === "RESUBMISSION_REQUIRED"
  ) {
    return {
      id: quote.id,
      quoteRequestId: quote.quoteRequestId,
      quoteAssignmentId: quote.quoteAssignmentId,
      version: quote.version,
      deliveryStatus: quote.status,
      targetCooperativeName: quoteRequest.cooperativeName ?? null,
      fiscalYear: quoteRequest.fiscalYear ?? null,
      accountingFirmName: quote.partnerName || null,
      engagementPartnerName: null,
      proposerType: null,
      submittedAt: null,
      partnerOrganizationId: quote.partnerId,
      partnerAccountId: null,
      cost: null,
      evaluationInput: null,
      quality: null,
      eligibilityStatus: "RESUBMISSION_REQUIRED",
      reasonCodes:
        compatibility?.reasonCodes as NhAuditEvaluationReasonCode[] ?? [
          "LEGACY_DOCUMENT_MISSING_REQUIRED_FIELDS",
        ],
      evaluationStandardVersion: null,
      evaluatedAt: null,
      missingFields: compatibility?.missingFields ?? [],
      includedInOverallRanking: false,
    };
  }

  const { submission, cost, quality } = snapshot;
  const auditGroup = submission.proposerType === "AUDIT_GROUP";
  const excludedByServerReason = snapshot.reasonCodes.some((reason) =>
    [
      "ADMINISTRATIVELY_EXCLUDED",
      "NON_POSITIVE_TOTAL_BURDEN",
      "SERVER_VALIDATION_FAILED",
    ].includes(reason)
  );
  const eligibilityStatus = auditGroup
    ? "INELIGIBLE"
    : excludedByServerReason
      ? "EXCLUDED"
      : snapshot.eligibilityStatus;
  const reasonCodes = auditGroup
    ? ["AUDIT_GROUP_PROPOSER" as const]
    : [...snapshot.reasonCodes];
  const showQuality =
    eligibilityStatus !== "RESUBMISSION_REQUIRED" &&
    quality.criteria.length > 0;

  return {
    id: quote.id,
    quoteRequestId: quote.quoteRequestId,
    quoteAssignmentId: quote.quoteAssignmentId,
    version: quote.version,
    deliveryStatus: quote.status,
    targetCooperativeName: submission.targetCooperative.name,
    fiscalYear: submission.fiscalYear,
    accountingFirmName: submission.accountingFirmName,
    engagementPartnerName: submission.engagementPartnerName,
    proposerType: submission.proposerType,
    submittedAt: submission.submittedAt,
    partnerOrganizationId: quote.partnerId,
    partnerAccountId: submission.partnerAccountId,
    cost: {
      auditFeeWon: cost.auditFeeWon,
      expenseBillingMode: submission.expenseBillingMode,
      expectedExpenseWon: cost.normalizedExpectedExpenseWon,
      supplyAmountWon: cost.supplyAmountWon,
      vatWon: cost.vatWon,
      expectedTotalBurdenWon: cost.expectedTotalBurdenWon,
    },
    evaluationInput: {
      localNonghyupAuditCount2025:
        submission.localNonghyupAuditCount2025,
      certifiedPublicAccountantCount:
        submission.certifiedPublicAccountantCount,
      accountingFirmRevenueWon: submission.accountingFirmRevenueWon,
      auditedNonghyupTypes2025: [...submission.auditedNonghyupTypes2025],
      nonghyupTaxAgencyPerformed2025:
        submission.nonghyupTaxAgencyPerformed2025,
      nonghyupSubsidySettlementPerformed2025:
        submission.nonghyupSubsidySettlementPerformed2025,
      factsConfirmed: submission.factsConfirmed,
    },
    quality: showQuality
      ? {
          scoreOneDecimal: formatExactScoreOneDecimal(
            quality.qualityScore,
          ),
          criteria: quality.criteria.map((criterion) => ({
            criterionId: criterion.criterionId,
            inputValue: criterion.inputValue,
            weightPoints: criterion.weightPoints,
            appliedBandId: criterion.appliedBandId,
            recognitionRateBasisPoints:
              criterion.recognitionRateBasisPoints,
            earnedScoreOneDecimal: formatExactScoreOneDecimal(
              criterion.earnedScore,
            ),
          })),
        }
      : null,
    eligibilityStatus,
    reasonCodes,
    evaluationStandardVersion: quality.evaluationStandardVersion,
    evaluatedAt: snapshot.evaluatedAt,
    missingFields: [],
    includedInOverallRanking: eligibilityStatus === "ELIGIBLE",
  };
}

export function buildAdminNhAuditQuoteViews(
  quotes: readonly QuoteRecord[],
  quoteRequests: readonly QuoteRequestRecord[],
) {
  const requestById = new Map(
    quoteRequests.map((quoteRequest) => [
      quoteRequest.id,
      quoteRequest,
    ]),
  );
  return quotes
    .flatMap((quote) => {
      const quoteRequest = requestById.get(quote.quoteRequestId);
      if (!quoteRequest) return [];
      const view = buildAdminNhAuditQuoteView(quote, quoteRequest);
      return view ? [view] : [];
    })
    .sort((left, right) => {
      const submitted = (right.submittedAt ?? "").localeCompare(
        left.submittedAt ?? "",
      );
      return submitted || right.id.localeCompare(left.id);
    });
}
