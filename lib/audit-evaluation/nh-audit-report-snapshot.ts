import { z } from "zod";
import {
  calculateNhAuditCompositeComponentsV2,
  evaluateNhAuditQuoteCandidatesV2,
  formatExactScoreOneDecimal,
} from "@/lib/audit-evaluation/nh-audit-v2-engine";
import {
  createDefaultNhAuditCustomerWeightsV2,
  nhAuditCustomerWeightsV2Schema,
  prepareNhAuditCandidateV2,
} from "@/lib/audit-evaluation/nh-audit-v2-schemas";
import {
  NH_AUDIT_COOPERATIVE_TYPES_2025,
  NH_AUDIT_ELIGIBILITY_STATUSES,
  NH_AUDIT_EVALUATION_REASON_CODES,
  NH_AUDIT_PROPOSER_TYPES,
  NH_AUDIT_QUALITY_CRITERION_IDS,
  type ExactScore,
  type NhAuditCustomerWeightsV2,
  type NhAuditQuoteEvaluationResultV2,
} from "@/lib/audit-evaluation/nh-audit-v2-types";
import type { QuoteRecord } from "@/lib/firebase/schema";

export const NH_AUDIT_REPORT_SNAPSHOT_SCHEMA_VERSION = 1 as const;

const exactScoreSchema = z
  .object({
    numerator: z.string().regex(/^(0|[1-9][0-9]*)$/),
    denominator: z.string().regex(/^[1-9][0-9]*$/),
  })
  .strict();
const criterionInputSchema = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^(0|[1-9][0-9]*)$/),
  z.boolean(),
  z.array(z.enum(NH_AUDIT_COOPERATIVE_TYPES_2025)).max(4),
]);
const criterionResultSchema = z
  .object({
    criterionId: z.enum(NH_AUDIT_QUALITY_CRITERION_IDS),
    inputValue: criterionInputSchema,
    appliedBandId: z.string().trim().min(1).max(100),
    recognitionRateBasisPoints: z.number().int().min(0).max(10_000),
    weightPoints: z.number().int().min(0).max(100),
    earnedScore: exactScoreSchema,
  })
  .strict();
const quoteResultSchema = z
  .object({
    quoteId: z.string().trim().min(1).max(128),
    accountingFirmName: z.string().trim().min(1).max(500),
    engagementPartnerName: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .nullable()
      .optional(),
    proposerType: z.enum(NH_AUDIT_PROPOSER_TYPES).nullable().optional(),
    eligibilityStatus: z.enum(NH_AUDIT_ELIGIBILITY_STATUSES),
    reasonCodes: z.array(z.enum(NH_AUDIT_EVALUATION_REASON_CODES)).max(10),
    missingFields: z.array(z.string().trim().min(1).max(128)).max(50),
    auditFeeWon: z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/)
      .nullable()
      .optional(),
    expectedExpenseWon: z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/)
      .nullable()
      .optional(),
    supplyAmountWon: z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/)
      .nullable()
      .optional(),
    vatWon: z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/)
      .nullable()
      .optional(),
    expectedTotalBurdenWon: z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/)
      .nullable(),
    criteria: z.array(criterionResultSchema).max(6),
    qualityScore: exactScoreSchema.nullable(),
    priceBaseScore: exactScoreSchema.nullable(),
    weightedQualityScore: exactScoreSchema.nullable(),
    weightedPriceScore: exactScoreSchema.nullable(),
    overallScore: exactScoreSchema.nullable(),
    rank: z.number().int().positive().nullable(),
  })
  .strict();

export type NhAuditReportQuoteResultSnapshot = z.infer<
  typeof quoteResultSchema
>;

export const nhAuditReportEvaluationSnapshotSchema = z
  .object({
    schemaVersion: z.literal(NH_AUDIT_REPORT_SNAPSHOT_SCHEMA_VERSION),
    reportId: z.string().trim().min(1).max(128),
    evaluationId: z.string().trim().min(1).max(128),
    quoteRequestId: z.string().trim().min(1).max(128),
    customerId: z.string().trim().min(1).max(256),
    weights: nhAuditCustomerWeightsV2Schema,
    evaluationStandardVersion: z.string().trim().min(1).max(128),
    includedQuoteIds: z.array(z.string().trim().min(1).max(128)).max(500),
    excludedQuotes: z
      .array(
        z
          .object({
            quoteId: z.string().trim().min(1).max(128),
            eligibilityStatus: z.enum(NH_AUDIT_ELIGIBILITY_STATUSES),
            reasonCodes: z
              .array(z.enum(NH_AUDIT_EVALUATION_REASON_CODES))
              .max(10),
          })
          .strict(),
      )
      .max(500),
    quoteResults: z.array(quoteResultSchema).min(1).max(500),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    usesDefaultWeights: z.boolean(),
  })
  .strict();

