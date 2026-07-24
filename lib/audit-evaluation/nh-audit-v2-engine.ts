import {
  normalizeWonAmount,
} from "@/lib/audit-evaluation/money";
import {
  NH_AUDIT_COUNT_RECOGNITION_BANDS,
  NH_AUDIT_CPA_COUNT_RECOGNITION_BANDS,
  NH_AUDIT_REVENUE_RECOGNITION_BANDS,
  NH_AUDIT_TYPE_DIVERSITY_RECOGNITION_BANDS,
  type NhAuditIntegerRecognitionBand,
  type NhAuditWonRecognitionBand,
} from "@/lib/audit-evaluation/nh-audit-v2-policy";
import {
  validateNhAuditCustomerWeightsV2,
} from "@/lib/audit-evaluation/nh-audit-v2-schemas";
import {
  NH_AUDIT_EVALUATION_STANDARD_VERSION,
  NH_AUDIT_VAT_ROUNDING_POLICY,
  type ExactScore,
  type NhAuditCostCalculationResult,
  type NhAuditCriterionInputValue,
  type NhAuditCustomerWeightsV2,
  type NhAuditEligibilityStatus,
  type NhAuditPriceCandidate,
  type NhAuditPriceScoreResult,
  type NhAuditQualityCriterionId,
  type NhAuditQualityCriterionResult,
  type NhAuditQualityEvaluationResult,
  type NhAuditQuoteEvaluationResultV2,
  type NhAuditQuoteSubmissionV2,
  type NhAuditRankKey,
  type PreparedNhAuditCandidate,
} from "@/lib/audit-evaluation/nh-audit-v2-types";
import type { WonAmount } from "@/lib/audit-evaluation/types";

const BASIS_POINTS = 10_000n;
const PERCENT = 100n;
const VAT_RATE_BASIS_POINTS = 1_000n;

export class NhAuditEvaluationV2Error extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "NhAuditEvaluationV2Error";
  }
}

export function calculateNhAuditQualityScoreV2(
  submission: NhAuditQuoteSubmissionV2,
  customerWeights: NhAuditCustomerWeightsV2,
): NhAuditQualityEvaluationResult {
  const weights = parseWeights(customerWeights);
  const criteria: NhAuditQualityCriterionResult[] = [
    integerCriterion(
      "LOCAL_NONGHYUP_AUDIT_COUNT_2025",
      submission.localNonghyupAuditCount2025,
      NH_AUDIT_COUNT_RECOGNITION_BANDS,
      weights.qualityCriterionWeights.LOCAL_NONGHYUP_AUDIT_COUNT_2025,
    ),
    integerCriterion(
      "CERTIFIED_PUBLIC_ACCOUNTANT_COUNT",
      submission.certifiedPublicAccountantCount,
      NH_AUDIT_CPA_COUNT_RECOGNITION_BANDS,
      weights.qualityCriterionWeights.CERTIFIED_PUBLIC_ACCOUNTANT_COUNT,
    ),
    wonCriterion(
      "ACCOUNTING_FIRM_REVENUE",
      submission.accountingFirmRevenueWon,
      NH_AUDIT_REVENUE_RECOGNITION_BANDS,
      weights.qualityCriterionWeights.ACCOUNTING_FIRM_REVENUE,
    ),
    integerCriterion(
      "AUDITED_NONGHYUP_TYPE_DIVERSITY_2025",
      submission.auditedNonghyupTypes2025.length,
      NH_AUDIT_TYPE_DIVERSITY_RECOGNITION_BANDS,
      weights.qualityCriterionWeights
        .AUDITED_NONGHYUP_TYPE_DIVERSITY_2025,
      submission.auditedNonghyupTypes2025,
    ),
    booleanCriterion(
      "NONGHYUP_TAX_AGENCY_PERFORMED_2025",
      submission.nonghyupTaxAgencyPerformed2025,
      weights.qualityCriterionWeights
        .NONGHYUP_TAX_AGENCY_PERFORMED_2025,
    ),
    booleanCriterion(
      "NONGHYUP_SUBSIDY_SETTLEMENT_PERFORMED_2025",
      submission.nonghyupSubsidySettlementPerformed2025,
      weights.qualityCriterionWeights
        .NONGHYUP_SUBSIDY_SETTLEMENT_PERFORMED_2025,
    ),
  ];

  return {
    evaluationStandardVersion: NH_AUDIT_EVALUATION_STANDARD_VERSION,
    criteria,
    qualityScore: criteria.reduce(
      (sum, criterion) => addExactScores(sum, criterion.earnedScore),
      exactScore(0n, 1n),
    ),
  };
}

