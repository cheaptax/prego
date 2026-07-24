import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { QuoteRecord, QuoteRequestRecord } from "@/lib/firebase/schema";
import {
  escapeEmailHtml,
  getAppBaseUrl,
  getTransactionalEmailConfigurationError,
} from "@/lib/email/resend";
import {
  canCustomerReadQuote,
  canCustomerReadQuoteRequest,
} from "@/lib/quotes/quote-access";

const QUOTE = {
  id: "quote-1",
  status: "delivered",
  pdfPath: "quotes/quote-1/v1/quote.pdf",
  customerEmail: "owner@nonghyup.com",
} as QuoteRecord;

function token(uid: string, email: string) {
  return { uid, email } as DecodedIdToken;
}

describe("quote security boundary", () => {
  it("requires the original member UID for consult quotes", () => {
    const request = {
      id: "request-1",
      sourceType: "consult",
      customerUid: "owner",
      customerEmail: "owner@nonghyup.com",
    } as QuoteRequestRecord;

    assert.equal(
      canCustomerReadQuote(token("owner", "owner@nonghyup.com"), QUOTE, request),
      true,
    );
    assert.equal(
      canCustomerReadQuote(
        token("attacker", "owner@nonghyup.com"),
        QUOTE,
        request,
      ),
      false,
    );
    assert.equal(
      canCustomerReadQuoteRequest(
        token("attacker", "owner@nonghyup.com"),
        request,
      ),
      false,
    );
  });

  it("requires the exact approved-account email for audit quotes", () => {
    const request = {
      id: "request-2",
      sourceType: "audit_quote",
      customerEmail: "owner@nonghyup.com",
    } as QuoteRequestRecord;

    assert.equal(
      canCustomerReadQuote(token("member", "OWNER@nonghyup.com"), QUOTE, request),
      true,
    );
    assert.equal(
      canCustomerReadQuote(
        token("member", "other@nonghyup.com"),
        QUOTE,
        request,
      ),
      false,
    );
    assert.equal(
      canCustomerReadQuoteRequest(
        token("member", "other@nonghyup.com"),
        request,
      ),
      false,
    );
  });

  it("uses a trusted customer UID for an audit request when available", () => {
    const request = {
      id: "request-uid",
      sourceType: "audit_quote",
      customerUid: "owner",
      customerEmail: "requested@nonghyup.com",
    } as QuoteRequestRecord;
    assert.equal(
      canCustomerReadQuoteRequest(
        token("owner", "changed@nonghyup.com"),
        request,
      ),
      true,
    );
    assert.equal(
      canCustomerReadQuote(
        token("owner", "changed@nonghyup.com"),
        {
          ...QUOTE,
          customerEmail: "requested@nonghyup.com",
          status: "finalized",
        },
        request,
      ),
      true,
    );
    assert.equal(
      canCustomerReadQuoteRequest(
        token("attacker", "changed@nonghyup.com"),
        request,
      ),
      false,
    );
  });

  it("places finalized PDFs in the inbox but never exposes drafts or void quotes", () => {
    const request = {
      id: "request-finalized",
      sourceType: "audit_quote",
      customerEmail: "owner@nonghyup.com",
    } as QuoteRequestRecord;
    assert.equal(
      canCustomerReadQuote(
        token("member", "owner@nonghyup.com"),
        { ...QUOTE, status: "finalized" },
        request,
      ),
      true,
    );
    assert.equal(
      canCustomerReadQuote(
        token("member", "owner@nonghyup.com"),
        { ...QUOTE, status: "draft" },
        request,
      ),
      false,
    );
    assert.equal(
      canCustomerReadQuote(
        token("member", "owner@nonghyup.com"),
        { ...QUOTE, status: "void" },
        request,
      ),
      false,
    );
  });

  it("escapes untrusted values before inserting them into email HTML", () => {
    assert.equal(
      escapeEmailHtml(`<img src=x onerror="alert('x')">&`),
      "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;",
    );
  });

  it("does not report email delivery ready without Resend configuration", () => {
    const previousApiKey = process.env.RESEND_API_KEY;
    const previousFrom = process.env.RESEND_FROM_EMAIL;
    try {
      delete process.env.RESEND_API_KEY;
      delete process.env.RESEND_FROM_EMAIL;
      assert.equal(
        getTransactionalEmailConfigurationError(),
        "resend_not_configured",
      );

      process.env.RESEND_API_KEY = "re_test";
      process.env.RESEND_FROM_EMAIL = "농협지원센터 <quotes@example.com>";
      assert.equal(getTransactionalEmailConfigurationError(), null);
    } finally {
      if (previousApiKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousApiKey;
      if (previousFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
      else process.env.RESEND_FROM_EMAIL = previousFrom;
    }
  });

  it("uses Vercel's production URL for customer email links", () => {
    const keys = [
      "NH_SUPPORT_BASE_URL",
      "AUDIT_QUOTE_ADMIN_BASE_URL",
      "AUDIT_EVALUATION_BASE_URL",
      "VERCEL_PROJECT_PRODUCTION_URL",
      "VERCEL_URL",
    ] as const;
    const previous = Object.fromEntries(
      keys.map((key) => [key, process.env[key]]),
    );
    try {
      delete process.env.NH_SUPPORT_BASE_URL;
      delete process.env.AUDIT_QUOTE_ADMIN_BASE_URL;
      delete process.env.AUDIT_EVALUATION_BASE_URL;
      process.env.VERCEL_PROJECT_PRODUCTION_URL = "project.example.com";
      process.env.VERCEL_URL = "preview.example.com";

      assert.equal(getAppBaseUrl(), "https://project.example.com");
    } finally {
      for (const key of keys) {
        const value = previous[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
