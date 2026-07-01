import { NextResponse } from "next/server";
import { ADMIN_EMAIL, adminAuth, adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import type { UserRecord } from "@/lib/firebase/schema";
import {
  addAuditLog,
  authErrorCode,
  authErrorStatus,
  requireAdmin,
} from "@/lib/firebase/server";

export const runtime = "nodejs";

type Payload = {
  name?: string;
  email?: string;
  password?: string;
  position?: string;
  duty?: string;
  status?: UserRecord["status"];
};

function isProtectedOperator(user: UserRecord, currentUid: string) {
  return (
    user.uid === currentUid ||
    user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()
  );
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ uid: string }> },
) {
  let admin;
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const { uid } = await context.params;
  const body = (await req.json().catch(() => null)) as Payload | null;
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

  const nextStatus = body?.status === "rejected" ? "rejected" : body?.status === "active" ? "active" : undefined;
  if (nextStatus === "rejected" && isProtectedOperator(current, admin.uid)) {
    return NextResponse.json({ ok: false, error: "protected_operator" }, { status: 400 });
  }

  const name = body?.name?.trim();
  const email = body?.email?.trim().toLowerCase();
  const position = body?.position?.trim();
  const duty = body?.duty?.trim();
  const password = body?.password;
  if (password && password.length < 8) {
    return NextResponse.json({ ok: false, error: "weak_password" }, { status: 400 });
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
    await adminAuth().setCustomUserClaims(uid, { admin: nextStatus === "active" });
  }

  const operator: UserRecord = withoutUndefined({
    ...current,
    name: name ?? current.name,
    email: email ?? current.email,
    position: position ?? current.position ?? "운영자",
    duty: duty ?? current.duty ?? "관리자",
    role: "admin",
    status: nextStatus ?? current.status,
    updatedAt: now,
  } satisfies UserRecord);
  await userRef.set(operator, { merge: true });

  const changedFields = [
    name && name !== current.name && "name",
    email && email !== current.email?.toLowerCase() && "email",
    position && position !== current.position && "position",
    duty && duty !== current.duty && "duty",
  ].filter(Boolean) as string[];
  const action =
    nextStatus && nextStatus !== current.status
      ? "operator.permission_changed"
      : password
        ? "operator.password_reset"
        : "operator.updated";

  await addAuditLog(db, {
    actorUid: admin.uid,
    actorEmail: admin.email,
    action,
    targetType: "user",
    targetId: uid,
    metadata: {
      targetName: operator.name,
      targetEmail: operator.email,
      previousStatus: current.status,
      status: operator.status,
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
    admin = await requireAdmin(req);
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
  if (isProtectedOperator(operator, admin.uid)) {
    return NextResponse.json({ ok: false, error: "protected_operator" }, { status: 400 });
  }

  await adminAuth().deleteUser(uid);
  await userRef.delete();

  const now = new Date().toISOString();
  await addAuditLog(db, {
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: "operator.deleted",
    targetType: "user",
    targetId: uid,
    metadata: {
      targetName: operator.name,
      targetEmail: operator.email,
      previousStatus: operator.status,
    },
    createdAt: now,
  });

  return NextResponse.json({ ok: true });
}
