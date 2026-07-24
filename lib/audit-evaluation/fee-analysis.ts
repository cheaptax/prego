import { feeAnalysisResultSchema } from "@/lib/audit-evaluation/evaluation-result-schemas";
import {
  isWonAmount,
  normalizeWonAmount,
} from "@/lib/audit-evaluation/money";
import { feeAnalysisPolicySchema } from "@/lib/audit-evaluation/schemas";
import type {
  FeeAnalysisPolicy,
  FeeAnalysisResult,
  QuoteFeeAnalysis,
  RationalWonAverage,
  WonAmount,
} from "@/lib/audit-evaluation/types";

export const FEE_ANALYSIS_ENGINE_VERSION = "fee-analysis-v1";

const QUOTE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const VAT_NUMERATOR = 11n;
const VAT_DENOMINATOR = 10n;
const BASIS_POINTS = 10_000n;
const MAX_QUOTE_COUNT = 100;

export class FeeAnalysisError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "FeeAnalysisError";
    this.code = code;
  }
}

export type FeeAnalysisQuoteInput = {
  readonly quoteId: string;
  readonly auditFee: unknown;
  readonly vatIncluded: boolean | null;
  readonly totalPlannedHours: number | null;
  readonly partnerHours: number | null;
};

type WorkingQuote = {
  quoteId: string;
  status: "ANALYZED" | "ERROR";
  originalFeeWon: WonAmount | null;
  normalizedFeeWon: WonAmount | null;
  normalizedFeeValue: bigint | null;
  vatIncluded: boolean | null;
  effectiveVatIncluded: boolean | null;
  vatAdjustment: QuoteFeeAnalysis["vatAdjustment"];
  deviationFromMedianBasisPoints: string | null;
  totalPlannedHours: number | null;
  hourlyRate: RationalWonAverage | null;
  partnerHours: number | null;
  partnerHoursRatioBasisPoints: number | null;
  totalFeePosition: number | null;
  flags: string[];
};

type ExactRational = {
  numerator: bigint;
  denominator: number;
};

export function runDeterministicFeeAnalysis(
  policy: unknown,
  quotes: readonly FeeAnalysisQuoteInput[],
): FeeAnalysisResult {
  const parsedPolicy = feeAnalysisPolicySchema.safeParse(policy);
  if (!parsedPolicy.success) {
    throw new FeeAnalysisError("INVALID_POLICY");
  }
  if (quotes.length > MAX_QUOTE_COUNT) {
    throw new FeeAnalysisError("TOO_MANY_QUOTES");
  }

  validateQuoteIds(quotes);
  const orderedInputs = [...quotes].sort((left, right) =>
    compareStrings(left.quoteId, right.quoteId)
  );
  const workingQuotes = orderedInputs.map((quote) =>
    analyzeQuote(quote, parsedPolicy.data)
  );
  const validQuotes = workingQuotes.filter(
    (quote): quote is WorkingQuote & {
      normalizedFeeWon: WonAmount;
      normalizedFeeValue: bigint;
    } =>
      quote.status === "ANALYZED" &&
      quote.normalizedFeeWon !== null &&
      quote.normalizedFeeValue !== null,
  );
  const fees = validQuotes
    .map(({ normalizedFeeValue }) => normalizedFeeValue)
    .sort(compareBigInts);

  const medianExact = calculateMedian(fees);
  const averageExact = calculateAverage(fees);
  const median = medianExact
    ? makeRationalWon(medianExact, parsedPolicy.data.roundingMode)
    : null;
  const average = averageExact
    ? makeRationalWon(averageExact, parsedPolicy.data.roundingMode)
    : null;

  assignFeePositions(validQuotes);
  assignMedianDeviations(validQuotes, medianExact);
  applyOutlierPolicy(
    validQuotes,
    medianExact,
    parsedPolicy.data.outlierPolicy,
  );
  assignHourlyRates(workingQuotes, parsedPolicy.data.roundingMode);

  const comparisonWarnings: string[] = [];
  if (validQuotes.length === 2) {
    addUnique(comparisonWarnings, "TWO_QUOTE_MIDPOINT");
  }
  if (
    parsedPolicy.data.vatHandling === "PRESERVE_AS_SUBMITTED" &&
    hasMixedVatStatuses(validQuotes)
  ) {
    addUnique(comparisonWarnings, "VAT_COMPARABILITY_WARNING");
  }
  if (
    validQuotes.length > 0 &&
    validQuotes.some(({ hourlyRate }) => hourlyRate === null)
  ) {
    addUnique(comparisonWarnings, "HOURLY_COMPARISON_INCOMPLETE");
  }
  if (hasTotalAndHourlyOrderInversion(validQuotes)) {
    addUnique(comparisonWarnings, "TOTAL_FEE_COMPARISON_DISTORTED");
  }
  if (!parsedPolicy.data.outlierPolicy) {
    addUnique(comparisonWarnings, "OUTLIER_POLICY_NOT_CONFIGURED");
  } else if (
    validQuotes.length <
    parsedPolicy.data.outlierPolicy.minimumQuoteCount
  ) {
    addUnique(comparisonWarnings, "OUTLIER_SAMPLE_TOO_SMALL");
  }

  const normalizedFeesByQuote = Object.create(null) as Record<
    string,
    WonAmount
  >;
  for (const quote of validQuotes) {
    normalizedFeesByQuote[quote.quoteId] = quote.normalizedFeeWon;
  }

  const minimumWon = fees.length > 0 ? toWonAmount(fees[0]) : null;
  const maximumWon = fees.length > 0
    ? toWonAmount(fees[fees.length - 1])
    : null;
  const medianWon = median?.roundedWon ?? null;
  const result: FeeAnalysisResult = {
    engineVersion: FEE_ANALYSIS_ENGINE_VERSION,
    currency: "KRW",
    qualityScoreIncluded: false,
    validQuoteCount: validQuotes.length,
    normalizedFeesByQuote,
    minimumWon,
    maximumWon,
    medianWon,
    median,
    medianInterpretation: medianInterpretation(validQuotes.length),
    average,
    comparisonBenchmark: {
      method: parsedPolicy.data.comparisonMethod,
      won: selectBenchmark(
        parsedPolicy.data.comparisonMethod,
        minimumWon,
        median,
        average,
      ),
    },
    quotes: workingQuotes.map(toQuoteFeeAnalysis),
    comparisonWarnings,
  };

  return feeAnalysisResultSchema.parse(result);
}