export function calculateNhAuditExpectedCostV2(
  submission: NhAuditQuoteSubmissionV2,
): NhAuditCostCalculationResult {
  const auditFee = BigInt(submission.auditFeeWon);
  const expense =
    submission.expenseBillingMode === "SEPARATELY_BILLED"
      ? BigInt(submission.expectedExpenseWon)
      : 0n;
  const supply = auditFee + expense;
  const vat = divideHalfUp(
    supply * VAT_RATE_BASIS_POINTS,
    BASIS_POINTS,
  );
  return {
    currency: "KRW",
    vatRateBasisPoints: 1_000,
    vatRoundingPolicy: NH_AUDIT_VAT_ROUNDING_POLICY,
    auditFeeWon: normalizeWonAmount(auditFee),
    normalizedExpectedExpenseWon: normalizeWonAmount(expense),
    supplyAmountWon: normalizeWonAmount(supply),
    vatWon: normalizeWonAmount(vat),
    expectedTotalBurdenWon: normalizeWonAmount(supply + vat),
  };
}

export function calculateNhAuditPriceBaseScoresV2(
  candidates: readonly NhAuditPriceCandidate[],
): NhAuditPriceScoreResult {
  assertUniqueCandidateIds(candidates);
  const eligible = candidates.flatMap((candidate) => {
    if (
      candidate.eligibilityStatus !== "ELIGIBLE" ||
      candidate.expectedTotalBurdenWon === null
    ) {
      return [];
    }
    const total = BigInt(candidate.expectedTotalBurdenWon);
    return total > 0n ? [{ ...candidate, total }] : [];
  });
  if (eligible.length === 0) {
    return {
      minimumEligibleTotalBurdenWon: null,
      scoresByCandidateId: {},
    };
  }
  const minimum = eligible.reduce(
    (current, candidate) =>
      candidate.total < current ? candidate.total : current,
    eligible[0].total,
  );
  const scoresByCandidateId: Record<string, ExactScore> = {};
  for (const candidate of eligible) {
    scoresByCandidateId[candidate.candidateId] = exactScore(
      PERCENT * minimum,
      candidate.total,
    );
  }
  return {
    minimumEligibleTotalBurdenWon: normalizeWonAmount(minimum),
    scoresByCandidateId,
  };
}

export function calculateNhAuditOverallScoreV2(
  qualityScore: ExactScore,
  priceBaseScore: ExactScore,
  customerWeights: NhAuditCustomerWeightsV2,
): ExactScore {
  return calculateNhAuditCompositeComponentsV2(
    qualityScore,
    priceBaseScore,
    customerWeights,
  ).overallScore;
}

export function calculateNhAuditCompositeComponentsV2(
  qualityScore: ExactScore,
  priceBaseScore: ExactScore,
  customerWeights: NhAuditCustomerWeightsV2,
) {
  const weights = parseWeights(customerWeights);
  const weightedQualityScore = multiplyExactScore(
    qualityScore,
    BigInt(weights.qualityWeightPercent),
    PERCENT,
  );
  const weightedPriceScore = multiplyExactScore(
    priceBaseScore,
    BigInt(weights.priceWeightPercent),
    PERCENT,
  );
  return {
    weightedQualityScore,
    weightedPriceScore,
    overallScore: addExactScores(
      weightedQualityScore,
      weightedPriceScore,
    ),
  };
}

