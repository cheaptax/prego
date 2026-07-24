import { z } from "zod";
import { isWonAmount } from "@/lib/audit-evaluation/money";
import {
  EVALUATION_CONFIG_STATUSES,
  NORMALIZED_AUDIT_QUOTE_FIELDS,
  type EvaluationConfig,
  type EvaluationCriterion,
  type RuleComparableValue,
} from "@/lib/audit-evaluation/types";

const SAFE_ID = /^[a-z][a-zA-Z0-9._-]{0,79}$/;
const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const DANGEROUS_TEXT =
  /<\s*\/?\s*(script|style|iframe|object|embed)\b|on[a-z]+\s*=|javascript\s*:/i;

const stableIdSchema = z.string().regex(SAFE_ID);
const safeTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .refine((value) => !DANGEROUS_TEXT.test(value), {
    message: "Executable markup is not allowed.",
  });
const instantSchema = z.string().datetime({ offset: true });
const basisPointsSchema = z.number().int().min(0).max(10_000);
const normalizedFieldSchema = z.enum(NORMALIZED_AUDIT_QUOTE_FIELDS);

const ruleComparableValueSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("INTEGER"),
      value: z.number().int().safe(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("DECIMAL_STRING"),
      value: z.string().refine(isWonAmount, "Invalid decimal string."),
    })
    .strict(),
  z
    .object({
      kind: z.literal("BOOLEAN"),
      value: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("TEXT"),
      value: safeTextSchema.max(500),
    })
    .strict(),
]);

const thresholdRuleSchema = z
  .object({
    type: z.literal("threshold"),
    field: normalizedFieldSchema,
    operator: z.enum(["GT", "GTE", "LT", "LTE", "EQ"]),
    threshold: ruleComparableValueSchema,
  })
  .strict();

const booleanRuleSchema = z
  .object({
    type: z.literal("boolean"),
    field: normalizedFieldSchema,
    expected: z.boolean(),
  })
  .strict();

const checklistItemConditionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("FIELD_PRESENT"),
      field: normalizedFieldSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("BOOLEAN_EQUALS"),
      field: normalizedFieldSchema,
      expected: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("MINIMUM_INTEGER"),
      field: normalizedFieldSchema,
      minimum: z.number().int().nonnegative().safe(),
    })
    .strict(),
  z
    .object({
      type: z.literal("PROPOSAL_ITEM_PRESENT"),
      itemId: stableIdSchema,
    })
    .strict(),
]);

const checklistRuleSchema = z
  .object({
    type: z.literal("checklist"),
    field: normalizedFieldSchema,
    items: z
      .array(
        z
          .object({
            id: stableIdSchema,
            label: safeTextSchema.max(200),
            required: z.boolean(),
            scoreBasisPoints: basisPointsSchema,
            condition: checklistItemConditionSchema.optional(),
          })
          .strict(),
      )
      .min(0)
      .max(100),
  })
  .strict()
  .superRefine((rule, context) => {
    requireUniqueIds(rule.items, context, ["items"]);
    const total = rule.items.reduce(
      (sum, item) => sum + item.scoreBasisPoints,
      0,
    );
    if (total > 10_000) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Checklist scores cannot exceed 10000 basis points.",
      });
    }
  });

