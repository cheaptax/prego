import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import {
  authErrorCode,
  authErrorStatus,
  requirePermission,
  writeAuditLog,
} from "@/lib/firebase/server";
import type {
  PartnerRecord,
  QuoteAssignmentRecord,
  QuoteRequestRecord,
} from "@/lib/firebase/schema";
import { isPartnerActive } from "@/lib/partners";
import { isPartnerEligibleForAuditQuote } from "@/lib/quotes/audit-quote-assignment";
import { notifyPartnerQuoteAssignment } from "@/lib/quotes/partner-assignment-email";

export const runtime = "nodejs";

type Params = { params: Promise<{ quoteRequestId: string }> };
type Payload = { partnerId?: string };

export async function POST(req: Request, { params }: Params) {
  let session;
  try {
    session = await requirePermission(req, "inquiries:write");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }
  const { quoteRequestId } = await params;
  const body = (await req.json().catch(() => null)) as Payload | null;
  const partnerId = body?.partnerId?.trim() ?? "";
  if (!partnerId) {
    return NextResponse.json(
      { ok: false, error: "missing_partner" },
      { status: 400 },
    );
  }

  const db = adminDb();
  const quoteRequestRef = db.collection("quoteRequests").doc(quoteRequestId);
  const partnerRef = db.collection("partners").doc(partnerId);
  const assignmentRef = db
    .collection("quoteAssignments")
    .doc(`${quoteRequestId}_${partnerId}`);
  const now = new Date().toISOString();
  const result = await db.runTransaction(async (transaction) => {
    const [quoteRequestSnapshot, partnerSnapshot, assignmentSnapshot] =
      await Promise.all([
        transaction.get(quoteRequestRef),
        transaction.get(partnerRef),
        transaction.get(assignmentRef),
      ]);
    if (!quoteRequestSnapshot.exists) {
      return { ok: false as const, error: "quote_request_not_found" };
    }
    if (!partnerSnapshot.exists) {
      return { ok: false as const, error: "partner_not_found" };
    }
    const quoteRequest =
      quoteRequestSnapshot.data() as QuoteRequestRecord;
    const partner = partnerSnapshot.data() as PartnerRecord;
    if (!isPartnerActive(partner)) {
      return { ok: false as const, error: "partner_inactive" };
    }
    const auditEligible =
      quoteRequest.sourceType === "audit_quote" &&
      isPartnerEligibleForAuditQuote(partner);
    if (
      quoteRequest.supportField &&
      !partner.fields.includes(quoteRequest.supportField) &&
      !auditEligible
    ) {
      return { ok: false as const, error: "partner_scope_mismatch" };
    }
    const previous = assignmentSnapshot.exists
      ? (assignmentSnapshot.data() as QuoteAssignmentRecord)
      : null;
    const assignment: QuoteAssignmentRecord = withoutUndefined({
      id: assignmentRef.id,
      quoteRequestId,
      partnerId,
      partnerName: partner.displayName,
      status: previous?.status && previous.status !== "revoked"
        ? previous.status
        : "assigned",
      assignedBy: previous?.assignedBy ?? session.decoded.uid,
      assignedByEmail: previous?.assignedByEmail ?? session.decoded.email,
      assignedAt: previous?.assignedAt ?? now,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    } satisfies QuoteAssignmentRecord);
    transaction.set(assignmentRef, assignment, { merge: true });
    transaction.set(
      quoteRequestRef,
      {
        status: "assigned",
        updatedAt: now,
      } satisfies Partial<QuoteRequestRecord>,
      { merge: true },
    );
    writeAuditLog(transaction, db, {
      actorUid: session.decoded.uid,
      actorEmail: session.decoded.email,
      action: "quote.assignment.created",
      targetType: "quoteRequest",
      targetId: quoteRequestId,
      metadata: {
        partnerId,
        partnerName: partner.displayName,
      },
      createdAt: now,
    });
    return { ok: true as const, assignment };
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.error.endsWith("_not_found") ? 404 : 400 },
    );
  }

  const quoteRequestSnapshot = await quoteRequestRef.get();
  const quoteRequest = quoteRequestSnapshot.exists
    ? (quoteRequestSnapshot.data() as QuoteRequestRecord)
    : null;
  const partnerSnapshot = await partnerRef.get();
  const partner = partnerSnapshot.exists
    ? ({
        ...(partnerSnapshot.data() as PartnerRecord),
        id: partnerId,
      } satisfies PartnerRecord)
    : null;
  if (quoteRequest && partner) {
    void notifyPartnerQuoteAssignment({
      db,
      partner,
      quoteRequest: { ...quoteRequest, id: quoteRequestId },
      assignmentId: result.assignment.id,
    }).catch((error: unknown) => {
      console.error("[quote-assignment] notify_unhandled", {
        quoteRequestId,
        partnerId,
        error: error instanceof Error ? error.message : "notify_failed",
      });
    });
  }

  return NextResponse.json({ ok: true, assignment: result.assignment });
}

export async function DELETE(req: Request, { params }: Params) {
  let session;
  try {
    session = await requirePermission(req, "inquiries:write");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }
  const { quoteRequestId } = await params;
  const partnerId = new URL(req.url).searchParams.get("partnerId")?.trim();
  if (!partnerId) {
    return NextResponse.json(
      { ok: false, error: "missing_partner" },
      { status: 400 },
    );
  }
  const db = adminDb();
  const assignmentRef = db
    .collection("quoteAssignments")
    .doc(`${quoteRequestId}_${partnerId}`);
  const now = new Date().toISOString();
  await assignmentRef.set(
    {
      status: "revoked",
      revokedBy: session.decoded.uid,
      revokedAt: now,
      updatedAt: now,
    } satisfies Partial<QuoteAssignmentRecord>,
    { merge: true },
  );
  return NextResponse.json({ ok: true });
}
