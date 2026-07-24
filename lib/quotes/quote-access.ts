import type { DecodedIdToken } from "firebase-admin/auth";
import type { QuoteRecord, QuoteRequestRecord } from "@/lib/firebase/schema";

export function canCustomerReadQuoteRequest(
  decoded: DecodedIdToken,
  quoteRequest: QuoteRequestRecord,
) {
  const email = decoded.email?.trim().toLowerCase() ?? "";
  const uidMatches = Boolean(
    quoteRequest.customerUid &&
      quoteRequest.customerUid === decoded.uid,
  );
  const auditEmailMatches = Boolean(
    quoteRequest.sourceType === "audit_quote" &&
      email &&
      quoteRequest.customerEmail.trim().toLowerCase() === email,
  );
  return uidMatches || auditEmailMatches;
}

export function canCustomerReadQuote(
  decoded: DecodedIdToken,
  quote: QuoteRecord,
  quoteRequest: QuoteRequestRecord,
) {
  const email = decoded.email?.trim().toLowerCase() ?? "";
  const uidMatches = Boolean(
    quoteRequest.customerUid &&
      quoteRequest.customerUid === decoded.uid,
  );
  const ownerMatches =
    canCustomerReadQuoteRequest(decoded, quoteRequest) &&
    (uidMatches ||
      quote.customerEmail.trim().toLowerCase() === email);
  return Boolean(
    ["finalized", "delivered"].includes(quote.status) &&
      quote.pdfPath &&
      ownerMatches,
  );
}
