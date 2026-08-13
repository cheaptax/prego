import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requireQuoteInboxMember,
  addAuditLog,
} from "@/lib/firebase/server";
import type { QuoteRecord, QuoteRequestRecord } from "@/lib/firebase/schema";
import { canCustomerReadQuote } from "@/lib/quotes/quote-access";
import { quotePdfFileNameFromRecords } from "@/lib/quotes/quote-pdf-filename";
import { createQuoteDownloadUrl } from "@/lib/quotes/quote-storage";

export const runtime = "nodejs";

type Params = { params: Promise<{ quoteId: string }> };

export async function GET(req: Request, { params }: Params) {
  let memberSession;
  try {
    memberSession = await requireQuoteInboxMember(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }
  const { decoded } = memberSession;
  const { quoteId } = await params;
  const db = adminDb();
  const quoteSnapshot = await db.collection("quotes").doc(quoteId).get();
  if (!quoteSnapshot.exists) {
    return NextResponse.json(
      { ok: false, error: "quote_not_found" },
      { status: 404 },
    );
  }
  const quote = quoteSnapshot.data() as QuoteRecord;
  const quoteRequestSnapshot = await db
    .collection("quoteRequests")
    .doc(quote.quoteRequestId)
    .get();
  if (!quoteRequestSnapshot.exists) {
    return NextResponse.json(
      { ok: false, error: "quote_request_not_found" },
      { status: 404 },
    );
  }
  const quoteRequest = quoteRequestSnapshot.data() as QuoteRequestRecord;
  if (!canCustomerReadQuote(decoded, quote, quoteRequest) || !quote.pdfPath) {
    return NextResponse.json(
      { ok: false, error: "permission_denied" },
      { status: 403 },
    );
  }
  const fileName = quotePdfFileNameFromRecords(quote, quoteRequest);
  const url = await createQuoteDownloadUrl({
    storagePath: quote.pdfPath,
    fileName,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
  await addAuditLog(db, {
    actorUid: decoded.uid,
    actorEmail: decoded.email,
    action: "quote.download_url_created",
    targetType: "quote",
    targetId: quote.id,
    metadata: {
      quoteRequestId: quote.quoteRequestId,
      partnerId: quote.partnerId,
    },
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true, url });
}