const rangeRuleSchema = z
  .object({
    type: z.literal("range"),
    field: normalizedFieldSchema,
    bands: z
      .array(
        z
          .object({
            id: stableIdSchema,
            minimumInclusive: ruleComparableValueSchema.nullable(),
            maximumExclusive: ruleComparableValueSchema.nullable(),
            scoreBasisPoints: basisPointsSchema,
          })
          .strict()
          .refine(
            (band) =>
              band.minimumInclusive !== null ||
              band.maximumExclusive !== null,
            "A range must define at least one boundary.",
          ),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((rule, context) => {
    requireUniqueIds(rule.bands, context, ["bands"]);
    validateRangeBands(rule.bands, context, false, ["bands"]);
  });

const informationalOnlyRuleSchema = z
  .object({
    type: z.literal("informational-only"),
    field: normalizedFieldSchema,
  })
  .strict();

const evaluationLeafRuleSchema = z.discriminatedUnion("type", [
  thresholdRuleSchema,
  booleanRuleSchema,
  checklistRuleSchema,
  rangeRuleSchema,
  informationalOnlyRuleSchema,
]);

const weightedSubcriteriaRuleSchema = z
  .object({
    type: z.literal("weighted-subcriteria"),
    subcriteria: z
      .array(
        z
          .object({
            id: stableIdSchema,
            name: safeTextSchema.max(200),
            relativeWeightBasisPoints: basisPointsSchema,
            rule: evaluationLeafRuleSchema,
          })
          .strict(),
      )
      .min(2)
      .max(50),
  })
  .strict()
  .superRefine((rule, context) => {
    requireUniqueIds(rule.subcriteria, context, ["subcriteria"]);
    const total = rule.subcriteria.reduce(
      (sum, item) => sum + item.relativeWeightBasisPoints,
      0,
    );
    if (total !== 10_000) {
      context.addIssue({
        code: "custom",
        path: ["subcriteria"],
        message: "Weighted subcriteria must total 10000 basis points.",
      });
    }
  });

export const evaluationCriterionSchema = z
  .object({
    id: stableIdSchema,
    name: safeTextSchema.max(200),
    description: safeTextSchema,
    weightBasisPoints: basisPointsSchema,
    required: z.boolean(),
    rule: z.union([
      evaluationLeafRuleSchema,
      weightedSubcriteriaRuleSchema,
    ]),
  })
  .strict()
  .superRefine((criterion, context) => {
    const informational = criterion.rule.type === "informational-only";
    if (informational && criterion.weightBasisPoints !== 0) {
      context.addIssue({
        code: "custom",
        path: ["weightBasisPoints"],
        message: "Informational criteria must have zero weight.",
      });
    }
    if (!informational && criterion.weightBasisPoints === 0) {
      context.addIssue({
        code: "custom",
        path: ["weightBasisPoints"],
        message: "Scored criteria must have positive weight.",
      });
    }
    if (
      !informational &&
      scoredRuleFields(criterion.rule).some(
        (field) => field === "auditFee" || field === "vatIncluded",
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["rule"],
        message: "Quality criteria cannot score audit fees or VAT treatment.",
      });
    }
  });

export const feeAnalysisPolicySchema = z
  .object({
    currency: z.literal("KRW"),
    vatHandling: z.enum([
      "PRESERVE_AS_SUBMITTED",
      "NORMALIZE_TO_VAT_INCLUDED",
      "NORMALIZE_TO_VAT_EXCLUDED",
    ]),
    comparisonMethod: z.enum(["LOWEST", "MEDIAN", "AVERAGE_RATIONAL"]),
    missingVatPolicy: z.enum([
      "NEEDS_REVIEW",
      "ASSUME_INCLUDED",
      "ASSUME_EXCLUDED",
    ]),
    roundingMode: z.enum(["DOWN", "HALF_UP", "UP"]),
    twoQuoteMedianPolicy: z.literal("MIDPOINT").optional(),
    realisticFeeRange: z
      .object({
        minimumWon: z.string().refine(isWonAmount, "Invalid minimum fee."),
        maximumWon: z.string().refine(isWonAmount, "Invalid maximum fee."),
      })
      .strict()
      .refine(
        ({ minimumWon, maximumWon }) =>
          BigInt(minimumWon) > 0n &&
          BigInt(minimumWon) <= BigInt(maximumWon),
        "Realistic fee range must be positive and ordered.",
      )
      .optional(),
    outlierPolicy: z
      .object({
        minimumQuoteCount: z.number().int().min(3).max(100),
        lowDeviationBasisPoints: z.number().int().positive().max(1_000_000),
        highDeviationBasisPoints: z.number().int().positive().max(1_000_000),
      })
      .strict()
      .optional(),
  })
  .strict();

const reportSectionSchema = z
  .object({
    id: stableIdSchema,
    name: safeTextSchema.max(200),
    order: z.number().int().min(0).max(1_000),
    enabled: z.boolean(),
    type: z.enum([
      "COVER",
      "PURPOSE_SCOPE",
      "EXECUTIVE_SUMMARY",
      "SUMMARY",
      "SCORE_BREAKDOWN",
      "FEE_ANALYSIS",
      "QUOTE_COMPARISON",
      "CAPABILITY_ANALYSIS",
      "FIRM_REVIEW",
      "OVERALL_OPINION",
      "APPENDIX",
      "RISKS",
      "EVIDENCE",
      "DISCLAIMER",
    ]),
  })
  .strict();

const reportPhraseSchema = z
  .object({
    id: stableIdSchema,
    label: safeTextSchema.max(200),
    text: safeTextSchema.max(8_000),
  })
  .strict();

const retentionPolicySchema = z
  .object({
    sourceDocumentDays: z.number().int().positive().max(36_500),
    normalizedDataDays: z.number().int().positive().max(36_500),
    reportDays: z.number().int().positive().max(36_500),
    expiredAccessTokenDays: z.number().int().min(1).max(3_650).optional(),
    auditLogDays: z.number().int().min(365).max(36_500).optional(),
    deleteAfterExpiry: z.boolean(),
  })
  .strict();

const customerAccessPolicySchema = z
  .object({
    magicLinkLifetimeMinutes: z.number().int().positive().max(10_080),
    sessionLifetimeMinutes: z.number().int().positive().max(43_200),
    caseLifetimeDays: z.number().int().positive().max(3_650),
    allowUploadWhenNoRegisteredQuotes: z.boolean(),
  })
  .strict();

const quoteExtractionPolicySchema = z
  .object({
    deterministicParserEnabled: z.boolean(),
    ocrEnabled: z.boolean(),
    aiExtractionEnabled: z.boolean(),
    aiPromptVersion: stableIdSchema,
  })
  .strict();

const customerCorrectionPolicySchema = z
  .object({
    coreFieldChangesRequireAdminReview: z.boolean(),
  })
  .strict();

const reportRenderingPolicySchema = z
  .object({
    watermarkEnabled: z.boolean(),
    watermarkText: safeTextSchema.max(100),
    downloadUrlLifetimeSeconds: z.number().int().min(30).max(300),
    reportTitle: safeTextSchema.min(1).max(120).optional(),
    centerContact: safeTextSchema.max(500).optional(),
    logoAssetId: stableIdSchema.nullable().optional(),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    fileNameRule: z
      .enum(["FISCAL_YEAR_VERSION", "CASE_VERSION"])
      .optional(),
    customerDownloadDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();

export const evaluationConfigSchema: z.ZodType<EvaluationConfig> = z
  .object({
    id: stableIdSchema,
    name: safeTextSchema.max(200),
    version: z.number().int().positive(),
    status: z.enum(EVALUATION_CONFIG_STATUSES),
    effectiveFrom: instantSchema.nullable(),
    effectiveTo: instantSchema.nullable(),
    minimumQuoteCount: z.number().int().positive().max(100),
    maximumQuoteCount: z.number().int().positive().max(100),
    uploadLimit: z.number().int().positive().max(500),
    permittedMimeTypes: z
      .array(z.string().regex(MIME_TYPE))
      .min(1)
      .max(20),
    maximumFileSize: z.number().int().positive().safe(),
    criteria: z.array(evaluationCriterionSchema).min(1).max(100),
    feeAnalysisPolicy: feeAnalysisPolicySchema,
    requiredFields: z.array(normalizedFieldSchema).min(1),
    reportSections: z.array(reportSectionSchema).min(1).max(50),
    reportPhrases: z.array(reportPhraseSchema).max(200),
    retentionPolicy: retentionPolicySchema,
    customerAccessPolicy: customerAccessPolicySchema,
    quoteExtractionPolicy: quoteExtractionPolicySchema.optional(),
    customerCorrectionPolicy: customerCorrectionPolicySchema.optional(),
    reportRenderingPolicy: reportRenderingPolicySchema.optional(),
    createdBy: z.string().trim().min(1).max(128),
    createdAt: instantSchema,
    draftRevision: z.number().int().positive().optional(),
    updatedBy: z.string().trim().min(1).max(128).optional(),
    updatedAt: instantSchema.optional(),
    publishedBy: z.string().trim().min(1).max(128).nullable(),
    publishedAt: instantSchema.nullable(),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.minimumQuoteCount > config.maximumQuoteCount) {
      context.addIssue({
        code: "custom",
        path: ["maximumQuoteCount"],
        message: "Maximum quote count must be at least the minimum.",
      });
    }
    if (config.uploadLimit < config.maximumQuoteCount) {
      context.addIssue({
        code: "custom",
        path: ["uploadLimit"],
        message: "Upload limit must cover the maximum quote count.",
      });
    }
    if (
      config.effectiveFrom &&
      config.effectiveTo &&
      Date.parse(config.effectiveFrom) >= Date.parse(config.effectiveTo)
    ) {
      context.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "Effective end must be after the start.",
      });
    }
    if (
      config.status === "PUBLISHED" &&
      (!config.publishedBy || !config.publishedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["publishedAt"],
        message: "Published configuration requires publisher metadata.",
      });
    }
    requireUniqueIds(config.criteria, context, ["criteria"]);
    if (config.status === "PUBLISHED") {
      config.criteria.forEach((criterion, index) => {
        validatePublishedCriterion(
          criterion,
          context,
          ["criteria", index, "rule"],
        );
      });
    }
    requireUniqueStrings(
      config.permittedMimeTypes,
      context,
      ["permittedMimeTypes"],
    );
    requireUniqueStrings(config.requiredFields, context, ["requiredFields"]);
    requireUniqueIds(config.reportSections, context, ["reportSections"]);
    requireUniqueNumbers(
      config.reportSections.map(({ order }) => order),
      context,
      ["reportSections"],
    );
    requireUniqueIds(config.reportPhrases, context, ["reportPhrases"]);

    const totalWeight = config.criteria.reduce(
      (sum, criterion) => sum + criterion.weightBasisPoints,
      0,
    );
    if (totalWeight !== 10_000) {
      context.addIssue({
        code: "custom",
        path: ["criteria"],
        message: "Scored criterion weights must total 10000 basis points.",
      });
    }
  });

