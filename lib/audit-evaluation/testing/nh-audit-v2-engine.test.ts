import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateNhAuditExpectedCostV2,
  calculateNhAuditQualityScoreV2,
  compareNhAuditRankKeysV2,
  evaluateNhAuditQuoteCandidatesV2,
  formatExactScoreOneDecimal,
} from "@/lib/audit-evaluation/nh-audit-v2-engine";
import {
  NH_AUDIT_DEFAULT_CUSTOMER_WEIGHTS,
  NH_AUDIT_QUALITY_WEIGHT_LIMITS,
} from "@/lib/audit-evaluation/nh-audit-v2-policy";
import {
  createDefaultNhAuditCustomerWeightsV2,
  nhAuditQuoteSubmissionV2Schema,
  prepareNhAuditCandidateV2,
  validateNhAuditCustomerWeightsV2,
  validateNhAuditQuoteSubmissionV2,
} from "@/lib/audit-evaluation/nh-audit-v2-schemas";
import {
  NH_AUDIT_EVALUATION_STANDARD_VERSION,
  NH_AUDIT_QUOTE_SUBMISSION_SCHEMA_VERSION,
  type ExactScore,
  type NhAuditCustomerWeightsV2,
  type NhAuditQualityCriterionId,
  type NhAuditQuoteSubmissionV2,
  type NhAuditRankKey,
} from "@/lib/audit-evaluation/nh-audit-v2-types";

describe("NH audit quote V2 submission validation", () => {
  it("pins explicit schema and evaluation standard versions", () => {
    assert.equal(NH_AUDIT_QUOTE_SUBMISSION_SCHEMA_VERSION, 2);
    assert.equal(
      NH_AUDIT_EVALUATION_STANDARD_VERSION,
      "nh-audit-evaluation-2025-v1",
    );
  });

  it("normalizes included expenses to zero and deduplicates types", () => {
    const parsed = nhAuditQuoteSubmissionV2Schema.parse(rawSubmission({
      expectedExpenseWon: "999999",
      auditedNonghyupTypes2025: [
        "LOCAL_AGRICULTURAL_COOPERATIVE",
        "LOCAL_AGRICULTURAL_COOPERATIVE",
        "GINSENG_COOPERATIVE",
      ],
    }));
    assert.equal(parsed.expectedExpenseWon, "0");
    assert.deepEqual(parsed.auditedNonghyupTypes2025, [
      "LOCAL_AGRICULTURAL_COOPERATIVE",
      "GINSENG_COOPERATIVE",
    ]);
  });

  it("rejects unsupported types, decimal amounts, and client scores", () => {
    const invalidType = validateNhAuditQuoteSubmissionV2(rawSubmission({
      auditedNonghyupTypes2025: ["CREDIT_UNION"],
    }));
    assert.equal(invalidType.success, false);

    const decimalAmount = validateNhAuditQuoteSubmissionV2(rawSubmission({
      auditFeeWon: 10.5,
    }));
    assert.equal(decimalAmount.success, false);

    const clientScore = validateNhAuditQuoteSubmissionV2({
      ...rawSubmission(),
      qualityScore: 100,
      priceScore: 100,
      overallScore: 100,
    });
    assert.equal(clientScore.success, false);
  });
});

