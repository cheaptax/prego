import { z } from "zod";
import {
  isWonAmount,
  normalizeWonAmount,
} from "@/lib/audit-evaluation/money";
import {
  NH_AUDIT_COMPOSITE_WEIGHT_LIMITS,
  NH_AUDIT_DEFAULT_CUSTOMER_WEIGHTS,
  NH_AUDIT_QUALITY_WEIGHT_LIMITS,
} from "@/lib/audit-evaluation/nh-audit-v2-policy";
import {
  NH_AUDIT_COOPERATIVE_TYPES_2025,
  NH_AUDIT_EXPENSE_BILLING_MODES,
  NH_AUDIT_PROPOSER_TYPES,
  NH_AUDIT_QUOTE_SUBMISSION_FIELDS,
  NH_AUDIT_QUOTE_SUBMISSION_SCHEMA_VERSION,
  type NhAuditCustomerWeightsV2,
  type NhAuditPartnerSubmissionInputV2,
  type NhAuditProposerType,
  type NhAuditQuoteSubmissionField,
  type NhAuditQuoteSubmissionV2,
  type NhAuditSubmissionValidationResult,
  type PrepareNhAuditCandidateInput,
  type PreparedNhAuditCandidate,
} from "@/lib/audit-evaluation/nh-audit-v2-types";
import type { WonAmount } from "@/lib/audit-evaluation/types";

const RESOURCE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const safeText = (maximum: number) =>
  z.string().trim().min(1).max(maximum);

const wonAmountInputSchema = z.preprocess(
  (value) => {
    if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      return String(value);
    }
    if (typeof value === "bigint" && value >= 0n) {
      return value.toString();
    }
    return typeof value === "string" ? value.trim() : value;
  },
  z.custom<WonAmount>(
    isWonAmount,
    "A canonical non-negative integer won amount is required.",
  ),
);

const safePartnerWonAmountSchema = z
  .custom<WonAmount>(
    isWonAmount,
    "A canonical non-negative integer won amount is required.",
  )
  .refine(
    (value) => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER),
    "A safe integer won amount is required.",
  );

const targetCooperativeSchema = z
  .object({
    id: safeText(128).nullable(),
    name: safeText(300),
  })
  .strict();

export const nhAuditPartnerSubmissionInputV2Schema = z
  .object({
    engagementPartnerName: safeText(200),
    proposerType: z.enum(NH_AUDIT_PROPOSER_TYPES),
    auditFeeWon: safePartnerWonAmountSchema.refine(
      (value) => BigInt(value) > 0n,
      "Audit fee must be greater than zero.",
    ),
    expenseBillingMode: z.enum(NH_AUDIT_EXPENSE_BILLING_MODES),
    expectedExpenseWon: safePartnerWonAmountSchema.optional(),
    localNonghyupAuditCount2025: z.number().int().nonnegative().safe(),
    certifiedPublicAccountantCount: z.number().int().nonnegative().safe(),
    accountingFirmRevenueWon: safePartnerWonAmountSchema,
    auditedNonghyupTypes2025: z
      .array(z.enum(NH_AUDIT_COOPERATIVE_TYPES_2025))
      .max(NH_AUDIT_COOPERATIVE_TYPES_2025.length)
      .transform((values) => [...new Set(values)]),
    nonghyupTaxAgencyPerformed2025: z.boolean(),
    nonghyupSubsidySettlementPerformed2025: z.boolean(),
    factsConfirmed: z.literal(true),
  })
  .superRefine((submission, context) => {
    if (
      submission.expenseBillingMode === "SEPARATELY_BILLED" &&
      submission.expectedExpenseWon === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["expectedExpenseWon"],
        message: "Expected expense is required when billed separately.",
      });
    }
  })
  .transform((submission) => ({
    ...submission,
    engagementPartnerName: submission.engagementPartnerName.trim(),
    expectedExpenseWon:
      submission.expenseBillingMode === "INCLUDED_IN_AUDIT_FEE"
        ? normalizeWonAmount("0")
        : submission.expectedExpenseWon!,
  })) satisfies z.ZodType<NhAuditPartnerSubmissionInputV2>;