function validateQuoteIds(quotes: readonly FeeAnalysisQuoteInput[]) {
  const seen = new Set<string>();
  for (const quote of quotes) {
    if (typeof quote.quoteId !== "string" || !QUOTE_ID.test(quote.quoteId)) {
      throw new FeeAnalysisError("INVALID_QUOTE_ID");
    }
    if (seen.has(quote.quoteId)) {
      throw new FeeAnalysisError("DUPLICATE_QUOTE_ID");
    }
    seen.add(quote.quoteId);
  }
}

function analyzeQuote(
  input: FeeAnalysisQuoteInput,
  policy: FeeAnalysisPolicy,
): WorkingQuote {
  const quote: WorkingQuote = {
    quoteId: input.quoteId,
    status: "ANALYZED",
    originalFeeWon: null,
    normalizedFeeWon: null,
    normalizedFeeValue: null,
    vatIncluded:
      typeof input.vatIncluded === "boolean" ? input.vatIncluded : null,
    effectiveVatIncluded: null,
    vatAdjustment: "NONE",
    deviationFromMedianBasisPoints: null,
    totalPlannedHours: null,
    hourlyRate: null,
    partnerHours: null,
    partnerHoursRatioBasisPoints: null,
    totalFeePosition: null,
    flags: [],
  };

  let feeValue: bigint | null = null;
  if (input.auditFee === null || input.auditFee === undefined) {
    markError(quote, "MISSING_FEE");
  } else if (!isWonAmount(input.auditFee)) {
    markError(quote, "INVALID_FEE");
  } else {
    quote.originalFeeWon = input.auditFee;
    feeValue = BigInt(input.auditFee);
    if (feeValue === 0n) {
      markError(quote, "ZERO_FEE");
      feeValue = null;
    }
  }

  const effectiveVat = resolveVat(input.vatIncluded, policy, quote);
  quote.effectiveVatIncluded = effectiveVat;

  if (feeValue !== null && effectiveVat !== null && quote.status === "ANALYZED") {
    const normalizedValue = normalizeVat(
      feeValue,
      effectiveVat,
      policy.vatHandling,
      policy.roundingMode,
      quote,
    );
    const normalizedText = normalizedValue.toString();
    if (!isWonAmount(normalizedText)) {
      markError(quote, "NORMALIZED_FEE_OVERFLOW");
    } else {
      quote.normalizedFeeValue = normalizedValue;
      quote.normalizedFeeWon = normalizedText;
      if (
        policy.realisticFeeRange &&
        (
          normalizedValue < BigInt(policy.realisticFeeRange.minimumWon) ||
          normalizedValue > BigInt(policy.realisticFeeRange.maximumWon)
        )
      ) {
        markError(quote, "UNREALISTIC_FEE");
      }
    }
  }

  validateHours(input, quote);
  return quote;
}