export function evaluateNhAuditQuoteCandidatesV2(
  candidates: readonly PreparedNhAuditCandidate[],
  customerWeights: NhAuditCustomerWeightsV2,
): NhAuditQuoteEvaluationResultV2[] {
  const weights = parseWeights(customerWeights);
  assertUniqueCandidateIds(candidates);

  const evaluated = candidates.map((candidate) => {
    const submission = candidate.validation.success
      ? candidate.validation.data
      : null;
    const quality = submission
      ? calculateNhAuditQualityScoreV2(submission, weights)
      : null;
    const cost = submission
      ? calculateNhAuditExpectedCostV2(submission)
      : null;
    const { status, reasonCodes } = resolveEligibility(
      candidate,
      submission,
      cost,
    );
    return {
      candidateId: candidate.candidateId,
      submission,
      evaluationStandardVersion: NH_AUDIT_EVALUATION_STANDARD_VERSION,
      eligibilityStatus: status,
      reasonCodes,
      missingFields: candidate.validation.missingFields,
      quality,
      cost,
      priceBaseScore: null,
      overallScore: null,
      rank: null,
      tiedWithCandidateIds: [],
    } satisfies NhAuditQuoteEvaluationResultV2;
  });

  const priceResult = calculateNhAuditPriceBaseScoresV2(
    evaluated.map((result) => ({
      candidateId: result.candidateId,
      eligibilityStatus: result.eligibilityStatus,
      expectedTotalBurdenWon:
        result.cost?.expectedTotalBurdenWon ?? null,
    })),
  );
  const scored = evaluated.map((result) => {
    const priceBaseScore =
      priceResult.scoresByCandidateId[result.candidateId] ?? null;
    return {
      ...result,
      priceBaseScore,
      overallScore:
        result.eligibilityStatus === "ELIGIBLE" &&
          result.quality &&
          priceBaseScore
          ? calculateNhAuditOverallScoreV2(
              result.quality.qualityScore,
              priceBaseScore,
              weights,
            )
          : null,
    };
  });
  return rankNhAuditEvaluationResultsV2(scored);
}

export function compareNhAuditRankKeysV2(
  left: NhAuditRankKey,
  right: NhAuditRankKey,
): number {
  return compareSpecifiedRankKeys(left, right) ||
    compareText(left.candidateId, right.candidateId);
}

export function rankNhAuditEvaluationResultsV2(
  results: readonly NhAuditQuoteEvaluationResultV2[],
): NhAuditQuoteEvaluationResultV2[] {
  const rankable = results.flatMap((result) => {
    if (
      result.eligibilityStatus !== "ELIGIBLE" ||
      !result.overallScore ||
      !result.quality ||
      !result.cost ||
      !result.submission
    ) {
      return [];
    }
    return [{
      candidateId: result.candidateId,
      overallScore: result.overallScore,
      qualityScore: result.quality.qualityScore,
      expectedTotalBurdenWon: result.cost.expectedTotalBurdenWon,
      localNonghyupAuditCount2025:
        result.submission.localNonghyupAuditCount2025,
    } satisfies NhAuditRankKey];
  }).sort(compareNhAuditRankKeysV2);

  const rankByCandidateId = new Map<string, {
    rank: number;
    tiedWithCandidateIds: string[];
  }>();
  let previous: NhAuditRankKey | null = null;
  let previousRank = 0;
  rankable.forEach((candidate, index) => {
    if (
      previous === null ||
      compareSpecifiedRankKeys(previous, candidate) !== 0
    ) {
      previousRank = index + 1;
      previous = candidate;
    }
    rankByCandidateId.set(candidate.candidateId, {
      rank: previousRank,
      tiedWithCandidateIds: rankable
        .filter((other) =>
          other.candidateId !== candidate.candidateId &&
          compareSpecifiedRankKeys(candidate, other) === 0
        )
        .map(({ candidateId }) => candidateId)
        .sort(compareText),
    });
  });

  return results
    .map((result) => ({
      ...result,
      ...(rankByCandidateId.get(result.candidateId) ?? {
        rank: null,
        tiedWithCandidateIds: [],
      }),
    }))
    .sort((left, right) => {
      const leftRank = left.rank ?? Number.MAX_SAFE_INTEGER;
      const rightRank = right.rank ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank ||
        compareText(left.candidateId, right.candidateId);
    });
}

