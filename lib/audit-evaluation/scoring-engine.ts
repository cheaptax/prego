import { evaluationScoreResultSchema } from "@/lib/audit-evaluation/evaluation-result-schemas";
import { normalizedAuditQuoteSchema } from "@/lib/audit-evaluation/quote-extraction-schemas";
import { evaluationConfigSchema } from "@/lib/audit-evaluation/schemas";
import {
  NORMALIZED_AUDIT_QUOTE_FIELDS,
  type ChecklistItemCondition,
  type ChecklistRule,
  type CriterionScoreResult,
  type EvaluationConfig,
  type EvaluationCriterion,
  type EvaluationLeafRule,
  type EvaluationScoreResult,
  type NormalizedAuditQuote,
  type NormalizedAuditQuoteField,
  type QuoteScoreResult,
  type QuoteDataSnapshot,
  type RuleComparableValue,
} from "@/lib/audit-evaluation/types";

export const QUALITY_SCORING_ENGINE_VERSION = "quality-scoring-engine-v1";

const BASIS_POINTS = 10_000n;
const LOW_CONFIDENCE_BASIS_POINTS = 7_000;
const FORBIDDEN_QUALITY_FIELDS = new Set<NormalizedAuditQuoteField>([
  "auditFee",
  "vatIncluded",
]);
const RESULT_RESOURCE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

type AppliedThreshold =
  CriterionScoreResult["appliedThresholds"][number];

type LeafScore = {
  rawScoreBasisPoints: number;
  passed: boolean | null;
  appliedThresholds: AppliedThreshold[];
  fields: NormalizedAuditQuoteField[];
  missingFields: NormalizedAuditQuoteField[];
  reasons: string[];
};

type ComparableResult =
  | { status: "VALUE"; value: RuleComparableValue }
  | { status: "MISSING" }
  | { status: "UNSUPPORTED" };

export class QualityScoringError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "QualityScoringError";
    this.code = code;
  }
}

export function runDeterministicQualityScoring(
  config: unknown,
  quotes: readonly (NormalizedAuditQuote | QuoteDataSnapshot)[],
): EvaluationScoreResult {
  const parsedConfig = parseEvaluationConfig(config);
  if (parsedConfig.status !== "PUBLISHED") {
    throw new QualityScoringError("evaluation_config_not_published");
  }
  assertNoForbiddenQualityFields(parsedConfig);

  const parsedQuotes = parseQuotes(quotes);
  const scoredQuotes = parsedQuotes.map((quote) =>
    scoreQuote(parsedConfig, quote)
  );
  applyCompetitionRanks(scoredQuotes);

  const result: EvaluationScoreResult = {
    engineVersion: QUALITY_SCORING_ENGINE_VERSION,
    maximumScoreBasisPoints: 10_000,
    rankingPolicy: "COMPETITION_EQUAL_SCORES_SHARE_RANK",
    quotes: scoredQuotes.sort((left, right) =>
      compareText(left.quoteId, right.quoteId)
    ),
    tieBreaksApplied: [],
  };

  try {
    return evaluationScoreResultSchema.parse(result);
  } catch {
    throw new QualityScoringError("invalid_evaluation_score_result");
  }
}

function parseEvaluationConfig(config: unknown): EvaluationConfig {
  try {
    return evaluationConfigSchema.parse(config);
  } catch {
    throw new QualityScoringError("invalid_evaluation_config");
  }
}

function parseQuotes(
  quotes: readonly (NormalizedAuditQuote | QuoteDataSnapshot)[],
): NormalizedAuditQuote[] {
  if (!Array.isArray(quotes) || quotes.length > 100) {
    throw new QualityScoringError("invalid_normalized_audit_quotes");
  }

  const parsed = quotes.map((quote) => {
    try {
      return normalizedAuditQuoteSchema.parse(quote);
    } catch {
      throw new QualityScoringError("invalid_normalized_audit_quote");
    }
  });
  const quoteIds = new Set<string>();
  for (const quote of parsed) {
    if (!RESULT_RESOURCE_ID.test(quote.quoteId)) {
      throw new QualityScoringError("invalid_quote_id");
    }
    if (quoteIds.has(quote.quoteId)) {
      throw new QualityScoringError("duplicate_quote_id");
    }
    quoteIds.add(quote.quoteId);
  }
  return parsed.sort((left, right) =>
    compareText(left.quoteId, right.quoteId)
  );
}

