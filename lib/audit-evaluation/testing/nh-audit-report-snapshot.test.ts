import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildNhAuditReportEvaluationSnapshot,
  nhAuditReportEvaluationSnapshotSchema,
  nhAuditReportPreviewFromSnapshot,
  nhAuditSnapshotNeedsRegeneration,
} from "@/lib/audit-evaluation/nh-audit-report-snapshot";
import { formatExactScoreOneDecimal } from "@/lib/audit-evaluation/nh-audit-v2-engine";
import {
  createDefaultNhAuditCustomerWeightsV2,
  validateNhAuditCustomerWeightsV2,
} from "@/lib/audit-evaluation/nh-audit-v2-schemas";
import type { NhAuditCustomerWeightsV2 } from "@/lib/audit-evaluation/nh-audit-v2-types";
import { extractPdfText } from "@/lib/audit-evaluation/pdf-text-extractor";
import { renderAuditEvaluationReportPdf } from "@/lib/audit-evaluation/report-pdf";
import {
  buildDeterministicReportViewModel,
  rebuildNhAuditReportViewModel,
} from "@/lib/audit-evaluation/report-view-model";
import {
  createReportFixture,
  REPORT_FIXTURE_NOW,
} from "@/lib/audit-evaluation/testing/report-fixtures";
import type {
  QuoteRecord,
  QuoteRequestRecord,
} from "@/lib/firebase/schema";
import { buildAdminNhAuditQuoteView } from "@/lib/quotes/nh-audit-admin-view";
import {
  buildTrustedNhAuditSubmissionV2,
  createNhAuditEvaluationSnapshotV2,
} from "@/lib/quotes/nh-audit-quote-server";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const NOW = "2026-07-23T00:00:00.000Z";

function quote(
  id: string,
  overrides: Record<string, unknown> = {},
  auditFeeWon = "10000000",
  accountingFirmName = `회계법인 ${id}`,
) {
  const trusted = buildTrustedNhAuditSubmissionV2(
    {
      engagementPartnerName: "홍길동",
      proposerType: "ACCOUNTING_FIRM",
      auditFeeWon,
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
      ...overrides,
    },
    {
      submissionId: id,
      quoteRequestId: "request-a",
      targetCooperativeId: "coop-a",
      targetCooperativeName: "프리고농협",
      fiscalYear: 2026,
      partnerAccountId: `account-${id}`,
      accountingFirmName,
      submittedAt: NOW,
    },
  );
  assert.equal(trusted.success, true);
  if (!trusted.success) throw new Error("fixture_validation_failed");
  return {
    id,
    quoteRequestId: "request-a",
    quoteAssignmentId: `assignment-${id}`,
    partnerId: `partner-${id}`,
    partnerName: trusted.submission.accountingFirmName,
    status: "delivered",
    version: 1,
    nhAuditV2: createNhAuditEvaluationSnapshotV2(
      trusted.submission,
      NOW,
    ),
  } as QuoteRecord;
}

function build(
  quotes: QuoteRecord[],
  weights: unknown = createDefaultNhAuditCustomerWeightsV2(),
) {
  return buildNhAuditReportEvaluationSnapshot({
    reportId: "case-a_v1",
    evaluationId: "case-a",
    quoteRequestId: "request-a",
    customerId: "customer-a",
    quotes,
    weights,
    now: NOW,
  });
}

