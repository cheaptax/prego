import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QuoteRecord, QuoteRequestRecord } from "@/lib/firebase/schema";
import {
  buildCustomerQuoteComparisonGroups,
  comparisonRedirectPath,
} from "@/lib/quotes/customer-quote-comparison";

describe("customer quote comparison groups", () => {
  it("exposes compare entry for audit requests with enough sent quotes", () => {
    const groups = buildCustomerQuoteComparisonGroups({
      quoteRequests: [
        {
          id: "qr-1",
          sourceType: "audit_quote",
          sourceId: "aq-1",
          subject: "FY27 감사견적",
          cooperativeName: "프리고농협",
          fiscalYear: 2027,
          customerEmail: "a@nonghyup.com",
          submittedQuoteCount: 2,
          createdAt: "",
          updatedAt: "",
          status: "quoted",
        },
      ] as QuoteRequestRecord[],
      quotes: [
        {
          id: "q1",
          quoteRequestId: "qr-1",
          status: "delivered",
          version: 1,
        },
        {
          id: "q2",
          quoteRequestId: "qr-1",
          status: "finalized",
          version: 1,
        },
      ] as QuoteRecord[],
      peeks: new Map([
        [
          "aq-1",
          {
            entryEnabled: true,
            caseId: "aec_1",
            status: "COMPLETED",
            reportAvailable: true,
          },
        ],
      ]),
    });
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.canCompare, true);
    assert.equal(
      groups[0]?.href,
      "/events/audit-quote/evaluations/aec_1/report",
    );
  });

  it("keeps the button disabled until two quotes arrive", () => {
    const groups = buildCustomerQuoteComparisonGroups({
      quoteRequests: [
        {
          id: "qr-1",
          sourceType: "audit_quote",
          sourceId: "aq-1",
          subject: "FY27 감사견적",
          customerEmail: "a@nonghyup.com",
          submittedQuoteCount: 1,
          createdAt: "",
          updatedAt: "",
          status: "quoted",
        },
      ] as QuoteRequestRecord[],
      quotes: [
        {
          id: "q1",
          quoteRequestId: "qr-1",
          status: "delivered",
          version: 1,
        },
      ] as QuoteRecord[],
      peeks: new Map([
        [
          "aq-1",
          {
            entryEnabled: true,
            caseId: null,
            status: null,
            reportAvailable: false,
          },
        ],
      ]),
    });
    assert.equal(groups[0]?.canCompare, false);
    assert.equal(groups[0]?.href, null);
  });

  it("routes unfinished cases to the evaluation workspace", () => {
    assert.equal(
      comparisonRedirectPath({ caseId: "aec_9", reportAvailable: false }),
      "/events/audit-quote/evaluations/aec_9",
    );
    assert.equal(
      comparisonRedirectPath({
        caseId: "aec_9",
        reportAvailable: false,
        reportWorkspaceReady: true,
      }),
      "/events/audit-quote/evaluations/aec_9/report",
    );
    assert.equal(
      comparisonRedirectPath({ caseId: "aec_9", reportAvailable: true }),
      "/events/audit-quote/evaluations/aec_9/report",
    );
  });
});
