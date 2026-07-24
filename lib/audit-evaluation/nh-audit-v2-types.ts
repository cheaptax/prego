import type { WonAmount } from "@/lib/audit-evaluation/types";

export const NH_AUDIT_QUOTE_SUBMISSION_SCHEMA_VERSION = 2 as const;
export const NH_AUDIT_EVALUATION_STANDARD_VERSION =
  "nh-audit-evaluation-2025-v1" as const;

export const NH_AUDIT_PROPOSER_TYPES = [
  "ACCOUNTING_FIRM",
  "AUDIT_GROUP",
] as const;
export type NhAuditProposerType =
  (typeof NH_AUDIT_PROPOSER_TYPES)[number];

export const NH_AUDIT_EXPENSE_BILLING_MODES = [
  "INCLUDED_IN_AUDIT_FEE",
  "SEPARATELY_BILLED",
] as const;
export type NhAuditExpenseBillingMode =
  (typeof NH_AUDIT_EXPENSE_BILLING_MODES)[number];

export const NH_AUDIT_COOPERATIVE_TYPES_2025 = [
  "LOCAL_AGRICULTURAL_COOPERATIVE",
  "LOCAL_LIVESTOCK_COOPERATIVE",
  "ITEM_AGRICULTURAL_OR_LIVESTOCK_COOPERATIVE",
  "GINSENG_COOPERATIVE",
] as const;
export type NhAuditCooperativeType2025 =
  (typeof NH_AUDIT_COOPERATIVE_TYPES_2025)[number];

export const NH_AUDIT_QUALITY_CRITERION_IDS = [
  "LOCAL_NONGHYUP_AUDIT_COUNT_2025",
  "CERTIFIED_PUBLIC_ACCOUNTANT_COUNT",
  "ACCOUNTING_FIRM_REVENUE",
  "AUDITED_NONGHYUP_TYPE_DIVERSITY_2025",
  "NONGHYUP_TAX_AGENCY_PERFORMED_2025",
  "NONGHYUP_SUBSIDY_SETTLEMENT_PERFORMED_2025",
] as const;
export type NhAuditQualityCriterionId =
  (typeof NH_AUDIT_QUALITY_CRITERION_IDS)[number];

export type NhAuditQuoteSubmissionV2 = {
  schemaVersion: typeof NH_AUDIT_QUOTE_SUBMISSION_SCHEMA_VERSION;
  submissionId: string;
  quoteRequestId: string;
  targetCooperative: {
    id: string | null;
    name: string;
  };
  fiscalYear: number;
  partnerAccountId: string;
  /** Trusted server code must resolve this from the partner record. */
  accountingFirmName: string;
  engagementPartnerName: string;
  proposerType: NhAuditProposerType;
  auditFeeWon: WonAmount;
  expenseBillingMode: NhAuditExpenseBillingMode;
  expectedExpenseWon: WonAmount;
  localNonghyupAuditCount2025: number;
  certifiedPublicAccountantCount: number;
  accountingFirmRevenueWon: WonAmount;
  auditedNonghyupTypes2025: NhAuditCooperativeType2025[];
  nonghyupTaxAgencyPerformed2025: boolean;
  nonghyupSubsidySettlementPerformed2025: boolean;
  factsConfirmed: true;
  submittedAt: string;
};

/**
 * Partner-controlled fields accepted at the API boundary. Identity, accounting
 * firm, request metadata, and timestamps are always supplied by the server.
 */
export type NhAuditPartnerSubmissionInputV2 = Pick<
  NhAuditQuoteSubmissionV2,
  | "engagementPartnerName"
  | "proposerType"
  | "auditFeeWon"
  | "expenseBillingMode"
  | "expectedExpenseWon"
  | "localNonghyupAuditCount2025"
  | "certifiedPublicAccountantCount"
  | "accountingFirmRevenueWon"
  | "auditedNonghyupTypes2025"
  | "nonghyupTaxAgencyPerformed2025"
  | "nonghyupSubsidySettlementPerformed2025"
  | "factsConfirmed"
>;

export const NH_AUDIT_PARTNER_SUBMISSION_FIELDS = [
  "engagementPartnerName",
  "proposerType",
  "auditFeeWon",
  "expenseBillingMode",
  "expectedExpenseWon",
  "localNonghyupAuditCount2025",
  "certifiedPublicAccountantCount",
  "accountingFirmRevenueWon",
  "auditedNonghyupTypes2025",
  "nonghyupTaxAgencyPerformed2025",
  "nonghyupSubsidySettlementPerformed2025",
  "factsConfirmed",
] as const satisfies readonly (keyof NhAuditPartnerSubmissionInputV2)[];

export const NH_AUDIT_QUOTE_SUBMISSION_FIELDS = [
  "schemaVersion",
  "submissionId",
  "quoteRequestId",
  "targetCooperative",
  "fiscalYear",
  "partnerAccountId",
  "accountingFirmName",
  "engagementPartnerName",
  "proposerType",
  "auditFeeWon",
  "expenseBillingMode",
  "expectedExpenseWon",
  "localNonghyupAuditCount2025",
  "certifiedPublicAccountantCount",
  "accountingFirmRevenueWon",
  "auditedNonghyupTypes2025",
  "nonghyupTaxAgencyPerformed2025",
  "nonghyupSubsidySettlementPerformed2025",
  "factsConfirmed",
  "submittedAt",
] as const;
export type NhAuditQuoteSubmissionField =
  (typeof NH_AUDIT_QUOTE_SUBMISSION_FIELDS)[number];