function resolveVat(
  vatIncluded: boolean | null,
  policy: FeeAnalysisPolicy,
  quote: WorkingQuote,
) {
  if (typeof vatIncluded === "boolean") return vatIncluded;
  if (policy.missingVatPolicy === "NEEDS_REVIEW") {
    markError(quote, "VAT_MISSING");
    return null;
  }
  if (policy.missingVatPolicy === "ASSUME_INCLUDED") {
    quote.vatAdjustment = "ASSUMED_INCLUDED";
    addUnique(quote.flags, "VAT_ASSUMED_INCLUDED");
    return true;
  }
  quote.vatAdjustment = "ASSUMED_EXCLUDED";
  addUnique(quote.flags, "VAT_ASSUMED_EXCLUDED");
  return false;
}

function normalizeVat(
  fee: bigint,
  vatIncluded: boolean,
  handling: FeeAnalysisPolicy["vatHandling"],
  roundingMode: FeeAnalysisPolicy["roundingMode"],
  quote: WorkingQuote,
) {
  if (handling === "PRESERVE_AS_SUBMITTED") return fee;
  if (handling === "NORMALIZE_TO_VAT_INCLUDED" && !vatIncluded) {
    if (quote.vatAdjustment === "NONE") {
      quote.vatAdjustment = "NORMALIZED_TO_INCLUDED";
    }
    return roundNonnegative(
      fee * VAT_NUMERATOR,
      VAT_DENOMINATOR,
      roundingMode,
    );
  }
  if (handling === "NORMALIZE_TO_VAT_EXCLUDED" && vatIncluded) {
    if (quote.vatAdjustment === "NONE") {
      quote.vatAdjustment = "NORMALIZED_TO_EXCLUDED";
    }
    return roundNonnegative(
      fee * VAT_DENOMINATOR,
      VAT_NUMERATOR,
      roundingMode,
    );
  }
  return fee;
}

function validateHours(
  input: FeeAnalysisQuoteInput,
  quote: WorkingQuote,
) {
  const totalHours = input.totalPlannedHours;
  const totalHoursValid =
    typeof totalHours === "number" &&
    Number.isSafeInteger(totalHours) &&
    totalHours > 0;
  if (totalHours === null || totalHours === undefined) {
    addUnique(quote.flags, "MISSING_HOURS");
  } else if (!totalHoursValid) {
    addUnique(quote.flags, "INVALID_HOURS");
  } else {
    quote.totalPlannedHours = totalHours;
  }

  const partnerHours = input.partnerHours;
  const partnerHoursValid =
    typeof partnerHours === "number" &&
    Number.isSafeInteger(partnerHours) &&
    partnerHours >= 0;
  if (partnerHours === null || partnerHours === undefined) {
    addUnique(quote.flags, "MISSING_PARTNER_HOURS");
  } else if (!partnerHoursValid) {
    addUnique(quote.flags, "INVALID_PARTNER_HOURS");
  } else if (totalHoursValid && partnerHours > totalHours) {
    addUnique(quote.flags, "PARTNER_HOURS_EXCEEDS_TOTAL_HOURS");
  } else {
    quote.partnerHours = partnerHours;
    if (totalHoursValid) {
      quote.partnerHoursRatioBasisPoints = Number(
        roundNonnegative(
          BigInt(partnerHours) * BASIS_POINTS,
          BigInt(totalHours),
          "HALF_UP",
        ),
      );
    }
  }
}

