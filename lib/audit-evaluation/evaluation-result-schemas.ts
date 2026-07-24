import { z } from "zod";
import { isWonAmount } from "@/lib/audit-evaluation/money";
import {
  NORMALIZED_AUDIT_QUOTE_FIELDS,
  QUOTE_FIELD_SOURCES,
  type EvaluationScoreResult,
  type FeeAnalysisResult,
  type WonAmount,
} from "@/lib/audit-evaluation/types";

const resourceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const basisPointsSchema = z.number().int().min(0).max(10_000);
const wonAmountSchema = z.custom<WonAmount>(
  (value) => isWonAmount(value),
  "Invalid won amount.",
);
const rationalWonSchema = z
  .object({
    numeratorWon: wonAmountSchema,
    denominator: z.number().int().positive().safe(),
    roundedWon: wonAmountSchema,
    roundingMode: z.enum(["DOWN", "HALF_UP", "UP"]),
  })
  .strict();

const criterionScoreSchema = z
  .object({
    criterionId: resourceIdSchema,
    rawScoreBasisPoints: basisPointsSchema,
    scoreBasisPoints: basisPointsSchema,
    maximumBasisPoints: basisPointsSchema,
    passed: z.boolean().nullable(),
    appliedThresholds: z
      .array(
        z
          .object({
            ruleType: z.enum([
              "threshold",
              "boolean",
              "checklist",
              "range",
              "informational-only",
            ]),
            ruleId: resourceIdSchema,
            field: z.enum(NORMALIZED_AUDIT_QUOTE_FIELDS),
            normalizedInput: z.string().max(8_000).nullable(),
            expression: z.string().trim().min(1).max(2_000),
          })
          .strict(),
      )
      .max(100),
    evidence: z
      .array(
        z
          .object({
            field: z.enum(NORMALIZED_AUDIT_QUOTE_FIELDS),
            evidenceIndexes: z.array(z.number().int().nonnegative()).max(100),
            sources: z.array(z.enum(QUOTE_FIELD_SOURCES)).max(20),
            confidenceBasisPoints: basisPointsSchema.nullable(),
          })
          .strict(),
      )
      .max(100),
    missingFields: z.array(z.enum(NORMALIZED_AUDIT_QUOTE_FIELDS)).max(100),
    dataConfidenceBasisPoints: basisPointsSchema.nullable(),
    reasons: z.array(z.string().trim().min(1).max(500)).max(500),
  })
  .strict();

export const evaluationScoreResultSchema: z.ZodType<EvaluationScoreResult> = z
  .object({
    engineVersion: resourceIdSchema,
    maximumScoreBasisPoints: z.literal(10_000),
    rankingPolicy: z.literal("COMPETITION_EQUAL_SCORES_SHARE_RANK"),
    quotes: z
      .array(
        z
          .object({
            quoteId: resourceIdSchema,
            totalScoreBasisPoints: basisPointsSchema,
            criteria: z.array(criterionScoreSchema).max(100),
            rank: z.number().int().positive(),
            tiedWithQuoteIds: z.array(resourceIdSchema).max(100),
            missingInformation: z
              .array(z.enum(NORMALIZED_AUDIT_QUOTE_FIELDS))
              .max(100),
            strengths: z.array(resourceIdSchema).max(100),
            reviewItems: z.array(z.string().trim().min(1).max(500)).max(500),
            dataConfidenceBasisPoints: basisPointsSchema.nullable(),
          })
          .strict(),
      )
      .max(100),
    tieBreaksApplied: z.array(z.string().max(500)).max(100),
  })
  .strict();

const quoteFeeAnalysisSchema = z
  .object({
    quoteId: resourceIdSchema,
    status: z.enum(["ANALYZED", "ERROR"]),
    originalFeeWon: wonAmountSchema.nullable(),
    normalizedFeeWon: wonAmountSchema.nullable(),
    vatIncluded: z.boolean().nullable(),
    vatAdjustment: z.enum([
      "NONE",
      "NORMALIZED_TO_INCLUDED",
      "NORMALIZED_TO_EXCLUDED",
      "ASSUMED_INCLUDED",
      "ASSUMED_EXCLUDED",
    ]),
    deviationFromMedianBasisPoints: z
      .string()
      .regex(/^-?(?:0|[1-9][0-9]*)$/)
      .nullable(),
    totalPlannedHours: z.number().int().nonnegative().safe().nullable(),
    hourlyRate: rationalWonSchema.nullable(),
    partnerHours: z.number().int().nonnegative().safe().nullable(),
    partnerHoursRatioBasisPoints: basisPointsSchema.nullable(),
    totalFeePosition: z.number().int().positive().nullable(),
    flags: z.array(z.string().trim().min(1).max(200)).max(100),
  })
  .strict();

export const feeAnalysisResultSchema: z.ZodType<FeeAnalysisResult> = z
  .object({
    engineVersion: resourceIdSchema,
    currency: z.literal("KRW"),
    qualityScoreIncluded: z.literal(false),
    validQuoteCount: z.number().int().nonnegative().max(100),
    normalizedFeesByQuote: z.record(resourceIdSchema, wonAmountSchema),
    minimumWon: wonAmountSchema.nullable(),
    maximumWon: wonAmountSchema.nullable(),
    medianWon: wonAmountSchema.nullable(),
    median: rationalWonSchema.nullable(),
    medianInterpretation: z.enum([
      "NO_VALID_QUOTES",
      "SINGLE_QUOTE",
      "TWO_QUOTE_MIDPOINT",
      "ODD_SET_MIDDLE",
      "EVEN_SET_MIDPOINT",
    ]),
    average: rationalWonSchema.nullable(),
    comparisonBenchmark: z
      .object({
        method: z.enum(["LOWEST", "MEDIAN", "AVERAGE_RATIONAL"]),
        won: wonAmountSchema.nullable(),
      })
      .strict(),
    quotes: z.array(quoteFeeAnalysisSchema).max(100),
    comparisonWarnings: z
      .array(z.string().trim().min(1).max(500))
      .max(100),
  })
  .strict();
