import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AUDIT_QUOTE_REQUESTS } from "@/lib/audit-quote/collections";
import { notifyCustomerAuditQuoteRequestReceived } from "@/lib/audit-quote/customer-request-email";
import { retryAuditQuoteNotification } from "@/lib/audit-quote/notify";
import type { AuditQuoteRequestRecord } from "@/lib/audit-quote/types";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type { QuoteRecord, QuoteRequestRecord } from "@/lib/firebase/schema";
import {
  addAuditLog,
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
} from "@/lib/firebase/server";
import { resolveTemporaryAccountPassword } from "@/lib/email/temporary-account-notice";
import { reissueTemporaryQuoteMemberPassword } from "@/lib/members/temporary-quote-member";
import { deliverExistingQuoteToCustomer } from "@/lib/quotes/finalize-partner-quote-delivery";
import { quoteRequestIdFor } from "@/lib/quotes/quote-requests";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ requestId: string }> };

type RetryKind = "request_received" | "quote_delivery";

export async function POST(req: Request, { params }: Params) {
  let admin;
  try {
    admin = await requireAdminCapability(req, "auditQuotes:write");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const { requestId } = await params;
  let kind: RetryKind = "request_received";
  try {
    const body = (await req.json().catch(() => null)) as
      | { kind?: string }
      | null;
    if (body?.kind === "quote_delivery" || body?.kind === "request_received") {
      kind = body.kind;
    }
  } catch {
    kind = "request_received";
  }

  const db = adminDb();
  const snap = await db.collection(AUDIT_QUOTE_REQUESTS).doc(requestId).get();
  if (!snap.exists) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const record = snap.data() as AuditQuoteRequestRecord;

  if (kind === "quote_delivery") {
    const quoteRequestId = quoteRequestIdFor("audit_quote", requestId);
    const quoteRequestSnap = await db
      .collection("quoteRequests")
      .doc(quoteRequestId)
      .get();
    if (!quoteRequestSnap.exists) {
      return NextResponse.json(
        { ok: false, error: "quote_request_not_found" },
        { status: 404 },
      );
    }
    const quoteRequest = {
      ...(quoteRequestSnap.data() as QuoteRequestRecord),
      id: quoteRequestId,
    };
    const quotesSnap = await db
      .collection("quotes")
      .where("quoteRequestId", "==", quoteRequestId)
      .get();
    const quotes = quotesSnap.docs
      .map((doc) => doc.data() as QuoteRecord)
      .filter(
        (quote) =>
          Boolean(quote.pdfPath) &&
          quote.status !== "void" &&
          quote.status !== "draft",
      );
    if (quotes.length === 0) {
      return NextResponse.json(
        { ok: false, error: "no_quotes_to_resend" },
        { status: 409 },
      );
    }
    const results = [];
    for (const quote of quotes) {
      results.push(
        await deliverExistingQuoteToCustomer({
          db,
          quote,
          quoteRequest,
        }),
      );
    }
    const sent = results.filter((item) => item.ok).length;
    const failed = results.length - sent;
    await addAuditLog(db, {
      actorUid: admin.uid,
      actorEmail: admin.email,
      action: "audit_quote.notify_retry",
      targetType: "auditQuote",
      targetId: requestId,
      metadata: {
        publicReference: record.publicReference,
        kind,
        sent,
        failed,
      },
    });
    if (sent === 0) {
      return NextResponse.json(
        { ok: false, error: "audit_quote_delivery_failed", kind, sent, failed },
        { status: 502 },
      );
    }
    void retryAuditQuoteNotification(db, requestId, {
      publicReference: record.publicReference,
      email: record.email,
      campaign: record.campaign,
    }).catch(() => undefined);
    return NextResponse.json({
      ok: true,
      kind,
      sent,
      failed,
    });
  }

  const issuedPassword = await reissueTemporaryQuoteMemberPassword({
    auth: adminAuth(),
    db,
    email: record.email,
    phone: record.phone ?? "",
  });
  const initialPassword = resolveTemporaryAccountPassword(
    record.phone,
    issuedPassword,
  );
  const customerResult = await notifyCustomerAuditQuoteRequestReceived({
    requestId,
    publicReference: record.publicReference,
    email: record.email,
    contactName: record.contactName,
    targetCooperativeName: record.targetCooperativeName,
    fiscalYear: record.fiscalYear,
    phone: record.phone,
    initialPassword,
    attemptKey: randomUUID(),
  });
  await addAuditLog(db, {
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: "audit_quote.notify_retry",
    targetType: "auditQuote",
    targetId: requestId,
    metadata: {
      publicReference: record.publicReference,
      kind,
      customerOk: customerResult.ok,
      customerError: customerResult.error ?? null,
      includedPassword: Boolean(initialPassword),
    },
  });

  if (!customerResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        kind,
        includedPassword: Boolean(initialPassword),
        error: customerResult.error ?? "send_failed",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    kind,
    includedPassword: Boolean(initialPassword),
  });
}
