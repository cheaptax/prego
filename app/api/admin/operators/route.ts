import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import {
  addAdminAuditLog,
  authErrorCode,
  authErrorStatus,
  requirePermission,
} from "@/lib/firebase/server";
import {
  buildMultiRoleOperatorClaims,
  buildMultiRoleOperatorProfile,
  canPromoteEmailToMultiRoleOperator,
} from "@/lib/admin/multi-role-operator";
import {
  ADMIN_ROLE_RANK,
  ADMIN_ROLE_LABELS,
  getAccountStatus,
  getAdminRole,
  hasPermission,
  isAdminRole,
  normalizeAdminCapabilities,
} from "@/lib/admin/rbac";
import type {
  AdminRole,
  AdminStatus,
  UserRecord,
} from "@/lib/firebase/schema";

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

function normalizeOperatorPayload(body: Payload | null) {
  const adminRole = isAdminRole(body?.adminRole)
    ? body.adminRole
    : "operations_manager";
  return {
    name: body?.name?.trim() ?? "",
    email: body?.email?.trim().toLowerCase() ?? "",
    password: body?.password ?? "",
    position: body?.position?.trim() || "운영자",
    duty: body?.duty?.trim() || ADMIN_ROLE_LABELS[adminRole],
    status: body?.status === "rejected" ? "rejected" : "active",
    adminRole,
    adminCapabilityAllow: normalizeAdminCapabilities(body?.adminCapabilityAllow),
    adminCapabilityDeny: normalizeAdminCapabilities(body?.adminCapabilityDeny),
  } satisfies Omit<Payload, "status"> & { status: UserRecord["status"] };
}