function requireUniqueIds(
  values: readonly { id: string }[],
  context: z.RefinementCtx,
  path: PropertyKey[],
) {
  requireUniqueStrings(
    values.map(({ id }) => id),
    context,
    path,
  );
}

function requireUniqueStrings(
  values: readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[],
) {
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: "custom",
      path,
      message: "Values must be unique.",
    });
  }
}

function requireUniqueNumbers(
  values: readonly number[],
  context: z.RefinementCtx,
  path: PropertyKey[],
) {
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: "custom",
      path,
      message: "Values must be unique.",
    });
  }
}

function scoredRuleFields(
  rule: EvaluationCriterion["rule"],
): NormalizedAuditQuoteField[] {
  if (rule.type === "weighted-subcriteria") {
    return rule.subcriteria.flatMap(({ rule: child }) =>
      scoredRuleFields(child)
    );
  }
  if (rule.type !== "checklist") return [rule.field];
  return [
    rule.field,
    ...rule.items.flatMap(({ condition }) => {
      if (
        condition?.type === "FIELD_PRESENT" ||
        condition?.type === "BOOLEAN_EQUALS" ||
        condition?.type === "MINIMUM_INTEGER"
      ) {
        return [condition.field];
      }
      return [];
    }),
  ];
}

type NormalizedAuditQuoteField =
  (typeof NORMALIZED_AUDIT_QUOTE_FIELDS)[number];

