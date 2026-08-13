import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  formatEmailFromHeader,
  getCustomerFacingAppBaseUrl,
  sanitizeResendDisplayName,
} from "@/lib/email/resend";

const previousDisplay = process.env.RESEND_FROM_DISPLAY_NAME;

afterEach(() => {
  if (previousDisplay === undefined) {
    delete process.env.RESEND_FROM_DISPLAY_NAME;
  } else {
    process.env.RESEND_FROM_DISPLAY_NAME = previousDisplay;
  }
});

describe("Resend-safe From header", () => {
  it("strips Korean from the display name so Gmail does not mojibake", () => {
    assert.equal(
      formatEmailFromHeader("PREGO 농협지원센터 <no-reply@example.com>"),
      "PREGO <no-reply@example.com>",
    );
    assert.equal(
      formatEmailFromHeader("농협지원센터 <quotes@example.com>"),
      "PREGO <quotes@example.com>",
    );
  });

  it("cleans already-corrupted display names left in env (PREGO ???…)", () => {
    assert.equal(
      formatEmailFromHeader("PREGO ?럾삣吏 <quotes@example.com>"),
      "PREGO <quotes@example.com>",
    );
    assert.equal(
      formatEmailFromHeader("PREGO ??? <quotes@example.com>"),
      "PREGO <quotes@example.com>",
    );
  });

  it("never emits RFC 2047 encoded-words (Resend rejects ?U / ?B patterns)", () => {
    const formatted = formatEmailFromHeader(
      "PREGO 농협지원센터 <no-reply@example.com>",
    );
    assert.equal(formatted.includes("=?"), false);
    assert.equal(formatted.includes("UTF-8"), false);
  });

  it("keeps ASCII display names and bare addresses", () => {
    assert.equal(
      formatEmailFromHeader("quotes@example.com"),
      "quotes@example.com",
    );
    assert.equal(
      formatEmailFromHeader("PREGO <quotes@example.com>"),
      "PREGO <quotes@example.com>",
    );
    assert.equal(
      formatEmailFromHeader("NH Support <quotes@example.com>"),
      "NH Support <quotes@example.com>",
    );
  });

  it("honors RESEND_FROM_DISPLAY_NAME when it is ASCII-safe", () => {
    process.env.RESEND_FROM_DISPLAY_NAME = "PREGO Support";
    assert.equal(
      sanitizeResendDisplayName("ignored 한글"),
      "PREGO Support",
    );
    assert.equal(
      formatEmailFromHeader("ignored 한글 <quotes@example.com>"),
      "PREGO Support <quotes@example.com>",
    );
  });

  it("unwraps already-encoded RFC 2047 phrases down to ASCII fallback", () => {
    const encoded = `=?UTF-8?B?${Buffer.from("농협지원센터", "utf8").toString("base64")}?=`;
    assert.equal(
      formatEmailFromHeader(`${encoded} <quotes@example.com>`),
      "PREGO <quotes@example.com>",
    );
  });
});

describe("customer-facing app base URL", () => {
  it("points local quote emails at localhost instead of production", () => {
    assert.equal(
      getCustomerFacingAppBaseUrl({
        NODE_ENV: "development",
      }),
      "http://localhost:3000",
    );
  });
});