const OPERATOR_STATUSES = new Set<AdminStatus>([
  "invited",
  "active",
  "suspended",
  "disabled",
]);

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(req: Request) {
  try {
    await requirePermission(req, "operators:read");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const url = new URL(req.url);
  const search = url.searchParams.get("search")?.trim().toLowerCase() ?? "";
  const requestedRole = url.searchParams.get("role");
  const role = isAdminRole(requestedRole) ? requestedRole : undefined;
  const requestedStatus = url.searchParams.get("status") as AdminStatus | null;
  const status =
    requestedStatus && OPERATOR_STATUSES.has(requestedStatus)
      ? requestedStatus
      : undefined;
  const partner = url.searchParams.get("partner")?.trim() ?? "";
  const page = positiveInteger(url.searchParams.get("page"), 1);
  const pageSize = Math.min(
    positiveInteger(url.searchParams.get("pageSize"), 20),
    50,
  );

  const snapshot = await adminDb()
    .collection("users")
    .where("role", "==", "admin")
    .get();
  const allOperators = snapshot.docs
    .map((doc) => doc.data() as UserRecord)
    .sort((left, right) =>
      (right.updatedAt ?? right.createdAt ?? "").localeCompare(
        left.updatedAt ?? left.createdAt ?? "",
      )
    );
  const activeSuperAdminCount = allOperators.filter(
    (operator) =>
      getAdminRole(operator) === "super_admin" &&
      getAccountStatus(operator) === "active",
  ).length;
  const filtered = allOperators.filter((operator) => {
    if (role && getAdminRole(operator) !== role) return false;
    if (status && getAccountStatus(operator) !== status) return false;
    if (partner && partner !== "internal") return false;
    if (!search) return true;
    return [
      operator.name,
      operator.email,
      operator.position,
      operator.duty,
      ADMIN_ROLE_LABELS[getAdminRole(operator)],
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(search);
  });
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageOperators = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const authResult = pageOperators.length > 0
    ? await adminAuth().getUsers(
        pageOperators.map((operator) => ({ uid: operator.uid })),
      )
    : { users: [] };
  const authByUid = new Map(
    authResult.users.map((authUser) => [authUser.uid, authUser]),
  );
  const operators = pageOperators.map((operator) => {
    const lastSignInTime = authByUid.get(operator.uid)?.metadata.lastSignInTime;
    return withoutUndefined({
      ...operator,
      adminRole: getAdminRole(operator),
      accountStatus: getAccountStatus(operator),
      scopes: ["ALL"],
      lastLoginAt: lastSignInTime
        ? new Date(lastSignInTime).toISOString()
        : undefined,
    });
  });

  return NextResponse.json({
    ok: true,
    operators,
    activeSuperAdminCount,
    pagination: {
      page: currentPage,
      pageSize,
      total,
      totalPages,
    },
  });
}

export async function POST(req: Request) {
  let admin;
  try {
    admin = await requirePermission(req, "operators:create");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const body = (await req.json().catch(() => null)) as Payload | null;
  if (body?.adminRole !== undefined && !isAdminRole(body.adminRole)) {
    return NextResponse.json(
      { ok: false, error: "unsupported_role" },
      { status: 400 },
    );
  }
  const payload = normalizeOperatorPayload(body);

  if (!payload.name || !payload.email || !payload.password) {
    return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
  }
  if (payload.password.length < 8) {
    return NextResponse.json({ ok: false, error: "weak_password" }, { status: 400 });
  }
  const actorRole = admin.context.adminRole;
  const hasPermissionOverrides =
    payload.adminCapabilityAllow.length > 0 ||
    payload.adminCapabilityDeny.length > 0;
  if (
    !actorRole ||
    (hasPermissionOverrides &&
      !hasPermission(admin.context, "operators:manageRoles")) ||
    (payload.adminRole === "super_admin" && actorRole !== "super_admin") ||
    (
      actorRole !== "super_admin" &&
      ADMIN_ROLE_RANK[payload.adminRole] >= ADMIN_ROLE_RANK[actorRole]
    )
  ) {
    return NextResponse.json(
      { ok: false, error: "operator_management_denied" },
      { status: 403 },
    );
  }

  const now = new Date().toISOString();
  let authUser;
  let promotedExisting = false;
  try {
    authUser = await adminAuth().createUser({
      email: payload.email,
      password: payload.password,
      displayName: payload.name,
      emailVerified: true,
      disabled: payload.status !== "active",
    });
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "";
    if (
      code === "auth/email-already-exists" &&
      canPromoteEmailToMultiRoleOperator(payload.email)
    ) {
      try {
        authUser = await adminAuth().getUserByEmail(payload.email);
        await adminAuth().updateUser(authUser.uid, {
          password: payload.password,
          displayName: payload.name,
          emailVerified: true,
          disabled: payload.status !== "active",
        });
        promotedExisting = true;
      } catch {
        return NextResponse.json(
          { ok: false, error: "operator_create_failed" },
          { status: 500 },
        );
      }
    } else if (code === "auth/email-already-exists") {
      return NextResponse.json(
        { ok: false, error: "email_already_exists" },
        { status: 409 },
      );
    } else {
      return NextResponse.json(
        { ok: false, error: "operator_create_failed" },
        { status: 500 },
      );
    }
  }

  const existingProfileSnapshot = promotedExisting
    ? await adminDb().collection("users").doc(authUser.uid).get()
    : null;
  const existingProfile = existingProfileSnapshot?.exists
    ? (existingProfileSnapshot.data() as UserRecord)
    : null;

  if (
    promotedExisting &&
    existingProfile?.role === "admin" &&
    !existingProfile.multiRoleTestAccount
  ) {
    return NextResponse.json(
      { ok: false, error: "email_already_exists" },
      { status: 409 },
    );
  }

  const operator: UserRecord = promotedExisting
    ? buildMultiRoleOperatorProfile({
        authUser,
        existingProfile,
        name: payload.name,
        email: payload.email,
        position: payload.position,
        duty: payload.duty,
        status: payload.status,
        adminRole: payload.adminRole,
        adminCapabilityAllow: payload.adminCapabilityAllow,
        adminCapabilityDeny: payload.adminCapabilityDeny,
        now,
      })
    : withoutUndefined({
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
        adminRole: payload.adminRole,
        adminCapabilityAllow: payload.adminCapabilityAllow,
        adminCapabilityDeny: payload.adminCapabilityDeny,
        accountStatus: payload.status === "active" ? "active" : "disabled",
        status: payload.status,
        createdAt: now,
        updatedAt: now,
      } satisfies UserRecord);

  const db = adminDb();
  try {
    if (promotedExisting) {
      await adminAuth().setCustomUserClaims(
        authUser.uid,
        buildMultiRoleOperatorClaims({
          authUser,
          profile: operator,
          adminEnabled: payload.status === "active",
        }),
      );
    } else {
      await adminAuth().setCustomUserClaims(authUser.uid, {
        admin: payload.status === "active",
      });
    }
    await db.collection("users").doc(authUser.uid).set(operator);
  } catch {
    if (!promotedExisting) {
      await adminAuth().deleteUser(authUser.uid).catch(() => undefined);
    }
    return NextResponse.json(
      { ok: false, error: "operator_create_failed" },
      { status: 500 },
    );
  }
  await addAdminAuditLog(db, {
    actorId: admin.decoded.uid,
    actorEmail: admin.decoded.email,
    actorRole,
    requiredPermission: "operators:create",
    action: promotedExisting
      ? "operator.multi_role_promoted"
      : "operator.created",
    targetType: "user",
    targetId: authUser.uid,
    after: {
      uid: operator.uid,
      name: operator.name,
      email: operator.email,
      accountStatus: operator.accountStatus,
      status: operator.status,
      adminRole: operator.adminRole,
      adminCapabilityAllow: operator.adminCapabilityAllow,
      adminCapabilityDeny: operator.adminCapabilityDeny,
      multiRoleTestAccount: operator.multiRoleTestAccount ?? false,
      enabledPortals: operator.enabledPortals ?? [],
    },
    metadata: {
      targetName: operator.name,
      targetEmail: operator.email,
      status: operator.status,
      adminRole: operator.adminRole ?? null,
      promotedExisting,
    },
    createdAt: now,
  });

  return NextResponse.json({ ok: true, operator, promotedExisting });
}
