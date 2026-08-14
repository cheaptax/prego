import { NextResponse } from "next/server";
import { toAuditQuoteDetail } from "@/lib/audit-quote/admin";
import { AUDIT_QUOTE_REQUESTS } from "@/lib/audit-quote/collections";
import {
  canTransitionAuditQuoteStatus,
  isAuditQuoteStatus,
} from "@/lib/audit-quote/status";
import type {
  AuditQuoteRequestRecord,
  AuditQuoteStatus,
} from "@/lib/audit-quote/types";
import { toCustomerEmailDeliveryView } from "@/lib/email/delivery-status";
import { withoutUndefined } from "@/lib/firebase/clean";
import { adminDb } from "@/lib/firebase/admin";
import type { QuoteEmailDeliveryRecord } from "@/lib/firebase/schema";
import {
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
  writeAuditLog,
} from "@/lib/firebase/server";
import { quoteRequestIdFor } from "@/lib/quotes/quote-requests";

export const runtime = "nodejs";

type Params = { params: Promise<{ requestId: string }> };

type PatchBody = {
  status?: string;
  assignedTo?: string | null;
  quoteCount?: number;
  expectedUpdatedAt?: string;
};

function toIso(value: unknown) {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return "";
}

export async function GET(req: Request, { params }: Params) {
  try {
    await requireAdminCapability(req, "auditQuotes:read");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) }
    );
  }

  const { requestId } = await params;
  const snap = await adminDb().collection(AUDIT_QUOTE_REQUESTS).doc(requestId).get();
  if (!snap.exists) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const record = snap.data() as AuditQuoteRequestRecord;
  const quoteRequestId = quoteRequestIdFor("audit_quote", requestId);
  const [byAuditId, byQuoteRequestId, requestDeliverySnap] = await Promise.all([
    adminDb()
      .collection("quoteEmailDeliveries")
      .where("auditQuoteRequestId", "==", requestId)
      .get()
      .catch(() => null),
    adminDb()
      .collection("quoteEmailDeliveries")
      .where("quoteRequestId", "==", quoteRequestId)
      .get()
      .catch(() => null),
    adminDb()
      .collection("quoteEmailDeliveries")
      .doc(`aqreq_${requestId}`)
      .get()
      .catch(() => null),
  ]);
  const deliveries = new Map<string, QuoteEmailDeliveryRecord>();
  for (const doc of [
    ...(byAuditId?.docs ?? []),
    ...(byQuoteRequestId?.docs ?? []),
  ]) {
    deliveries.set(doc.id, doc.data() as QuoteEmailDeliveryRecord);
  }
  if (requestDeliverySnap?.exists) {
    deliveries.set(
      requestDeliverySnap.id,
      requestDeliverySnap.data() as QuoteEmailDeliveryRecord,
    );
  }
  return NextResponse.json({
    ok: true,
    item: toAuditQuoteDetail(record),
    emailDeliveries: Array.from(deliveries.values())
      .map(toCustomerEmailDeliveryView)
      .sort((left, right) =>
        (right.updatedAt || "").localeCompare(left.updatedAt || ""),
      ),
  });
}

export async function PATCH(req: Request, { params }: Params) {
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
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (
    body.status === undefined &&
    body.assignedTo === undefined &&
    body.quoteCount === undefined
  ) {
    return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
  }

  if (body.status !== undefined && !isAuditQuoteStatus(body.status)) {
    return NextResponse.json({ ok: false, error: "invalid_status" }, { status: 400 });
  }

  if (
    body.quoteCount !== undefined &&
    (!Number.isInteger(body.quoteCount) || body.quoteCount < 0 || body.quoteCount > 50)
  ) {
    return NextResponse.json({ ok: false, error: "invalid_quote_count" }, { status: 400 });
  }

  const db = adminDb();
  const ref = db.collection(AUDIT_QUOTE_REQUESTS).doc(requestId);
  const now = new Date().toISOString();

  try {
    const updated = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists) {
        throw Object.assign(new Error("not_found"), { code: "not_found" });
      }

      const current = snap.data() as AuditQuoteRequestRecord;
      const currentUpdatedAt = toIso(current.updatedAt);
      if (
        body.expectedUpdatedAt &&
        currentUpdatedAt &&
        body.expectedUpdatedAt !== currentUpdatedAt
      ) {
        throw Object.assign(new Error("conflict"), { code: "conflict" });
      }

      const nextStatus = (body.status ?? current.status) as AuditQuoteStatus;
      if (!canTransitionAuditQuoteStatus(current.status, nextStatus)) {
        throw Object.assign(new Error("invalid_transition"), {
          code: "invalid_transition",
        });
      }

      const nextAssigned =
        body.assignedTo === undefined
          ? current.assignedTo
          : body.assignedTo?.trim() || null;
      const nextQuoteCount =
        body.quoteCount === undefined ? current.quoteCount : body.quoteCount;

      const next: AuditQuoteRequestRecord = {
        ...current,
        status: nextStatus,
        assignedTo: nextAssigned,
        quoteCount: nextQuoteCount,
        updatedAt: now as unknown as AuditQuoteRequestRecord["updatedAt"],
      };

      transaction.set(ref, withoutUndefined(next), { merge: true });

      writeAuditLog(transaction, db, {
        actorUid: admin.uid,
        actorEmail: admin.email,
        action: "audit_quote.updated",
        targetType: "auditQuote",
        targetId: requestId,
        metadata: {
          publicReference: current.publicReference,
          fromStatus: current.status,
          toStatus: nextStatus,
          fromQuoteCount: current.quoteCount,
          toQuoteCount: nextQuoteCount,
          fromAssignedTo: current.assignedTo ?? null,
          toAssignedTo: nextAssigned,
        },
        createdAt: now,
      });

      return next;
    });

    return NextResponse.json({
      ok: true,
      item: toAuditQuoteDetail(updated),
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (code === "not_found") {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    if (code === "conflict") {
      return NextResponse.json({ ok: false, error: "conflict" }, { status: 409 });
    }
    if (code === "invalid_transition") {
      return NextResponse.json(
        { ok: false, error: "invalid_transition" },
        { status: 400 }
      );
    }
    throw error;
  }
}
