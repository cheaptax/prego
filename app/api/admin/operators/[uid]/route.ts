import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import {
  ADMIN_ROLE_LABELS,
  canManageOperator,
  getAccountStatus,
  getAdminRole,
  hasPermission,
  isAdminRole,
  isSuperAdmin,
  normalizeAdminCapabilities,
  wouldRemoveLastSuperAdmin,
} from "@/lib/admin/rbac";
import type {
  AdminPermission,
  AdminRole,
  OperatorProfile,
  UserRecord,
} from "@/lib/firebase/schema";
import {
  addAdminAuditLog,
  authErrorCode,
  authErrorStatus,
  requireActiveAdmin,
  requirePermission,
} from "@/lib/firebase/server";

export const runtime = "nodejs";

type Payload = {
  name?: string;
  email?: string;
  password?: string;
  position?: string;
  duty?: string;
  status?: UserRecord["status"];
  adminRole?: AdminRole;
  adminCapabilityAllow?: string[];
  adminCapabilityDeny?: string[];
};

function operatorProfile(user: UserRecord): OperatorProfile {
  return {
    ...user,
    role: "admin",
    adminRole: getAdminRole(user),
  };
}

async function activeSuperAdminCount() {
  const snapshot = await adminDb()
    .collection("users")
    .where("role", "==", "admin")
    .get();
  return snapshot.docs
    .map((doc) => doc.data() as UserRecord)
    .filter((user) => isSuperAdmin(operatorProfile(user)))
    .length;
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ uid: string }> },
) {
  let admin;
  try {
    admin = await requireActiveAdmin(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const { uid } = await context.params;
  const body = (await req.json().catch(() => null)) as Payload | null;
  const requiredPermissions = new Set<AdminPermission>();
  if (
    body?.name !== undefined ||
    body?.email !== undefined ||
    body?.position !== undefined ||
    body?.duty !== undefined
  ) {
    requiredPermissions.add("operators:update");
  }
  if (
    body?.adminRole !== undefined ||
    body?.adminCapabilityAllow !== undefined ||
    body?.adminCapabilityDeny !== undefined
  ) {
    requiredPermissions.add("operators:manageRoles");
  }
  if (body?.status !== undefined) {
    requiredPermissions.add("operators:disable");
  }
  if (body?.password) {
    requiredPermissions.add("operators:resetPassword");
  }
  if (requiredPermissions.size === 0) {
    requiredPermissions.add("operators:update");
  }
  if (
    [...requiredPermissions].some(
      (permission) => !hasPermission(admin.context, permission),
    )
  ) {
    return NextResponse.json(
      { ok: false, error: "permission_denied" },
      { status: 403 },
    );
  }
  const db = adminDb();
  const userRef = db.collection("users").doc(uid);
  const snapshot = await userRef.get();
  if (!snapshot.exists) {
    return NextResponse.json({ ok: false, error: "operator_not_found" }, { status: 404 });
  }

  const current = snapshot.data() as UserRecord;
  if (current.role !== "admin") {
    return NextResponse.json({ ok: false, error: "not_operator" }, { status: 400 });
  }

  if (body?.adminRole !== undefined && !isAdminRole(body.adminRole)) {
    return NextResponse.json(
      { ok: false, error: "unsupported_role" },
      { status: 400 },
    );
  }
  const nextStatus = body?.status === "rejected" ? "rejected" : body?.status === "active" ? "active" : undefined;
  const hasAllowPayload = Array.isArray(body?.adminCapabilityAllow);
  const hasDenyPayload = Array.isArray(body?.adminCapabilityDeny);
  const hasSensitiveSelfChange =
    nextStatus !== undefined ||
    body?.adminRole !== undefined ||
    hasAllowPayload ||
    hasDenyPayload;
  if (hasSensitiveSelfChange && current.uid === admin.decoded.uid) {
    return NextResponse.json({ ok: false, error: "protected_operator" }, { status: 400 });
  }

  const name = body?.name?.trim();
  const email = body?.email?.trim().toLowerCase();
  const position = body?.position?.trim();
  const duty = body?.duty?.trim();
  const password = body?.password;
  const nextAdminRole = isAdminRole(body?.adminRole) ? body.adminRole : undefined;
  if (password && password.length < 8) {
    return NextResponse.json({ ok: false, error: "weak_password" }, { status: 400 });
  }
  const target = operatorProfile(current);
  const superAdminCount = await activeSuperAdminCount();
  const nextAccountStatus =
    nextStatus === "rejected"
      ? "disabled"
      : nextStatus === "active"
        ? "active"
        : undefined;
  if (wouldRemoveLastSuperAdmin({
    target,
    activeSuperAdminCount: superAdminCount,
    nextRole: nextAdminRole,
    nextStatus: nextAccountStatus,
  })) {
    return NextResponse.json({ ok: false, error: "last_super_admin" }, { status: 400 });
  }
  if (
    current.uid !== admin.decoded.uid &&
    !canManageOperator(admin.context, target, {
      permission: [...requiredPermissions][0] as Extract<
        AdminPermission,
        `operators:${string}`
      >,
      activeSuperAdminCount: superAdminCount,
      nextRole: nextAdminRole,
      nextStatus: nextAccountStatus,
    })
  ) {
    return NextResponse.json(
      { ok: false, error: "operator_management_denied" },
      { status: 403 },
    );
  }

  const now = new Date().toISOString();
  const authUpdate: Parameters<ReturnType<typeof adminAuth>["updateUser"]>[1] = {};
  if (name && name !== current.name) authUpdate.displayName = name;
  if (email && email !== current.email?.toLowerCase()) authUpdate.email = email;
  if (password) authUpdate.password = password;
  if (nextStatus) authUpdate.disabled = nextStatus !== "active";
  if (Object.keys(authUpdate).length > 0) {
    await adminAuth().updateUser(uid, authUpdate);
  }
  if (nextStatus) {
    const authUser = await adminAuth().getUser(uid);
    await adminAuth().setCustomUserClaims(uid, {
      ...(authUser.customClaims ?? {}),
      admin: nextStatus === "active",
    });
  }

  const operator: UserRecord = withoutUndefined({
    ...current,
    name: name ?? current.name,
    email: email ?? current.email,
    position: position ?? current.position ?? "운영자",
    duty:
      duty ??
      (nextAdminRole ? ADMIN_ROLE_LABELS[nextAdminRole] : current.duty) ??
      "관리자",
    role: "admin",
    adminRole: nextAdminRole ?? getAdminRole(current),
    adminCapabilityAllow: hasAllowPayload
      ? normalizeAdminCapabilities(body?.adminCapabilityAllow)
      : current.adminCapabilityAllow,
    adminCapabilityDeny: hasDenyPayload
      ? normalizeAdminCapabilities(body?.adminCapabilityDeny)
      : current.adminCapabilityDeny,
    accountStatus: nextAccountStatus ?? getAccountStatus(current),
    status: nextStatus ?? current.status,
    updatedAt: now,
  } satisfies UserRecord);
  await userRef.set(operator, { merge: true });

  const changedFields = [
    name && name !== current.name && "name",
    email && email !== current.email?.toLowerCase() && "email",
    position && position !== current.position && "position",
    duty && duty !== current.duty && "duty",
    nextAdminRole && nextAdminRole !== current.adminRole && "adminRole",
    hasAllowPayload && "adminCapabilityAllow",
    hasDenyPayload && "adminCapabilityDeny",
  ].filter(Boolean) as string[];
  const action =
    nextStatus && nextStatus !== current.status
      ? "operator.permission_changed"
      : password
        ? "operator.password_reset"
        : "operator.updated";
  const requiredPermission: AdminPermission =
    nextStatus && nextStatus !== current.status
      ? "operators:disable"
      : password
        ? "operators:resetPassword"
        : nextAdminRole || hasAllowPayload || hasDenyPayload
          ? "operators:manageRoles"
          : "operators:update";

  await addAdminAuditLog(db, {
    actorId: admin.decoded.uid,
    actorEmail: admin.decoded.email,
    actorRole: admin.context.adminRole,
    requiredPermission,
    action,
    targetType: "user",
    targetId: uid,
    before: {
      name: current.name,
      email: current.email,
      position: current.position,
      duty: current.duty,
      accountStatus: getAccountStatus(current),
      status: current.status,
      adminRole: getAdminRole(current),
      adminCapabilityAllow: current.adminCapabilityAllow,
      adminCapabilityDeny: current.adminCapabilityDeny,
    },
    after: {
      name: operator.name,
      email: operator.email,
      position: operator.position,
      duty: operator.duty,
      accountStatus: operator.accountStatus,
      status: operator.status,
      adminRole: operator.adminRole,
      adminCapabilityAllow: operator.adminCapabilityAllow,
      adminCapabilityDeny: operator.adminCapabilityDeny,
    },
    metadata: {
      targetName: operator.name,
      targetEmail: operator.email,
      previousStatus: current.status,
      status: operator.status,
      previousAdminRole: getAdminRole(current),
      adminRole: getAdminRole(operator),
      changedFields: changedFields.join(","),
      passwordReset: Boolean(password),
    },
    createdAt: now,
  });

  return NextResponse.json({ ok: true, operator });
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ uid: string }> },
) {
  let admin;
  try {
    admin = await requirePermission(req, "operators:delete");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const { uid } = await context.params;
  const db = adminDb();
  const userRef = db.collection("users").doc(uid);
  const snapshot = await userRef.get();
  if (!snapshot.exists) {
    return NextResponse.json({ ok: false, error: "operator_not_found" }, { status: 404 });
  }

  const operator = snapshot.data() as UserRecord;
  if (operator.role !== "admin") {
    return NextResponse.json({ ok: false, error: "not_operator" }, { status: 400 });
  }
  if (operator.uid === admin.decoded.uid) {
    return NextResponse.json({ ok: false, error: "protected_operator" }, { status: 400 });
  }
  const target = operatorProfile(operator);
  const superAdminCount = await activeSuperAdminCount();
  if (wouldRemoveLastSuperAdmin({
    target,
    activeSuperAdminCount: superAdminCount,
    deleting: true,
  })) {
    return NextResponse.json({ ok: false, error: "last_super_admin" }, { status: 400 });
  }
  if (!canManageOperator(admin.context, target, {
    permission: "operators:delete",
    activeSuperAdminCount: superAdminCount,
    deleting: true,
  })) {
    return NextResponse.json(
      { ok: false, error: "operator_management_denied" },
      { status: 403 },
    );
  }

  await adminAuth().deleteUser(uid);
  await userRef.delete();

  const now = new Date().toISOString();
  await addAdminAuditLog(db, {
    actorId: admin.decoded.uid,
    actorEmail: admin.decoded.email,
    actorRole: admin.context.adminRole,
    requiredPermission: "operators:delete",
    action: "operator.deleted",
    targetType: "user",
    targetId: uid,
    before: {
      uid: operator.uid,
      name: operator.name,
      email: operator.email,
      status: operator.status,
      adminRole: getAdminRole(operator),
      adminCapabilityAllow: operator.adminCapabilityAllow,
      adminCapabilityDeny: operator.adminCapabilityDeny,
    },
    metadata: {
      targetName: operator.name,
      targetEmail: operator.email,
      previousStatus: operator.status,
    },
    createdAt: now,
  });

  return NextResponse.json({ ok: true });
}
