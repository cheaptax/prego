import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { getAccountStatus } from "@/lib/admin/rbac";
import {
  addAdminAuditLog,
  authErrorCode,
  authErrorStatus,
  requirePermission,
  writeAdminAuditLog,
} from "@/lib/firebase/server";
import { shouldEnablePartnerAccount } from "@/lib/partner-management";
import type {
  AdminStatus,
  PartnerRecord,
  UserRecord,
} from "@/lib/firebase/schema";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ partnerId: string; uid: string }>;
};

type Payload = {
  name?: string;
  phone?: string;
  position?: string;
  duty?: string;
  accountStatus?: AdminStatus;
  targetPartnerId?: string;
};

function isAccountStatus(value: unknown): value is AdminStatus {
  return (
    value === "invited" ||
    value === "active" ||
    value === "suspended" ||
    value === "disabled"
  );
}

function legacyStatus(status: AdminStatus): UserRecord["status"] {
  if (status === "active") return "active";
  if (status === "invited") return "pending_cooperative_review";
  return "rejected";
}

async function syncAccountAuth(
  user: UserRecord,
  partner: Pick<PartnerRecord, "id" | "status"> | null,
) {
  try {
    const authUser = await adminAuth().getUser(user.uid);
    const enabled = partner
      ? shouldEnablePartnerAccount(partner.status, getAccountStatus(user))
      : false;
    await adminAuth().updateUser(user.uid, {
      disabled: !enabled,
      displayName: user.name,
    });
    await adminAuth().setCustomUserClaims(user.uid, {
      ...(authUser.customClaims ?? {}),
      partner: enabled,
      partnerId: partner?.id ?? null,
    });
    return { ok: true as const };
  } catch {
    return { ok: false as const };
  }
}

export async function PATCH(req: Request, { params }: Params) {
  let session;
  try {
    session = await requirePermission(req, "partners:manageMembers");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }
  const { partnerId, uid } = await params;
  const body = (await req.json().catch(() => null)) as Payload | null;
  if (
    body?.accountStatus !== undefined &&
    !isAccountStatus(body.accountStatus)
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid_partner_account_status" },
      { status: 400 },
    );
  }
  const targetPartnerId = body?.targetPartnerId?.trim() || partnerId;
  const db = adminDb();
  const sourcePartnerRef = db.collection("partners").doc(partnerId);
  const targetPartnerRef = db.collection("partners").doc(targetPartnerId);
  const userRef = db.collection("users").doc(uid);
  const [sourcePartnerSnapshot, targetPartnerSnapshot, userSnapshot] =
    await Promise.all([
      sourcePartnerRef.get(),
      targetPartnerRef.get(),
      userRef.get(),
    ]);
  if (!sourcePartnerSnapshot.exists || !targetPartnerSnapshot.exists) {
    return NextResponse.json(
      { ok: false, error: "partner_not_found" },
      { status: 404 },
    );
  }
  if (!userSnapshot.exists) {
    return NextResponse.json(
      { ok: false, error: "partner_account_not_found" },
      { status: 404 },
    );
  }
  const current = userSnapshot.data() as UserRecord;
  if (current.role !== "partner" || current.partnerId !== partnerId) {
    return NextResponse.json(
      { ok: false, error: "partner_account_scope_mismatch" },
      { status: 403 },
    );
  }
  const targetPartner = targetPartnerSnapshot.data() as PartnerRecord;
  if (targetPartner.status === "terminated") {
    return NextResponse.json(
      { ok: false, error: "target_partner_terminated" },
      { status: 409 },
    );
  }
  const nextAccountStatus = body?.accountStatus ?? getAccountStatus(current);
  const now = new Date().toISOString();
  const user: UserRecord = {
    ...current,
    name: body?.name?.trim() || current.name,
    phone: body?.phone?.trim() ?? current.phone,
    position: body?.position?.trim() || current.position,
    duty: body?.duty?.trim() || targetPartner.displayName,
    partnerId: targetPartnerId,
    accountStatus: nextAccountStatus,
    status: legacyStatus(nextAccountStatus),
    updatedAt: now,
  };
  const moving = targetPartnerId !== partnerId;
  const statusChanged = getAccountStatus(current) !== nextAccountStatus;
  const mutationResult = await db.runTransaction(async (transaction) => {
    const freshUser = await transaction.get(userRef);
    if (
      !freshUser.exists ||
      freshUser.data()?.role !== "partner" ||
      freshUser.data()?.partnerId !== partnerId
    ) {
      return { ok: false as const };
    }
    transaction.set(userRef, user, { merge: true });
    if (moving) {
      writeAdminAuditLog(transaction, db, {
        actorId: session.decoded.uid,
        actorEmail: session.decoded.email,
        actorRole: session.context.adminRole,
        requiredPermission: "partners:manageMembers",
        action: "partner.account_unlinked",
        targetType: "partner",
        targetId: partnerId,
        before: { uid, partnerId },
        after: { uid, partnerId: targetPartnerId },
        createdAt: now,
      });
      writeAdminAuditLog(transaction, db, {
        actorId: session.decoded.uid,
        actorEmail: session.decoded.email,
        actorRole: session.context.adminRole,
        requiredPermission: "partners:manageMembers",
        action: "partner.account_linked",
        targetType: "partner",
        targetId: targetPartnerId,
        before: { uid, partnerId },
        after: { uid, partnerId: targetPartnerId },
        createdAt: now,
      });
    } else {
      writeAdminAuditLog(transaction, db, {
        actorId: session.decoded.uid,
        actorEmail: session.decoded.email,
        actorRole: session.context.adminRole,
        requiredPermission: "partners:manageMembers",
        action: statusChanged
          ? "partner.account_status_changed"
          : "partner.account_updated",
        targetType: "partner",
        targetId: partnerId,
        before: {
          uid,
          name: current.name,
          accountStatus: getAccountStatus(current),
        },
        after: {
          uid,
          name: user.name,
          accountStatus: nextAccountStatus,
        },
        createdAt: now,
      });
    }
    return { ok: true as const };
  });
  if (!mutationResult.ok) {
    return NextResponse.json(
      { ok: false, error: "partner_account_conflict" },
      { status: 409 },
    );
  }
  const authSync = await syncAccountAuth(user, targetPartner);
  if (!authSync.ok) {
    await addAdminAuditLog(db, {
      actorId: session.decoded.uid,
      actorEmail: session.decoded.email,
      actorRole: session.context.adminRole,
      requiredPermission: "partners:manageMembers",
      action: "partner.account_sync_failed",
      targetType: "partner",
      targetId: targetPartnerId,
      metadata: { targetUid: uid },
      result: "failed",
      createdAt: new Date().toISOString(),
    });
  }
  return NextResponse.json({ ok: true, user, authSync });
}

