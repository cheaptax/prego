import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isReportWorkspaceReady,
  normalizedQuoteFromPartnerNhAuditQuote,
  selectNhAuditQuotesForReport,
} from "@/lib/audit-evaluation/inbox-report-bridge-core";
import type { QuoteRecord } from "@/lib/firebase/schema";
import {
  buildTrustedNhAuditSubmissionV2,
  createNhAuditEvaluationSnapshotV2,
} from "@/lib/quotes/nh-audit-quote-server";

const NOW = "2026-07-25T00:00:00.000Z";

describe("inbox report bridge helpers", () => {
  it("picks the latest sent NH quote per assignment and skips voids", () => {
    const quotes = [
      baseQuote({
        id: "q-old",
        quoteAssignmentId: "asg-1",
        version: 1,
        status: "void",
      }),
      baseQuote({
        id: "q-new",
        quoteAssignmentId: "asg-1",
        version: 2,
        status: "finalized",
      }),
      baseQuote({
        id: "q-b",
        quoteAssignmentId: "asg-2",
        version: 1,
        status: "delivered",
      }),
      baseQuote({
        id: "q-draft",
        quoteAssignmentId: "asg-3",
        version: 1,
        status: "draft",
        withNh: false,
      }),
    ];
    const selected = selectNhAuditQuotesForReport(quotes);
    assert.deepEqual(
      selected.map((quote) => quote.id).sort(),
      ["q-b", "q-new"],
    );
  });

  it("builds a confirmed normalized quote from nhAuditV2 submission", () => {
    const quote = baseQuote({
      id: "q-1",
      quoteAssignmentId: "asg-1",
      version: 1,
      status: "finalized",
    });
    const normalized = normalizedQuoteFromPartnerNhAuditQuote({
      quote,
      caseId: "case-1",
      now: NOW,
    });
    assert.equal(normalized.quoteId, "q-1");
    assert.equal(normalized.caseId, "case-1");
    assert.equal(normalized.confirmedByCustomer, true);
    assert.equal(normalized.accountingFirmName, "테스트회계법인");
    assert.equal(normalized.auditFee, "50000000");
  });

  it("treats READY and COMPLETED as report workspace ready", () => {
    assert.equal(isReportWorkspaceReady("READY"), true);
    assert.equal(isReportWorkspaceReady("COMPLETED"), true);
    assert.equal(isReportWorkspaceReady("ACCESS_PENDING"), false);
  });
});

function baseQuote(input: {
  id: string;
  quoteAssignmentId: string;
  version: number;
  status: QuoteRecord["status"];
  withNh?: boolean;
}): QuoteRecord {
  const withNh = input.withNh !== false;
  const trusted = buildTrustedNhAuditSubmissionV2(
    {
      engagementPartnerName: "김감사",
      proposerType: "ACCOUNTING_FIRM",
      auditFeeWon: "50000000",
      expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
      expectedExpenseWon: "0",
      localNonghyupAuditCount2025: 12,
      certifiedPublicAccountantCount: 40,
      accountingFirmRevenueWon: "10000000000",
      auditedNonghyupTypes2025: ["LOCAL_AGRICULTURAL_COOPERATIVE"],
      nonghyupTaxAgencyPerformed2025: true,
      nonghyupSubsidySettlementPerformed2025: false,
      factsConfirmed: true,
    },
    {
      submissionId: input.id,
      quoteRequestId: "req1",
      targetCooperativeId: "coop-a",
      targetCooperativeName: "프리고농협",
      fiscalYear: 2027,
      partnerAccountId: `partner-${input.quoteAssignmentId}`,
      accountingFirmName: "테스트회계법인",
      submittedAt: NOW,
    },
  );
  assert.equal(trusted.success, true);
  if (!trusted.success) throw new Error("fixture_validation_failed");
  return {
    id: input.id,
    quoteRequestId: "audit_quote_req1",
    quoteAssignmentId: input.quoteAssignmentId,
    partnerId: `partner-${input.quoteAssignmentId}`,
    partnerName: "테스트회계법인",
    status: input.status,
    version: input.version,
    customerEmail: "a@nonghyup.com",
    supplierName: "테스트회계법인",
    supplierContactEmail: "p@example.com",
    lineItems: [],
    subtotal: 50_000_000,
    taxAmount: 5_000_000,
    totalAmount: 55_000_000,
    vatIncluded: true,
    createdBy: "partner",
    createdAt: NOW,
    updatedAt: NOW,
    ...(withNh
      ? {
          nhAuditV2: createNhAuditEvaluationSnapshotV2(
            trusted.submission,
            NOW,
          ),
        }
      : {}),
  };
}
