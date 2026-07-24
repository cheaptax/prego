import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDefaultAuditQualityDraft } from "@/lib/audit-evaluation/default-evaluation-draft";
import { normalizeWonAmount } from "@/lib/audit-evaluation/money";
import {
  QualityScoringError,
  runDeterministicQualityScoring,
} from "@/lib/audit-evaluation/scoring-engine";
import { evaluationConfigSchema } from "@/lib/audit-evaluation/schemas";
import { createEvaluationConfigSnapshot } from "@/lib/audit-evaluation/snapshots";
import type {
  EvaluationConfig,
  NormalizedAuditQuote,
} from "@/lib/audit-evaluation/types";
import { createTrustedStandardQuotePayload } from "@/lib/audit-evaluation/testing/fixtures";

const NOW = "2026-07-21T00:00:00.000Z";

describe("deterministic quality scoring", () => {
  it("keeps the proposed criteria as an unpublished incomplete draft", () => {
    const draft = createDefaultAuditQualityDraft({
      createdBy: "admin-test",
      createdAt: NOW,
    });
    assert.equal(draft.status, "DRAFT");
    assert.equal(draft.publishedAt, null);
    assert.deepEqual(
      draft.criteria.map(({ weightBasisPoints }) => weightBasisPoints),
      [4_000, 2_000, 2_000, 1_000, 1_000],
    );
    assert.equal(
      draft.criteria
        .filter(({ rule }) => rule.type === "checklist")
        .every(({ rule }) =>
          rule.type === "checklist" && rule.items.length === 0
        ),
      true,
    );
    assert.equal(
      evaluationConfigSchema.safeParse({
        ...draft,
        status: "PUBLISHED",
        publishedBy: "admin-test",
        publishedAt: NOW,
      }).success,
      false,
    );
  });

  it("uses explicit inclusive and exclusive boundaries for every count threshold", () => {
    const config = publishedConfig();
    const cases = [
      [9, 0, "recentNonghyupAuditCount.band-1"],
      [10, 600, "recentNonghyupAuditCount.band-2"],
      [11, 600, "recentNonghyupAuditCount.band-2"],
      [29, 600, "recentNonghyupAuditCount.band-2"],
      [30, 3_000, "recentNonghyupAuditCount.band-3"],
      [31, 3_000, "recentNonghyupAuditCount.band-3"],
      [49, 3_000, "recentNonghyupAuditCount.band-3"],
      [50, 6_000, "recentNonghyupAuditCount.band-4"],
      [51, 6_000, "recentNonghyupAuditCount.band-4"],
    ] as const;
    for (const [count, expectedRaw, bandId] of cases) {
      const result = runDeterministicQualityScoring(config, [
        quote("quote-boundary", {
          recentNonghyupAuditCount: count,
          auditedNonghyupTypes: [],
        }),
      ]);
      const criterion = criterionById(
        result.quotes[0],
        "nonghyup-audit-performance",
      );
      assert.equal(criterion.rawScoreBasisPoints, expectedRaw, String(count));
      assert.ok(
        criterion.appliedThresholds.some(({ ruleId }) => ruleId === bandId),
        String(count),
      );
    }
  });

  it("uses explicit boundaries for diversity and won-normalized revenue", () => {
    const config = publishedConfig();
    const diversityCases = [
      [1, 0],
      [2, 400],
      [3, 2_000],
      [4, 4_000],
      [5, 4_000],
    ] as const;
    for (const [count, expectedRaw] of diversityCases) {
      const result = runDeterministicQualityScoring(config, [
        quote("quote-diversity", {
          recentNonghyupAuditCount: 0,
          auditedNonghyupTypes: Array.from(
            { length: count },
            (_, index) => `농협-${index}`,
          ),
        }),
      ]);
      assert.equal(
        criterionById(
          result.quotes[0],
          "nonghyup-audit-performance",
        ).rawScoreBasisPoints,
        expectedRaw,
      );
    }

    const revenueCases = [
      ["2999999999", 0],
      ["3000000000", 3_000],
      ["3000000001", 3_000],
      ["4999999999", 3_000],
      ["5000000000", 5_000],
      ["5000000001", 5_000],
      ["9999999999", 5_000],
      ["10000000000", 10_000],
      ["10000000001", 10_000],
    ] as const;
    for (const [won, expectedRaw] of revenueCases) {
      const result = runDeterministicQualityScoring(config, [
        quote("quote-revenue", {
          accountingFirmRevenue: normalizeWonAmount(won),
        }),
      ]);
      assert.equal(
        criterionById(
          result.quotes[0],
          "accounting-firm-scale",
        ).rawScoreBasisPoints,
        expectedRaw,
        won,
      );
    }
  });

  it("produces exact maximum and zero quality scores", () => {
    const config = publishedConfig();
    const maximum = runDeterministicQualityScoring(config, [
      quote("quote-max", {
        recentNonghyupAuditCount: 50,
        auditedNonghyupTypes: ["1", "2", "3", "4"],
        accountingFirmRevenue: normalizeWonAmount("10000000000"),
      }),
    ]);
    assert.equal(maximum.quotes[0].totalScoreBasisPoints, 10_000);

    const zero = runDeterministicQualityScoring(config, [
      quote("quote-zero", {
        recentNonghyupAuditCount: 0,
        auditedNonghyupTypes: [],
        taxAgencyExperience: { hasExperience: false, descriptions: [] },
        subsidySettlementExperience: {
          hasExperience: false,
          descriptions: [],
        },
        engagementPartner: null,
        engagementTeam: [],
        totalPlannedHours: null,
        auditSchedule: [],
        accountingFirmRevenue: normalizeWonAmount("0"),
        requiredProposalItems: {
          independence: { present: false, value: null },
        },
      }),
    ]);
    assert.equal(zero.quotes[0].totalScoreBasisPoints, 0);
  });

  it("records missing information and equal-score competition ranks", () => {
    const config = publishedConfig();
    const first = quote("quote-a");
    const second = quote("quote-b");
    const lower = quote("quote-c", {
      recentNonghyupAuditCount: null,
      missingFields: ["recentNonghyupAuditCount"],
    });
    const result = runDeterministicQualityScoring(
      config,
      [lower, second, first],
    );
    assert.deepEqual(
      result.quotes.map(({ quoteId }) => quoteId),
      ["quote-a", "quote-b", "quote-c"],
    );
    assert.equal(result.quotes[0].rank, 1);
    assert.equal(result.quotes[1].rank, 1);
    assert.equal(result.quotes[2].rank, 3);
    assert.deepEqual(result.quotes[0].tiedWithQuoteIds, ["quote-b"]);
    assert.deepEqual(result.tieBreaksApplied, []);
    assert.ok(
      result.quotes[2].missingInformation.includes(
        "recentNonghyupAuditCount",
      ),
    );
  });

  it("rejects non-100-point and fee-scoring configurations", () => {
    const invalidWeight = publishedConfig();
    invalidWeight.criteria[0].weightBasisPoints = 3_999;
    assert.throws(
      () => runDeterministicQualityScoring(invalidWeight, [quote("quote-a")]),
      (error: unknown) =>
        error instanceof QualityScoringError &&
        error.code === "invalid_evaluation_config",
    );

    const feeScoring = publishedConfig();
    feeScoring.criteria[0].rule = {
      type: "threshold",
      field: "auditFee",
      operator: "GTE",
      threshold: { kind: "DECIMAL_STRING", value: "1" },
    };
    assert.equal(evaluationConfigSchema.safeParse(feeScoring).success, false);
  });

  it("is deterministic and quality scores never depend on audit fees", () => {
    const config = publishedConfig();
    const lowFee = quote("quote-a", {
      auditFee: normalizeWonAmount("10000000"),
    });
    const highFee = quote("quote-b", {
      auditFee: normalizeWonAmount("999999999"),
    });
    const first = runDeterministicQualityScoring(config, [highFee, lowFee]);
    const repeated = runDeterministicQualityScoring(config, [lowFee, highFee]);
    assert.deepEqual(first, repeated);
    assert.equal(
      first.quotes[0].totalScoreBasisPoints,
      first.quotes[1].totalScoreBasisPoints,
    );
  });

  it("keeps an old config snapshot immutable after a version change", () => {
    const config = publishedConfig();
    const snapshot = createEvaluationConfigSnapshot(config);
    const input = [quote("quote-a", { recentNonghyupAuditCount: 50 })];
    const oldResult = runDeterministicQualityScoring(snapshot, input);

    config.version = 2;
    const performance = config.criteria.find(
      ({ id }) => id === "nonghyup-audit-performance",
    );
    if (!performance || performance.rule.type !== "weighted-subcriteria") {
      assert.fail("missing performance criterion");
    }
    const countRule = performance.rule.subcriteria[0].rule;
    if (countRule.type !== "range") assert.fail("missing count range");
    countRule.bands.at(-1)!.scoreBasisPoints = 0;
    const newResult = runDeterministicQualityScoring(config, input);
    assert.notEqual(
      oldResult.quotes[0].totalScoreBasisPoints,
      newResult.quotes[0].totalScoreBasisPoints,
    );
    assert.deepEqual(
      runDeterministicQualityScoring(snapshot, input),
      oldResult,
    );
  });
});