describe("NH audit quality recognition boundaries", () => {
  it("applies every required audit-count boundary", () => {
    const cases = [
      [4, 0],
      [5, 500],
      [9, 500],
      [10, 1_000],
      [19, 1_000],
      [20, 2_000],
      [29, 2_000],
      [30, 3_000],
      [39, 3_000],
      [40, 5_000],
      [49, 5_000],
      [50, 10_000],
    ] as const;
    for (const [value, expectedRate] of cases) {
      assert.equal(
        criterion(
          quality(submission({ localNonghyupAuditCount2025: value })),
          "LOCAL_NONGHYUP_AUDIT_COUNT_2025",
        ).recognitionRateBasisPoints,
        expectedRate,
        String(value),
      );
    }
  });

  it("applies every required CPA-count boundary", () => {
    const cases = [
      [6, 0],
      [7, 1_500],
      [10, 1_500],
      [11, 3_000],
      [15, 3_000],
      [16, 5_000],
      [19, 5_000],
      [20, 10_000],
    ] as const;
    for (const [value, expectedRate] of cases) {
      assert.equal(
        criterion(
          quality(submission({ certifiedPublicAccountantCount: value })),
          "CERTIFIED_PUBLIC_ACCOUNTANT_COUNT",
        ).recognitionRateBasisPoints,
        expectedRate,
        String(value),
      );
    }
  });

  it("compares every revenue boundary at exact won precision", () => {
    const cases = [
      ["500000000", 0],
      ["500000001", 1_000],
      ["2000000000", 1_000],
      ["2000000001", 2_000],
      ["5000000000", 2_000],
      ["5000000001", 3_000],
      ["8000000000", 3_000],
      ["8000000001", 5_000],
      ["10000000000", 5_000],
      ["10000000001", 10_000],
    ] as const;
    for (const [value, expectedRate] of cases) {
      assert.equal(
        criterion(
          quality(submission({ accountingFirmRevenueWon: value })),
          "ACCOUNTING_FIRM_REVENUE",
        ).recognitionRateBasisPoints,
        expectedRate,
        value,
      );
    }
  });

  it("scores type diversity from zero through four unique types", () => {
    const allTypes = [
      "LOCAL_AGRICULTURAL_COOPERATIVE",
      "LOCAL_LIVESTOCK_COOPERATIVE",
      "ITEM_AGRICULTURAL_OR_LIVESTOCK_COOPERATIVE",
      "GINSENG_COOPERATIVE",
    ] as const;
    const rates = [0, 1_500, 3_000, 5_000, 10_000];
    for (let count = 0; count <= 4; count += 1) {
      assert.equal(
        criterion(
          quality(submission({
            auditedNonghyupTypes2025: allTypes.slice(0, count),
          })),
          "AUDITED_NONGHYUP_TYPE_DIVERSITY_2025",
        ).recognitionRateBasisPoints,
        rates[count],
      );
    }
  });

  it("scores every tax-agency and subsidy-settlement combination", () => {
    for (const taxAgency of [false, true]) {
      for (const subsidy of [false, true]) {
        const result = quality(submission({
          nonghyupTaxAgencyPerformed2025: taxAgency,
          nonghyupSubsidySettlementPerformed2025: subsidy,
        }));
        assert.equal(
          criterion(
            result,
            "NONGHYUP_TAX_AGENCY_PERFORMED_2025",
          ).recognitionRateBasisPoints,
          taxAgency ? 10_000 : 0,
        );
        assert.equal(
          criterion(
            result,
            "NONGHYUP_SUBSIDY_SETTLEMENT_PERFORMED_2025",
          ).recognitionRateBasisPoints,
          subsidy ? 10_000 : 0,
        );
      }
    }
  });

  it("returns exactly 100 points at all maximum conditions", () => {
    const result = quality(submission());
    assert.deepEqual(result.qualityScore, score(100));
  });

  it("does not change quality when audit fees change", () => {
    const low = quality(submission({ auditFeeWon: "1000000" }));
    const high = quality(submission({ auditFeeWon: "999999999999" }));
    assert.deepEqual(low, high);
  });
});

describe("NH audit cost calculation", () => {
  it("uses explicit half-up won VAT rounding for included expenses", () => {
    const cost = calculateNhAuditExpectedCostV2(submission({
      auditFeeWon: "101",
      expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
      expectedExpenseWon: "500",
    }));
    assert.equal(cost.normalizedExpectedExpenseWon, "0");
    assert.equal(cost.supplyAmountWon, "101");
    assert.equal(cost.vatWon, "10");
    assert.equal(cost.expectedTotalBurdenWon, "111");
    assert.equal(cost.vatRoundingPolicy, "HALF_UP_TO_WON");
  });

  it("adds separate expenses before VAT and rounds 0.5 won upward", () => {
    const cost = calculateNhAuditExpectedCostV2(submission({
      auditFeeWon: "101",
      expenseBillingMode: "SEPARATELY_BILLED",
      expectedExpenseWon: "4",
    }));
    assert.equal(cost.supplyAmountWon, "105");
    assert.equal(cost.vatWon, "11");
    assert.equal(cost.expectedTotalBurdenWon, "116");
  });
});