function assignHourlyRates(
  quotes: WorkingQuote[],
  roundingMode: FeeAnalysisPolicy["roundingMode"],
) {
  for (const quote of quotes) {
    if (
      quote.status === "ANALYZED" &&
      quote.normalizedFeeValue !== null &&
      quote.totalPlannedHours !== null
    ) {
      quote.hourlyRate = makeRationalWon(
        {
          numerator: quote.normalizedFeeValue,
          denominator: quote.totalPlannedHours,
        },
        roundingMode,
      );
    }
  }
}

function calculateMedian(fees: readonly bigint[]): ExactRational | null {
  if (fees.length === 0) return null;
  const middle = Math.floor(fees.length / 2);
  if (fees.length % 2 === 1) {
    return { numerator: fees[middle], denominator: 1 };
  }
  return {
    numerator: fees[middle - 1] + fees[middle],
    denominator: 2,
  };
}

function calculateAverage(fees: readonly bigint[]): ExactRational | null {
  if (fees.length === 0) return null;
  return {
    numerator: fees.reduce((sum, fee) => sum + fee, 0n),
    denominator: fees.length,
  };
}

function makeRationalWon(
  rational: ExactRational,
  roundingMode: FeeAnalysisPolicy["roundingMode"],
): RationalWonAverage {
  return {
    numeratorWon: toWonAmount(rational.numerator),
    denominator: rational.denominator,
    roundedWon: toWonAmount(
      roundNonnegative(
        rational.numerator,
        BigInt(rational.denominator),
        roundingMode,
      ),
    ),
    roundingMode,
  };
}

function assignFeePositions(
  validQuotes: Array<
    WorkingQuote & {
      normalizedFeeWon: WonAmount;
      normalizedFeeValue: bigint;
    }
  >,
) {
  const ordered = [...validQuotes].sort((left, right) => {
    const feeComparison = compareBigInts(
      left.normalizedFeeValue,
      right.normalizedFeeValue,
    );
    return feeComparison || compareStrings(left.quoteId, right.quoteId);
  });
  let previousFee: bigint | null = null;
  let position = 0;
  ordered.forEach((quote, index) => {
    if (previousFee === null || quote.normalizedFeeValue !== previousFee) {
      position = index + 1;
      previousFee = quote.normalizedFeeValue;
    }
    quote.totalFeePosition = position;
  });
}

function assignMedianDeviations(
  validQuotes: Array<
    WorkingQuote & {
      normalizedFeeWon: WonAmount;
      normalizedFeeValue: bigint;
    }
  >,
  median: ExactRational | null,
) {
  if (!median) return;
  const medianDenominator = BigInt(median.denominator);
  for (const quote of validQuotes) {
    const difference =
      quote.normalizedFeeValue * medianDenominator - median.numerator;
    quote.deviationFromMedianBasisPoints = roundSignedHalfUp(
      difference * BASIS_POINTS,
      median.numerator,
    ).toString();
  }
}

function applyOutlierPolicy(
  validQuotes: Array<
    WorkingQuote & {
      normalizedFeeWon: WonAmount;
      normalizedFeeValue: bigint;
    }
  >,
  median: ExactRational | null,
  policy: FeeAnalysisPolicy["outlierPolicy"],
) {
  if (!median || !policy || validQuotes.length < policy.minimumQuoteCount) {
    return;
  }
  const medianDenominator = BigInt(median.denominator);
  for (const quote of validQuotes) {
    const scaledFee = quote.normalizedFeeValue * medianDenominator;
    if (scaledFee < median.numerator) {
      const lowDeviation =
        (median.numerator - scaledFee) * BASIS_POINTS;
      if (
        lowDeviation >=
        BigInt(policy.lowDeviationBasisPoints) * median.numerator
      ) {
        addUnique(quote.flags, "ABNORMALLY_LOW");
      }
    } else if (scaledFee > median.numerator) {
      const highDeviation =
        (scaledFee - median.numerator) * BASIS_POINTS;
      if (
        highDeviation >=
        BigInt(policy.highDeviationBasisPoints) * median.numerator
      ) {
        addUnique(quote.flags, "ABNORMALLY_HIGH");
      }
    }
  }
}

function hasMixedVatStatuses(
  validQuotes: readonly WorkingQuote[],
) {
  const statuses = new Set(
    validQuotes
      .map(({ effectiveVatIncluded }) => effectiveVatIncluded)
      .filter((value): value is boolean => value !== null),
  );
  return statuses.size > 1;
}