function publishedConfig(): EvaluationConfig {
  const config = createDefaultAuditQualityDraft({
    createdBy: "admin-test",
    createdAt: NOW,
  });
  const plan = config.criteria.find(
    ({ id }) => id === "audit-plan-and-staffing",
  );
  if (!plan || plan.rule.type !== "checklist") {
    throw new Error("missing plan checklist");
  }
  plan.rule.items = [
    {
      id: "partner",
      label: "책임회계사",
      required: true,
      scoreBasisPoints: 2_500,
      condition: { type: "FIELD_PRESENT", field: "engagementPartner" },
    },
    {
      id: "team",
      label: "투입인력",
      required: true,
      scoreBasisPoints: 2_500,
      condition: { type: "FIELD_PRESENT", field: "engagementTeam" },
    },
    {
      id: "hours",
      label: "총 투입시간",
      required: true,
      scoreBasisPoints: 2_500,
      condition: {
        type: "MINIMUM_INTEGER",
        field: "totalPlannedHours",
        minimum: 1,
      },
    },
    {
      id: "schedule",
      label: "감사 일정",
      required: true,
      scoreBasisPoints: 2_500,
      condition: { type: "FIELD_PRESENT", field: "auditSchedule" },
    },
  ];
  const proposal = config.criteria.find(
    ({ id }) => id === "proposal-completeness",
  );
  if (!proposal || proposal.rule.type !== "checklist") {
    throw new Error("missing proposal checklist");
  }
  proposal.rule.items = [
    {
      id: "independence",
      label: "독립성 확인",
      required: true,
      scoreBasisPoints: 10_000,
    },
  ];
  config.status = "PUBLISHED";
  config.publishedBy = "admin-test";
  config.publishedAt = NOW;
  return evaluationConfigSchema.parse(config);
}

function quote(
  quoteId: string,
  overrides: Partial<NormalizedAuditQuote> = {},
): NormalizedAuditQuote {
  return {
    quoteId,
    caseId: "case-score",
    documentId: `document-${quoteId}`,
    ...createTrustedStandardQuotePayload(),
    accountingFirmId: `firm-${quoteId}`,
    accountingFirmName: `${quoteId} 회계법인`,
    recentNonghyupAuditCount: 50,
    auditedNonghyupTypes: ["1", "2", "3", "4"],
    accountingFirmRevenue: normalizeWonAmount("10000000000"),
    missingFields: [],
    warnings: [],
    confidenceByField: {},
    evidenceByField: {},
    source: {},
    confirmedByCustomer: true,
    confirmedAt: NOW,
    ...overrides,
  };
}

function criterionById(
  quoteResult: ReturnType<typeof runDeterministicQualityScoring>["quotes"][number],
  id: string,
) {
  const criterion = quoteResult.criteria.find(
    ({ criterionId }) => criterionId === id,
  );
  if (!criterion) throw new Error(`missing criterion ${id}`);
  return criterion;
}