export type NhAuditReportEvaluationSnapshot = z.infer<
  typeof nhAuditReportEvaluationSnapshotSchema
>;

export type NhAuditReportPreview = {
  weights: NhAuditCustomerWeightsV2;
  evaluationStandardVersion: string;
  usesDefaultWeights: boolean;
  includedQuoteIds: string[];
  excludedQuotes: NhAuditReportEvaluationSnapshot["excludedQuotes"];
  quoteResults: Array<
    Omit<
      NhAuditReportQuoteResultSnapshot,
      | "qualityScore"
      | "priceBaseScore"
      | "weightedQualityScore"
      | "weightedPriceScore"
      | "overallScore"
      | "criteria"
    > & {
      qualityScoreOneDecimal: string | null;
      priceBaseScoreOneDecimal: string | null;
      weightedQualityScoreOneDecimal: string | null;
      weightedPriceScoreOneDecimal: string | null;
      overallScoreOneDecimal: string | null;
      criteria: Array<
        NhAuditReportQuoteResultSnapshot["criteria"][number] & {
          earnedScoreOneDecimal: string;
        }
      >;
    }
  >;
};

export function buildNhAuditReportEvaluationSnapshot(input: {
  reportId: string;
  evaluationId: string;
  quoteRequestId: string;
  customerId: string;
  quotes: readonly QuoteRecord[];
  weights: unknown;
  now: string;
}): NhAuditReportEvaluationSnapshot {
  const weights = nhAuditCustomerWeightsV2Schema.parse(input.weights);
  const quoteById = new Map(input.quotes.map((quote) => [quote.id, quote]));
  const candidates = input.quotes.map((quote) =>
    prepareNhAuditCandidateV2({
      candidateId: quote.id,
      source: quote.nhAuditV2 ? "V2_SUBMISSION" : "LEGACY_DOCUMENT",
      rawSubmission: quote.nhAuditV2?.submission ?? null,
      administrativelyExcluded:
        quote.status === "void" ||
        quote.nhAuditV2?.eligibilityStatus === "EXCLUDED" ||
        quote.nhAuditV2?.reasonCodes.includes(
          "ADMINISTRATIVELY_EXCLUDED",
        ) === true,
    }),
  );
  const evaluated = evaluateNhAuditQuoteCandidatesV2(
    candidates,
    weights,
  );
  const quoteResults = evaluated.map((result) =>
    resultSnapshot(result, quoteById.get(result.candidateId), weights)
  );
  const includedQuoteIds = quoteResults
    .filter((result) => result.eligibilityStatus === "ELIGIBLE")
    .map((result) => result.quoteId);
  const excludedQuotes = quoteResults
    .filter((result) => result.eligibilityStatus !== "ELIGIBLE")
    .map((result) => ({
      quoteId: result.quoteId,
      eligibilityStatus: result.eligibilityStatus,
      reasonCodes: [...result.reasonCodes],
    }));
  const evaluationStandardVersion =
    evaluated[0]?.evaluationStandardVersion;
  if (!evaluationStandardVersion) {
    throw new Error("nh_audit_report_requires_quotes");
  }
  return nhAuditReportEvaluationSnapshotSchema.parse({
    schemaVersion: NH_AUDIT_REPORT_SNAPSHOT_SCHEMA_VERSION,
    reportId: input.reportId,
    evaluationId: input.evaluationId,
    quoteRequestId: input.quoteRequestId,
    customerId: input.customerId,
    weights,
    evaluationStandardVersion,
    includedQuoteIds,
    excludedQuotes,
    quoteResults,
    createdAt: input.now,
    updatedAt: input.now,
    usesDefaultWeights: weightsEqual(
      weights,
      createDefaultNhAuditCustomerWeightsV2(),
    ),
  });
}

