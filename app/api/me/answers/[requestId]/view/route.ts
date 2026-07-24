import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  canReadRequest,
  requireWritableActiveMember,
  writeAuditLog,
} from "@/lib/firebase/server";
import type {
  AnswerRecord,
  AnswerViewRecord,
  ConsultRequestRecord,
  OrganizationRecord,
  PointLedgerRecord,
  PointTransactionRecord,
} from "@/lib/firebase/schema";

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
  const { decoded, profile: user } = memberSession;

  const { requestId } = await params;
  const db = adminDb();
  if (!user.cooperativeId) {
    return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
  }

  const requestRef = db.collection("consultRequests").doc(requestId);
  const answerRef = db.collection("answers").doc(requestId);
  const chargedViewRef = db.collection("answerViews").doc(`${requestId}_${user.cooperativeId}`);
  const userViewRef = db.collection("answerViews").doc(`${requestId}_${decoded.uid}`);
  const orgRef = db.collection("organizations").doc(user.cooperativeId);
  const ledgerRef = db.collection("pointLedger").doc();
  const transactionRef = db.collection("point_transactions").doc();
  const now = new Date().toISOString();

  try {
    const result = await db.runTransaction(async (transaction) => {
      const [
        requestSnapshot,
        answerSnapshot,
        chargedViewSnapshot,
        userViewSnapshot,
        orgSnapshot,
      ] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(answerRef),
        transaction.get(chargedViewRef),
        transaction.get(userViewRef),
        transaction.get(orgRef),
      ]);

      if (!requestSnapshot.exists || !answerSnapshot.exists) {
        throw new Error("answer_not_found");
      }
      const requestRecord = requestSnapshot.data() as ConsultRequestRecord;
      const answer = answerSnapshot.data() as AnswerRecord;
      if (!canReadRequest(requestRecord, user)) throw new Error("permission_denied");

      if (chargedViewSnapshot.exists) {
        if (!userViewSnapshot.exists) {
          transaction.set(userViewRef, {
            id: userViewRef.id,
            requestId,
            answerId: answer.id,
            cooperativeId: user.cooperativeId ?? "",
            nh_org_id: user.nh_org_id ?? user.cooperativeId,
            uid: decoded.uid,
            pointCost: answer.pointCost,
            charged: false,
            createdAt: now,
          } satisfies AnswerViewRecord);
        }
        const currentStatus = String(requestRecord.status ?? "").toUpperCase();
        if (
          currentStatus !== "ANSWER_PUBLISHED" &&
          currentStatus !== "COMPLETED" &&
          currentStatus !== "FOLLOWUP"
        ) {
          transaction.update(requestRef, {
            status: "ANSWER_PUBLISHED",
            updatedAt: now,
          });
          transaction.set(
            answerRef,
            {
              ...answer,
              status: "ANSWER_PUBLISHED",
              updatedAt: now,
            } satisfies AnswerRecord,
            { merge: true },
          );
        }
        return {
          answer,
          alreadyViewed: true,
          walletBalance: (orgSnapshot.data() as OrganizationRecord | undefined)?.walletBalance ?? 0,
        };
      }

      if (!orgSnapshot.exists) throw new Error("organization_not_found");
      const organization = orgSnapshot.data() as OrganizationRecord;
      if (organization.walletBalance < answer.pointCost) throw new Error("insufficient_points");

      const nextBalance = organization.walletBalance - answer.pointCost;
      transaction.update(orgRef, { walletBalance: nextBalance, updatedAt: now });
      transaction.update(requestRef, {
        status: "ANSWER_PUBLISHED",
        updatedAt: now,
      });
      transaction.set(
        answerRef,
        {
          ...answer,
          status: "ANSWER_PUBLISHED",
          updatedAt: now,
        } satisfies AnswerRecord,
        { merge: true },
      );
      const chargedView: AnswerViewRecord = {
        id: chargedViewRef.id,
        requestId,
        answerId: answer.id,
        cooperativeId: user.cooperativeId ?? "",
        nh_org_id: user.nh_org_id ?? user.cooperativeId,
        uid: decoded.uid,
        pointCost: answer.pointCost,
        charged: true,
        createdAt: now,
      };
      transaction.set(chargedViewRef, chargedView);
      transaction.set(userViewRef, { ...chargedView, id: userViewRef.id });
      const balanceBefore = organization.walletBalance;
      transaction.set(ledgerRef, {
        id: ledgerRef.id,
        cooperativeId: user.cooperativeId ?? "",
        nh_org_id: user.nh_org_id ?? user.cooperativeId,
        userId: decoded.uid,
        event: "answer_view",
        type: "question_answer_usage",
        amount: -answer.pointCost,
        points: -answer.pointCost,
        balanceBefore,
        balanceAfter: nextBalance,
        balance_before: balanceBefore,
        balance_after: nextBalance,
        related_inquiry_id: requestId,
        requestId,
        answerId: answer.id,
        reason: "답변 열람",
        createdAt: now,
      } satisfies PointLedgerRecord);
      transaction.set(transactionRef, {
        id: transactionRef.id,
        cooperativeId: user.cooperativeId ?? "",
        nh_org_id: user.nh_org_id ?? user.cooperativeId,
        user_id: decoded.uid,
        type: "question_answer_usage",
        amount: -answer.pointCost,
        balance_before: balanceBefore,
        balance_after: nextBalance,
        related_inquiry_id: requestId,
        requestId,
        answerId: answer.id,
        createdAt: now,
      } satisfies PointTransactionRecord);
      writeAuditLog(transaction, db, {
        actorUid: decoded.uid,
        actorEmail: decoded.email,
        action: "answer.viewed",
        targetType: "answer",
        targetId: answer.id,
        metadata: { requestId, pointCost: answer.pointCost, balanceAfter: nextBalance },
        createdAt: now,
      });

      return { answer, alreadyViewed: false, walletBalance: nextBalance };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    const status = message === "insufficient_points" ? 402 : message === "permission_denied" ? 403 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