export const nhAuditQuoteSubmissionV2Schema: z.ZodType<
  NhAuditQuoteSubmissionV2
> = z
  .object({
    schemaVersion: z.literal(NH_AUDIT_QUOTE_SUBMISSION_SCHEMA_VERSION),
    submissionId: z.string().regex(RESOURCE_ID),
    quoteRequestId: z.string().regex(RESOURCE_ID),
    targetCooperative: targetCooperativeSchema,
    fiscalYear: z.number().int().min(2_000).max(2_100),
    partnerAccountId: z.string().regex(RESOURCE_ID),
    accountingFirmName: safeText(300),
    engagementPartnerName: safeText(200),
    proposerType: z.enum(NH_AUDIT_PROPOSER_TYPES),
    auditFeeWon: wonAmountInputSchema,
    expenseBillingMode: z.enum(NH_AUDIT_EXPENSE_BILLING_MODES),
    expectedExpenseWon: wonAmountInputSchema,
    localNonghyupAuditCount2025: z.number().int().nonnegative().safe(),
    certifiedPublicAccountantCount: z.number().int().nonnegative().safe(),
    accountingFirmRevenueWon: wonAmountInputSchema,
    auditedNonghyupTypes2025: z
      .array(z.enum(NH_AUDIT_COOPERATIVE_TYPES_2025))
      .max(NH_AUDIT_COOPERATIVE_TYPES_2025.length)
      .transform((values) => [...new Set(values)]),
    nonghyupTaxAgencyPerformed2025: z.boolean(),
    nonghyupSubsidySettlementPerformed2025: z.boolean(),
    factsConfirmed: z.literal(true),
    submittedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .transform((submission) => ({
    ...submission,
    expectedExpenseWon:
      submission.expenseBillingMode === "INCLUDED_IN_AUDIT_FEE"
        ? normalizeWonAmount("0")
        : submission.expectedExpenseWon,
  }));

const qualityCriterionWeightsSchema = z
  .object({
    LOCAL_NONGHYUP_AUDIT_COUNT_2025: boundedWeight(
      "LOCAL_NONGHYUP_AUDIT_COUNT_2025",
    ),
    CERTIFIED_PUBLIC_ACCOUNTANT_COUNT: boundedWeight(
      "CERTIFIED_PUBLIC_ACCOUNTANT_COUNT",
    ),
    ACCOUNTING_FIRM_REVENUE: boundedWeight(
      "ACCOUNTING_FIRM_REVENUE",
    ),
    AUDITED_NONGHYUP_TYPE_DIVERSITY_2025: boundedWeight(
      "AUDITED_NONGHYUP_TYPE_DIVERSITY_2025",
    ),
    NONGHYUP_TAX_AGENCY_PERFORMED_2025: boundedWeight(
      "NONGHYUP_TAX_AGENCY_PERFORMED_2025",
    ),
    NONGHYUP_SUBSIDY_SETTLEMENT_PERFORMED_2025: boundedWeight(
      "NONGHYUP_SUBSIDY_SETTLEMENT_PERFORMED_2025",
    ),
  })
  .strict()
  .superRefine((weights, context) => {
    const total = Object.values(weights).reduce(
      (sum, weight) => sum + weight,
      0,
    );
    if (total !== 100) {
      context.addIssue({
        code: "custom",
        path: [],
        message: "Quality criterion weights must total 100 points.",
      });
    }
  });

export const nhAuditCustomerWeightsV2Schema: z.ZodType<
  NhAuditCustomerWeightsV2
> = z
  .object({
    qualityWeightPercent: z
      .number()
      .int()
      .min(NH_AUDIT_COMPOSITE_WEIGHT_LIMITS.quality.minimum)
      .max(NH_AUDIT_COMPOSITE_WEIGHT_LIMITS.quality.maximum),
    priceWeightPercent: z
      .number()
      .int()
      .min(NH_AUDIT_COMPOSITE_WEIGHT_LIMITS.price.minimum)
      .max(NH_AUDIT_COMPOSITE_WEIGHT_LIMITS.price.maximum),
    qualityCriterionWeights: qualityCriterionWeightsSchema,
  })
  .strict()
  .superRefine((weights, context) => {
    if (
      weights.qualityWeightPercent + weights.priceWeightPercent !==
      NH_AUDIT_COMPOSITE_WEIGHT_LIMITS.requiredTotal
    ) {
      context.addIssue({
        code: "custom",
        path: ["qualityWeightPercent"],
        message: "Quality and price weights must total 100 percent.",
      });
    }
  });

export function validateNhAuditQuoteSubmissionV2(
  value: unknown,
): NhAuditSubmissionValidationResult {
  const parsed = nhAuditQuoteSubmissionV2Schema.safeParse(value);
  if (parsed.success) {
    return {
      success: true,
      data: parsed.data,
      missingFields: [],
      issues: [],
    };
  }
  return {
    success: false,
    data: null,
    missingFields: missingSubmissionFields(value),
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      code: issue.code,
      message: issue.message,
    })),
  };
}