describe("NH audit customer weight validation", () => {
  it("accepts defaults and both composite-weight limits", () => {
    assert.equal(
      validateNhAuditCustomerWeightsV2(
        createDefaultNhAuditCustomerWeightsV2(),
      ).success,
      true,
    );
    assert.equal(
      validateNhAuditCustomerWeightsV2(weights({ quality: 80 })).success,
      true,
    );
    assert.equal(
      validateNhAuditCustomerWeightsV2(weights({ quality: 40 })).success,
      true,
    );
  });

  it("rejects quality 81 or 39 and mismatched composite totals", () => {
    assert.equal(
      validateNhAuditCustomerWeightsV2({
        ...weights({ quality: 80 }),
        qualityWeightPercent: 81,
        priceWeightPercent: 19,
      }).success,
      false,
    );
    assert.equal(
      validateNhAuditCustomerWeightsV2({
        ...weights({ quality: 40 }),
        qualityWeightPercent: 39,
        priceWeightPercent: 61,
      }).success,
      false,
    );
    assert.equal(
      validateNhAuditCustomerWeightsV2({
        ...weights({ quality: 60 }),
        priceWeightPercent: 39,
      }).success,
      false,
    );
  });

  it("accepts every criterion minimum and maximum in a 100-point profile", () => {
    const profiles = [
      criterionWeightPair("LOCAL_NONGHYUP_AUDIT_COUNT_2025", 20,
        "CERTIFIED_PUBLIC_ACCOUNTANT_COUNT", 30),
      criterionWeightPair("LOCAL_NONGHYUP_AUDIT_COUNT_2025", 40,
        "CERTIFIED_PUBLIC_ACCOUNTANT_COUNT", 10),
      criterionWeightPair("CERTIFIED_PUBLIC_ACCOUNTANT_COUNT", 10,
        "LOCAL_NONGHYUP_AUDIT_COUNT_2025", 40),
      criterionWeightPair("CERTIFIED_PUBLIC_ACCOUNTANT_COUNT", 30,
        "LOCAL_NONGHYUP_AUDIT_COUNT_2025", 20),
      criterionWeightPair("ACCOUNTING_FIRM_REVENUE", 10,
        "LOCAL_NONGHYUP_AUDIT_COUNT_2025", 40),
      criterionWeightPair("ACCOUNTING_FIRM_REVENUE", 30,
        "LOCAL_NONGHYUP_AUDIT_COUNT_2025", 20),
      criterionWeightPair("AUDITED_NONGHYUP_TYPE_DIVERSITY_2025", 0,
        "LOCAL_NONGHYUP_AUDIT_COUNT_2025", 40),
      criterionWeightPair("AUDITED_NONGHYUP_TYPE_DIVERSITY_2025", 20,
        "LOCAL_NONGHYUP_AUDIT_COUNT_2025", 20),
      criterionWeightPair("NONGHYUP_TAX_AGENCY_PERFORMED_2025", 0,
        "LOCAL_NONGHYUP_AUDIT_COUNT_2025", 40),
      criterionWeightPair("NONGHYUP_TAX_AGENCY_PERFORMED_2025", 20,
        "LOCAL_NONGHYUP_AUDIT_COUNT_2025", 20),
      criterionWeightPair(
        "NONGHYUP_SUBSIDY_SETTLEMENT_PERFORMED_2025",
        0,
        "LOCAL_NONGHYUP_AUDIT_COUNT_2025",
        40,
      ),
      criterionWeightPair(
        "NONGHYUP_SUBSIDY_SETTLEMENT_PERFORMED_2025",
        20,
        "LOCAL_NONGHYUP_AUDIT_COUNT_2025",
        20,
      ),
    ];
    for (const profile of profiles) {
      assert.equal(validateNhAuditCustomerWeightsV2(profile).success, true);
    }
  });

  it("rejects every criterion outside its allowed range", () => {
    for (
      const [criterionId, limits] of
      Object.entries(NH_AUDIT_QUALITY_WEIGHT_LIMITS)
    ) {
      for (const invalid of [limits.minimum - 1, limits.maximum + 1]) {
        const value = createDefaultNhAuditCustomerWeightsV2();
        value.qualityCriterionWeights[
          criterionId as NhAuditQualityCriterionId
        ] = invalid;
        assert.equal(
          validateNhAuditCustomerWeightsV2(value).success,
          false,
          `${criterionId}:${invalid}`,
        );
      }
    }
  });

  it("rejects quality criterion totals of 99 and 101", () => {
    const ninetyNine = createDefaultNhAuditCustomerWeightsV2();
    ninetyNine.qualityCriterionWeights
      .AUDITED_NONGHYUP_TYPE_DIVERSITY_2025 = 9;
    assert.equal(
      validateNhAuditCustomerWeightsV2(ninetyNine).success,
      false,
    );
    const oneHundredOne = createDefaultNhAuditCustomerWeightsV2();
    oneHundredOne.qualityCriterionWeights
      .AUDITED_NONGHYUP_TYPE_DIVERSITY_2025 = 11;
    assert.equal(
      validateNhAuditCustomerWeightsV2(oneHundredOne).success,
      false,
    );
  });

  it("keeps fixed recognition rates when customer weights change", () => {
    const quote = submission({
      localNonghyupAuditCount2025: 40,
      certifiedPublicAccountantCount: 16,
      accountingFirmRevenueWon: "8000000001",
    });
    const base = quality(quote);
    const adjusted = calculateNhAuditQualityScoreV2(
      quote,
      criterionWeightPair(
        "LOCAL_NONGHYUP_AUDIT_COUNT_2025",
        40,
        "CERTIFIED_PUBLIC_ACCOUNTANT_COUNT",
        10,
      ),
    );
    assert.deepEqual(
      base.criteria.map(({ recognitionRateBasisPoints }) =>
        recognitionRateBasisPoints
      ),
      adjusted.criteria.map(({ recognitionRateBasisPoints }) =>
        recognitionRateBasisPoints
      ),
    );
  });
});

