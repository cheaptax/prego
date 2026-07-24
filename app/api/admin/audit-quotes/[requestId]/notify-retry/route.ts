import { NextResponse } from "next/server";
import { AUDIT_QUOTE_REQUESTS } from "@/lib/audit-quote/collections";
import { retryAuditQuoteNotification } from "@/lib/audit-quote/notify";
import type { AuditQuoteRequestRecord } from "@/lib/audit-quote/types";
import { adminDb } from "@/lib/firebase/admin";
import {
  addAuditLog,
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
} from "@/lib/firebase/server";

export const runtime = "nodejs";

type Params = { params: Promise<{ requestId: string }> };

export async function POST(req: Request, { params }: Params) {
  let admin;
  try {
    admin = await requireAdminCapability(req, "auditQuotes:write");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) }
    );
  }

  const { requestId } = await params;
  const db = adminDb();
  const snap = await db.collection(AUDIT_QUOTE_REQUESTS).doc(requestId).get();
  if (!snap.exists) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const record = snap.data() as AuditQuoteRequestRecord;
  const result = await retryAuditQuoteNotification(db, requestId, {
    publicReference: record.publicReference,
    email: record.email,
    campaign: record.campaign,
  });

  await addAuditLog(db, {
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: "audit_quote.notify_retry",
    targetType: "auditQuote",
    targetId: requestId,
    metadata: {
      publicReference: record.publicReference,
      notifyStatus: result.status,
      attempts: result.attempts,
    },
  });

  return NextResponse.json({
    ok: true,
    notifyStatus: result.status,
    attempts: result.attempts,
  });
}