type RangeBandLike = {
  id: string;
  minimumInclusive: RuleComparableValue | null;
  maximumExclusive: RuleComparableValue | null;
};

function validatePublishedCriterion(
  criterion: EvaluationCriterion,
  context: z.RefinementCtx,
  path: PropertyKey[],
) {
  const rules = criterion.rule.type === "weighted-subcriteria"
    ? criterion.rule.subcriteria.map(({ rule }) => rule)
    : [criterion.rule];
  rules.forEach((rule, index) => {
    const rulePath = criterion.rule.type === "weighted-subcriteria"
      ? [...path, "subcriteria", index, "rule"]
      : path;
    if (rule.type === "checklist") {
      const total = rule.items.reduce(
        (sum, item) => sum + item.scoreBasisPoints,
        0,
      );
      if (rule.items.length === 0 || total !== 10_000) {
        context.addIssue({
          code: "custom",
          path: [...rulePath, "items"],
          message:
            "Published checklist criteria require configured items totaling 10000 basis points.",
        });
      }
      rule.items.forEach((item, itemIndex) => {
        if (!item.condition && rule.field !== "requiredProposalItems") {
          context.addIssue({
            code: "custom",
            path: [...rulePath, "items", itemIndex, "condition"],
            message:
              "Published checklist items require a deterministic condition.",
          });
        }
      });
    }
    if (rule.type === "range") {
      validateRangeBands(
        rule.bands,
        context,
        true,
        [...rulePath, "bands"],
      );
    }
  });
}