function assertNoForbiddenQualityFields(config: EvaluationConfig): void {
  for (const criterion of config.criteria) {
    const rules = criterion.rule.type === "weighted-subcriteria"
      ? criterion.rule.subcriteria.map((subcriterion) => subcriterion.rule)
      : [criterion.rule];
    for (const rule of rules) {
      for (const field of fieldsUsedByRule(rule)) {
        if (FORBIDDEN_QUALITY_FIELDS.has(field)) {
          throw new QualityScoringError("forbidden_quality_field");
        }
      }
    }
  }
}

function scoreQuote(
  config: EvaluationConfig,
  quote: NormalizedAuditQuote,
): QuoteScoreResult {
  const criteria = config.criteria.map((criterion) =>
    scoreCriterion(criterion, quote)
  );
  const missingInformation = sortFields(
    criteria.flatMap((criterion) => criterion.missingFields),
  );
  const strengths = criteria
    .filter((criterion) => criterion.rawScoreBasisPoints >= 8_000)
    .map((criterion) => criterion.criterionId);
  const evidenceByField = new Map<
    NormalizedAuditQuoteField,
    number | null
  >();
  for (const criterion of criteria) {
    for (const evidence of criterion.evidence) {
      if (!evidenceByField.has(evidence.field)) {
        evidenceByField.set(
          evidence.field,
          evidence.confidenceBasisPoints,
        );
      }
    }
  }

  const reviewItems: string[] = [];
  for (const field of missingInformation) {
    reviewItems.push(`missing_field:${field}`);
  }
  for (const warning of [...quote.warnings].sort((left, right) => {
    const leftKey = `${left.code}:${left.field ?? "quote"}`;
    const rightKey = `${right.code}:${right.field ?? "quote"}`;
    return compareText(leftKey, rightKey);
  })) {
    reviewItems.push(
      `quote_warning:${warning.code}:${warning.field ?? "quote"}`,
    );
  }
  for (const field of sortFields([...evidenceByField.keys()])) {
    const confidence = evidenceByField.get(field);
    if (
      confidence !== undefined &&
      confidence !== null &&
      confidence < LOW_CONFIDENCE_BASIS_POINTS
    ) {
      reviewItems.push(`low_confidence:${field}`);
    }
  }
  for (const criterion of criteria) {
    for (const reason of criterion.reasons) {
      if (isReviewReason(reason)) reviewItems.push(reason);
    }
  }

  return {
    quoteId: quote.quoteId,
    totalScoreBasisPoints: criteria.reduce(
      (total, criterion) => total + criterion.scoreBasisPoints,
      0,
    ),
    criteria,
    rank: 1,
    tiedWithQuoteIds: [],
    missingInformation,
    strengths,
    reviewItems: uniqueStrings(reviewItems).slice(0, 500),
    dataConfidenceBasisPoints: averageBasisPoints(
      [...evidenceByField.values()].filter(
        (value): value is number => value !== null,
      ),
    ),
  };
}

function scoreCriterion(
  criterion: EvaluationCriterion,
  quote: NormalizedAuditQuote,
): CriterionScoreResult {
  let leafScore: LeafScore;
  if (criterion.rule.type === "weighted-subcriteria") {
    const children = criterion.rule.subcriteria.map((subcriterion) => ({
      relativeWeightBasisPoints: subcriterion.relativeWeightBasisPoints,
      score: scoreLeafRule(subcriterion.rule, subcriterion.id, quote),
    }));
    const rawScoreBasisPoints = children.reduce(
      (total, child) =>
        total +
        multiplyBasisPoints(
          child.score.rawScoreBasisPoints,
          child.relativeWeightBasisPoints,
        ),
      0,
    );
    const childPasses = children
      .map((child) => child.score.passed)
      .filter((passed): passed is boolean => passed !== null);
    leafScore = {
      rawScoreBasisPoints,
      passed: childPasses.length === 0
        ? null
        : childPasses.every(Boolean),
      appliedThresholds: children.flatMap(
        (child) => child.score.appliedThresholds,
      ),
      fields: children.flatMap((child) => child.score.fields),
      missingFields: children.flatMap(
        (child) => child.score.missingFields,
      ),
      reasons: children.flatMap((child) => child.score.reasons),
    };
  } else {
    leafScore = scoreLeafRule(criterion.rule, criterion.id, quote);
  }

  const fields = sortFields(leafScore.fields);
  const evidence = fields.map((field) => evidenceForField(quote, field));
  return {
    criterionId: criterion.id,
    rawScoreBasisPoints: leafScore.rawScoreBasisPoints,
    scoreBasisPoints: multiplyBasisPoints(
      leafScore.rawScoreBasisPoints,
      criterion.weightBasisPoints,
    ),
    maximumBasisPoints: criterion.weightBasisPoints,
    passed: leafScore.passed,
    appliedThresholds: leafScore.appliedThresholds.slice(0, 100),
    evidence,
    missingFields: sortFields(leafScore.missingFields),
    dataConfidenceBasisPoints: averageBasisPoints(
      evidence
        .map((item) => item.confidenceBasisPoints)
        .filter((value): value is number => value !== null),
    ),
    reasons: uniqueStrings(leafScore.reasons).slice(0, 500),
  };
}

