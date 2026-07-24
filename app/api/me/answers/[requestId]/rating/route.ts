import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import {
  authErrorCode,
  authErrorStatus,
  requireWritableActiveMember,
  writeAuditLog,
} from "@/lib/firebase/server";
import type { AnswerRatingRecord } from "@/lib/firebase/schema";

export const runtime = "nodejs";

type Params = { params: Promise<{ requestId: string }> };
type Payload = { score?: number; helpful?: boolean | string; comment?: string };

export async function POST(req: Request, { params }: Params) {
  let memberSession;
  try {
    memberSession = await requireWritableActiveMember(req);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }
  const { decoded } = memberSession;

  const { requestId } = await params;
  const body = (await req.json().catch(() => null)) as Payload | null;
  const score = Number(body?.score);
  const helpful =
    typeof body?.helpful === "boolean"
      ? body.helpful
      : body?.helpful === "true"
        ? true
        : body?.helpful === "false"
          ? false
          : undefined;
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return NextResponse.json({ ok: false, error: "invalid_score" }, { status: 400 });
  }

  const db = adminDb();
  const answerRef = db.collection("answers").doc(requestId);
  const viewRef = db.collection("answerViews").doc(`${requestId}_${decoded.uid}`);
  const ratingRef = db.collection("answerRatings").doc(`${requestId}_${decoded.uid}`);
  const now = new Date().toISOString();

  await db.runTransaction(async (transaction) => {
    const [answerSnapshot, viewSnapshot, ratingSnapshot] = await Promise.all([
      transaction.get(answerRef),
      transaction.get(viewRef),
      transaction.get(ratingRef),
    ]);
    if (!answerSnapshot.exists || !viewSnapshot.exists) {
      throw new Error("answer_not_viewed");
    }

    transaction.set(
      ratingRef,
      withoutUndefined({
        id: ratingRef.id,
        requestId,
        answerId: answerRef.id,
        uid: decoded.uid,
        score,
        helpful,
        comment: body?.comment?.trim(),
        createdAt: ratingSnapshot.exists
          ? (ratingSnapshot.data() as AnswerRatingRecord).createdAt
          : now,
        updatedAt: now,
      } satisfies AnswerRatingRecord),
      { merge: true }
    );
    writeAuditLog(transaction, db, {
      actorUid: decoded.uid,
      actorEmail: decoded.email,
      action: "answer.rating.saved",
      targetType: "answer",
      targetId: answerRef.id,
      metadata: { requestId, score, helpful: helpful ?? null },
      createdAt: now,
    });
  });

  return NextResponse.json({ ok: true });
}
