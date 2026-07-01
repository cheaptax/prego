import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import {
  authErrorCode,
  authErrorStatus,
  requireAdmin,
  validateAnswerPointCost,
  writeAuditLog,
} from "@/lib/firebase/server";
import { isValidSupportFieldLabel } from "@/lib/inquiry-categories";
import type { AnswerRecord, ConsultRequestRecord } from "@/lib/firebase/schema";

export const runtime = "nodejs";

type Params = { params: Promise<{ requestId: string }> };
type Payload = {
  internalCategory?: string;
  adminTags?: string[] | string;
  answerBody?: string;
  pointCost?: number;
};

function parseAdminTags(value: Payload["adminTags"]) {
  if (Array.isArray(value)) {
    return value.map((tag) => tag.trim()).filter(Boolean);
  }
  return String(value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export async function POST(req: Request, { params }: Params) {
  let decoded;
  try {
    decoded = await requireAdmin(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) }
    );
  }

  const { requestId } = await params;
  const body = (await req.json().catch(() => null)) as Payload | null;
  const pointCost = validateAnswerPointCost(body?.pointCost);
  const internalCategory = body?.internalCategory?.trim() ?? "";
  const adminTags = parseAdminTags(body?.adminTags);
  if (pointCost === null) {
    return NextResponse.json(
      { ok: false, error: "invalid_point_cost" },
      { status: 400 },
    );
  }
  if (
    !body?.answerBody?.trim() ||
    !internalCategory ||
    !isValidSupportFieldLabel(internalCategory) ||
    adminTags.length === 0
  ) {
    return NextResponse.json({ ok: false, error: "invalid_answer" }, { status: 400 });
  }

  const db = adminDb();
  const requestRef = db.collection("consultRequests").doc(requestId);
  const answerRef = db.collection("answers").doc(requestId);
  const now = new Date().toISOString();

  await db.runTransaction(async (transaction) => {
    const [requestSnapshot, answerSnapshot] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(answerRef),
    ]);
    if (!requestSnapshot.exists) throw new Error("request_not_found");
    const request = requestSnapshot.data() as ConsultRequestRecord;
    const existingAnswer = answerSnapshot.exists
      ? (answerSnapshot.data() as AnswerRecord)
      : null;

    transaction.set(
      answerRef,
      withoutUndefined({
        id: answerRef.id,
        requestId,
        body: body.answerBody?.trim() ?? "",
        pointCost,
        status: "ANSWER_READY",
        createdBy: existingAnswer?.createdBy ?? decoded.uid,
        createdByEmail: existingAnswer?.createdByEmail ?? decoded.email,
        createdAt: existingAnswer?.createdAt ?? now,
        updatedAt: now,
      } satisfies AnswerRecord),
      { merge: true }
    );
    transaction.set(
      requestRef,
      {
        ...request,
        internalCategory,
        internal_category: internalCategory,
        adminTags,
        status: "ANSWERED",
        answeredAt: request.answeredAt ?? now,
        updatedAt: now,
      } satisfies ConsultRequestRecord,
      { merge: true }
    );
    writeAuditLog(transaction, db, {
      actorUid: decoded.uid,
      actorEmail: decoded.email,
      action: "answer.upserted",
      targetType: "answer",
      targetId: answerRef.id,
      metadata: {
        requestId,
        pointCost,
        internalCategory,
        adminTags: adminTags.join(", "),
      },
      createdAt: now,
    });
  });

  return NextResponse.json({ ok: true, answerId: answerRef.id });
}
