import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { uniqueCcRecipients } from "@/lib/email/resend";
import {
  QUOTE_OPS_CC_EMAIL,
  quotePartnerCcEmails,
} from "@/lib/quotes/partner-quote-cc";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("quote partner CC", () => {
  it("uses the affiliated firm contact and skips the customer address", () => {
    assert.deepEqual(
      quotePartnerCcEmails({
        customerEmail: "audit@nonghyup.com",
        partnerContactEmail: "partner@example.com",
        supplierContactEmail: "quote.desk@example.com",
      }),
      ["partner@example.com", QUOTE_OPS_CC_EMAIL],
    );
  });

  it("falls back to the quote supplier contact when the firm email is missing", () => {
    assert.deepEqual(
      quotePartnerCcEmails({
        customerEmail: "audit@nonghyup.com",
        partnerContactEmail: "",
        supplierContactEmail: "quote.desk@example.com",
      }),
      ["quote.desk@example.com", QUOTE_OPS_CC_EMAIL],
    );
  });

  it("always CCs the ops inbox even when the firm contact is missing", () => {
    assert.deepEqual(
      quotePartnerCcEmails({
        customerEmail: "audit@nonghyup.com",
        partnerContactEmail: "",
        supplierContactEmail: "",
      }),
      [QUOTE_OPS_CC_EMAIL],
    );
  });

  it("drops invalid or same-as-customer addresses but keeps the ops inbox", () => {
    assert.deepEqual(
      quotePartnerCcEmails({
        customerEmail: "partner@example.com",
        partnerContactEmail: "partner@example.com",
      }),
      [QUOTE_OPS_CC_EMAIL],
    );
    assert.deepEqual(
      quotePartnerCcEmails({
        customerEmail: "audit@nonghyup.com",
        partnerContactEmail: "not-an-email",
      }),
      [QUOTE_OPS_CC_EMAIL],
    );
  });

  it("does not duplicate the ops inbox when it is also the firm contact or customer", () => {
    assert.deepEqual(
      quotePartnerCcEmails({
        customerEmail: "audit@nonghyup.com",
        partnerContactEmail: QUOTE_OPS_CC_EMAIL,
      }),
      [QUOTE_OPS_CC_EMAIL],
    );
    assert.deepEqual(
      quotePartnerCcEmails({
        customerEmail: QUOTE_OPS_CC_EMAIL,
        partnerContactEmail: "partner@example.com",
      }),
      ["partner@example.com"],
    );
  });

  it("does not CC a Naver plus-alias that resolves to the same inbox as the customer", () => {
    assert.deepEqual(
      uniqueCcRecipients("cheaptax+quote1@naver.com", [
        "cheaptax@naver.com",
        "firm@example.com",
      ]),
      ["firm@example.com"],
    );
  });
});

describe("customer quote send paths include partner CC", () => {
  it("finalizes, retries, and safe-price rewrites go through the CC helper", () => {
    const finalize = readFileSync(
      path.join(root, "lib/quotes/finalize-partner-quote-delivery.ts"),
      "utf8",
    );
    const retry = readFileSync(
      path.join(root, "app/api/internal/quote-emails/retry/route.ts"),
      "utf8",
    );
    const rewrite = readFileSync(
      path.join(root, "lib/quotes/safe-price-source-rewrite.ts"),
      "utf8",
    );
    const assignment = readFileSync(
      path.join(root, "lib/quotes/partner-assignment-email.ts"),
      "utf8",
    );
    assert.match(finalize, /sendCustomerQuoteTransactionalEmail/u);
    assert.match(retry, /sendCustomerQuoteTransactionalEmail/u);
    assert.match(rewrite, /sendCustomerQuoteTransactionalEmail/u);
    assert.doesNotMatch(assignment, /sendCustomerQuoteTransactionalEmail/u);
  });
});