export function parseNhAuditPartnerSubmissionInputV2(value: unknown) {
  return nhAuditPartnerSubmissionInputV2Schema.safeParse(value);
}

export function validateNhAuditCustomerWeightsV2(value: unknown) {
  return nhAuditCustomerWeightsV2Schema.safeParse(value);
}

export function createDefaultNhAuditCustomerWeightsV2():
  NhAuditCustomerWeightsV2 {
  return {
    qualityWeightPercent:
      NH_AUDIT_DEFAULT_CUSTOMER_WEIGHTS.qualityWeightPercent,
    priceWeightPercent:
      NH_AUDIT_DEFAULT_CUSTOMER_WEIGHTS.priceWeightPercent,
    qualityCriterionWeights: {
      ...NH_AUDIT_DEFAULT_CUSTOMER_WEIGHTS.qualityCriterionWeights,
    },
  };
}

export function prepareNhAuditCandidateV2(
  input: PrepareNhAuditCandidateInput,
): PreparedNhAuditCandidate {
  if (!RESOURCE_ID.test(input.candidateId)) {
    throw new Error("invalid_nh_audit_candidate_id");
  }
  return {
    candidateId: input.candidateId,
    source: input.source,
    administrativelyExcluded: input.administrativelyExcluded === true,
    rawProposerType: readRawProposerType(input.rawSubmission),
    validation: validateNhAuditQuoteSubmissionV2(input.rawSubmission),
  };
}

function boundedWeight(
  criterionId: keyof typeof NH_AUDIT_QUALITY_WEIGHT_LIMITS,
) {
  const limits = NH_AUDIT_QUALITY_WEIGHT_LIMITS[criterionId];
  return z.number().int().min(limits.minimum).max(limits.maximum);
}

function missingSubmissionFields(
  value: unknown,
): NhAuditQuoteSubmissionField[] {
  const record = isRecord(value) ? value : {};
  return NH_AUDIT_QUOTE_SUBMISSION_FIELDS.filter((field) => {
    const candidate = record[field];
    if (candidate === undefined || candidate === null) return true;
    if (typeof candidate === "string") return candidate.trim() === "";
    if (field === "targetCooperative") {
      return (
        !isRecord(candidate) ||
        typeof candidate.name !== "string" ||
        candidate.name.trim() === ""
      );
    }
    return false;
  });
}

function readRawProposerType(value: unknown): NhAuditProposerType | null {
  if (!isRecord(value)) return null;
  const proposerType = value.proposerType;
  return NH_AUDIT_PROPOSER_TYPES.includes(
      proposerType as NhAuditProposerType,
    )
    ? proposerType as NhAuditProposerType
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
