import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  QuoteRecord,
  QuoteRequestRecord,
} from "@/lib/firebase/schema";
import {
  buildAdminNhAuditQuoteView,
  buildAdminNhAuditQuoteViews,
} from "@/lib/quotes/nh-audit-admin-view";
import {
  buildTrustedNhAuditSubmissionV2,
  createNhAuditEvaluationSnapshotV2,
} from "@/lib/quotes/nh-audit-quote-server";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const request = {
  id: "request-a",
  sourceType: "audit_quote",
  cooperativeName: "프리고농협",
  fiscalYear: 2026,
} as QuoteRequestRecord;

function input(overrides: Record<string, unknown> = {}) {
  return {
    engagementPartnerName: "홍길동",
    proposerType: "ACCOUNTING_FIRM",
    auditFeeWon: "10000000",
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
  };
}

function currentQuote(
  id: string,
  overrides: Record<string, unknown> = {},
  submittedAt = "2026-07-23T00:00:00.000Z",
) {
  const trusted = buildTrustedNhAuditSubmissionV2(input(overrides), {
    submissionId: id,
    quoteRequestId: request.id,
    targetCooperativeId: "coop-a",
    targetCooperativeName: request.cooperativeName!,
    fiscalYear: request.fiscalYear!,
    partnerAccountId: `account-${id}`,
    accountingFirmName: `회계법인 ${id}`,
    submittedAt,
  });
  assert.equal(trusted.success, true);
  if (!trusted.success) throw new Error("fixture_validation_failed");
  return {
    id,
    quoteRequestId: request.id,
    quoteAssignmentId: `assignment-${id}`,
    partnerId: `partner-${id}`,
    partnerName: trusted.submission.accountingFirmName,
    status: "delivered",
    version: 1,
    nhAuditV2: createNhAuditEvaluationSnapshotV2(
      trusted.submission,
      submittedAt,
    ),
  } as QuoteRecord;
}

