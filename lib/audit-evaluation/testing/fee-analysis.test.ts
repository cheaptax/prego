import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  runDeterministicFeeAnalysis,
  type FeeAnalysisQuoteInput,
} from "@/lib/audit-evaluation/fee-analysis";
import { normalizeWonAmount } from "@/lib/audit-evaluation/money";
import type { FeeAnalysisPolicy } from "@/lib/audit-evaluation/types";

describe("deterministic fee analysis", () => {
  it("returns an explicit empty analysis", () => {
    const result = runDeterministicFeeAnalysis(policy(), []);
    assert.equal(result.validQuoteCount, 0);
    assert.equal(result.minimumWon, null);
    assert.equal(result.medianInterpretation, "NO_VALID_QUOTES");
    assert.equal(result.qualityScoreIncluded, false);
  });

  it("calculates two-quote midpoint, average, deviations, and fee positions", () => {
    const result = runDeterministicFeeAnalysis(policy(), [
      quote("quote-high", "300"),
      quote("quote-low", "100"),
    ]);
    assert.equal(result.minimumWon, "100");
    assert.equal(result.maximumWon, "300");
    assert.equal(result.average?.numeratorWon, "400");
    assert.equal(result.average?.denominator, 2);
    assert.equal(result.average?.roundedWon, "200");
    assert.equal(result.medianWon, "200");
    assert.equal(result.medianInterpretation, "TWO_QUOTE_MIDPOINT");
    assert.ok(result.comparisonWarnings.includes("TWO_QUOTE_MIDPOINT"));
    assert.ok(
      result.comparisonWarnings.includes("OUTLIER_SAMPLE_TOO_SMALL"),
    );
    assert.equal(byId(result, "quote-low").totalFeePosition, 1);
    assert.equal(
      byId(result, "quote-low").deviationFromMedianBasisPoints,
      "-5000",
    );
    assert.equal(
      byId(result, "quote-high").deviationFromMedianBasisPoints,
      "5000",
    );
  });

  it("normalizes VAT with explicit BigInt rounding policies", () => {
    const included = runDeterministicFeeAnalysis(
      policy({ vatHandling: "NORMALIZE_TO_VAT_INCLUDED" }),
      [quote("quote-a", "100", { vatIncluded: false })],
    );
    assert.equal(byId(included, "quote-a").normalizedFeeWon, "110");
    assert.equal(
      byId(included, "quote-a").vatAdjustment,
      "NORMALIZED_TO_INCLUDED",
    );

    const excluded = runDeterministicFeeAnalysis(
      policy({ vatHandling: "NORMALIZE_TO_VAT_EXCLUDED" }),
      [quote("quote-a", "110", { vatIncluded: true })],
    );
    assert.equal(byId(excluded, "quote-a").normalizedFeeWon, "100");

    const halfUp = runDeterministicFeeAnalysis(
      policy({
        vatHandling: "NORMALIZE_TO_VAT_EXCLUDED",
        roundingMode: "HALF_UP",
      }),
      [quote("quote-a", "100", { vatIncluded: true })],
    );
    assert.equal(byId(halfUp, "quote-a").normalizedFeeWon, "91");
  });

  it("classifies missing, zero, negative, and configured unrealistic fees as errors", () => {
    const result = runDeterministicFeeAnalysis(
      policy({
        realisticFeeRange: {
          minimumWon: normalizeWonAmount("100"),
          maximumWon: normalizeWonAmount("1000"),
        },
      }),
      [
        { ...quote("quote-missing", "100"), auditFee: null },
        quote("quote-zero", "0"),
        { ...quote("quote-negative", "100"), auditFee: "-1" },
        quote("quote-unrealistic", "1001"),
        quote("quote-valid", "500"),
      ],
    );
    assert.equal(result.validQuoteCount, 1);
    assert.ok(byId(result, "quote-missing").flags.includes("MISSING_FEE"));
    assert.ok(byId(result, "quote-zero").flags.includes("ZERO_FEE"));
    assert.ok(byId(result, "quote-negative").flags.includes("INVALID_FEE"));
    assert.ok(
      byId(result, "quote-unrealistic").flags.includes("UNREALISTIC_FEE"),
    );
    assert.equal(byId(result, "quote-valid").status, "ANALYZED");
  });

  it("handles hours, partner ratios, and distorted total-fee comparisons separately", () => {
    const result = runDeterministicFeeAnalysis(policy(), [
      quote("quote-low-total", "1000", {
        totalPlannedHours: 1,
        partnerHours: 1,
      }),
      quote("quote-high-total", "2000", {
        totalPlannedHours: 10,
        partnerHours: 2,
      }),
      quote("quote-no-hours", "1500", {
        totalPlannedHours: null,
        partnerHours: null,
      }),
    ]);
    assert.equal(
      byId(result, "quote-low-total").hourlyRate?.roundedWon,
      "1000",
    );
    assert.equal(
      byId(result, "quote-high-total").hourlyRate?.roundedWon,
      "200",
    );
    assert.equal(
      byId(result, "quote-high-total").partnerHoursRatioBasisPoints,
      2_000,
    );
    assert.ok(
      result.comparisonWarnings.includes(
        "TOTAL_FEE_COMPARISON_DISTORTED",
      ),
    );
    assert.ok(
      result.comparisonWarnings.includes("HOURLY_COMPARISON_INCOMPLETE"),
    );
  });

  it("applies only configured outlier thresholds with at least three quotes", () => {
    const configured = policy({
      outlierPolicy: {
        minimumQuoteCount: 3,
        lowDeviationBasisPoints: 5_000,
        highDeviationBasisPoints: 10_000,
      },
    });
    const result = runDeterministicFeeAnalysis(configured, [
      quote("quote-a", "100"),
      quote("quote-b", "100"),
      quote("quote-c", "1000"),
    ]);
    assert.ok(byId(result, "quote-c").flags.includes("ABNORMALLY_HIGH"));
    assert.ok(
      !result.comparisonWarnings.includes("OUTLIER_POLICY_NOT_CONFIGURED"),
    );
  });

  it("is deterministic for three and ten quotes regardless of input order", () => {
    const three = [
      quote("quote-c", "300"),
      quote("quote-a", "100"),
      quote("quote-b", "200"),
    ];
    assert.deepEqual(
      runDeterministicFeeAnalysis(policy(), three),
      runDeterministicFeeAnalysis(policy(), [...three].reverse()),
    );

    const ten = Array.from({ length: 10 }, (_, index) =>
      quote(`quote-${String(index).padStart(2, "0")}`, String((index + 1) * 100))
    );
    const result = runDeterministicFeeAnalysis(policy(), ten);
    assert.equal(result.validQuoteCount, 10);
    assert.equal(result.minimumWon, "100");
    assert.equal(result.maximumWon, "1000");
    assert.equal(result.medianWon, "550");
  });

  it("warns when preserved totals mix VAT treatments", () => {
    const result = runDeterministicFeeAnalysis(policy(), [
      quote("quote-included", "110", { vatIncluded: true }),
      quote("quote-excluded", "100", { vatIncluded: false }),
    ]);
    assert.ok(
      result.comparisonWarnings.includes("VAT_COMPARABILITY_WARNING"),
    );
  });
});