export function compareExactScores(
  left: ExactScore,
  right: ExactScore,
): number {
  const leftNumerator = parseExactInteger(left.numerator);
  const leftDenominator = parsePositiveExactInteger(left.denominator);
  const rightNumerator = parseExactInteger(right.numerator);
  const rightDenominator = parsePositiveExactInteger(right.denominator);
  const leftScaled = leftNumerator * rightDenominator;
  const rightScaled = rightNumerator * leftDenominator;
  return leftScaled === rightScaled ? 0 : leftScaled < rightScaled ? -1 : 1;
}

export function formatExactScoreOneDecimal(score: ExactScore): string {
  const numerator = parseExactInteger(score.numerator);
  const denominator = parsePositiveExactInteger(score.denominator);
  const tenths = divideHalfUp(numerator * 10n, denominator);
  return `${tenths / 10n}.${tenths % 10n}`;
}

function integerCriterion(
  criterionId: NhAuditQualityCriterionId,
  value: number,
  bands: readonly NhAuditIntegerRecognitionBand[],
  weightPoints: number,
  inputValue: NhAuditCriterionInputValue = value,
): NhAuditQualityCriterionResult {
  const band = bands.find(({ minimumInclusive, maximumExclusive }) =>
    value >= minimumInclusive &&
    (maximumExclusive === null || value < maximumExclusive)
  );
  if (!band) {
    throw new NhAuditEvaluationV2Error("INTEGER_RECOGNITION_BAND_NOT_FOUND");
  }
  return criterionResult(
    criterionId,
    inputValue,
    band.id,
    band.recognitionRateBasisPoints,
    weightPoints,
  );
}

function wonCriterion(
  criterionId: NhAuditQualityCriterionId,
  value: WonAmount,
  bands: readonly NhAuditWonRecognitionBand[],
  weightPoints: number,
): NhAuditQualityCriterionResult {
  const amount = BigInt(value);
  const band = bands.find(({ minimumInclusiveWon, maximumExclusiveWon }) =>
    amount >= BigInt(minimumInclusiveWon) &&
    (
      maximumExclusiveWon === null ||
      amount < BigInt(maximumExclusiveWon)
    )
  );
  if (!band) {
    throw new NhAuditEvaluationV2Error("WON_RECOGNITION_BAND_NOT_FOUND");
  }
  return criterionResult(
    criterionId,
    value,
    band.id,
    band.recognitionRateBasisPoints,
    weightPoints,
  );
}

function booleanCriterion(
  criterionId: NhAuditQualityCriterionId,
  value: boolean,
  weightPoints: number,
): NhAuditQualityCriterionResult {
  return criterionResult(
    criterionId,
    value,
    value ? "performed" : "not-performed",
    value ? 10_000 : 0,
    weightPoints,
  );
}

function criterionResult(
  criterionId: NhAuditQualityCriterionId,
  inputValue: NhAuditCriterionInputValue,
  appliedBandId: string,
  recognitionRateBasisPoints: number,
  weightPoints: number,
): NhAuditQualityCriterionResult {
  return {
    criterionId,
    inputValue,
    appliedBandId,
    recognitionRateBasisPoints,
    weightPoints,
    earnedScore: exactScore(
      BigInt(weightPoints) * BigInt(recognitionRateBasisPoints),
      BASIS_POINTS,
    ),
  };
}

