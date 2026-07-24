import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import {
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
  writeAuditLog,
} from "@/lib/firebase/server";
import type {
  ConsultRequestRecord,
  PartnerAssignmentRecord,
  PartnerRecord,
} from "@/lib/firebase/schema";
import { isPartnerActive } from "@/lib/partners";

export const runtime = "nodejs";

type Params = { params: Promise<{ requestId: string }> };
type Payload = {
  partnerId?: string;
};

export async function POST(req: Request, { params }: Params) {
  let admin;
  try {
    admin = await requireAdminCapability(req, "inquiries:write");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const { requestId } = await params;
  const body = (await req.json().catch(() => null)) as Payload | null;
  const partnerId = body?.partnerId?.trim() ?? "";
  if (!partnerId) {
    return NextResponse.json(
      { ok: false, error: "missing_partner" },
      { status: 400 },
    );
  }

  const db = adminDb();
  const requestRef = db.collection("consultRequests").doc(requestId);
  const partnerRef = db.collection("partners").doc(partnerId);
  const assignmentRef = db.collection("partnerAssignments").doc(`${requestId}_${partnerId}`);
  const now = new Date().toISOString();

  const result = await db.runTransaction(async (transaction) => {
    const [requestSnapshot, partnerSnapshot, assignmentSnapshot] =
      await Promise.all([
        transaction.get(requestRef),
        transaction.get(partnerRef),
        transaction.get(assignmentRef),
      ]);
    if (!requestSnapshot.exists) {
      return { ok: false as const, error: "request_not_found" };
    }
    if (!partnerSnapshot.exists) {
      return { ok: false as const, error: "partner_not_found" };
    }
    const request = requestSnapshot.data() as ConsultRequestRecord;
    const partner = partnerSnapshot.data() as PartnerRecord;
    if (!isPartnerActive(partner)) {
      return { ok: false as const, error: "partner_inactive" };
    }
    const requestCategory =
      (request.internalCategory ?? request.internal_category)?.trim();
    if (
      requestCategory &&
      !partner.fields.includes(requestCategory)
    ) {
      return { ok: false as const, error: "partner_scope_mismatch" };
    }

    const previous = assignmentSnapshot.exists
      ? (assignmentSnapshot.data() as PartnerAssignmentRecord)
      : null;
    const assignment: PartnerAssignmentRecord = withoutUndefined({
      id: assignmentRef.id,
      requestId,
      partnerId,
      partnerName: partner.displayName,
      status: previous?.status && previous.status !== "revoked"
        ? previous.status
        : "assigned",
      assignedBy: previous?.assignedBy ?? admin.uid,
      assignedByEmail: previous?.assignedByEmail ?? admin.email,
      assignedAt: previous?.assignedAt ?? now,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    } satisfies PartnerAssignmentRecord);

    transaction.set(assignmentRef, assignment, { merge: true });
    transaction.set(
      requestRef,
      withoutUndefined({
        ...request,
        assignedPartnerId: partnerId,
        assignedPartnerName: partner.displayName,
        partnerAssignmentId: assignment.id,
        status: request.status === "submitted" ? "assigned" : request.status,
        updatedAt: now,
      } satisfies ConsultRequestRecord),
      { merge: true },
    );
    writeAuditLog(transaction, db, {
      actorUid: admin.uid,
      actorEmail: admin.email,
      action: "inquiry.assignment.created",
      targetType: "partnerAssignment",
      targetId: assignment.id,
      metadata: {
        requestId,
        partnerId,
        partnerName: partner.displayName,
      },
      createdAt: now,
    });
    return { ok: true as const, assignment };
  });

  if (!result.ok) {
    const status = result.error.endsWith("_not_found") ? 404 : 400;
    return NextResponse.json(
      { ok: false, error: result.error },
      { status },
    );
  }

  return NextResponse.json({ ok: true, assignment: result.assignment });
}

export async function DELETE(req: Request, { params }: Params) {
  let admin;
  try {
    admin = await requireAdminCapability(req, "inquiries:write");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const { requestId } = await params;
  const db = adminDb();
  const requestRef = db.collection("consultRequests").doc(requestId);
  const now = new Date().toISOString();
  const assignmentSnapshot = await db
    .collection("partnerAssignments")
    .where("requestId", "==", requestId)
    .where("status", "!=", "revoked")
    .limit(1)
    .get();
  if (assignmentSnapshot.empty) {
    return NextResponse.json(
      { ok: false, error: "assignment_not_found" },
      { status: 404 },
    );
  }

  const assignmentRef = assignmentSnapshot.docs[0].ref;
  const assignment = assignmentSnapshot.docs[0].data() as PartnerAssignmentRecord;
  await db.runTransaction(async (transaction) => {
    transaction.set(
      assignmentRef,
      {
        status: "revoked",
        revokedBy: admin.uid,
        revokedAt: now,
        updatedAt: now,
      } satisfies Partial<PartnerAssignmentRecord>,
      { merge: true },
    );
    transaction.set(
      requestRef,
      {
        assignedPartnerId: null,
        assignedPartnerName: null,
        partnerAssignmentId: null,
        updatedAt: now,
      },
      { merge: true },
    );
    writeAuditLog(transaction, db, {
      actorUid: admin.uid,
      actorEmail: admin.email,
      action: "inquiry.assignment.revoked",
      targetType: "partnerAssignment",
      targetId: assignment.id,
      metadata: {
        requestId,
        partnerId: assignment.partnerId,
      },
      createdAt: now,
    });
  });

  return NextResponse.json({ ok: true });
}