describe("NH audit eligibility, price, composite score, and ranking", () => {
  it("marks an audit group ineligible even with maximum quality inputs", () => {
    const [result] = evaluate([
      candidate("audit-group", rawSubmission({ proposerType: "AUDIT_GROUP" })),
    ]);
    assert.equal(result.eligibilityStatus, "INELIGIBLE");
    assert.deepEqual(result.reasonCodes, ["AUDIT_GROUP_PROPOSER"]);
    assert.deepEqual(result.quality?.qualityScore, score(100));
    assert.equal(result.priceBaseScore, null);
    assert.equal(result.rank, null);
  });

  it("does not let an administratively excluded low quote set the minimum", () => {
    const results = evaluate([
      candidate("excluded-low", rawSubmission({ auditFeeWon: "100" }), {
        administrativelyExcluded: true,
      }),
      candidate("eligible-low", rawSubmission({ auditFeeWon: "200" })),
      candidate("eligible-high", rawSubmission({ auditFeeWon: "300" })),
    ]);
    const excluded = byId(results, "excluded-low");
    const low = byId(results, "eligible-low");
    const high = byId(results, "eligible-high");
    assert.equal(excluded.eligibilityStatus, "EXCLUDED");
    assert.deepEqual(low.priceBaseScore, score(100));
    assert.deepEqual(high.priceBaseScore, {
      numerator: "200",
      denominator: "3",
    });
  });

  it("excludes audit groups and server-validation failures from the price pool", () => {
    const results = evaluate([
      candidate("audit-group-low", rawSubmission({
        proposerType: "AUDIT_GROUP",
        auditFeeWon: "10",
      })),
      candidate("invalid-low", {
        ...rawSubmission({ auditFeeWon: "20" }),
        clientCalculatedScore: 100,
      }),
      candidate("eligible", rawSubmission({ auditFeeWon: "100" })),
    ]);
    assert.equal(
      byId(results, "audit-group-low").eligibilityStatus,
      "INELIGIBLE",
    );
    assert.equal(byId(results, "invalid-low").eligibilityStatus, "EXCLUDED");
    assert.deepEqual(
      byId(results, "invalid-low").reasonCodes,
      ["SERVER_VALIDATION_FAILED"],
    );
    assert.deepEqual(byId(results, "eligible").priceBaseScore, score(100));
    assert.deepEqual(
      results.map((result) => result.candidateId),
      ["eligible", "invalid-low", "audit-group-low"],
    );
    assert.equal(byId(results, "audit-group-low").rank, null);
  });

  it("calculates the default weighted composite without intermediate rounding", () => {
    const results = evaluate([
      candidate("full", rawSubmission({ auditFeeWon: "100" })),
      candidate("partial", rawSubmission({
        auditFeeWon: "200",
        localNonghyupAuditCount2025: 40,
      })),
    ]);
    assert.deepEqual(byId(results, "full").overallScore, score(100));
    assert.deepEqual(byId(results, "partial").quality?.qualityScore, score(85));
    assert.deepEqual(byId(results, "partial").priceBaseScore, score(50));
    assert.deepEqual(byId(results, "partial").overallScore, score(71));
  });

  it("ranks by exact values even when one-decimal display values match", () => {
    const results = evaluate([
      candidate("lowest", rawSubmission({ auditFeeWon: "100000" })),
      candidate("slightly-higher", rawSubmission({ auditFeeWon: "100010" })),
    ]);
    const lowest = byId(results, "lowest");
    const slightlyHigher = byId(results, "slightly-higher");
    assert.equal(formatExactScoreOneDecimal(lowest.overallScore!), "100.0");
    assert.equal(
      formatExactScoreOneDecimal(slightlyHigher.overallScore!),
      "100.0",
    );
    assert.equal(lowest.rank, 1);
    assert.equal(slightlyHigher.rank, 2);
  });

  it("applies the four required tie-break keys in order", () => {
    const keys: NhAuditRankKey[] = [
      rankKey("lower-quality-cheaper", score(90), score(79), "90", 10),
      rankKey("higher-quality", score(90), score(80), "100", 10),
      rankKey("same-quality-higher-cost", score(90), score(79), "100", 20),
      rankKey("same-cost-more-audits", score(90), score(79), "100", 30),
    ];
    assert.deepEqual(
      keys.sort(compareNhAuditRankKeysV2).map(({ candidateId }) => candidateId),
      [
        "higher-quality",
        "lower-quality-cheaper",
        "same-cost-more-audits",
        "same-quality-higher-cost",
      ],
    );
  });

  it("assigns the same competition rank only after all tie-breaks match", () => {
    const results = evaluate([
      candidate("same-a", rawSubmission()),
      candidate("same-b", rawSubmission({ submissionId: "submission-b" })),
    ]);
    assert.equal(byId(results, "same-a").rank, 1);
    assert.equal(byId(results, "same-b").rank, 1);
    assert.deepEqual(byId(results, "same-a").tiedWithCandidateIds, ["same-b"]);
  });

  it("keeps legacy missing-data submissions as resubmission-required, not zero", () => {
    const [result] = evaluate([
      prepareNhAuditCandidateV2({
        candidateId: "legacy",
        source: "LEGACY_DOCUMENT",
        rawSubmission: {
          proposerType: "ACCOUNTING_FIRM",
          quoteRequestId: "request-1",
        },
      }),
    ]);
    assert.equal(result.eligibilityStatus, "RESUBMISSION_REQUIRED");
    assert.equal(result.quality, null);
    assert.equal(result.priceBaseScore, null);
    assert.equal(result.overallScore, null);
    assert.equal(result.rank, null);
    assert.ok(result.missingFields.includes("certifiedPublicAccountantCount"));
  });

  it("excludes a validated zero-total quote from price and ranking", () => {
    const results = evaluate([
      candidate("zero", rawSubmission({ auditFeeWon: "0" })),
      candidate("positive", rawSubmission({ auditFeeWon: "100" })),
    ]);
    assert.equal(byId(results, "zero").eligibilityStatus, "EXCLUDED");
    assert.deepEqual(
      byId(results, "zero").reasonCodes,
      ["NON_POSITIVE_TOTAL_BURDEN"],
    );
    assert.deepEqual(byId(results, "positive").priceBaseScore, score(100));
  });

  it("penalizes quality only for every 저가부실수임 firm and caps price at the clean eligible maximum", () => {
    const results = evaluateNhAuditQuoteCandidatesV2(
      [
        candidate("low", rawSubmission({ auditFeeWon: "7500000" })),
        candidate("second", rawSubmission({ auditFeeWon: "7700000" })),
        candidate("high", rawSubmission({ auditFeeWon: "8500000" })),
      ],
      createDefaultNhAuditCustomerWeightsV2(),
      { safePriceMinWon: "7600000" },
    );
    const low = byId(results, "low");
    const second = byId(results, "second");
    const high = byId(results, "high");
    const cleanPriceCap = {
      numerator: "7500",
      denominator: "77",
    };
    assert.deepEqual(low.priceBaseScore, cleanPriceCap);
    assert.deepEqual(low.quality?.qualityScore, {
      numerator: "1780",
      denominator: "19",
    });
    assert.deepEqual(low.overallScore, {
      numerator: "139236",
      denominator: "1463",
    });
    assert.deepEqual(second.priceBaseScore, cleanPriceCap);
    assert.deepEqual(second.quality?.qualityScore, score(100));
    assert.deepEqual(high.priceBaseScore, {
      numerator: "1500",
      denominator: "17",
    });
    assert.equal(second.rank, 1);
    assert.ok((low.rank ?? 0) > 1);
  });

  it("applies a larger quality-only penalty when the quote is farther below 안전마진", () => {
    const results = evaluateNhAuditQuoteCandidatesV2(
      [
        candidate("low-a", rawSubmission({ auditFeeWon: "7500000" })),
        candidate("low-b", rawSubmission({ auditFeeWon: "7550000" })),
        candidate("clean", rawSubmission({ auditFeeWon: "8500000" })),
      ],
      createDefaultNhAuditCustomerWeightsV2(),
      { safePriceMinWon: "7600000" },
    );
    const lowA = byId(results, "low-a");
    const lowB = byId(results, "low-b");
    const clean = byId(results, "clean");
    const cleanPriceCap = {
      numerator: "1500",
      denominator: "17",
    };
    assert.deepEqual(lowA.priceBaseScore, cleanPriceCap);
    assert.deepEqual(lowA.quality?.qualityScore, {
      numerator: "1780",
      denominator: "19",
    });
    assert.deepEqual(lowB.priceBaseScore, cleanPriceCap);
    assert.deepEqual(lowB.quality?.qualityScore, score(95));
    assert.deepEqual(clean.priceBaseScore, cleanPriceCap);
    assert.deepEqual(clean.quality?.qualityScore, score(100));
  });

  it("does not pull other firms down when a 저가부실수임 quote is far below 안전마진", () => {
    const results = evaluateNhAuditQuoteCandidatesV2(
      [
        candidate("low", rawSubmission({ auditFeeWon: "10000000" })),
        candidate("second", rawSubmission({ auditFeeWon: "12000000" })),
      ],
      createDefaultNhAuditCustomerWeightsV2(),
      { safePriceMinWon: "11300000" },
    );
    const low = byId(results, "low");
    const cleanPriceCap = {
      numerator: "280",
      denominator: "3",
    };
    assert.deepEqual(low.priceBaseScore, cleanPriceCap);
    assert.deepEqual(low.quality?.qualityScore, {
      numerator: "9435",
      denominator: "113",
    });
    assert.deepEqual(low.overallScore, {
      numerator: "29639",
      denominator: "339",
    });
    assert.deepEqual(byId(results, "second").priceBaseScore, cleanPriceCap);
    assert.deepEqual(byId(results, "second").quality?.qualityScore, score(100));
  });

  it("caps the 저가부실수임 quality penalty at 80% and the price score at the clean maximum", () => {
    const results = evaluateNhAuditQuoteCandidatesV2(
      [
        candidate("low", rawSubmission({ auditFeeWon: "1000000" })),
        candidate("second", rawSubmission({ auditFeeWon: "12000000" })),
      ],
      createDefaultNhAuditCustomerWeightsV2(),
      { safePriceMinWon: "11300000" },
    );
    const low = byId(results, "low");
    const cleanPriceCap = {
      numerator: "280",
      denominator: "3",
    };
    assert.deepEqual(low.priceBaseScore, cleanPriceCap);
    assert.deepEqual(low.quality?.qualityScore, score(20));
    assert.deepEqual(low.overallScore, {
      numerator: "148",
      denominator: "3",
    });
    assert.deepEqual(byId(results, "second").priceBaseScore, cleanPriceCap);
  });

  it("uses 최저안전마진 minus 10만원 as the price full-score reference", () => {
    const results = evaluateNhAuditQuoteCandidatesV2(
      [
        candidate("at-reference", rawSubmission({ auditFeeWon: "7500000" })),
        candidate("at-safe-min", rawSubmission({ auditFeeWon: "7600000" })),
      ],
      createDefaultNhAuditCustomerWeightsV2(),
      { safePriceMinWon: "7600000" },
    );
    const cleanPriceCap = {
      numerator: "1875",
      denominator: "19",
    };
    assert.deepEqual(
      byId(results, "at-reference").priceBaseScore,
      cleanPriceCap,
    );
    assert.deepEqual(byId(results, "at-safe-min").priceBaseScore, cleanPriceCap);
  });
});

