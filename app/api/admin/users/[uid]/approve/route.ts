import { NextResponse } from "next/server";
import { withoutUndefined } from "@/lib/firebase/clean";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
  writeAuditLog,
} from "@/lib/firebase/server";
import type {
  OrganizationRecord,
  PointLedgerRecord,
  PointTransactionRecord,
  UserRecord,
} from "@/lib/firebase/schema";
import {
  DEMO_COOPERATIVE_COLLECTION,
  getTestCooperativeDefinition,
  nextDemoSignupStatus,
  parseTestCooperativeMaster,
} from "@/lib/cooperatives/demo-cooperative";
import { inheritTestRootMetadata } from "@/lib/test-data/root-metadata";
import { PURGE_LOCK_COLLECTION } from "@/lib/test-data/purge-job-types";
import { isActivePurgeLock } from "@/lib/test-data/purge-lock";
import { signupPointPolicy } from "@/lib/platform";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  context: { params: Promise<{ uid: string }> }
) {
  let admin;
  try {
    admin = await requireAdminCapability(req, "members:write");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) }
    );
  }

  const { uid } = await context.params;
  const db = adminDb();
  const userRef = db.collection("users").doc(uid);
  const now = new Date().toISOString();

  const result = await db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    if (!userSnapshot.exists) {
      return { ok: false as const, error: "user_not_found" };
    }

    const user = userSnapshot.data() as UserRecord;
    if (!user.cooperativeId) {
      return { ok: false as const, error: "missing_cooperative" };
    }
    const purgeLockSnapshot = await transaction.get(
      db.collection(PURGE_LOCK_COLLECTION).doc(user.cooperativeId),
    );
    if (
      purgeLockSnapshot.exists &&
      isActivePurgeLock(purgeLockSnapshot.data())
    ) {
      return { ok: false as const, error: "institution_purge_in_progress" };
    }
    if (user.status === "active") {
      return {
        ok: true as const,
        alreadyActive: true,
        walletBalance: 0,
        grantedPoints: 0,
        transition: "noop" as const,
      };
    }

    const transition: "approve" | "reactivate" =
      user.status === "rejected" ? "reactivate" : "approve";

    const orgRef = db.collection("organizations").doc(user.cooperativeId);
    const orgSnapshot = await transaction.get(orgRef);
    const existing = orgSnapshot.exists
      ? (orgSnapshot.data() as OrganizationRecord)
      : null;
    const demoMasterRef =
      getTestCooperativeDefinition(user.cooperativeId)
        ? db
            .collection(DEMO_COOPERATIVE_COLLECTION)
            .doc(user.cooperativeId)
        : null;
    const demoMasterSnapshot = demoMasterRef
      ? await transaction.get(demoMasterRef)
      : null;
    const demoMaster = demoMasterSnapshot
      ? parseTestCooperativeMaster(
          demoMasterSnapshot.data(),
          user.cooperativeId,
        )
      : null;
    if (demoMasterRef && !demoMaster) {
      return { ok: false as const, error: "invalid_demo_cooperative_master" };
    }
    const isFirstUser = !existing;
    const wasPreviouslyJoined = Boolean(existing?.users?.includes(uid));
    const grantedPoints = wasPreviouslyJoined
      ? 0
      : signupPointPolicy.userJoinGrant +
        (isFirstUser ? signupPointPolicy.firstOrganizationGrant : 0);
    const walletBalance = (existing?.walletBalance ?? 0) + grantedPoints;

    transaction.set(
      orgRef,
      {
        ...inheritTestRootMetadata(user),
        cooperativeId: user.cooperativeId,
        nh_org_id: user.nh_org_id ?? user.cooperativeId,
        cooperativeName: user.cooperativeName ?? user.manualCooperativeName ?? "",
        walletBalance,
        users: Array.from(new Set([...(existing?.users ?? []), uid])),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      } satisfies OrganizationRecord,
      { merge: true }
    );

    if (demoMasterRef && demoMaster) {
      transaction.update(demoMasterRef, {
        signupStatus: nextDemoSignupStatus(
          demoMaster.signupStatus,
          "APPROVED",
        ),
        updatedAt: now,
        updatedBy: admin.uid,
      });
    }

    transaction.set(
      userRef,
      withoutUndefined({
        ...user,
        status: "active",
        rejectedAt: undefined,
        rejectedBy: undefined,
        rejectionReason: undefined,
        updatedAt: now,
      } satisfies UserRecord),
      { merge: true }
    );

    let runningBalance = existing?.walletBalance ?? 0;
    if (!wasPreviouslyJoined && isFirstUser) {
      const firstGrantBalanceBefore = runningBalance;
      runningBalance += signupPointPolicy.firstOrganizationGrant;
      const firstGrantRef = db.collection("pointLedger").doc();
      const firstTransactionRef = db.collection("point_transactions").doc();
      transaction.set(firstGrantRef, {
        id: firstGrantRef.id,
        cooperativeId: user.cooperativeId,
        nh_org_id: user.nh_org_id ?? user.cooperativeId,
        userId: uid,
        event: "first_org_signup",
        points: signupPointPolicy.firstOrganizationGrant,
        balanceAfter: runningBalance,
        reason: "관리자 승인 후 농협 최초 가입 지급",
        createdAt: now,
      } satisfies PointLedgerRecord);
      transaction.set(firstTransactionRef, {
        id: firstTransactionRef.id,
        cooperativeId: user.cooperativeId,
        nh_org_id: user.nh_org_id ?? user.cooperativeId,
        user_id: uid,
        type: "first_org_signup",
        amount: signupPointPolicy.firstOrganizationGrant,
        balance_before: firstGrantBalanceBefore,
        balance_after: runningBalance,
        reason: "관리자 승인 후 농협 최초 가입 지급",
        createdAt: now,
      } satisfies PointTransactionRecord);
    }

    if (wasPreviouslyJoined) {
      writeAuditLog(transaction, db, {
        actorUid: admin.uid,
        actorEmail: admin.email,
        action: transition === "reactivate" ? "user.reactivated" : "user.approved",
        targetType: "user",
        targetId: uid,
        metadata: {
          cooperativeId: user.cooperativeId,
          firstOrganizationGrant: false,
          grantedPoints: 0,
          reapproval: true,
          previousStatus: user.status,
        },
        createdAt: now,
      });
      return {
        ok: true as const,
        alreadyActive: false,
        walletBalance,
        grantedPoints: 0,
        transition,
      };
    }

    const userGrantBalanceBefore = runningBalance;
    runningBalance += signupPointPolicy.userJoinGrant;
    const userGrantRef = db.collection("pointLedger").doc();
    const userTransactionRef = db.collection("point_transactions").doc();
    transaction.set(userGrantRef, {
      id: userGrantRef.id,
      cooperativeId: user.cooperativeId,
      nh_org_id: user.nh_org_id ?? user.cooperativeId,
      userId: uid,
      event: "user_signup",
      points: signupPointPolicy.userJoinGrant,
      balanceAfter: runningBalance,
      reason: "관리자 승인 후 사용자 가입 지급",
      createdAt: now,
    } satisfies PointLedgerRecord);
    transaction.set(userTransactionRef, {
      id: userTransactionRef.id,
      cooperativeId: user.cooperativeId,
      nh_org_id: user.nh_org_id ?? user.cooperativeId,
      user_id: uid,
      type: "user_signup",
      amount: signupPointPolicy.userJoinGrant,
      balance_before: userGrantBalanceBefore,
      balance_after: runningBalance,
      reason: "관리자 승인 후 사용자 가입 지급",
      createdAt: now,
    } satisfies PointTransactionRecord);

    writeAuditLog(transaction, db, {
      actorUid: admin.uid,
      actorEmail: admin.email,
      action: transition === "reactivate" ? "user.reactivated" : "user.approved",
      targetType: "user",
      targetId: uid,
      metadata: {
        cooperativeId: user.cooperativeId,
        firstOrganizationGrant: isFirstUser,
        grantedPoints,
        previousStatus: user.status,
      },
      createdAt: now,
    });

    return {
      ok: true as const,
      alreadyActive: false,
      walletBalance,
      grantedPoints,
      transition,
    };
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    alreadyActive: result.alreadyActive,
    walletBalance: result.walletBalance,
    grantedPoints: result.grantedPoints,
    transition: result.transition,
  });
}
