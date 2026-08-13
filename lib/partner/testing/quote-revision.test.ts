import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  QuoteAssignmentRecord,
  QuoteRecord,
  QuoteRequestRecord,
} from "@/lib/firebase/schema";
import {
  buildRevisionDraftFromSentQuote,
  canPartnerReviseQuoteAssignment,
  formatQuoteVersionLabel,
  partnerQuoteRevisionBlockReason,
  pickLatestSentQuote,
} from "@/lib/quotes/quote-revision";
import { nextImmutableQuoteVersion, partnerQuoteFinalizeBlockReason } from "@/lib/quotes/nh-audit-quote-server";

function assignment(
  overrides: Partial<QuoteAssignmentRecord> = {},
): QuoteAssignmentRecord {
  return {
    id: "assignment-a",
    quoteRequestId: "request-a",
    partnerId: "partner-a",
    partnerName: "프리고회계법인",
    status: "finalized",
    assignedBy: "admin",
    assignedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("partner quote revision", () => {
  it("allows revise only for finalized assignments on open requests", () => {
    const request = { status: "quoted" } as QuoteRequestRecord;
    assert.equal(
      canPartnerReviseQuoteAssignment({
        authenticatedPartnerId: "partner-a",
        assignment: assignment(),
        quoteRequest: request,
      }),
      true,
    );
    assert.equal(
      partnerQuoteRevisionBlockReason({
        authenticatedPartnerId: "partner-a",
        assignment: assignment({ status: "drafting" }),
        quoteRequest: request,
      }),
      "assignment_not_finalized",
    );
    assert.equal(
      partnerQuoteRevisionBlockReason({
        authenticatedPartnerId: "partner-a",
        assignment: assignment(),
        quoteRequest: { status: "closed" },
      }),
      "quote_request_closed",
    );
  });

  it("seeds a draft from the latest sent quote including fee fields", () => {
    const source = {
      id: "assignment-a_v1",
      quoteRequestId: "request-a",
      quoteAssignmentId: "assignment-a",
      partnerId: "partner-a",
      partnerName: "프리고회계법인",
      status: "delivered",
      version: 1,
      customerEmail: "customer@example.com",
      supplierName: "프리고회계법인",
      supplierContactEmail: "partner@example.com",
      lineItems: [
        {
          id: "audit-fee",
          name: "회계감사 보수",
          quantity: 1,
          unitPrice: 10_000_000,
          supplyAmount: 10_000_000,
        },
      ],
      subtotal: 10_000_000,
      taxAmount: 1_000_000,
      totalAmount: 11_000_000,
      vatIncluded: true,
      nhAuditDraft: {
        engagementPartnerName: "김회계",
        proposerType: "ACCOUNTING_FIRM",
        auditFeeWon: "10,000,000",
        expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
        expectedExpenseWon: "0",
        localNonghyupAuditCount2025: "3",
        certifiedPublicAccountantCount: "12",
        accountingFirmRevenueWon: "1,000,000,000",
        auditedNonghyupTypes2025: ["LOCAL_AGRICULTURAL_COOPERATIVE"],
        noAuditedNonghyupTypes2025: false,
        nonghyupTaxAgencyPerformed2025: "YES",
        nonghyupSubsidySettlementPerformed2025: "NO",
        factsConfirmed: true,
      },
      createdBy: "partner-user",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as QuoteRecord;

    const draft = buildRevisionDraftFromSentQuote({
      source,
      createdBy: "partner-user-2",
      createdByEmail: "partner2@example.com",
      now: "2026-07-01T00:00:00.000Z",
    });
    assert.equal(draft.id, "assignment-a_draft");
    assert.equal(draft.status, "draft");
    assert.equal(draft.version, 0);
    assert.equal(draft.nhAuditDraft?.auditFeeWon, "10,000,000");
    assert.equal(draft.nhAuditDraft?.factsConfirmed, false);
    assert.equal(draft.lineItems[0]?.unitPrice, 10_000_000);
  });

  it("picks the highest active sent version and keeps void versions in numbering", () => {
    const quotes = [
      {
        id: "a_v1",
        quoteAssignmentId: "a",
        status: "void",
        version: 1,
      },
      {
        id: "a_v2",
        quoteAssignmentId: "a",
        status: "delivered",
        version: 2,
      },
    ] as QuoteRecord[];
    assert.equal(pickLatestSentQuote(quotes, "a")?.id, "a_v2");
    assert.equal(nextImmutableQuoteVersion([1, 2]), 3);
  });

  it("allows sending the next immutable version on an already finalized assignment", () => {
    const request = { status: "quoted" } as QuoteRequestRecord;
    assert.equal(
      partnerQuoteFinalizeBlockReason({
        authenticatedPartnerId: "partner-a",
        assignment: assignment(),
        quoteRequest: request,
      }),
      null,
    );
    assert.equal(
      partnerQuoteFinalizeBlockReason({
        authenticatedPartnerId: "partner-a",
        assignment: assignment({ status: "assigned" }),
        quoteRequest: { status: "assigned" } as QuoteRequestRecord,
      }),
      null,
    );
    assert.equal(
      partnerQuoteFinalizeBlockReason({
        authenticatedPartnerId: "partner-a",
        assignment: assignment({ status: "revoked" }),
        quoteRequest: request,
      }),
      "assignment_revoked",
    );
    assert.equal(
      partnerQuoteFinalizeBlockReason({
        authenticatedPartnerId: "partner-a",
        assignment: assignment(),
        quoteRequest: { status: "closed" },
      }),
      "quote_request_closed",
    );
    assert.equal(formatQuoteVersionLabel(1), "v1");
    assert.equal(formatQuoteVersionLabel(2), "v2");
  });
});
