import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requireWritableActiveMember,
  writeAuditLog,
} from "@/lib/firebase/server";
import type { ConsultRequestRecord } from "@/lib/firebase/schema";

export const runtime = "nodejs";

type Params = { params: Promise<{ requestId: string }> };

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
  const db = adminDb();

  const requestRef = db.collection("consultRequests").doc(requestId);
  const viewRef = db.collection("answerViews").doc(`${requestId}_${decoded.uid}`);
  const ratingRef = db.collection("answerRatings").doc(`${requestId}_${decoded.uid}`);
  const now = new Date().toISOString();

  try {
    const result = await db.runTransaction(async (transaction) => {
      const [requestSnapshot, viewSnapshot, ratingSnapshot] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(viewRef),
        transaction.get(ratingRef),
      ]);

      if (!requestSnapshot.exists) throw new Error("request_not_found");
      const requestRecord = requestSnapshot.data() as ConsultRequestRecord;
      if (requestRecord.uid !== decoded.uid) throw new Error("permission_denied");
      if (!viewSnapshot.exists) throw new Error("answer_not_viewed");
      if (!ratingSnapshot.exists) throw new Error("rating_required");

      transaction.update(requestRef, {
        status: "COMPLETED",
        updatedAt: now,
      });
      writeAuditLog(transaction, db, {
        actorUid: decoded.uid,
        actorEmail: decoded.email,
        action: "request.completed",
        targetType: "request",
        targetId: requestId,
        metadata: { ratingRequired: true },
        createdAt: now,
      });

      return { status: "COMPLETED" as const, updatedAt: now };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "request_complete_failed";
    const status =
      message === "permission_denied"
        ? 403
        : message === "request_not_found"
          ? 404
          : message === "rating_required" || message === "answer_not_viewed"
            ? 400
            : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