export async function DELETE(req: Request, { params }: Params) {
  let session;
  try {
    session = await requirePermission(req, "partners:manageMembers");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }
  const { partnerId, uid } = await params;
  const db = adminDb();
  const userRef = db.collection("users").doc(uid);
  const snapshot = await userRef.get();
  if (!snapshot.exists) {
    return NextResponse.json(
      { ok: false, error: "partner_account_not_found" },
      { status: 404 },
    );
  }
  const current = snapshot.data() as UserRecord;
  if (current.role !== "partner" || current.partnerId !== partnerId) {
    return NextResponse.json(
      { ok: false, error: "partner_account_scope_mismatch" },
      { status: 403 },
    );
  }
  const now = new Date().toISOString();
  const unlinkResult = await db.runTransaction(async (transaction) => {
    const fresh = await transaction.get(userRef);
    if (!fresh.exists || fresh.data()?.partnerId !== partnerId) {
      return { ok: false as const };
    }
    transaction.set(
      userRef,
      {
        partnerId: FieldValue.delete(),
        accountStatus: "disabled",
        status: "rejected",
        updatedAt: now,
      },
      { merge: true },
    );
    writeAdminAuditLog(transaction, db, {
      actorId: session.decoded.uid,
      actorEmail: session.decoded.email,
      actorRole: session.context.adminRole,
      requiredPermission: "partners:manageMembers",
      action: "partner.account_unlinked",
      targetType: "partner",
      targetId: partnerId,
      before: {
        uid,
        partnerId,
        accountStatus: getAccountStatus(current),
      },
      after: {
        uid,
        partnerId: null,
        accountStatus: "disabled",
      },
      createdAt: now,
    });
    return { ok: true as const };
  });
  if (!unlinkResult.ok) {
    return NextResponse.json(
      { ok: false, error: "partner_account_conflict" },
      { status: 409 },
    );
  }
  const unlinked: UserRecord = {
    ...current,
    partnerId: undefined,
    accountStatus: "disabled",
    status: "rejected",
    updatedAt: now,
  };
  const authSync = await syncAccountAuth(unlinked, null);
  if (!authSync.ok) {
    await addAdminAuditLog(db, {
      actorId: session.decoded.uid,
      actorEmail: session.decoded.email,
      actorRole: session.context.adminRole,
      requiredPermission: "partners:manageMembers",
      action: "partner.account_sync_failed",
      targetType: "partner",
      targetId: partnerId,
      metadata: { targetUid: uid },
      result: "failed",
      createdAt: new Date().toISOString(),
    });
  }
  return NextResponse.json({
    ok: true,
    user: unlinked,
    authSync,
    hardDeleted: false,
  });
}
