import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAssignedPartnerNames,
  isPartnerEligibleForAuditQuote,
  resolveExpectedAuditQuoteCount,
} from "@/lib/quotes/audit-quote-assignment";
import { quoteAutomationPlanLookupIds, quoteRequestIdFor } from "@/lib/quotes/quote-requests";
import {
  quoteRequestIdsForSafePriceRewrite,
  recipientEmailForQuoteRewrite,
} from "@/lib/quotes/safe-price-rewrite-helpers";

describe("audit quote partner assignment", () => {
  it("accepts partners with audit field or accounting professions", () => {
    assert.equal(
      isPartnerEligibleForAuditQuote({
        fields: ["감사"],
        profession: "ATTORNEY",
        status: "active",
      }),
      true,
    );
    assert.equal(
      isPartnerEligibleForAuditQuote({
        fields: ["세무·회계"],
        profession: "ACCOUNTANT",
        status: "active",
      }),
      true,
    );
    assert.equal(
      isPartnerEligibleForAuditQuote({
        fields: ["법률"],
        profession: "ATTORNEY",
        status: "active",
      }),
      false,
    );
  });

  it("requires at least two quote assignments for comparison", () => {
    assert.equal(resolveExpectedAuditQuoteCount(0, 0), 2);
    assert.equal(resolveExpectedAuditQuoteCount(3, 1), 3);
    assert.equal(resolveExpectedAuditQuoteCount(1, 4), 4);
    assert.equal(
      formatAssignedPartnerNames([
        { partnerName: "A회계", status: "assigned" },
        { partnerName: "B세무", status: "revoked" },
        { partnerName: "C감사", status: "drafting" },
      ]),
      "A회계, C감사",
    );
  });

  it("builds a stable quote request id from audit request id", () => {
    assert.equal(
      quoteRequestIdFor("audit_quote", "abc123"),
      "audit_quote_abc123",
    );
  });

  it("looks up automation presets from either inbox or raw request ids", () => {
    assert.deepEqual(quoteAutomationPlanLookupIds("abc123"), [
      "audit_quote_abc123",
      "abc123",
    ]);
    assert.deepEqual(quoteAutomationPlanLookupIds("audit_quote_abc123"), [
      "audit_quote_abc123",
    ]);
  });

  it("resolves quote request docs and customer email for safe-price rewrites", () => {
    assert.deepEqual(
      quoteRequestIdsForSafePriceRewrite("abc123", "audit_quote_abc123"),
      ["audit_quote_abc123", "abc123"],
    );
    assert.equal(
      recipientEmailForQuoteRewrite(
        { customerEmail: "" },
        { customerEmail: "coop@nonghyup.com" },
      ),
      "coop@nonghyup.com",
    );
    assert.equal(
      recipientEmailForQuoteRewrite(
        { customerEmail: "quote@nonghyup.com" },
        { customerEmail: "coop@nonghyup.com" },
      ),
      "quote@nonghyup.com",
    );
  });
});
