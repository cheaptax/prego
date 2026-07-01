import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
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

function normalizeOperatorPayload(body: Payload | null) {
  return {
    name: body?.name?.trim() ?? "",
    email: body?.email?.trim().toLowerCase() ?? "",
    password: body?.password ?? "",
    position: body?.position?.trim() || "운영자",
    duty: body?.duty?.trim() || "관리자",
    status: body?.status === "rejected" ? "rejected" : "active",
  } satisfies Omit<Payload, "status"> & { status: UserRecord["status"] };
}

export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const body = (await req.json().catch(() => null)) as Payload | null;
  const payload = normalizeOperatorPayload(body);

  if (!payload.name || !payload.email || !payload.password) {
    return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
  }
  if (payload.password.length < 8) {
    return NextResponse.json({ ok: false, error: "weak_password" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const authUser = await adminAuth().createUser({
    email: payload.email,
    password: payload.password,
    displayName: payload.name,
    emailVerified: true,
    disabled: payload.status !== "active",
  });
  await adminAuth().setCustomUserClaims(authUser.uid, {
    admin: payload.status === "active",
  });

  const operator: UserRecord = withoutUndefined({
    uid: authUser.uid,
    name: payload.name,
    phone: "",
    email: payload.email,
    position: payload.position,
    duty: payload.duty,
    consents: {
      terms: false,
      privacy: false,
      marketing: false,
      email: false,
      sms: false,
      kakao: false,
    },
    role: "admin",
    status: payload.status,
    createdAt: now,
    updatedAt: now,
  } satisfies UserRecord);

  const db = adminDb();
  await db.collection("users").doc(authUser.uid).set(operator);
  await addAuditLog(db, {
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: "operator.created",
    targetType: "user",
    targetId: authUser.uid,
    metadata: {
      targetName: operator.name,
      targetEmail: operator.email,
      status: operator.status,
    },
    createdAt: now,
  });

  return NextResponse.json({ ok: true, operator });
}
