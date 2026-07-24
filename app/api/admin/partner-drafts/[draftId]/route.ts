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
  AnswerRecord,
  ConsultRequestRecord,
  PartnerAnswerDraftRecord,
  PartnerAssignmentRecord,
  PartnerRecord,
} from "@/lib/firebase/schema";
import { canApprovePartnerDraft, canPartnerPriceAnswer } from "@/lib/partners";

export const runtime = "nodejs";

type Params = { params: Promise<{ draftId: string }> };
type Payload = {
  action?: "approve" | "request_revision";
  revisionNote?: string;
};

export async function PATCH(req: Request, { params }: Params) {
  let admin;
  try {
    admin = await requireAdminCapability(req, "inquiries:write");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const body = (await req.json().catch(() => null)) as Payload | null;
  const action = body?.action === "request_revision" ? "request_revision" : "approve";
  const revisionNote = body?.revisionNote?.trim() ?? "";
  if (action === "request_revision" && !revisionNote) {
    return NextResponse.json(
      { ok: false, error: "missing_revision_note" },
      { status: 400 },
    );
  }

  const { draftId } = await params;
  const db = adminDb();
  const draftRef = db.collection("partnerAnswerDrafts").doc(draftId);
  const now = new Date().toISOString();

  const result = await db.runTransaction(async (transaction) => {
    const draftSnapshot = await transaction.get(draftRef);
    if (!draftSnapshot.exists) {
      return { ok: false as const, error: "draft_not_found" };
    }
    const draft = draftSnapshot.data() as PartnerAnswerDraftRecord;
    const assignmentRef = db.collection("partnerAssignments").doc(draft.assignmentId);
    const partnerRef = db.collection("partners").doc(draft.partnerId);
    const requestRef = db.collection("consultRequests").doc(draft.requestId);
    const answerRef = db.collection("answers").doc(draft.requestId);
    const [assignmentSnapshot, partnerSnapshot, requestSnapshot, answerSnapshot] =
      await Promise.all([
        transaction.get(assignmentRef),
        transaction.get(partnerRef),
        transaction.get(requestRef),
        transaction.get(answerRef),
      ]);
    if (!assignmentSnapshot.exists || !partnerSnapshot.exists || !requestSnapshot.exists) {
      return { ok: false as const, error: "linked_record_not_found" };
    }
    const assignment = assignmentSnapshot.data() as PartnerAssignmentRecord;
    const partner = partnerSnapshot.data() as PartnerRecord;
    const request = requestSnapshot.data() as ConsultRequestRecord;
    const existingAnswer = answerSnapshot.exists
      ? (answerSnapshot.data() as AnswerRecord)
      : null;
    if (!canPartnerPriceAnswer(partner, draft.pointCost)) {
      return { ok: false as const, error: "invalid_partner_point_cost" };
    }

    if (action === "request_revision") {
      transaction.set(
        draftRef,
        {
          status: "revision_requested",
          revisionNote,
          updatedAt: now,
        } satisfies Partial<PartnerAnswerDraftRecord>,
        { merge: true },
      );
      transaction.set(
        assignmentRef,
        {
          status: "revision_requested",
          revisionNote,
          updatedAt: now,
        } satisfies Partial<PartnerAssignmentRecord>,
        { merge: true },
      );
      writeAuditLog(transaction, db, {
        actorUid: admin.uid,
        actorEmail: admin.email,
        action: "partner.answer.revision_requested",
        targetType: "partnerAnswerDraft",
        targetId: draft.id,
        metadata: {
          requestId: draft.requestId,
          partnerId: draft.partnerId,
        },
        createdAt: now,
      });
      return { ok: true as const, draftId: draft.id };
    }

    if (!canApprovePartnerDraft(assignment, draft)) {
      return { ok: false as const, error: "draft_not_approvable" };
    }

    transaction.set(
      answerRef,
      withoutUndefined({
        id: answerRef.id,
        requestId: draft.requestId,
        body: draft.body,
        pointCost: draft.pointCost,
        status: "ANSWER_READY",
        source: "partner",
        partnerId: draft.partnerId,
        partnerAssignmentId: draft.assignmentId,
        partnerDraftId: draft.id,
        createdBy: existingAnswer?.createdBy ?? draft.createdBy,
        createdByEmail: existingAnswer?.createdByEmail ?? draft.createdByEmail,
        createdAt: existingAnswer?.createdAt ?? now,
        updatedAt: now,
      } satisfies AnswerRecord),
      { merge: true },
    );
    transaction.set(
      requestRef,
      withoutUndefined({
        ...request,
        status: "ANSWERED",
        answeredAt: request.answeredAt ?? now,
        updatedAt: now,
      } satisfies ConsultRequestRecord),
      { merge: true },
    );
    transaction.set(
      draftRef,
      {
        status: "approved",
        approvedAt: now,
        approvedBy: admin.uid,
        updatedAt: now,
      } satisfies Partial<PartnerAnswerDraftRecord>,
      { merge: true },
    );
    transaction.set(
      assignmentRef,
      {
        status: "approved",
        updatedAt: now,
      } satisfies Partial<PartnerAssignmentRecord>,
      { merge: true },
    );
    writeAuditLog(transaction, db, {
      actorUid: admin.uid,
      actorEmail: admin.email,
      action: "partner.answer.approved",
      targetType: "partnerAnswerDraft",
      targetId: draft.id,
      metadata: {
        requestId: draft.requestId,
        answerId: answerRef.id,
        partnerId: draft.partnerId,
        pointCost: draft.pointCost,
      },
      createdAt: now,
    });
    return { ok: true as const, draftId: draft.id, answerId: answerRef.id };
  });

  if (!result.ok) {
    const status = result.error.endsWith("_not_found") ? 404 : 400;
    return NextResponse.json(
      { ok: false, error: result.error },
      { status },
    );
  }

  return NextResponse.json(result);
}