function rawSubmission(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 2,
    submissionId: "submission-a",
    quoteRequestId: "request-a",
    targetCooperative: {
      id: "cooperative-a",
      name: "테스트 농협",
    },
    fiscalYear: 2025,
    partnerAccountId: "partner-account-a",
    accountingFirmName: "테스트 회계법인",
    engagementPartnerName: "책임회계사",
    proposerType: "ACCOUNTING_FIRM",
    auditFeeWon: "100000000",
    expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
    expectedExpenseWon: "0",
    localNonghyupAuditCount2025: 50,
    certifiedPublicAccountantCount: 20,
    accountingFirmRevenueWon: "10000000001",
    auditedNonghyupTypes2025: [
      "LOCAL_AGRICULTURAL_COOPERATIVE",
      "LOCAL_LIVESTOCK_COOPERATIVE",
      "ITEM_AGRICULTURAL_OR_LIVESTOCK_COOPERATIVE",
      "GINSENG_COOPERATIVE",
    ],
    nonghyupTaxAgencyPerformed2025: true,
    nonghyupSubsidySettlementPerformed2025: true,
    factsConfirmed: true,
    submittedAt: "2026-07-22T12:00:00.000Z",
    ...overrides,
  };
}

function submission(
  overrides: Record<string, unknown> = {},
): NhAuditQuoteSubmissionV2 {
  return nhAuditQuoteSubmissionV2Schema.parse(rawSubmission(overrides));
}