function hasTotalAndHourlyOrderInversion(
  validQuotes: readonly WorkingQuote[],
) {
  const comparable = validQuotes.filter(
    (quote): quote is WorkingQuote & {
      normalizedFeeValue: bigint;
      totalPlannedHours: number;
      hourlyRate: RationalWonAverage;
    } =>
      quote.normalizedFeeValue !== null &&
      quote.totalPlannedHours !== null &&
      quote.hourlyRate !== null,
  );
  for (let leftIndex = 0; leftIndex < comparable.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < comparable.length;
      rightIndex += 1
    ) {
      const left = comparable[leftIndex];
      const right = comparable[rightIndex];
      const totalComparison = compareBigInts(
        left.normalizedFeeValue,
        right.normalizedFeeValue,
      );
      const hourlyComparison = compareBigInts(
        left.normalizedFeeValue * BigInt(right.totalPlannedHours),
        right.normalizedFeeValue * BigInt(left.totalPlannedHours),
      );
      if (
        (totalComparison < 0 && hourlyComparison > 0) ||
        (totalComparison > 0 && hourlyComparison < 0)
      ) {
        return true;
      }
    }
  }
  return false;
}

function selectBenchmark(
  method: FeeAnalysisPolicy["comparisonMethod"],
  minimumWon: WonAmount | null,
  median: RationalWonAverage | null,
  average: RationalWonAverage | null,
) {
  if (method === "LOWEST") return minimumWon;
  if (method === "MEDIAN") return median?.roundedWon ?? null;
  return average?.roundedWon ?? null;
}

function medianInterpretation(
  quoteCount: number,
): FeeAnalysisResult["medianInterpretation"] {
  if (quoteCount === 0) return "NO_VALID_QUOTES";
  if (quoteCount === 1) return "SINGLE_QUOTE";
  if (quoteCount === 2) return "TWO_QUOTE_MIDPOINT";
  return quoteCount % 2 === 1 ? "ODD_SET_MIDDLE" : "EVEN_SET_MIDPOINT";
}

function toQuoteFeeAnalysis(quote: WorkingQuote): QuoteFeeAnalysis {
  return {
    quoteId: quote.quoteId,
    status: quote.status,
    originalFeeWon: quote.originalFeeWon,
    normalizedFeeWon: quote.normalizedFeeWon,
    vatIncluded: quote.vatIncluded,
    vatAdjustment: quote.vatAdjustment,
    deviationFromMedianBasisPoints:
      quote.deviationFromMedianBasisPoints,
    totalPlannedHours: quote.totalPlannedHours,
    hourlyRate: quote.hourlyRate,
    partnerHours: quote.partnerHours,
    partnerHoursRatioBasisPoints: quote.partnerHoursRatioBasisPoints,
    totalFeePosition: quote.totalFeePosition,
    flags: quote.flags,
  };
}

function roundNonnegative(
  numerator: bigint,
  denominator: bigint,
  mode: FeeAnalysisPolicy["roundingMode"],
) {
  if (numerator < 0n || denominator <= 0n) {
    throw new FeeAnalysisError("INVALID_ROUNDING_OPERAND");
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n || mode === "DOWN") return quotient;
  if (mode === "UP") return quotient + 1n;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

function roundSignedHalfUp(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n) {
    throw new FeeAnalysisError("INVALID_ROUNDING_OPERAND");
  }
  if (numerator < 0n) {
    return -roundNonnegative(-numerator, denominator, "HALF_UP");
  }
  return roundNonnegative(numerator, denominator, "HALF_UP");
}

function toWonAmount(value: bigint) {
  try {
    return normalizeWonAmount(value);
  } catch {
    throw new FeeAnalysisError("RESULT_AMOUNT_OVERFLOW");
  }
}

function markError(quote: WorkingQuote, flag: string) {
  quote.status = "ERROR";
  addUnique(quote.flags, flag);
}

function addUnique(values: string[], value: string) {
  if (!values.includes(value)) values.push(value);
}

function compareBigInts(left: bigint, right: bigint) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareStrings(left: string, right: string) {
  return left === right ? 0 : left < right ? -1 : 1;
}
