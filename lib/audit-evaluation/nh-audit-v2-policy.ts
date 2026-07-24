import type {
  NhAuditQualityCriterionId,
  NhAuditQualityWeights,
} from "@/lib/audit-evaluation/nh-audit-v2-types";

export const NH_AUDIT_DEFAULT_CUSTOMER_WEIGHTS = {
  qualityWeightPercent: 60,
  priceWeightPercent: 40,
  qualityCriterionWeights: {
    LOCAL_NONGHYUP_AUDIT_COUNT_2025: 30,
    CERTIFIED_PUBLIC_ACCOUNTANT_COUNT: 20,
    ACCOUNTING_FIRM_REVENUE: 20,
    AUDITED_NONGHYUP_TYPE_DIVERSITY_2025: 10,
    NONGHYUP_TAX_AGENCY_PERFORMED_2025: 10,
    NONGHYUP_SUBSIDY_SETTLEMENT_PERFORMED_2025: 10,
  },
} as const satisfies {
  qualityWeightPercent: number;
  priceWeightPercent: number;
  qualityCriterionWeights: NhAuditQualityWeights;
};

export const NH_AUDIT_COMPOSITE_WEIGHT_LIMITS = {
  quality: { minimum: 40, maximum: 80 },
  price: { minimum: 20, maximum: 60 },
  requiredTotal: 100,
} as const;

export const NH_AUDIT_QUALITY_WEIGHT_LIMITS = {
  LOCAL_NONGHYUP_AUDIT_COUNT_2025: {
    default: 30,
    minimum: 20,
    maximum: 40,
  },
  CERTIFIED_PUBLIC_ACCOUNTANT_COUNT: {
    default: 20,
    minimum: 10,
    maximum: 30,
  },
  ACCOUNTING_FIRM_REVENUE: {
    default: 20,
    minimum: 10,
    maximum: 30,
  },
  AUDITED_NONGHYUP_TYPE_DIVERSITY_2025: {
    default: 10,
    minimum: 0,
    maximum: 20,
  },
  NONGHYUP_TAX_AGENCY_PERFORMED_2025: {
    default: 10,
    minimum: 0,
    maximum: 20,
  },
  NONGHYUP_SUBSIDY_SETTLEMENT_PERFORMED_2025: {
    default: 10,
    minimum: 0,
    maximum: 20,
  },
} as const satisfies Record<
  NhAuditQualityCriterionId,
  { default: number; minimum: number; maximum: number }
>;

export type NhAuditIntegerRecognitionBand = {
  id: string;
  minimumInclusive: number;
  maximumExclusive: number | null;
  recognitionRateBasisPoints: number;
};

export type NhAuditWonRecognitionBand = {
  id: string;
  minimumInclusiveWon: string;
  maximumExclusiveWon: string | null;
  recognitionRateBasisPoints: number;
};

export const NH_AUDIT_COUNT_RECOGNITION_BANDS = [
  {
    id: "audit-count-0-4",
    minimumInclusive: 0,
    maximumExclusive: 5,
    recognitionRateBasisPoints: 0,
  },
  {
    id: "audit-count-5-9",
    minimumInclusive: 5,
    maximumExclusive: 10,
    recognitionRateBasisPoints: 500,
  },
  {
    id: "audit-count-10-19",
    minimumInclusive: 10,
    maximumExclusive: 20,
    recognitionRateBasisPoints: 1_000,
  },
  {
    id: "audit-count-20-29",
    minimumInclusive: 20,
    maximumExclusive: 30,
    recognitionRateBasisPoints: 2_000,
  },
  {
    id: "audit-count-30-39",
    minimumInclusive: 30,
    maximumExclusive: 40,
    recognitionRateBasisPoints: 3_000,
  },
  {
    id: "audit-count-40-49",
    minimumInclusive: 40,
    maximumExclusive: 50,
    recognitionRateBasisPoints: 5_000,
  },
  {
    id: "audit-count-50-plus",
    minimumInclusive: 50,
    maximumExclusive: null,
    recognitionRateBasisPoints: 10_000,
  },
] as const satisfies readonly NhAuditIntegerRecognitionBand[];

export const NH_AUDIT_CPA_COUNT_RECOGNITION_BANDS = [
  {
    id: "cpa-count-0-6",
    minimumInclusive: 0,
    maximumExclusive: 7,
    recognitionRateBasisPoints: 0,
  },
  {
    id: "cpa-count-7-10",
    minimumInclusive: 7,
    maximumExclusive: 11,
    recognitionRateBasisPoints: 1_500,
  },
  {
    id: "cpa-count-11-15",
    minimumInclusive: 11,
    maximumExclusive: 16,
    recognitionRateBasisPoints: 3_000,
  },
  {
    id: "cpa-count-16-19",
    minimumInclusive: 16,
    maximumExclusive: 20,
    recognitionRateBasisPoints: 5_000,
  },
  {
    id: "cpa-count-20-plus",
    minimumInclusive: 20,
    maximumExclusive: null,
    recognitionRateBasisPoints: 10_000,
  },
] as const satisfies readonly NhAuditIntegerRecognitionBand[];

export const NH_AUDIT_REVENUE_RECOGNITION_BANDS = [
  {
    id: "revenue-up-to-500m",
    minimumInclusiveWon: "0",
    maximumExclusiveWon: "500000001",
    recognitionRateBasisPoints: 0,
  },
  {
    id: "revenue-over-500m-up-to-2b",
    minimumInclusiveWon: "500000001",
    maximumExclusiveWon: "2000000001",
    recognitionRateBasisPoints: 1_000,
  },
  {
    id: "revenue-over-2b-up-to-5b",
    minimumInclusiveWon: "2000000001",
    maximumExclusiveWon: "5000000001",
    recognitionRateBasisPoints: 2_000,
  },
  {
    id: "revenue-over-5b-up-to-8b",
    minimumInclusiveWon: "5000000001",
    maximumExclusiveWon: "8000000001",
    recognitionRateBasisPoints: 3_000,
  },
  {
    id: "revenue-over-8b-up-to-10b",
    minimumInclusiveWon: "8000000001",
    maximumExclusiveWon: "10000000001",
    recognitionRateBasisPoints: 5_000,
  },
  {
    id: "revenue-over-10b",
    minimumInclusiveWon: "10000000001",
    maximumExclusiveWon: null,
    recognitionRateBasisPoints: 10_000,
  },
] as const satisfies readonly NhAuditWonRecognitionBand[];

export const NH_AUDIT_TYPE_DIVERSITY_RECOGNITION_BANDS = [
  {
    id: "type-diversity-0",
    minimumInclusive: 0,
    maximumExclusive: 1,
    recognitionRateBasisPoints: 0,
  },
  {
    id: "type-diversity-1",
    minimumInclusive: 1,
    maximumExclusive: 2,
    recognitionRateBasisPoints: 1_500,
  },
  {
    id: "type-diversity-2",
    minimumInclusive: 2,
    maximumExclusive: 3,
    recognitionRateBasisPoints: 3_000,
  },
  {
    id: "type-diversity-3",
    minimumInclusive: 3,
    maximumExclusive: 4,
    recognitionRateBasisPoints: 5_000,
  },
  {
    id: "type-diversity-4",
    minimumInclusive: 4,
    maximumExclusive: null,
    recognitionRateBasisPoints: 10_000,
  },
] as const satisfies readonly NhAuditIntegerRecognitionBand[];
