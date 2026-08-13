import assert from "node:assert/strict";
import test from "node:test";
import type { QuoteRecord } from "@/lib/firebase/schema";
import { quoteDocumentForPersistence } from "@/lib/quotes/quote-persistence";

function quote(overrides: Partial<QuoteRecord> = {}): QuoteRecord {
  const now = "2026-08-13T00:00:00.000Z";
  return {
    id: "assignment-1_v1",
    quoteRequestId: "qr-1",
    quoteAssignmentId: "assignment-1",
    partnerId: "partner-1",
    partnerName: "테스트회계법인",
    status: "finalized",
    version: 1,
    customerEmail: "customer@example.com",
    supplierName: "테스트회계법인",
    supplierContactEmail: "partner@example.com",
    lineItems: [
      {
        id: "audit-fee",
        name: "회계감사 보수",
        quantity: 1,
        unitPrice: 8_500_000,
        supplyAmount: 8_500_000,
      },
    ],
    subtotal: 8_500_000,
    taxAmount: 850_000,
    totalAmount: 9_350_000,
    vatIncluded: true,
    createdBy: "partner-1",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function hasUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(hasUndefined);
  if (value && typeof value === "object") {
    return Object.values(value).some(hasUndefined);
  }
  return false;
}

test("first quote persist payload omits undefined supersedesQuoteId", () => {
  const persisted = quoteDocumentForPersistence({
    quote: quote({ logoPath: undefined, sealPath: undefined }),
    pdfPath: "quotes/assignment-1_v1/v1/quote.pdf",
    pdfFileName: "테스트농협_테스트회계법인_FY2027 외부회계감사견적서.pdf",
    supersededQuoteId: undefined,
    updatedAt: "2026-08-13T01:00:00.000Z",
  });
  assert.equal("supersedesQuoteId" in persisted, false);
  assert.equal("logoPath" in persisted, false);
  assert.equal(persisted.pdfPath, "quotes/assignment-1_v1/v1/quote.pdf");
  assert.equal(hasUndefined(persisted), false);
});

test("revision persist payload keeps supersedesQuoteId", () => {
  const persisted = quoteDocumentForPersistence({
    quote: quote({ id: "assignment-1_v2", version: 2 }),
    pdfPath: "quotes/assignment-1_v2/v2/quote.pdf",
    pdfFileName: "테스트농협_테스트회계법인_FY2027 외부회계감사견적서_v2.pdf",
    supersededQuoteId: "assignment-1_v1",
    updatedAt: "2026-08-13T02:00:00.000Z",
  });
  assert.equal(persisted.supersedesQuoteId, "assignment-1_v1");
  assert.equal(hasUndefined(persisted), false);
});