function resolveEligibility(
  candidate: PreparedNhAuditCandidate,
  submission: NhAuditQuoteSubmissionV2 | null,
  cost: NhAuditCostCalculationResult | null,
): {
  status: NhAuditEligibilityStatus;
  reasonCodes: NhAuditQuoteEvaluationResultV2["reasonCodes"];
} {
  if (
    candidate.rawProposerType === "AUDIT_GROUP" ||
    submission?.proposerType === "AUDIT_GROUP"
  ) {
    return {
      status: "INELIGIBLE",
      reasonCodes: ["AUDIT_GROUP_PROPOSER"],
    };
  }
  if (candidate.administrativelyExcluded) {
    return {
      status: "EXCLUDED",
      reasonCodes: ["ADMINISTRATIVELY_EXCLUDED"],
    };
  }
  if (!candidate.validation.success) {
    return candidate.source === "LEGACY_DOCUMENT"
      ? {
          status: "RESUBMISSION_REQUIRED",
          reasonCodes: ["LEGACY_DOCUMENT_MISSING_REQUIRED_FIELDS"],
        }
      : {
          status: "EXCLUDED",
          reasonCodes: ["SERVER_VALIDATION_FAILED"],
        };
  }
  if (!cost || BigInt(cost.expectedTotalBurdenWon) <= 0n) {
    return {
      status: "EXCLUDED",
      reasonCodes: ["NON_POSITIVE_TOTAL_BURDEN"],
    };
  }
  return { status: "ELIGIBLE", reasonCodes: [] };
}

function compareSpecifiedRankKeys(
  left: NhAuditRankKey,
  right: NhAuditRankKey,
): number {
  const overall = compareExactScores(right.overallScore, left.overallScore);
  if (overall !== 0) return overall;
  const quality = compareExactScores(right.qualityScore, left.qualityScore);
  if (quality !== 0) return quality;
  const leftCost = BigInt(left.expectedTotalBurdenWon);
  const rightCost = BigInt(right.expectedTotalBurdenWon);
  if (leftCost !== rightCost) return leftCost < rightCost ? -1 : 1;
  return right.localNonghyupAuditCount2025 -
    left.localNonghyupAuditCount2025;
}

function parseWeights(
  value: NhAuditCustomerWeightsV2,
): NhAuditCustomerWeightsV2 {
  const parsed = validateNhAuditCustomerWeightsV2(value);
  if (!parsed.success) {
    throw new NhAuditEvaluationV2Error("INVALID_CUSTOMER_WEIGHTS");
  }
  return parsed.data;
}

function exactScore(numerator: bigint, denominator: bigint): ExactScore {
  if (numerator < 0n || denominator <= 0n) {
    throw new NhAuditEvaluationV2Error("INVALID_EXACT_SCORE");
  }
  const divisor = greatestCommonDivisor(numerator, denominator);
  return {
    numerator: (numerator / divisor).toString(),
    denominator: (denominator / divisor).toString(),
  };
}

function addExactScores(left: ExactScore, right: ExactScore): ExactScore {
  const leftNumerator = parseExactInteger(left.numerator);
  const leftDenominator = parsePositiveExactInteger(left.denominator);
  const rightNumerator = parseExactInteger(right.numerator);
  const rightDenominator = parsePositiveExactInteger(right.denominator);
  return exactScore(
    leftNumerator * rightDenominator +
      rightNumerator * leftDenominator,
    leftDenominator * rightDenominator,
  );
}

function multiplyExactScore(
  score: ExactScore,
  numerator: bigint,
  denominator: bigint,
): ExactScore {
  return exactScore(
    parseExactInteger(score.numerator) * numerator,
    parsePositiveExactInteger(score.denominator) * denominator,
  );
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left;
  let b = right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a === 0n ? 1n : a;
}

function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) {
    throw new NhAuditEvaluationV2Error("INVALID_ROUNDING_OPERAND");
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

function parseExactInteger(value: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new NhAuditEvaluationV2Error("INVALID_EXACT_SCORE");
  }
  return BigInt(value);
}

function parsePositiveExactInteger(value: string): bigint {
  const parsed = parseExactInteger(value);
  if (parsed === 0n) {
    throw new NhAuditEvaluationV2Error("INVALID_EXACT_SCORE");
  }
  return parsed;
}

function assertUniqueCandidateIds(
  candidates: readonly { candidateId: string }[],
) {
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (ids.has(candidate.candidateId)) {
      throw new NhAuditEvaluationV2Error("DUPLICATE_CANDIDATE_ID");
    }
    ids.add(candidate.candidateId);
  }
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}