describe("NH audit report-specific evaluation snapshot", () => {
  it("regenerates the report when quote fees change even if weights stay the same", () => {
    const first = build([quote("a"), quote("b", {}, "20000000")]);
    const second = build([quote("a"), quote("b", {}, "15000000")]);
    assert.equal(nhAuditSnapshotNeedsRegeneration(first, first), false);
    assert.equal(nhAuditSnapshotNeedsRegeneration(first, second), true);
  });

  it("marks quotes below 최저안전가격 as 저가부실수임 우려", () => {
    const snapshot = buildNhAuditReportEvaluationSnapshot({
      reportId: "case-a_v1",
      evaluationId: "case-a",
      quoteRequestId: "request-a",
      customerId: "customer-a",
      quotes: [
        quote("safe", {}, "12500000"),
        quote("samduk", {}, "12000000"),
        quote("low", {}, "10000000"),
      ],
      weights: createDefaultNhAuditCustomerWeightsV2(),
      now: NOW,
      safePriceMinWon: "11300000",
    });
    assert.equal(
      snapshot.quoteResults.find((result) => result.quoteId === "safe")
        ?.lowPriceEngagementRisk,
      undefined,
    );
    assert.equal(
      snapshot.quoteResults.find((result) => result.quoteId === "samduk")
        ?.lowPriceEngagementRisk,
      undefined,
    );
    assert.equal(
      snapshot.quoteResults.find((result) => result.quoteId === "low")
        ?.lowPriceEngagementRisk,
      true,
    );
    assert.equal(
      snapshot.quoteResults.find((result) => result.quoteId === "low")
        ?.eligibilityStatus,
      "ELIGIBLE",
    );
    const fixture = createReportFixture();
    const viewModel = buildDeterministicReportViewModel({
      reportRun: {
        ...fixture.reportRun,
        nhAuditEvaluationSnapshot: snapshot,
      },
      evaluationCase: fixture.evaluationCase,
      corrections: [],
      generatedAt: REPORT_FIXTURE_NOW,
    });
    const comparison = viewModel.sections
      .flatMap(({ blocks }) => blocks)
      .find(({ id }) => id === "nh-audit-composite-comparison-rank");
    assert.equal(comparison?.type, "TABLE");
    if (comparison?.type === "TABLE") {
      assert.deepEqual(comparison.columns, [
        "순위",
        "회계법인명",
        "적격여부",
        "담당회계사",
        "예상 총부담액",
        "최종 종합점수",
      ]);
      const lowRow = comparison.rows.find((row) =>
        row.some((cell) => cell.includes("회계법인 low")),
      );
      const safeRow = comparison.rows.find((row) =>
        row.some((cell) => cell.includes("회계법인 safe")),
      );
      assert.equal(lowRow?.[2], "우려");
      assert.equal(safeRow?.[2], "적격");
    }
    assert.equal(
      viewModel.sections.find(({ id }) => id === "fee-analysis")?.title,
      "감사보수 분석",
    );
    assert.equal(
      viewModel.sections.find(({ id }) => id === "firm-review")?.title,
      "부적격·우려 견적 내역",
    );
    const excluded = viewModel.sections
      .flatMap(({ blocks }) => blocks)
      .find(({ id }) => id === "nh-audit-excluded-quotes");
    assert.equal(excluded?.type, "TABLE");
    if (excluded?.type === "TABLE") {
      assert.equal(excluded.title, "평가제외·부적격·우려·재제출 필요 견적");
      const listedLow = excluded.rows.find((row) =>
        row.some((cell) => cell.includes("회계법인 low")),
      );
      const listedSafe = excluded.rows.find((row) =>
        row.some((cell) => cell.includes("회계법인 safe")),
      );
      assert.deepEqual(listedLow?.slice(0, 4), [
        "회계법인 low",
        "회계법인",
        "우려",
        "저가부실수임 우려",
      ]);
      assert.equal(listedSafe, undefined);
    }
  });

  it("applies the 저가부실수임 quality-score penalty before ranking", () => {
    const snapshot = buildNhAuditReportEvaluationSnapshot({
      reportId: "case-a_v1",
      evaluationId: "case-a",
      quoteRequestId: "request-a",
      customerId: "customer-a",
      quotes: [
        quote("low", {}, "7500000"),
        quote("second", {}, "7700000"),
      ],
      weights: createDefaultNhAuditCustomerWeightsV2(),
      now: NOW,
      safePriceMinWon: "7600000",
    });
    const low = snapshot.quoteResults.find((result) => result.quoteId === "low");
    const second = snapshot.quoteResults.find(
      (result) => result.quoteId === "second",
    );
    assert.equal(low?.lowPriceEngagementRisk, true);
    assert.deepEqual(low?.priceBaseScore, {
      numerator: "7500",
      denominator: "77",
    });
    assert.deepEqual(low?.qualityScore, {
      numerator: "1780",
      denominator: "19",
    });
    assert.deepEqual(low?.overallScore, {
      numerator: "139236",
      denominator: "1463",
    });
    assert.equal(second?.lowPriceEngagementRisk, undefined);
    assert.deepEqual(second?.priceBaseScore, {
      numerator: "7500",
      denominator: "77",
    });
    assert.deepEqual(second?.qualityScore, {
      numerator: "100",
      denominator: "1",
    });
  });

  it("stores default 60/40 weights and a reproducible server result", () => {
    const snapshot = build([quote("a"), quote("b", {}, "20000000")]);
    assert.equal(snapshot.weights.qualityWeightPercent, 60);
    assert.equal(snapshot.weights.priceWeightPercent, 40);
    assert.equal(
      Object.values(snapshot.weights.qualityCriterionWeights).reduce(
        (sum, value) => sum + value,
        0,
      ),
      100,
    );
    assert.equal(snapshot.usesDefaultWeights, true);
    assert.equal(snapshot.quoteResults[0].rank, 1);
    assert.equal(snapshot.quoteResults[1].rank, 2);

    const restored = nhAuditReportEvaluationSnapshotSchema.parse(
      JSON.parse(JSON.stringify(snapshot)),
    );
    assert.deepEqual(
      nhAuditReportPreviewFromSnapshot(restored),
      nhAuditReportPreviewFromSnapshot(snapshot),
    );
  });

  it("keeps fixed recognition rates when customer criterion weights change", () => {
    const weights: NhAuditCustomerWeightsV2 = {
      qualityWeightPercent: 80,
      priceWeightPercent: 20,
      qualityCriterionWeights: {
        LOCAL_NONGHYUP_AUDIT_COUNT_2025: 40,
        CERTIFIED_PUBLIC_ACCOUNTANT_COUNT: 10,
        ACCOUNTING_FIRM_REVENUE: 20,
        AUDITED_NONGHYUP_TYPE_DIVERSITY_2025: 10,
        NONGHYUP_TAX_AGENCY_PERFORMED_2025: 10,
        NONGHYUP_SUBSIDY_SETTLEMENT_PERFORMED_2025: 10,
      },
    };
    const result = build([
      quote("custom", { localNonghyupAuditCount2025: 40 }),
    ], weights).quoteResults[0];
    const auditCount = result.criteria.find(
      ({ criterionId }) =>
        criterionId === "LOCAL_NONGHYUP_AUDIT_COUNT_2025",
    );
    assert.equal(auditCount?.recognitionRateBasisPoints, 5_000);
    assert.equal(auditCount?.weightPoints, 40);
    assert.deepEqual(auditCount?.earnedScore, {
      numerator: "20",
      denominator: "1",
    });
  });

  it("never admits audit groups or administrative exclusions to price ranking", () => {
    const auditGroup = quote(
      "audit-group",
      { proposerType: "AUDIT_GROUP" },
      "1000000",
    );
    const excluded = quote("excluded", {}, "500000");
    excluded.nhAuditV2!.eligibilityStatus = "EXCLUDED";
    excluded.nhAuditV2!.reasonCodes = ["ADMINISTRATIVELY_EXCLUDED"];
    const eligible = quote("eligible", {}, "10000000");
    const snapshot = build([auditGroup, excluded, eligible]);
    assert.deepEqual(snapshot.includedQuoteIds, ["eligible"]);
    assert.equal(
      snapshot.quoteResults.find(({ quoteId }) => quoteId === "eligible")
        ?.priceBaseScore?.numerator,
      "100",
    );
    assert.equal(
      snapshot.quoteResults.find(({ quoteId }) => quoteId === "audit-group")
        ?.rank,
      null,
    );
    assert.equal(
      snapshot.quoteResults.find(({ quoteId }) => quoteId === "excluded")
        ?.rank,
      null,
    );
  });

  it("includes a complete 비제휴 견적 in ranking instead of excluding it by id", () => {
    const partner = quote("eligible");
    const external = quote("external_complete", {}, "11000000");
    const snapshot = build([partner, external]);
    assert.ok(snapshot.includedQuoteIds.includes("external_complete"));
    assert.equal(
      snapshot.quoteResults.find(({ quoteId }) => quoteId === "external_complete")
        ?.eligibilityStatus,
      "ELIGIBLE",
    );
    assert.notEqual(
      snapshot.quoteResults.find(({ quoteId }) => quoteId === "external_complete")
        ?.rank,
      null,
    );
  });

  it("does not mutate source quotes or trust extra client score fields", () => {
    const quotes = [quote("immutable")];
    const before = structuredClone(quotes);
    const input = {
      reportId: "case-a_v1",
      evaluationId: "case-a",
      quoteRequestId: "request-a",
      customerId: "customer-a",
      quotes,
      weights: createDefaultNhAuditCustomerWeightsV2(),
      now: NOW,
      clientOverallScore: 999,
      clientRank: 999,
    };
    const snapshot = buildNhAuditReportEvaluationSnapshot(input);
    assert.deepEqual(quotes, before);
    assert.equal(snapshot.quoteResults[0].rank, 1);
    assert.notEqual(snapshot.quoteResults[0].overallScore?.numerator, "999");
  });

  it("feeds the stored snapshot into the shared web and PDF view model", () => {
    const fixture = createReportFixture();
    const sourceQuote = quote("report");
    const adminView = buildAdminNhAuditQuoteView(
      sourceQuote,
      {
        id: "request-a",
        sourceType: "audit_quote",
        cooperativeName: "프리고농협",
        fiscalYear: 2026,
      } as QuoteRequestRecord,
    );
    assert.ok(adminView);
    const snapshot = buildNhAuditReportEvaluationSnapshot({
      reportId: fixture.reportRun.id,
      evaluationId: fixture.evaluationCase.id,
      quoteRequestId: fixture.evaluationCase.quoteRequestId,
      customerId: "customer-a",
      quotes: [sourceQuote],
      weights: createDefaultNhAuditCustomerWeightsV2(),
      now: NOW,
    });
    const viewModel = buildDeterministicReportViewModel({
      reportRun: {
        ...fixture.reportRun,
        nhAuditEvaluationSnapshot: snapshot,
      },
      evaluationCase: fixture.evaluationCase,
      corrections: [],
      generatedAt: REPORT_FIXTURE_NOW,
    });
    const summary = viewModel.sections.find(
      ({ id }) => id === "executive-summary",
    );
    const detail = viewModel.sections.find(
      ({ id }) => id === "quantitative-evaluation",
    );
    assert.ok(summary);
    assert.ok(detail);
    assert.deepEqual(
      summary.blocks.map(({ id }) => id),
      [
        "nh-audit-final-result",
        "nh-audit-final-result-guidance",
        "nh-audit-report-summary",
        "nh-audit-weight-guidance",
      ],
    );
    assert.match(JSON.stringify(summary), /1위 회계법인/u);
    assert.match(JSON.stringify(summary), /최종 종합점수/u);
    assert.match(JSON.stringify(summary), /예상 총부담액/u);
    assert.match(
      JSON.stringify(summary),
      /감사인 선임 안건을 검토할 때 이 회계법인의 점수와 예상 총부담액을 우선 참고/u,
    );
    const finalResult = summary.blocks.find(
      ({ id }) => id === "nh-audit-final-result",
    );
    assert.equal(finalResult?.type, "KEY_VALUES");
    if (finalResult?.type === "KEY_VALUES") {
      assert.equal(finalResult.items[0]?.label, "1위 회계법인");
      assert.match(finalResult.items[0]?.value ?? "", /회계법인 report/u);
      assert.equal(finalResult.items[1]?.label, "최종 종합점수");
      assert.equal(finalResult.items[2]?.label, "예상 총부담액");
      assert.match(finalResult.items[2]?.value ?? "", /원/u);
    }
    assert.equal(detail.blocks[0]?.id, "nh-audit-quality-detail-input");
    assert.equal(detail.blocks[1]?.id, "nh-audit-quality-detail-score");
    assert.equal(
      viewModel.sections.some(({ id }) => id === "appendix"),
      false,
    );
    assert.equal(
      viewModel.sections.find(({ id }) => id === "overall-opinion")?.title,
      "계산 방법",
    );
    assert.doesNotMatch(JSON.stringify(viewModel), /저가격견적 표시 정책/u);
    assert.doesNotMatch(
      JSON.stringify(viewModel),
      /안전마진|가격 기초점수/u,
    );
    assert.match(
      JSON.stringify(viewModel),
      /Prego AI가 최소 필수 투입 시간 등 원가를 고려해 검증/u,
    );
    assert.match(
      JSON.stringify(viewModel),
      /만점기준은 적격 견적 중 최저 예상 총부담액입니다/u,
    );
    assert.match(
      JSON.stringify(viewModel),
      /저가부실수임 우려 견적은 품질점수에서 감점 반영합니다/u,
    );
    assert.match(
      JSON.stringify(viewModel),
      /귀 농협이 설정한 배점과 가격과 품질 가중치를 반영한 최종 종합점수/u,
    );
    assert.match(JSON.stringify(viewModel), /회계법인 수행역량 비교/u);
    assert.doesNotMatch(
      JSON.stringify(viewModel),
      /적격 회계법인 수행역량 입력값 비교/u,
    );
    assert.doesNotMatch(JSON.stringify(viewModel), /선정 검토 안내/u);
    assert.doesNotMatch(
      JSON.stringify(viewModel),
      /만점기준은 Prego AI가 최소 필수 투입 시간/u,
    );
    const rebuilt = rebuildNhAuditReportViewModel({
      reportRun: {
        ...fixture.reportRun,
        status: "COMPLETED",
        generatedAt: REPORT_FIXTURE_NOW,
        nhAuditEvaluationSnapshot: snapshot,
      },
      evaluationCase: fixture.evaluationCase,
      storedViewModel: viewModel,
    });
    assert.doesNotMatch(JSON.stringify(rebuilt), /안전마진|가격 기초점수/u);
    assert.match(
      JSON.stringify(rebuilt),
      /Prego AI가 최소 필수 투입 시간 등 원가를 고려해 검증/u,
    );
    const cover = viewModel.sections.find(({ id }) => id === "cover");
    const purpose = viewModel.sections.find(({ id }) => id === "purpose-scope");
    assert.doesNotMatch(
      JSON.stringify(cover),
      /보고서 ID|평가기준 버전|보고서 버전|"센터"|문의/u,
    );
    assert.match(JSON.stringify(purpose), /회계법인이 제공한 견적서/u);
    assert.match(JSON.stringify(purpose), /총비용기준/u);
    assert.doesNotMatch(
      JSON.stringify(purpose),
      /대표 비용값|지원자료 성격|확정본 기준|고객 확정 보고서별 평가 스냅샷/u,
    );
    assert.doesNotMatch(
      JSON.stringify(summary),
      /적용 평가기준 버전|기본값 사용 여부/u,
    );
    if (detail.blocks[0]?.type === "TABLE") {
      const namedRows = detail.blocks[0].rows.filter(
        (row) => (row[0] ?? "").trim().length > 0,
      );
      if (detail.blocks[0].rows.length > namedRows.length) {
        assert.ok(
          detail.blocks[0].rows.some((row) => (row[0] ?? "") === ""),
        );
        assert.ok(
          !detail.blocks[0].rows.some(
            (row, index) =>
              index > 0 &&
              (row[0] ?? "") === "미확인" &&
              (detail.blocks[0] as { rows: string[][] }).rows[index - 1]?.[0],
          ),
        );
      }
    }
    assert.match(JSON.stringify(viewModel), /기본 평가배점 적용/u);
    assert.match(viewModel.metadata.downloadFilename, /테스트농협_FY2027 감사인견적평가보고서\.pdf$/u);
    const preview = nhAuditReportPreviewFromSnapshot(snapshot);
    assert.equal(
      adminView.cost?.expectedTotalBurdenWon,
      snapshot.quoteResults[0].expectedTotalBurdenWon,
    );
    assert.equal(
      adminView.quality?.scoreOneDecimal,
      preview.quoteResults[0].qualityScoreOneDecimal,
    );
    assert.equal(
      sourceQuote.nhAuditV2?.eligibilityStatus,
      snapshot.quoteResults[0].eligibilityStatus,
    );
  });

  it("generates matching screen and PDF output for nine report scenarios", async () => {
    const defaults = createDefaultNhAuditCustomerWeightsV2();
    const custom: NhAuditCustomerWeightsV2 = {
      qualityWeightPercent: 80,
      priceWeightPercent: 20,
      qualityCriterionWeights: {
        LOCAL_NONGHYUP_AUDIT_COUNT_2025: 40,
        CERTIFIED_PUBLIC_ACCOUNTANT_COUNT: 10,
        ACCOUNTING_FIRM_REVENUE: 20,
        AUDITED_NONGHYUP_TYPE_DIVERSITY_2025: 10,
        NONGHYUP_TAX_AGENCY_PERFORMED_2025: 10,
        NONGHYUP_SUBSIDY_SETTLEMENT_PERFORMED_2025: 10,
      },
    };
    const legacy = {
      id: "legacy",
      quoteRequestId: "request-a",
      quoteAssignmentId: "assignment-legacy",
      partnerId: "partner-legacy",
      partnerName: "기존자료 회계법인",
      status: "delivered",
      version: 1,
    } as QuoteRecord;
    const separatelyBilled = quote("separate", {
      expenseBillingMode: "SEPARATELY_BILLED",
      expectedExpenseWon: "1000000",
    });
    const auditGroup = quote("audit-group-report", {
      proposerType: "AUDIT_GROUP",
    });
    const scenarios: Array<{
      name: string;
      quotes: QuoteRecord[];
      weights: NhAuditCustomerWeightsV2;
      longContent?: boolean;
      expectedPdfText: RegExp;
    }> = [
      {
        name: "default",
        quotes: [quote("default-a"), quote("default-b", {}, "20000000")],
        weights: defaults,
        expectedPdfText: /기본 평가배점 적용/u,
      },
      {
        name: "custom",
        quotes: [quote("custom-a"), quote("custom-b", {}, "20000000")],
        weights: custom,
        expectedPdfText: /고객이 설정한 가격·품질 비중/u,
      },
      {
        name: "audit-group",
        quotes: [quote("eligible-with-group"), auditGroup],
        weights: defaults,
        expectedPdfText: /감사반은 평가기준상 부적격/u,
      },
      {
        name: "legacy",
        quotes: [quote("eligible-with-legacy"), legacy],
        weights: defaults,
        expectedPdfText: /재제출 필요/u,
      },
      {
        name: "mixed-expenses",
        quotes: [quote("included"), separatelyBilled],
        weights: defaults,
        expectedPdfText: /12,100,000원/u,
      },
      {
        name: "long-names",
        quotes: [
          quote(
            "long",
            {},
            "10000000",
            `회계법인 ${"매우긴회계법인명".repeat(12)}`,
          ),
        ],
        weights: defaults,
        longContent: true,
        expectedPdfText: /매우긴회계법인명/u,
      },
      {
        name: "tie",
        quotes: [quote("tie-a"), quote("tie-b")],
        weights: defaults,
        expectedPdfText: /1위/u,
      },
      {
        name: "one-eligible",
        quotes: [quote("only")],
        weights: defaults,
        expectedPdfText: /적격 비교대상/u,
      },
      {
        name: "no-eligible",
        quotes: [auditGroup, legacy],
        weights: defaults,
        expectedPdfText: /표시할 항목 없음/u,
      },
    ];

    for (const scenario of scenarios) {
      const fixture = createReportFixture({
        longContent: scenario.longContent,
      });
      const snapshot = buildNhAuditReportEvaluationSnapshot({
        reportId: fixture.reportRun.id,
        evaluationId: fixture.evaluationCase.id,
        quoteRequestId: fixture.evaluationCase.quoteRequestId,
        customerId: "customer-a",
        quotes: scenario.quotes,
        weights: scenario.weights,
        now: NOW,
      });
      const viewModel = buildDeterministicReportViewModel({
        reportRun: {
          ...fixture.reportRun,
          nhAuditEvaluationSnapshot: snapshot,
        },
        evaluationCase: fixture.evaluationCase,
        corrections: [],
        generatedAt: REPORT_FIXTURE_NOW,
      });
      const pdf = await renderAuditEvaluationReportPdf(viewModel);
      const extracted = await extractPdfText(pdf, {
        maximumPages: 100,
        maximumTotalText: 2_000_000,
      });
      const pdfText = extracted.pages.map(({ text }) => text).join("\n");
      assert.doesNotMatch(pdfText, /열 묶음/u, `${scenario.name}: no column groups`);
      assert.match(
        pdfText,
        scenario.expectedPdfText,
        `${scenario.name}: PDF text`,
      );
      assert.match(pdfText, /예상 총부담액/u, `${scenario.name}: total burden`);
      assert.match(
        pdfText,
        new RegExp(snapshot.evaluationStandardVersion, "u"),
        `${scenario.name}: standard version`,
      );
      assert.match(
        JSON.stringify(viewModel),
        new RegExp(snapshot.reportId, "u"),
        `${scenario.name}: report id`,
      );
      if (scenario.longContent) {
        assert.ok(
          (pdfText.match(/회계법인명/gu) ?? []).length >= 2,
          `${scenario.name}: repeated table headers`,
        );
      }
      const eligible = snapshot.quoteResults.filter(
        ({ eligibilityStatus }) => eligibilityStatus === "ELIGIBLE",
      );
      const comparison = viewModel.sections
        .flatMap(({ blocks }) => blocks)
        .find(({ id }) => id === "nh-audit-composite-comparison-rank");
      assert.equal(comparison?.type, "TABLE");
      if (comparison?.type === "TABLE") {
        assert.equal(comparison.rows.length, eligible.length);
        eligible.forEach((result) => {
          assert.ok(
            comparison.rows.some(
              (row) =>
                row.includes(result.accountingFirmName) &&
                row.includes(`${result.rank}위`),
            ),
            `${scenario.name}: snapshot ranking`,
          );
          const displayedOverall = result.overallScore
            ? formatExactScoreOneDecimal(result.overallScore)
            : null;
          if (displayedOverall) {
            assert.match(
              pdfText,
              new RegExp(
                displayedOverall.replace(".", "\\."),
                "u",
              ),
              `${scenario.name}: PDF overall score`,
            );
          }
        });
      }
    }
  });

  it("rejects out-of-range and non-100 customer settings", () => {
    const defaults = createDefaultNhAuditCustomerWeightsV2();
    assert.equal(
      validateNhAuditCustomerWeightsV2({
        ...defaults,
        qualityWeightPercent: 81,
        priceWeightPercent: 19,
      }).success,
      false,
    );
    assert.equal(
      validateNhAuditCustomerWeightsV2({
        ...defaults,
        qualityCriterionWeights: {
          ...defaults.qualityCriterionWeights,
          LOCAL_NONGHYUP_AUDIT_COUNT_2025: 29,
        },
      }).success,
      false,
    );
    assert.equal(
      validateNhAuditCustomerWeightsV2({
        ...defaults,
        qualityCriterionWeights: {
          ...defaults.qualityCriterionWeights,
          LOCAL_NONGHYUP_AUDIT_COUNT_2025: 31,
        },
      }).success,
      false,
    );
  });
});