function scoreLeafRule(
  rule: EvaluationLeafRule,
  ruleId: string,
  quote: NormalizedAuditQuote,
): LeafScore {
  switch (rule.type) {
    case "threshold":
      return scoreThreshold(rule, ruleId, quote);
    case "boolean":
      return scoreBoolean(rule, ruleId, quote);
    case "range":
      return scoreRange(rule, ruleId, quote);
    case "checklist":
      return scoreChecklist(rule, ruleId, quote);
    case "informational-only":
      return scoreInformational(rule, ruleId, quote);
  }
}

function scoreThreshold(
  rule: Extract<EvaluationLeafRule, { type: "threshold" }>,
  ruleId: string,
  quote: NormalizedAuditQuote,
): LeafScore {
  const comparable = comparableFieldValue(quote, rule.field);
  const appliedThresholds: AppliedThreshold[] = [{
    ruleType: "threshold",
    ruleId,
    field: rule.field,
    normalizedInput: comparable.status === "VALUE"
      ? comparableValueText(comparable.value)
      : null,
    expression:
      `${rule.operator}:${rule.threshold.kind}:${comparableValueText(rule.threshold)}`,
  }];
  if (comparable.status === "MISSING") {
    return failedLeaf(
      [rule.field],
      [rule.field],
      appliedThresholds,
      `missing_field:${rule.field}`,
    );
  }
  if (
    comparable.status === "UNSUPPORTED" ||
    comparable.value.kind !== rule.threshold.kind
  ) {
    return failedLeaf(
      [rule.field],
      [],
      appliedThresholds,
      `comparison_kind_mismatch:${ruleId}`,
    );
  }

  const comparison = compareValues(comparable.value, rule.threshold);
  if (comparison === null) {
    return failedLeaf(
      [rule.field],
      [],
      appliedThresholds,
      `comparison_kind_mismatch:${ruleId}`,
    );
  }
  const passed = thresholdPassed(rule.operator, comparison);
  return {
    rawScoreBasisPoints: passed ? 10_000 : 0,
    passed,
    appliedThresholds,
    fields: [rule.field],
    missingFields: [],
    reasons: [`rule_${passed ? "passed" : "failed"}:${ruleId}`],
  };
}

function scoreBoolean(
  rule: Extract<EvaluationLeafRule, { type: "boolean" }>,
  ruleId: string,
  quote: NormalizedAuditQuote,
): LeafScore {
  const comparable = comparableFieldValue(quote, rule.field);
  const appliedThresholds: AppliedThreshold[] = [{
    ruleType: "boolean",
    ruleId,
    field: rule.field,
    normalizedInput: comparable.status === "VALUE"
      ? comparableValueText(comparable.value)
      : null,
    expression: `BOOLEAN_EQUALS:${String(rule.expected)}`,
  }];
  if (comparable.status === "MISSING") {
    return failedLeaf(
      [rule.field],
      [rule.field],
      appliedThresholds,
      `missing_field:${rule.field}`,
    );
  }
  if (
    comparable.status === "UNSUPPORTED" ||
    comparable.value.kind !== "BOOLEAN"
  ) {
    return failedLeaf(
      [rule.field],
      [],
      appliedThresholds,
      `comparison_kind_mismatch:${ruleId}`,
    );
  }
  const passed = comparable.value.value === rule.expected;
  return {
    rawScoreBasisPoints: passed ? 10_000 : 0,
    passed,
    appliedThresholds,
    fields: [rule.field],
    missingFields: [],
    reasons: [`rule_${passed ? "passed" : "failed"}:${ruleId}`],
  };
}

