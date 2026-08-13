import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAppBaseUrl } from "@/lib/email/resend";
import {
  quoteComparisonReportPath,
  quoteComparisonReportUrl,
} from "@/lib/quotes/quote-comparison-link";
import { renderQuoteComparisonQrDataUri } from "@/lib/quotes/quote-pdf-qr";

describe("quote comparison report link", () => {
  it("deep-links audit quotes into the inbox comparison report entry", () => {
    assert.equal(
      quoteComparisonReportPath({
        quoteRequestId: "qr-1",
        sourceType: "audit_quote",
      }),
      "/mypage/quotes?compare=qr-1",
    );
    assert.equal(
      quoteComparisonReportUrl({
        quote: { quoteRequestId: "qr-1" },
        quoteRequest: { id: "qr-1", sourceType: "audit_quote" },
      }),
      `${getAppBaseUrl()}/mypage/quotes?compare=qr-1`,
    );
  });

  it("falls back to the quote inbox when the request is not an audit quote", () => {
    assert.equal(
      quoteComparisonReportPath({
        quoteRequestId: "qr-2",
        sourceType: "consult",
      }),
      "/mypage/quotes",
    );
  });

  it("encodes the comparison report link as a scannable QR image", async () => {
    const uri = await renderQuoteComparisonQrDataUri(
      `${getAppBaseUrl()}/mypage/quotes?compare=qr-1`,
    );
    assert.match(uri, /^data:image\/png;base64,/);
  });
});
