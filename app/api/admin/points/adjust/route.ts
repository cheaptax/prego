import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requirePermission,
  writeAuditLog,
} from "@/lib/firebase/server";
import type {
  OrganizationRecord,
  PointLedgerRecord,
  PointTransactionRecord,
} from "@/lib/firebase/schema";

export const runtime = "nodejs";

type Payload = {
  cooperativeId?: string;
  points?: number;
  reason?: string;
};

export async function POST(req: Request) {
  let decoded;
  try {
    decoded = (await requirePermission(req, "points:adjust")).decoded;
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) }
    );
  }

  const body = (await req.json().catch(() => null)) as Payload | null;
  const points = Number(body?.points);
  if (!body?.cooperativeId?.trim() || !Number.isInteger(points) || points === 0 || !body.reason?.trim()) {
    return NextResponse.json({ ok: false, error: "invalid_adjustment" }, { status: 400 });
  }

  const db = adminDb();
  const orgRef = db.collection("organizations").doc(body.cooperativeId.trim());
  const ledgerRef = db.collection("pointLedger").doc();
  const transactionRef = db.collection("point_transactions").doc();
  const now = new Date().toISOString();
  const adjustmentType =
    points > 0 ? "admin_adjustment_credit" : "admin_adjustment_debit";

  try {
    const result = await db.runTransaction(async (transaction) => {
      const orgSnapshot = await transaction.get(orgRef);
      if (!orgSnapshot.exists) throw new Error("organization_not_found");
      const organization = orgSnapshot.data() as OrganizationRecord;
      const balanceBefore = organization.walletBalance;
      const nextBalance = organization.walletBalance + points;
      if (nextBalance < 0) throw new Error("insufficient_points");

      transaction.update(orgRef, { walletBalance: nextBalance, updatedAt: now });
      transaction.set(ledgerRef, {
        id: ledgerRef.id,
        cooperativeId: body.cooperativeId?.trim() ?? "",
        nh_org_id: body.cooperativeId?.trim() ?? "",
        userId: decoded.uid,
        event: adjustmentType,
        type: adjustmentType,
        amount: points,
        points,
        balanceBefore,
        balanceAfter: nextBalance,
        balance_before: balanceBefore,
        balance_after: nextBalance,
        reason: body.reason?.trim(),
        createdAt: now,
      } satisfies PointLedgerRecord);
      transaction.set(transactionRef, {
        id: transactionRef.id,
        cooperativeId: body.cooperativeId?.trim() ?? "",
        nh_org_id: body.cooperativeId?.trim() ?? "",
        user_id: decoded.uid,
        type: adjustmentType,
        amount: points,
        balance_before: balanceBefore,
        balance_after: nextBalance,
        reason: body.reason?.trim(),
        createdAt: now,
      } satisfies PointTransactionRecord);
      writeAuditLog(transaction, db, {
        actorUid: decoded.uid,
        actorEmail: decoded.email,
        action: "points.adjusted",
        targetType: "pointLedger",
        targetId: ledgerRef.id,
        metadata: {
          cooperativeId: body.cooperativeId?.trim() ?? "",
          points,
          type: adjustmentType,
          balanceAfter: nextBalance,
        },
        createdAt: now,
      });
      return { walletBalance: nextBalance };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const error = err instanceof Error ? err.message : "adjustment_failed";
    const status = error === "insufficient_points" ? 400 : 404;
    return NextResponse.json({ ok: false, error }, { status });
  }
}