describe("administrator NH audit quote view model", () => {
  it("shows the server-confirmed full-score eligible accounting firm", () => {
    const view = buildAdminNhAuditQuoteView(
      currentQuote("eligible"),
      request,
    );
    assert.ok(view);
    assert.equal(view.eligibilityStatus, "ELIGIBLE");
    assert.equal(view.includedInOverallRanking, true);
    assert.equal(view.quality?.scoreOneDecimal, "100.0");
    assert.equal(view.quality?.criteria.length, 6);
    assert.deepEqual(
      view.quality?.criteria.map((criterion) => criterion.weightPoints),
      [30, 20, 20, 10, 10, 10],
    );
    assert.equal(view.cost?.expectedTotalBurdenWon, "11000000");
    assert.equal(
      view.quality?.criteria.reduce(
        (total, criterion) =>
          total + Number(criterion.earnedScoreOneDecimal),
        0,
      ),
      Number(view.quality?.scoreOneDecimal),
    );
  });

  it("keeps audit groups out of the normal ranking", () => {
    const view = buildAdminNhAuditQuoteView(
      currentQuote("audit-group", { proposerType: "AUDIT_GROUP" }),
      request,
    );
    assert.ok(view);
    assert.equal(view.eligibilityStatus, "INELIGIBLE");
    assert.equal(view.includedInOverallRanking, false);
    assert.deepEqual(view.reasonCodes, ["AUDIT_GROUP_PROPOSER"]);
  });

  it("marks an incomplete legacy document for resubmission without zeroes", () => {
    const legacy = {
      id: "legacy",
      quoteRequestId: request.id,
      quoteAssignmentId: "assignment-legacy",
      partnerId: "partner-legacy",
      partnerName: "기존회계법인",
      status: "delivered",
      version: 1,
      subtotal: 0,
      taxAmount: 0,
      totalAmount: 0,
    } as QuoteRecord;
    const view = buildAdminNhAuditQuoteView(legacy, request);
    assert.ok(view);
    assert.equal(view.eligibilityStatus, "RESUBMISSION_REQUIRED");
    assert.equal(view.quality, null);
    assert.equal(view.cost, null);
    assert.equal(view.submittedAt, null);
    assert.ok(view.missingFields.length > 0);
  });

  it("uses the stored server cost for included and separate expenses", () => {
    const included = buildAdminNhAuditQuoteView(
      currentQuote("included", {
        expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
        expectedExpenseWon: "999999",
      }),
      request,
    );
    const separate = buildAdminNhAuditQuoteView(
      currentQuote("separate", {
        expenseBillingMode: "SEPARATELY_BILLED",
        expectedExpenseWon: "1000000",
      }),
      request,
    );
    assert.equal(included?.cost?.expectedExpenseWon, "0");
    assert.equal(included?.cost?.expectedTotalBurdenWon, "11000000");
    assert.equal(separate?.cost?.expectedExpenseWon, "1000000");
    assert.equal(separate?.cost?.supplyAmountWon, "11000000");
    assert.equal(separate?.cost?.vatWon, "1100000");
    assert.equal(separate?.cost?.expectedTotalBurdenWon, "12100000");
  });

  it("shows an eligible zero-quality firm as zero instead of missing", () => {
    const view = buildAdminNhAuditQuoteView(
      currentQuote("zero-quality", {
        localNonghyupAuditCount2025: 0,
        certifiedPublicAccountantCount: 0,
        accountingFirmRevenueWon: "0",
        auditedNonghyupTypes2025: [],
        nonghyupTaxAgencyPerformed2025: false,
        nonghyupSubsidySettlementPerformed2025: false,
      }),
      request,
    );
    assert.ok(view);
    assert.equal(view.eligibilityStatus, "ELIGIBLE");
    assert.equal(view.quality?.scoreOneDecimal, "0.0");
    assert.equal(view.includedInOverallRanking, true);
  });

  it("preserves an existing administrative exclusion without score editing", () => {
    const quote = currentQuote("excluded");
    quote.nhAuditV2!.eligibilityStatus = "EXCLUDED";
    quote.nhAuditV2!.reasonCodes = ["ADMINISTRATIVELY_EXCLUDED"];
    const view = buildAdminNhAuditQuoteView(quote, request);
    assert.ok(view);
    assert.equal(view.eligibilityStatus, "EXCLUDED");
    assert.equal(view.includedInOverallRanking, false);
    assert.deepEqual(view.reasonCodes, ["ADMINISTRATIVELY_EXCLUDED"]);
    assert.equal(view.quality?.scoreOneDecimal, "100.0");
  });

  it("keeps list and detail state identical and sorts by server submission time", () => {
    const olderHighScore = currentQuote(
      "older",
      {},
      "2026-07-22T00:00:00.000Z",
    );
    const newerZeroScore = currentQuote(
      "newer",
      {
        localNonghyupAuditCount2025: 0,
        certifiedPublicAccountantCount: 0,
        accountingFirmRevenueWon: "0",
        auditedNonghyupTypes2025: [],
        nonghyupTaxAgencyPerformed2025: false,
        nonghyupSubsidySettlementPerformed2025: false,
      },
      "2026-07-23T00:00:00.000Z",
    );
    const views = buildAdminNhAuditQuoteViews(
      [olderHighScore, newerZeroScore],
      [request],
    );
    assert.deepEqual(
      views.map((view) => view.id),
      ["newer", "older"],
    );
    assert.equal(views[0].quality?.scoreOneDecimal, "0.0");
    assert.equal(views[0].eligibilityStatus, "ELIGIBLE");
  });
});

describe("administrator NH audit quote UI and authorization contract", () => {
  it("renders read-only list, detail, status and narrow-screen contracts", () => {
    const component = readFileSync(
      path.join(
        root,
        "components/admin/AdminNhAuditQuotesPanel.tsx",
      ),
      "utf8",
    );
    const css = readFileSync(path.join(root, "app/globals.css"), "utf8");
    assert.match(component, /quoteBasicInfoTitle/u);
    assert.match(component, /quoteCostInfoTitle/u);
    assert.match(component, /quoteEvaluationInputTitle/u);
    assert.match(component, /quoteQualityEvaluationTitle/u);
    assert.match(component, /quoteResultStatusTitle/u);
    assert.match(component, /includedInOverallRanking/u);
    assert.doesNotMatch(component, /<(input|textarea|select)\b/iu);
    assert.match(css, /\.nh-audit-admin__mobile-list/u);
    assert.match(
      css,
      /@media \(max-width: 720px\)[\s\S]*\.nh-audit-admin__table-wrap/u,
    );
  });

  it("keeps the API admin-only and returns server-built views", () => {
    const route = readFileSync(
      path.join(root, "app/api/admin/quotes/route.ts"),
      "utf8",
    );
    assert.match(route, /requirePermission\(req, "inquiries:read"\)/u);
    assert.match(route, /buildAdminNhAuditQuoteViews/u);
    assert.doesNotMatch(route, /request\.role|body\.role/u);
  });
});
