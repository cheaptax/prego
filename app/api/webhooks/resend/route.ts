import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import type { QuoteEmailDeliveryRecord } from "@/lib/firebase/schema";
import { verifyResendWebhook } from "@/lib/email/resend";

export const runtime = "nodejs";

const STATUS_BY_EVENT: Record<string, QuoteEmailDeliveryRecord["status"]> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.delivery_delayed": "sending",
  "email.failed": "failed",
};

export async function POST(req: Request) {
  const rawBody = await req.text();
  let payload;
  try {
    payload = verifyResendWebhook(rawBody, req.headers);
  } catch (error) {
    const misconfigured =
      error instanceof Error &&
      error.message === "resend_webhook_not_configured";
    return NextResponse.json(
      {
        ok: false,
        error: misconfigured ? "webhook_not_configured" : "invalid_signature",
      },
      { status: misconfigured ? 503 : 401 },
    );
  }
  const eventType = payload.type;
  const status = STATUS_BY_EVENT[eventType];
  const messageId =
    "email_id" in payload.data ? payload.data.email_id : "";
  if (!status || !messageId) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  const snapshot = await adminDb()
    .collection("quoteEmailDeliveries")
    .where("providerMessageId", "==", messageId)
    .limit(5)
    .get();
  const now = new Date().toISOString();
  await Promise.all(
    snapshot.docs.map((doc) =>
      doc.ref.set(
        {
          status,
          updatedAt: now,
        } satisfies Partial<QuoteEmailDeliveryRecord>,
        { merge: true },
      ),
    ),
  );
  return NextResponse.json({ ok: true, updated: snapshot.size });
}