function scoreRange(
  rule: Extract<EvaluationLeafRule, { type: "range" }>,
  ruleId: string,
  quote: NormalizedAuditQuote,
): LeafScore {
  const comparable = comparableFieldValue(quote, rule.field);
  if (comparable.status === "MISSING") {
    return failedLeaf(
      [rule.field],
      [rule.field],
      [],
      `missing_field:${rule.field}`,
    );
  }
  const boundary = rule.bands
    .flatMap((band) => [
      ...(band.minimumInclusive ? [band.minimumInclusive] : []),
      ...(band.maximumExclusive ? [band.maximumExclusive] : []),
    ])
    .at(0);
  if (!boundary) {
    return failedLeaf(
      [rule.field],
      [],
      [],
      `range_boundary_missing:${ruleId}`,
    );
  }
  if (
    comparable.status === "UNSUPPORTED" ||
    comparable.value.kind !== boundary.kind
  ) {
    return failedLeaf(
      [rule.field],
      [],
      [],
      `comparison_kind_mismatch:${ruleId}`,
    );
  }

  for (const band of rule.bands) {
    const minimumComparison = band.minimumInclusive
      ? compareValues(comparable.value, band.minimumInclusive)
      : 1;
    const maximumComparison = band.maximumExclusive
      ? compareValues(comparable.value, band.maximumExclusive)
      : -1;
    if (minimumComparison === null || maximumComparison === null) {
      return failedLeaf(
        [rule.field],
        [],
        [],
        `comparison_kind_mismatch:${ruleId}`,
      );
    }
    if (minimumComparison >= 0 && maximumComparison < 0) {
      const passed = band.scoreBasisPoints > 0;
      return {
        rawScoreBasisPoints: band.scoreBasisPoints,
        passed,
        appliedThresholds: [{
          ruleType: "range",
          ruleId: band.id,
          field: rule.field,
          normalizedInput: comparableValueText(comparable.value),
          expression: rangeExpression(band),
        }],
        fields: [rule.field],
        missingFields: [],
        reasons: [
          `range_band_applied:${band.id}`,
          `rule_${passed ? "passed" : "failed"}:${ruleId}`,
        ],
      };
    }
  }
  return failedLeaf(
    [rule.field],
    [],
    [],
    `range_band_not_found:${ruleId}`,
  );
}

function scoreChecklist(
  rule: ChecklistRule,
  ruleId: string,
  quote: NormalizedAuditQuote,
): LeafScore {
  let rawScoreBasisPoints = 0;
  let requiredItemsPassed = true;
  const appliedThresholds: AppliedThreshold[] = [];
  const fields = fieldsUsedByRule(rule);
  const missingFields: NormalizedAuditQuoteField[] = [];
  const reasons: string[] = [];

  for (const item of rule.items) {
    const result = evaluateChecklistCondition(
      rule,
      item.id,
      item.condition,
      quote,
    );
    appliedThresholds.push({
      ruleType: "checklist",
      ruleId: item.id,
      field: result.field,
      normalizedInput: result.normalizedInput,
      expression: result.expression,
    });
    if (result.satisfied) rawScoreBasisPoints += item.scoreBasisPoints;
    if (item.required && !result.satisfied) requiredItemsPassed = false;
    if (result.missing) missingFields.push(result.field);
    if (result.reviewReason) reasons.push(result.reviewReason);
    reasons.push(
      `checklist_item_${result.satisfied ? "passed" : "failed"}:${item.id}`,
    );
  }
  reasons.push(
    `rule_${requiredItemsPassed ? "passed" : "failed"}:${ruleId}`,
  );
  return {
    rawScoreBasisPoints,
    passed: requiredItemsPassed,
    appliedThresholds,
    fields,
    missingFields,
    reasons,
  };
}

