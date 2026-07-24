import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildNhAuditReportEvaluationSnapshot,
  nhAuditReportEvaluationSnapshotSchema,
  nhAuditReportPreviewFromSnapshot,
} from "@/lib/audit-evaluation/nh-audit-report-snapshot";
import { formatExactScoreOneDecimal } from "@/lib/audit-evaluation/nh-audit-v2-engine";
import {
  createDefaultNhAuditCustomerWeightsV2,
  validateNhAuditCustomerWeightsV2,
} from "@/lib/audit-evaluation/nh-audit-v2-schemas";
import type { NhAuditCustomerWeightsV2 } from "@/lib/audit-evaluation/nh-audit-v2-types";
import { extractPdfText } from "@/lib/audit-evaluation/pdf-text-extractor";
import { renderAuditEvaluationReportPdf } from "@/lib/audit-evaluation/report-pdf";
import { buildDeterministicReportViewModel } from "@/lib/audit-evaluation/report-view-model";
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
        "nh-audit-report-summary",
        "nh-audit-weight-guidance",
      ],
    );
    assert.equal(detail.blocks[0]?.id, "nh-audit-quality-detail");
    assert.match(JSON.stringify(viewModel), /기본 평가배점 적용/u);
    assert.match(viewModel.metadata.downloadFilename, /테스트농협-FY2027/u);
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
        .find(({ id }) => id === "nh-audit-composite-comparison");
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
    assert.match(
      css,
      /@media \(max-width: 760px\)[\s\S]*\.nh-audit-report-settings__criteria/u,
    );
  });
});
