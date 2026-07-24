import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAssignedPartnerNames,
  isPartnerEligibleForAuditQuote,
  resolveExpectedAuditQuoteCount,
} from "@/lib/quotes/audit-quote-assignment";
import { quoteRequestIdFor } from "@/lib/quotes/quote-requests";

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
});