export type NhAuditQualityWeights = Record<
  NhAuditQualityCriterionId,
  number
>;

export type NhAuditCustomerWeightsV2 = {
  qualityWeightPercent: number;
  priceWeightPercent: number;
  qualityCriterionWeights: NhAuditQualityWeights;
};

export const NH_AUDIT_ELIGIBILITY_STATUSES = [
  "ELIGIBLE",
  "INELIGIBLE",
  "RESUBMISSION_REQUIRED",
  "EXCLUDED",
] as const;
export type NhAuditEligibilityStatus =
  (typeof NH_AUDIT_ELIGIBILITY_STATUSES)[number];

export const NH_AUDIT_EVALUATION_REASON_CODES = [
  "AUDIT_GROUP_PROPOSER",
  "LEGACY_DOCUMENT_MISSING_REQUIRED_FIELDS",
  "SERVER_VALIDATION_FAILED",
  "ADMINISTRATIVELY_EXCLUDED",
  "NON_POSITIVE_TOTAL_BURDEN",
] as const;
export type NhAuditEvaluationReasonCode =
  (typeof NH_AUDIT_EVALUATION_REASON_CODES)[number];

export type ExactScore = {
  numerator: string;
  denominator: string;
};

export type NhAuditCriterionInputValue =
  | number
  | WonAmount
  | NhAuditCooperativeType2025[]
  | boolean;

export type NhAuditQualityCriterionResult = {
  criterionId: NhAuditQualityCriterionId;
  inputValue: NhAuditCriterionInputValue;
  appliedBandId: string;
  recognitionRateBasisPoints: number;
  weightPoints: number;
  earnedScore: ExactScore;
};

export type NhAuditQualityEvaluationResult = {
  evaluationStandardVersion:
    typeof NH_AUDIT_EVALUATION_STANDARD_VERSION;
  criteria: NhAuditQualityCriterionResult[];
  qualityScore: ExactScore;
};

export const NH_AUDIT_VAT_ROUNDING_POLICY =
  "HALF_UP_TO_WON" as const;

export type NhAuditCostCalculationResult = {
  currency: "KRW";
  vatRateBasisPoints: 1_000;
  vatRoundingPolicy: typeof NH_AUDIT_VAT_ROUNDING_POLICY;
  auditFeeWon: WonAmount;
  normalizedExpectedExpenseWon: WonAmount;
  supplyAmountWon: WonAmount;
  vatWon: WonAmount;
  expectedTotalBurdenWon: WonAmount;
};

export type NhAuditSubmissionValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export type NhAuditSubmissionValidationResult =
  | {
      success: true;
      data: NhAuditQuoteSubmissionV2;
      missingFields: [];
      issues: [];
    }
  | {
      success: false;
      data: null;
      missingFields: NhAuditQuoteSubmissionField[];
      issues: NhAuditSubmissionValidationIssue[];
    };

export type NhAuditCandidateSource =
  | "V2_SUBMISSION"
  | "LEGACY_DOCUMENT";

export type PrepareNhAuditCandidateInput = {
  candidateId: string;
  source: NhAuditCandidateSource;
  rawSubmission: unknown;
  administrativelyExcluded?: boolean;
};

export type PreparedNhAuditCandidate = {
  candidateId: string;
  source: NhAuditCandidateSource;
  administrativelyExcluded: boolean;
  rawProposerType: NhAuditProposerType | null;
  validation: NhAuditSubmissionValidationResult;
};

export type NhAuditQuoteEvaluationResultV2 = {
  candidateId: string;
  submission: NhAuditQuoteSubmissionV2 | null;
  evaluationStandardVersion:
    typeof NH_AUDIT_EVALUATION_STANDARD_VERSION;
  eligibilityStatus: NhAuditEligibilityStatus;
  reasonCodes: NhAuditEvaluationReasonCode[];
  missingFields: NhAuditQuoteSubmissionField[];
  quality: NhAuditQualityEvaluationResult | null;
  cost: NhAuditCostCalculationResult | null;
  priceBaseScore: ExactScore | null;
  overallScore: ExactScore | null;
  rank: number | null;
  tiedWithCandidateIds: string[];
};

export type NhAuditPriceCandidate = {
  candidateId: string;
  eligibilityStatus: NhAuditEligibilityStatus;
  expectedTotalBurdenWon: WonAmount | null;
};

export type NhAuditPriceScoreResult = {
  minimumEligibleTotalBurdenWon: WonAmount | null;
  scoresByCandidateId: Record<string, ExactScore>;
};

export type NhAuditRankKey = {
  candidateId: string;
  overallScore: ExactScore;
  qualityScore: ExactScore;
  expectedTotalBurdenWon: WonAmount;
  localNonghyupAuditCount2025: number;
};