function evaluateChecklistCondition(
  rule: ChecklistRule,
  itemId: string,
  condition: ChecklistItemCondition | undefined,
  quote: NormalizedAuditQuote,
): {
  satisfied: boolean;
  field: NormalizedAuditQuoteField;
  normalizedInput: string | null;
  expression: string;
  missing: boolean;
  reviewReason: string | null;
} {
  if (!condition) {
    const proposal = quote.requiredProposalItems[itemId];
    return {
      satisfied: proposal?.present === true,
      field: "requiredProposalItems",
      normalizedInput: proposal ? String(proposal.present) : null,
      expression: `PROPOSAL_ITEM_PRESENT:${itemId}`,
      missing: proposal === undefined,
      reviewReason: proposal === undefined
        ? `missing_proposal_item:${itemId}`
        : null,
    };
  }
  if (condition.type === "PROPOSAL_ITEM_PRESENT") {
    const proposal = quote.requiredProposalItems[condition.itemId];
    return {
      satisfied: proposal?.present === true,
      field: "requiredProposalItems",
      normalizedInput: proposal ? String(proposal.present) : null,
      expression: `PROPOSAL_ITEM_PRESENT:${condition.itemId}`,
      missing: proposal === undefined,
      reviewReason: proposal === undefined
        ? `missing_proposal_item:${condition.itemId}`
        : null,
    };
  }
  if (condition.type === "FIELD_PRESENT") {
    const present = isFieldPresent(quote, condition.field);
    return {
      satisfied: present,
      field: condition.field,
      normalizedInput: normalizedFieldInput(quote, condition.field),
      expression: "FIELD_PRESENT",
      missing: !present,
      reviewReason: present ? null : `missing_field:${condition.field}`,
    };
  }

  const comparable = comparableFieldValue(quote, condition.field);
  if (condition.type === "BOOLEAN_EQUALS") {
    const supported =
      comparable.status === "VALUE" &&
      comparable.value.kind === "BOOLEAN";
    return {
      satisfied:
        supported && comparable.value.value === condition.expected,
      field: condition.field,
      normalizedInput: comparable.status === "VALUE"
        ? comparableValueText(comparable.value)
        : null,
      expression: `BOOLEAN_EQUALS:${String(condition.expected)}`,
      missing: comparable.status === "MISSING",
      reviewReason: checklistComparisonReviewReason(
        comparable,
        condition.field,
        itemId,
        "BOOLEAN",
      ),
    };
  }

  return {
    satisfied:
      comparable.status === "VALUE" &&
      comparable.value.kind === "INTEGER" &&
      comparable.value.value >= condition.minimum,
    field: condition.field,
    normalizedInput: comparable.status === "VALUE"
      ? comparableValueText(comparable.value)
      : null,
    expression: `MINIMUM_INTEGER:${String(condition.minimum)}`,
    missing: comparable.status === "MISSING",
    reviewReason: checklistComparisonReviewReason(
      comparable,
      condition.field,
      itemId,
      "INTEGER",
    ),
  };
}

function checklistComparisonReviewReason(
  comparable: ComparableResult,
  field: NormalizedAuditQuoteField,
  itemId: string,
  expectedKind: "BOOLEAN" | "INTEGER",
): string | null {
  if (comparable.status === "MISSING") return `missing_field:${field}`;
  if (
    comparable.status === "UNSUPPORTED" ||
    comparable.value.kind !== expectedKind
  ) {
    return `comparison_kind_mismatch:${itemId}`;
  }
  return null;
}

function scoreInformational(
  rule: Extract<EvaluationLeafRule, { type: "informational-only" }>,
  ruleId: string,
  quote: NormalizedAuditQuote,
): LeafScore {
  const present = isFieldPresent(quote, rule.field);
  return {
    rawScoreBasisPoints: 0,
    passed: null,
    appliedThresholds: [{
      ruleType: "informational-only",
      ruleId,
      field: rule.field,
      normalizedInput: normalizedFieldInput(quote, rule.field),
      expression: "INFORMATIONAL_ONLY",
    }],
    fields: [rule.field],
    missingFields: present ? [] : [rule.field],
    reasons: [
      present
        ? `informational_value_present:${ruleId}`
        : `missing_field:${rule.field}`,
    ],
  };
}