function validateRangeBands(
  bands: readonly RangeBandLike[],
  context: z.RefinementCtx,
  requireCompleteCoverage: boolean,
  path: PropertyKey[],
) {
  const kinds = new Set(
    bands.flatMap(({ minimumInclusive, maximumExclusive }) => [
      ...(minimumInclusive ? [minimumInclusive.kind] : []),
      ...(maximumExclusive ? [maximumExclusive.kind] : []),
    ]),
  );
  if (kinds.size > 1) {
    context.addIssue({
      code: "custom",
      path,
      message: "Range boundaries must use one comparable value kind.",
    });
    return;
  }
  for (const [index, band] of bands.entries()) {
    if (
      band.minimumInclusive &&
      band.maximumExclusive &&
      compareRuleValues(
        band.minimumInclusive,
        band.maximumExclusive,
      ) >= 0
    ) {
      context.addIssue({
        code: "custom",
        path: [...path, index],
        message: "Range minimum must be lower than its maximum.",
      });
    }
  }
  const ordered = [...bands].sort((left, right) => {
    if (!left.minimumInclusive) return -1;
    if (!right.minimumInclusive) return 1;
    return compareRuleValues(left.minimumInclusive, right.minimumInclusive);
  });
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (
      previous.maximumExclusive === null ||
      current.minimumInclusive === null ||
      compareRuleValues(
        previous.maximumExclusive,
        current.minimumInclusive,
      ) > 0
    ) {
      context.addIssue({
        code: "custom",
        path,
        message: "Range bands cannot overlap.",
      });
      return;
    }
    if (
      requireCompleteCoverage &&
      compareRuleValues(
        previous.maximumExclusive,
        current.minimumInclusive,
      ) !== 0
    ) {
      context.addIssue({
        code: "custom",
        path,
        message: "Published range bands cannot contain gaps.",
      });
      return;
    }
  }
  if (
    requireCompleteCoverage &&
    (
      ordered[0]?.minimumInclusive !== null ||
      ordered.at(-1)?.maximumExclusive !== null
    )
  ) {
    context.addIssue({
      code: "custom",
      path,
      message: "Published range bands must cover all boundary values.",
    });
  }
}

function compareRuleValues(
  left: RuleComparableValue,
  right: RuleComparableValue,
) {
  if (left.kind !== right.kind) return 0;
  if (left.kind === "INTEGER" && right.kind === "INTEGER") {
    return left.value === right.value ? 0 : left.value < right.value ? -1 : 1;
  }
  if (left.kind === "DECIMAL_STRING" && right.kind === "DECIMAL_STRING") {
    const leftValue = BigInt(left.value);
    const rightValue = BigInt(right.value);
    return leftValue === rightValue ? 0 : leftValue < rightValue ? -1 : 1;
  }
  if (left.kind === "BOOLEAN" && right.kind === "BOOLEAN") {
    return left.value === right.value ? 0 : left.value ? 1 : -1;
  }
  if (left.kind === "TEXT" && right.kind === "TEXT") {
    return left.value === right.value ? 0 : left.value < right.value ? -1 : 1;
  }
  return 0;
}