describe("NH audit report API and responsive UI contracts", () => {
  it("derives the customer from authenticated case ownership", () => {
    const service = readFileSync(
      path.join(
        root,
        "lib/audit-evaluation/nh-audit-report-service.ts",
      ),
      "utf8",
    );
    const previewRoute = readFileSync(
      path.join(
        root,
        "app/api/audit-evaluations/[caseId]/reports/preview/route.ts",
      ),
      "utf8",
    );
    const downloadRoute = readFileSync(
      path.join(
        root,
        "app/api/audit-evaluations/[caseId]/reports/[reportVersion]/download/route.ts",
      ),
      "utf8",
    );
    assert.match(service, /ownerSubjectId\(evaluationCase\)/u);
    assert.match(service, /input\.actor\.subjectId/u);
    assert.match(service, /customerId:\s*input\.actor\.subjectId/u);
    assert.match(
      previewRoute,
      /authenticateAuditEvaluationMutationRequest/u,
    );
    assert.doesNotMatch(previewRoute, /body\?\.customerId|body\.customerId/u);
    assert.match(
      downloadRoute,
      /authenticateAuditEvaluationCaseRequest/u,
    );
    assert.match(downloadRoute, /filename\*=UTF-8''/u);
  });

  it("uses native keyboard controls, reset actions and mobile layout", () => {
    const component = readFileSync(
      path.join(
        root,
        "components/AuditEvaluationReportWorkspace.tsx",
      ),
      "utf8",
    );
    const css = readFileSync(path.join(root, "app/globals.css"), "utf8");
    assert.match(component, /type="range"/u);
    assert.match(component, /min=\{40\}/u);
    assert.match(component, /max=\{80\}/u);
    assert.match(component, /aria-valuetext/u);
    assert.match(component, /resetCompositeWeightsLabel/u);
    assert.match(component, /resetQualityWeightsLabel/u);
    assert.match(component, /disabled=\{!valid \|\| !preview \|\| busy\}/u);
    assert.match(component, /is-frozen-1/u);
    assert.match(component, /is-frozen-2 is-total-burden/u);
    assert.match(component, /is-frozen-3 is-total-burden/u);
    assert.match(
      component,
      /overallScoreLabel[\s\S]*totalBurdenLabel[\s\S]*finalRankLabel/u,
    );
    assert.match(
      css,
      /\.nh-audit-report-preview \.is-frozen-3[\s\S]*position: sticky/u,
    );
    assert.match(css, /--nh-freeze-firm:\s*10\.25rem/u);
    assert.match(css, /--nh-freeze-score:\s*5\.15rem/u);
    assert.match(css, /--nh-freeze-burden:\s*7rem/u);
    assert.match(
      css,
      /\.audit-report-block dl > div:first-child[\s\S]*border-top:/u,
    );
    assert.match(css, /\.audit-report-block--result/u);
    assert.match(component, /audit-report-block--result/u);
    assert.match(
      css,
      /@media \(max-width: 760px\)[\s\S]*\.nh-audit-report-settings__criteria/u,
    );
    const pdf = readFileSync(
      path.join(root, "lib/audit-evaluation/report-pdf.tsx"),
      "utf8",
    );
    assert.match(pdf, /keyValueRowFirst/u);
    assert.match(pdf, /nh-audit-final-result/u);
    assert.match(component, /reportTableCellClassName/u);
    assert.match(css, /\.audit-report-table-wrap \.is-audit-count/u);
    assert.match(css, /\.audit-report-table-wrap \.is-nowrap/u);
    const reportPage = readFileSync(
      path.join(root, "components/AuditEvaluationCustomerPage.tsx"),
      "utf8",
    );
    assert.doesNotMatch(
      reportPage,
      /event\.auditQuoteEvaluationReport",\s*"disclaimer"/u,
    );
  });
});