function failedLeaf(
  fields: NormalizedAuditQuoteField[],
  missingFields: NormalizedAuditQuoteField[],
  appliedThresholds: AppliedThreshold[],
  reason: string,
): LeafScore {
  return {
    rawScoreBasisPoints: 0,
    passed: false,
    appliedThresholds,
    fields,
    missingFields,
    reasons: [reason],
  };
}

function comparableFieldValue(
  quote: NormalizedAuditQuote,
  field: NormalizedAuditQuoteField,
): ComparableResult {
  if (quote.missingFields.includes(field)) return { status: "MISSING" };
  const value = quote[field];
  if (value === null || value === undefined || value === "") {
    return { status: "MISSING" };
  }
  if (typeof value === "number") {
    return {
      status: "VALUE",
      value: { kind: "INTEGER", value },
    };
  }
  if (typeof value === "boolean") {
    return {
      status: "VALUE",
      value: { kind: "BOOLEAN", value },
    };
  }
  if (typeof value === "string") {
    return {
      status: "VALUE",
      value: field === "accountingFirmRevenue" || field === "auditFee"
        ? { kind: "DECIMAL_STRING", value }
        : { kind: "TEXT", value },
    };
  }
  if (Array.isArray(value)) {
    return {
      status: "VALUE",
      value: { kind: "INTEGER", value: value.length },
    };
  }
  if (
    typeof value === "object" &&
    "hasExperience" in value &&
    typeof value.hasExperience === "boolean"
  ) {
    return {
      status: "VALUE",
      value: { kind: "BOOLEAN", value: value.hasExperience },
    };
  }
  return { status: "UNSUPPORTED" };
}

function isFieldPresent(
  quote: NormalizedAuditQuote,
  field: NormalizedAuditQuoteField,
): boolean {
  if (quote.missingFields.includes(field)) return false;
  const value = quote[field];
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (
    typeof value === "object" &&
    !("hasExperience" in value) &&
    !("name" in value)
  ) {
    return Object.keys(value).length > 0;
  }
  return true;
}

function normalizedFieldInput(
  quote: NormalizedAuditQuote,
  field: NormalizedAuditQuoteField,
): string | null {
  if (quote.missingFields.includes(field)) return null;
  const comparable = comparableFieldValue(quote, field);
  if (comparable.status === "VALUE") {
    return comparableValueText(comparable.value);
  }
  const value = quote[field];
  if (value === null || value === undefined) return null;
  return stableJson(value).slice(0, 8_000);
}

function compareValues(
  left: RuleComparableValue,
  right: RuleComparableValue,
): number | null {
  if (left.kind !== right.kind) return null;
  if (left.kind === "INTEGER" && right.kind === "INTEGER") {
    return comparePrimitives(left.value, right.value);
  }
  if (
    left.kind === "DECIMAL_STRING" &&
    right.kind === "DECIMAL_STRING"
  ) {
    return comparePrimitives(BigInt(left.value), BigInt(right.value));
  }
  if (left.kind === "BOOLEAN" && right.kind === "BOOLEAN") {
    return comparePrimitives(Number(left.value), Number(right.value));
  }
  if (left.kind === "TEXT" && right.kind === "TEXT") {
    return comparePrimitives(left.value, right.value);
  }
  return null;
}

function comparePrimitives<T extends bigint | number | string>(
  left: T,
  right: T,
): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function thresholdPassed(
  operator: Extract<EvaluationLeafRule, { type: "threshold" }>["operator"],
  comparison: number,
): boolean {
  switch (operator) {
    case "GT":
      return comparison > 0;
    case "GTE":
      return comparison >= 0;
    case "LT":
      return comparison < 0;
    case "LTE":
      return comparison <= 0;
    case "EQ":
      return comparison === 0;
  }
}

function comparableValueText(value: RuleComparableValue): string {
  return String(value.value);
}

function rangeExpression(
  band: Extract<EvaluationLeafRule, { type: "range" }>["bands"][number],
): string {
  const minimum = band.minimumInclusive
    ? `${band.minimumInclusive.kind}:${comparableValueText(band.minimumInclusive)}`
    : "-INF";
  const maximum = band.maximumExclusive
    ? `${band.maximumExclusive.kind}:${comparableValueText(band.maximumExclusive)}`
    : "+INF";
  return `[${minimum},${maximum})`;
}