export function nhAuditReportPreviewFromSnapshot(
  snapshot: NhAuditReportEvaluationSnapshot,
): NhAuditReportPreview {
  const parsed = nhAuditReportEvaluationSnapshotSchema.parse(snapshot);
  return {
    weights: parsed.weights,
    evaluationStandardVersion: parsed.evaluationStandardVersion,
    usesDefaultWeights: parsed.usesDefaultWeights,
    includedQuoteIds: [...parsed.includedQuoteIds],
    excludedQuotes: parsed.excludedQuotes.map((item) => ({
      ...item,
      reasonCodes: [...item.reasonCodes],
    })),
    quoteResults: parsed.quoteResults.map((result) => ({
      quoteId: result.quoteId,
      accountingFirmName: result.accountingFirmName,
      engagementPartnerName: result.engagementPartnerName ?? null,
      proposerType: result.proposerType ?? null,
      eligibilityStatus: result.eligibilityStatus,
      reasonCodes: [...result.reasonCodes],
      missingFields: [...result.missingFields],
      auditFeeWon: result.auditFeeWon ?? null,
      expectedExpenseWon: result.expectedExpenseWon ?? null,
      supplyAmountWon: result.supplyAmountWon ?? null,
      vatWon: result.vatWon ?? null,
      expectedTotalBurdenWon: result.expectedTotalBurdenWon,
      criteria: result.criteria.map((criterion) => ({
        ...criterion,
        earnedScoreOneDecimal: formatExactScoreOneDecimal(
          criterion.earnedScore,
        ),
      })),
      rank: result.rank,
      qualityScoreOneDecimal: formatOptionalScore(result.qualityScore),
      priceBaseScoreOneDecimal: formatOptionalScore(
        result.priceBaseScore,
      ),
      weightedQualityScoreOneDecimal: formatOptionalScore(
        result.weightedQualityScore,
      ),
      weightedPriceScoreOneDecimal: formatOptionalScore(
        result.weightedPriceScore,
      ),
      overallScoreOneDecimal: formatOptionalScore(result.overallScore),
    })),
  };
}

function resultSnapshot(
  result: NhAuditQuoteEvaluationResultV2,
  quote: QuoteRecord | undefined,
  weights: NhAuditCustomerWeightsV2,
): NhAuditReportQuoteResultSnapshot {
  const components =
    result.quality && result.priceBaseScore
      ? calculateNhAuditCompositeComponentsV2(
          result.quality.qualityScore,
          result.priceBaseScore,
          weights,
        )
      : null;
  return {
    quoteId: result.candidateId,
    accountingFirmName:
      result.submission?.accountingFirmName ||
      quote?.partnerName ||
      result.candidateId,
    engagementPartnerName:
      result.submission?.engagementPartnerName ?? null,
    proposerType: result.submission?.proposerType ?? null,
    eligibilityStatus: result.eligibilityStatus,
    reasonCodes: [...result.reasonCodes],
    missingFields: [...result.missingFields],
    auditFeeWon: result.cost?.auditFeeWon ?? null,
    expectedExpenseWon:
      result.cost?.normalizedExpectedExpenseWon ?? null,
    supplyAmountWon: result.cost?.supplyAmountWon ?? null,
    vatWon: result.cost?.vatWon ?? null,
    expectedTotalBurdenWon:
      result.cost?.expectedTotalBurdenWon ?? null,
    criteria: result.quality
      ? result.quality.criteria.map((criterion) => ({
          ...criterion,
          inputValue: Array.isArray(criterion.inputValue)
            ? [...criterion.inputValue]
            : criterion.inputValue,
        }))
      : [],
    qualityScore: result.quality?.qualityScore ?? null,
    priceBaseScore: result.priceBaseScore,
    weightedQualityScore: components?.weightedQualityScore ?? null,
    weightedPriceScore: components?.weightedPriceScore ?? null,
    overallScore: components?.overallScore ?? null,
    rank: result.rank,
  };
}

function formatOptionalScore(score: ExactScore | null) {
  return score ? formatExactScoreOneDecimal(score) : null;
}

function weightsEqual(
  left: NhAuditCustomerWeightsV2,
  right: NhAuditCustomerWeightsV2,
) {
  return (
    left.qualityWeightPercent === right.qualityWeightPercent &&
    left.priceWeightPercent === right.priceWeightPercent &&
    NH_AUDIT_QUALITY_CRITERION_IDS.every(
      (criterionId) =>
        left.qualityCriterionWeights[criterionId] ===
        right.qualityCriterionWeights[criterionId],
    )
  );
}