function quality(value: NhAuditQuoteSubmissionV2) {
  return calculateNhAuditQualityScoreV2(
    value,
    createDefaultNhAuditCustomerWeightsV2(),
  );
}

function criterion(
  result: ReturnType<typeof quality>,
  criterionId: NhAuditQualityCriterionId,
) {
  const value = result.criteria.find((item) =>
    item.criterionId === criterionId
  );
  if (!value) assert.fail(`Missing criterion: ${criterionId}`);
  return value;
}

function candidate(
  candidateId: string,
  raw: unknown,
  options: { administrativelyExcluded?: boolean } = {},
) {
  return prepareNhAuditCandidateV2({
    candidateId,
    source: "V2_SUBMISSION",
    rawSubmission: raw,
    ...options,
  });
}

function evaluate(
  candidates: ReturnType<typeof prepareNhAuditCandidateV2>[],
  customerWeights = createDefaultNhAuditCustomerWeightsV2(),
) {
  return evaluateNhAuditQuoteCandidatesV2(candidates, customerWeights);
}

function byId(
  results: ReturnType<typeof evaluate>,
  candidateId: string,
) {
  const result = results.find((item) => item.candidateId === candidateId);
  if (!result) assert.fail(`Missing candidate: ${candidateId}`);
  return result;
}

