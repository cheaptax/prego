import { withoutUndefined } from "@/lib/firebase/clean";
import type { QuoteRecord } from "@/lib/firebase/schema";
import { withStandardQuoteConditions } from "@/lib/quotes/quote-presentation";

/** Firestore rejects explicit `undefined` fields. First sends have no prior quote. */
export function quoteDocumentForPersistence(input: {
  quote: QuoteRecord;
  pdfPath: string;
  pdfFileName: string;
  supersededQuoteId?: string;
  updatedAt: string;
}): QuoteRecord {
  return withoutUndefined({
    ...withStandardQuoteConditions(input.quote),
    pdfPath: input.pdfPath,
    pdfFileName: input.pdfFileName,
    supersedesQuoteId: input.supersededQuoteId,
    updatedAt: input.updatedAt,
  });
}
