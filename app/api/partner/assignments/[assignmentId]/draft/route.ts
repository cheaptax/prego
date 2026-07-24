import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import {
  authErrorCode,
  authErrorStatus,
  canPartnerReadAssignment,
  requirePartner,
  writeAuditLog,
} from "@/lib/firebase/server";
import type {
  PartnerAnswerDraftRecord,
  PartnerAssignmentRecord,
  PartnerRecord,
} from "@/lib/firebase/schema";
import { canPartnerPriceAnswer } from "@/lib/partners";

export const runtime = "nodejs";

type Params = { params: Promise<{ assignmentId: string }> };
type Payload = {
  body?: string;
  pointCost?: number;
  submit?: boolean;
};

export async function PUT(req: Request, { params }: Params) {
  let partnerSession;
  try {
    partnerSession = await requirePartner(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const { assignmentId } = await params;
  const body = (await req.json().catch(() => null)) as Payload | null;
  const answerBody = body?.body?.trim() ?? "";
  const pointCost = Number(body?.pointCost);
  if (!answerBody || !Number.isInteger(pointCost)) {
    return NextResponse.json(
      { ok: false, error: "invalid_draft" },
      { status: 400 },
    );
  }

  const db = adminDb();
  const assignmentRef = db.collection("partnerAssignments").doc(assignmentId);
  const draftRef = db.collection("partnerAnswerDrafts").doc(assignmentId);
  const now = new Date().toISOString();
  const partnerId = partnerSession.profile?.partnerId ?? "";

  const result = await db.runTransaction(async (transaction) => {
    const [assignmentSnapshot, partnerSnapshot, draftSnapshot] =
      await Promise.all([
        transaction.get(assignmentRef),
        transaction.get(db.collection("partners").doc(partnerId)),
        transaction.get(draftRef),
      ]);
    if (!assignmentSnapshot.exists || !partnerSnapshot.exists) {
      return { ok: false as const, error: "assignment_not_found" };
    }
    const assignment = assignmentSnapshot.data() as PartnerAssignmentRecord;
    const partner = partnerSnapshot.data() as PartnerRecord;
    if (!canPartnerReadAssignment(assignment, partnerId)) {
      return { ok: false as const, error: "permission_denied" };
    }
    if (!canPartnerPriceAnswer(partner, pointCost)) {
      return { ok: false as const, error: "invalid_point_cost" };
    }
    const existing = draftSnapshot.exists
      ? (draftSnapshot.data() as PartnerAnswerDraftRecord)
      : null;
    if (
      existing?.status === "approved" ||
      existing?.status === "submitted"
    ) {
      return { ok: false as const, error: "draft_locked" };
    }
    const status = body?.submit ? "submitted" : "draft";
    const draft: PartnerAnswerDraftRecord = withoutUndefined({
      id: draftRef.id,
      assignmentId,
      requestId: assignment.requestId,
      partnerId,
      body: answerBody,
      pointCost,
      status,
      revisionNote: status === "draft" ? existing?.revisionNote : undefined,
      submittedAt: status === "submitted" ? now : existing?.submittedAt,
      createdBy: existing?.createdBy ?? partnerSession.decoded.uid,
      createdByEmail: existing?.createdByEmail ?? partnerSession.decoded.email,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    } satisfies PartnerAnswerDraftRecord);

    transaction.set(draftRef, draft, { merge: true });
    transaction.set(
      assignmentRef,
      {
        status: status === "submitted" ? "submitted" : "drafting",
        updatedAt: now,
      } satisfies Partial<PartnerAssignmentRecord>,
      { merge: true },
    );
    writeAuditLog(transaction, db, {
      actorUid: partnerSession.decoded.uid,
      actorEmail: partnerSession.decoded.email,
      action:
        status === "submitted"
          ? "partner.answer.submitted"
          : "partner.answer.saved",
      targetType: "partnerAnswerDraft",
      targetId: draft.id,
      metadata: {
        requestId: draft.requestId,
        partnerId,
        pointCost,
      },
      createdAt: now,
    });
    return { ok: true as const, draft };
  });

  if (!result.ok) {
    const status = result.error === "permission_denied" ? 403 : 400;
    return NextResponse.json(
      { ok: false, error: result.error },
      { status },
    );
  }

  return NextResponse.json({ ok: true, draft: result.draft });
}