function weights(input: { quality: number }): NhAuditCustomerWeightsV2 {
  return {
    qualityWeightPercent: input.quality,
    priceWeightPercent: 100 - input.quality,
    qualityCriterionWeights: {
      ...NH_AUDIT_DEFAULT_CUSTOMER_WEIGHTS.qualityCriterionWeights,
    },
  };
}

function criterionWeightPair(
  firstId: NhAuditQualityCriterionId,
  firstValue: number,
  secondId: NhAuditQualityCriterionId,
  secondValue: number,
): NhAuditCustomerWeightsV2 {
  const value = createDefaultNhAuditCustomerWeightsV2();
  value.qualityCriterionWeights[firstId] = firstValue;
  value.qualityCriterionWeights[secondId] = secondValue;
  return value;
}

function score(value: number): ExactScore {
  return { numerator: String(value), denominator: "1" };
}

function rankKey(
  candidateId: string,
  overallScore: ExactScore,
  qualityScore: ExactScore,
  expectedTotalBurdenWon: string,
  localNonghyupAuditCount2025: number,
): NhAuditRankKey {
  return {
    candidateId,
    overallScore,
    qualityScore,
    expectedTotalBurdenWon:
      expectedTotalBurdenWon as NhAuditRankKey["expectedTotalBurdenWon"],
    localNonghyupAuditCount2025,
  };
}