function policy(
  overrides: Partial<FeeAnalysisPolicy> = {},
): FeeAnalysisPolicy {
  return {
    currency: "KRW",
    vatHandling: "PRESERVE_AS_SUBMITTED",
    comparisonMethod: "MEDIAN",
    missingVatPolicy: "NEEDS_REVIEW",
    roundingMode: "HALF_UP",
    twoQuoteMedianPolicy: "MIDPOINT",
    outlierPolicy: {
      minimumQuoteCount: 3,
      lowDeviationBasisPoints: 5_000,
      highDeviationBasisPoints: 10_000,
    },
    ...overrides,
  };
}

function quote(
  quoteId: string,
  auditFee: string,
  overrides: Partial<FeeAnalysisQuoteInput> = {},
): FeeAnalysisQuoteInput {
  return {
    quoteId,
    auditFee: normalizeWonAmount(auditFee),
    vatIncluded: true,
    totalPlannedHours: 100,
    partnerHours: 10,
    ...overrides,
  };
}

function byId(
  result: ReturnType<typeof runDeterministicFeeAnalysis>,
  quoteId: string,
) {
  const quoteResult = result.quotes.find((quote) => quote.quoteId === quoteId);
  if (!quoteResult) throw new Error(`missing fee result ${quoteId}`);
  return quoteResult;
}
