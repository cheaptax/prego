import { NextResponse } from "next/server";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import type {
  QuoteEmailDeliveryRecord,
  QuoteRecord,
} from "@/lib/firebase/schema";
import {
  getTransactionalEmailConfigurationError,
  sendTransactionalEmail,
} from "@/lib/email/resend";
import { buildCustomerQuoteEmail } from "@/lib/quotes/customer-quote-email";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (
    !cronSecret ||
    request.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    return NextResponse.json(
      { ok: false, error: "access_denied" },
      { status: 403 },
    );
  }
  const db = adminDb();
  const finalizedQuotes = await db
    .collection("quotes")
    .where("status", "==", "finalized")
    .limit(10)
    .get();
  let queued = 0;
  for (const quoteDoc of finalizedQuotes.docs) {
    const quote = quoteDoc.data() as QuoteRecord;
    if (!quote.pdfPath || !quote.customerEmail) continue;
    const deliveryRef = db
      .collection("quoteEmailDeliveries")
      .doc(`${quote.id}_customer`);
    const created = await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(deliveryRef);
      if (existing.exists) return false;
      const now = new Date().toISOString();
      transaction.set(deliveryRef, {
        id: deliveryRef.id,
        quoteId: quote.id,
        quoteRequestId: quote.quoteRequestId,
        recipientEmail: quote.customerEmail,
        status: "pending",
        provider: "local",
        attemptCount: 0,
        createdAt: now,
        updatedAt: now,
      } satisfies QuoteEmailDeliveryRecord);
      return true;
    });
    if (created) queued += 1;
  }
  const configurationError = getTransactionalEmailConfigurationError();
  if (configurationError) {
    return NextResponse.json({
      ok: true,
      configured: false,
      queued,
      scanned: 0,
      sent: 0,
      failed: 0,
    });
  }
  const snapshot = await db
    .collection("quoteEmailDeliveries")
    .where("status", "in", ["pending", "failed"])
    .limit(10)
    .get();
  let sent = 0;
  let failed = 0;
  for (const doc of snapshot.docs) {
    const delivery = doc.data() as QuoteEmailDeliveryRecord;
    if (delivery.attemptCount >= 5) continue;
    const quoteSnapshot = await db.collection("quotes").doc(delivery.quoteId).get();
    if (!quoteSnapshot.exists) continue;
    const quote = quoteSnapshot.data() as QuoteRecord;
    if (!quote.pdfPath) continue;
    await doc.ref.set(
      {
        status: "sending",
        attemptCount: delivery.attemptCount + 1,
        updatedAt: new Date().toISOString(),
      } satisfies Partial<QuoteEmailDeliveryRecord>,
      { merge: true },
    );
    try {
      const [pdfBuffer] = await adminStorage().bucket().file(quote.pdfPath).download();
      const emailContent = await buildCustomerQuoteEmail({ db, quote });
      const result = await sendTransactionalEmail({
        to: delivery.recipientEmail,
        ...emailContent,
        attachments: [
          { filename: quote.pdfFileName ?? "quote.pdf", content: pdfBuffer },
        ],
        idempotencyKey: `quote/${quote.id}/customer`,
      });
      if (result.provider === "local") {
        throw new Error("resend_not_configured");
      }
      const sentAt = new Date().toISOString();
      await doc.ref.set(
        {
          status: "sent",
          provider: result.provider,
          providerMessageId: result.id,
          recipientEmail: result.recipientEmail,
          sentAt,
          updatedAt: sentAt,
        } satisfies Partial<QuoteEmailDeliveryRecord>,
        { merge: true },
      );
      await db.collection("quotes").doc(quote.id).set(
        {
          status: "delivered",
          deliveredAt: sentAt,
          updatedAt: sentAt,
        } satisfies Partial<QuoteRecord>,
        { merge: true },
      );
      sent += 1;
    } catch (error) {
      await doc.ref.set(
        {
          status: "failed",
          lastError: error instanceof Error ? error.message : "send_failed",
          updatedAt: new Date().toISOString(),
        } satisfies Partial<QuoteEmailDeliveryRecord>,
        { merge: true },
      );
      failed += 1;
    }
  }
  return NextResponse.json({
    ok: true,
    configured: true,
    queued,
    scanned: snapshot.size,
    sent,
    failed,
  });
}
