import { NextResponse } from "next/server";
import { withoutUndefined } from "@/lib/firebase/clean";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
  writeAuditLog,
} from "@/lib/firebase/server";
import type { UserRecord } from "@/lib/firebase/schema";

export const runtime = "nodejs";

type Payload = { reason?: string };

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

  const body = (await req.json().catch(() => null)) as Payload | null;
  const reason = body?.reason?.trim();

  const { uid } = await context.params;
  const db = adminDb();
  const userRef = db.collection("users").doc(uid);
  const now = new Date().toISOString();

  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      return { ok: false as const, error: "user_not_found" };
    }
    const user = snapshot.data() as UserRecord;
    if (user.status === "rejected") {
      return { ok: true as const, alreadyRejected: true, transition: "noop" as const };
    }

    const transition: "deactivate" | "reject" =
      user.status === "active" ? "deactivate" : "reject";
    const action = transition === "deactivate" ? "user.deactivated" : "user.rejected";

    transaction.set(
      userRef,
      withoutUndefined({
        ...user,
        status: "rejected",
        rejectedAt: now,
        rejectedBy: admin.uid,
        rejectionReason: reason,
        updatedAt: now,
      } satisfies UserRecord),
      { merge: true }
    );

    writeAuditLog(transaction, db, {
      actorUid: admin.uid,
      actorEmail: admin.email,
      action,
      targetType: "user",
      targetId: uid,
      metadata: {
        cooperativeId: user.cooperativeId ?? null,
        reason: reason ?? null,
        previousStatus: user.status,
      },
      createdAt: now,
    });

    return { ok: true as const, alreadyRejected: false, transition };
  });

  if (!result.ok) {
    const status = result.error === "user_not_found" ? 404 : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  return NextResponse.json({
    ok: true,
    alreadyRejected: result.alreadyRejected,
    transition: result.transition,
  });
}
