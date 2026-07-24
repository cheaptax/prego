import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import {
  addAdminAuditLog,
  authErrorCode,
  authErrorStatus,
  requirePermission,
} from "@/lib/firebase/server";
import { shouldEnablePartnerAccount } from "@/lib/partner-management";
import { loadPartnerAccounts } from "@/lib/partner-management-server";
import type {
  AdminStatus,
  PartnerRecord,
  UserRecord,
} from "@/lib/firebase/schema";

export const runtime = "nodejs";

type Params = { params: Promise<{ partnerId: string }> };
type Payload = {
  name?: string;
  email?: string;
  password?: string;
  phone?: string;
  position?: string;
  duty?: string;
  status?: UserRecord["status"];
  accountStatus?: AdminStatus;
};

export async function GET(req: Request, { params }: Params) {
  try {
    await requirePermission(req, "partners:read");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }
  const { partnerId } = await params;
  const db = adminDb();
  const partnerSnapshot = await db.collection("partners").doc(partnerId).get();
  if (!partnerSnapshot.exists) {
    return NextResponse.json(
      { ok: false, error: "partner_not_found" },
      { status: 404 },
    );
  }
  const accounts = await loadPartnerAccounts(db, partnerId);
  return NextResponse.json({
    ok: true,
    accounts: accounts.map((account) => ({
      uid: account.uid,
      name: account.name,
      email: account.email,
      phone: account.phone,
      position: account.position,
      duty: account.duty,
      accountStatus: account.accountStatus,
      status: account.status,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    })),
  });
}

export async function POST(req: Request, { params }: Params) {
  let session;
  try {
    session = await requirePermission(req, "partners:manageMembers");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const { partnerId } = await params;
  const body = (await req.json().catch(() => null)) as Payload | null;
  const name = body?.name?.trim() ?? "";
  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";
  const accountStatus: AdminStatus =
    body?.accountStatus === "active" ||
    body?.accountStatus === "suspended" ||
    body?.accountStatus === "disabled" ||
    body?.accountStatus === "invited"
      ? body.accountStatus
      : body?.status === "active"
        ? "active"
        : "invited";
  const status: UserRecord["status"] =
    accountStatus === "active"
      ? "active"
      : accountStatus === "invited"
        ? "pending_cooperative_review"
        : "rejected";
  if (
    !name ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    password.length < 8 ||
    !/[A-Za-z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid_partner_account" },
      { status: 400 },
    );
  }

  const db = adminDb();
  const partnerSnapshot = await db.collection("partners").doc(partnerId).get();
  if (!partnerSnapshot.exists) {
    return NextResponse.json(
      { ok: false, error: "partner_not_found" },
      { status: 404 },
    );
  }
  const partner = partnerSnapshot.data() as PartnerRecord;
  if (partner.status === "terminated") {
    return NextResponse.json(
      { ok: false, error: "partner_terminated" },
      { status: 409 },
    );
  }
  const enabled = shouldEnablePartnerAccount(partner.status, accountStatus);
  let authUser;
  try {
    authUser = await adminAuth().createUser({
      email,
      password,
      displayName: name,
      emailVerified: true,
      disabled: !enabled,
    });
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "";
    return NextResponse.json(
      {
        ok: false,
        error:
          code === "auth/email-already-exists"
            ? "partner_account_email_exists"
            : "partner_account_create_failed",
      },
      { status: code === "auth/email-already-exists" ? 409 : 500 },
    );
  }
  const now = new Date().toISOString();
  const user: UserRecord = withoutUndefined({
    uid: authUser.uid,
    name,
    phone: body?.phone?.trim() ?? "",
    email,
    position: body?.position?.trim() || "제휴 전문가",
    duty: body?.duty?.trim() || partner.displayName,
    consents: {
      terms: false,
      privacy: false,
      marketing: false,
      email: false,
      sms: false,
      kakao: false,
    },
    role: "partner",
    partnerId,
    accountStatus,
    status,
    createdAt: now,
    updatedAt: now,
  } satisfies UserRecord);
  try {
    await adminAuth().setCustomUserClaims(authUser.uid, {
      partner: enabled,
      partnerId,
    });
    await db.collection("users").doc(authUser.uid).set(user);
  } catch {
    await adminAuth()
      .deleteUser(authUser.uid)
      .catch(() => undefined);
    return NextResponse.json(
      { ok: false, error: "partner_account_create_failed" },
      { status: 500 },
    );
  }
  await addAdminAuditLog(db, {
    actorId: session.decoded.uid,
    actorEmail: session.decoded.email,
    actorRole: session.context.adminRole,
    requiredPermission: "partners:manageMembers",
    action: "partner.account_created",
    targetType: "partner",
    targetId: partnerId,
    after: {
      uid: user.uid,
      name: user.name,
      email: user.email,
      partnerId: user.partnerId,
      accountStatus: user.accountStatus,
    },
    metadata: {
      targetUid: authUser.uid,
      targetEmail: email,
      status: accountStatus,
    },
    createdAt: now,
  });

  return NextResponse.json({ ok: true, user, accessEnabled: enabled });
}