function fieldsUsedByRule(
  rule: EvaluationLeafRule,
): NormalizedAuditQuoteField[] {
  if (rule.type !== "checklist") return [rule.field];
  const fields: NormalizedAuditQuoteField[] = [rule.field];
  for (const item of rule.items) {
    const condition = item.condition;
    if (
      condition?.type === "FIELD_PRESENT" ||
      condition?.type === "BOOLEAN_EQUALS" ||
      condition?.type === "MINIMUM_INTEGER"
    ) {
      fields.push(condition.field);
    } else if (condition?.type === "PROPOSAL_ITEM_PRESENT" || !condition) {
      fields.push("requiredProposalItems");
    }
  }
  return sortFields(fields);
}

function evidenceForField(
  quote: NormalizedAuditQuote,
  field: NormalizedAuditQuoteField,
): CriterionScoreResult["evidence"][number] {
  const evidence = quote.evidenceByField[field] ?? [];
  const fallbackConfidence = quote.confidenceByField[field];
  const fallbackSource = quote.source[field];
  return {
    field,
    evidenceIndexes: evidence.map((_, index) => index),
    sources: uniqueValues([
      ...evidence.map((item) => item.source),
      ...(fallbackSource ? [fallbackSource] : []),
    ]),
    confidenceBasisPoints: evidence.length > 0
      ? averageBasisPoints(
          evidence.map((item) => confidenceToBasisPoints(item.confidence)),
        )
      : fallbackConfidence === undefined
        ? null
        : confidenceToBasisPoints(fallbackConfidence),
  };
}

function confidenceToBasisPoints(confidence: number): number {
  const text = confidence.toString().toLowerCase();
  const match = text.match(
    /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/,
  );
  if (!match) {
    throw new QualityScoringError("invalid_evidence_confidence");
  }
  const fractionalDigits = match[2] ?? "";
  const exponent = Number(match[3] ?? "0");
  let numerator = BigInt(`${match[1]}${fractionalDigits}`);
  const scale = fractionalDigits.length - exponent;
  let denominator = 1n;
  if (scale >= 0) {
    denominator = 10n ** BigInt(scale);
  } else {
    numerator *= 10n ** BigInt(-scale);
  }
  const basisPoints = Number(
    divideHalfUp(numerator * 100n, denominator),
  );
  return Math.min(10_000, Math.max(0, basisPoints));
}

function multiplyBasisPoints(
  valueBasisPoints: number,
  weightBasisPoints: number,
): number {
  return Number(
    divideHalfUp(
      BigInt(valueBasisPoints) * BigInt(weightBasisPoints),
      BASIS_POINTS,
    ),
  );
}

function averageBasisPoints(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  return Number(divideHalfUp(total, BigInt(values.length)));
}

function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n || numerator < 0n) {
    throw new QualityScoringError("invalid_scoring_arithmetic");
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

function applyCompetitionRanks(quotes: QuoteScoreResult[]): void {
  const ranked = [...quotes].sort((left, right) => {
    const scoreOrder =
      right.totalScoreBasisPoints - left.totalScoreBasisPoints;
    return scoreOrder !== 0
      ? scoreOrder
      : compareText(left.quoteId, right.quoteId);
  });
  let previousScore: number | null = null;
  let previousRank = 0;
  ranked.forEach((quote, index) => {
    if (previousScore === null || quote.totalScoreBasisPoints !== previousScore) {
      previousRank = index + 1;
      previousScore = quote.totalScoreBasisPoints;
    }
    quote.rank = previousRank;
    quote.tiedWithQuoteIds = ranked
      .filter((candidate) =>
        candidate.quoteId !== quote.quoteId &&
        candidate.totalScoreBasisPoints === quote.totalScoreBasisPoints
      )
      .map((candidate) => candidate.quoteId)
      .sort(compareText);
  });
}

function isReviewReason(reason: string): boolean {
  return (
    reason.startsWith("comparison_kind_mismatch:") ||
    reason.startsWith("range_boundary_missing:") ||
    reason.startsWith("range_band_not_found:") ||
    reason.startsWith("missing_proposal_item:")
  );
}

function sortFields(
  fields: readonly NormalizedAuditQuoteField[],
): NormalizedAuditQuoteField[] {
  const values = new Set(fields);
  return NORMALIZED_AUDIT_QUOTE_FIELDS.filter((field) => values.has(field));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueValues<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
