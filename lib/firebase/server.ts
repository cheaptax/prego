import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import {
  ANSWER_POINT_MAX,
  ANSWER_POINT_MIN,
} from "@/lib/answer-points";
import {
  canAccessResource,
  createAuthorizationContext,
  hasAnyPermission,
  hasPermission,
  isAccountActive,
  isAdminRole,
  resolveAdminCapabilities,
} from "@/lib/admin/rbac";
import { prepareAdminAuditLog } from "@/lib/admin/audit";
import {
  assertInstitutionWriteAllowed,
  InstitutionPurgeLockedError,
} from "@/lib/test-data/purge-lock";
import type {
  AdminAuditLogInput,
  AdminCapability,
  AdminPermission,
  AdminResourceDescriptor,
  AdminRole,
  AdminScope,
  AuditLogRecord,
  AuthorizationContext,
  PartnerAssignmentRecord,
  PartnerRecord,
  UserRecord,
} from "@/lib/firebase/schema";

export { ANSWER_POINT_MIN, ANSWER_POINT_MAX };

export function getBearerToken(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const [type, token] = authorization.split(" ");
  return type?.toLowerCase() === "bearer" ? token : "";
}

export type AdminAuthorizationErrorCode =
  | "missing_token"
  | "invalid_token"
  | "permission_denied"
  | "inactive_account"
  | "profile_not_found"
  | "scope_denied"
  | "recent_authentication_required"
  | "institution_purge_in_progress";

export class AdminAuthorizationError extends Error {
  readonly code: AdminAuthorizationErrorCode;
  readonly status: 401 | 403;

  constructor(
    code: AdminAuthorizationErrorCode,
    status: 401 | 403,
  ) {
    super(code);
    this.name = "AdminAuthorizationError";
    this.code = code;
    this.status = status;
  }
}

export async function verifyBearerToken(req: Request) {
  const token = getBearerToken(req);
  if (!token) throw new AdminAuthorizationError("missing_token", 401);
  try {
    return await adminAuth().verifyIdToken(token);
  } catch {
    throw new AdminAuthorizationError("invalid_token", 401);
  }
}

export function isAdminToken(decoded: DecodedIdToken) {
  return decoded.admin === true;
}

export type AuthenticatedAdmin = {
  decoded: DecodedIdToken;
  profile: UserRecord;
  context: AuthorizationContext;
};

function assertTokenProfileIdentity(
  decoded: DecodedIdToken,
  profile: UserRecord,
) {
  const tokenEmail = decoded.email?.trim().toLowerCase();
  const profileEmail = profile.email?.trim().toLowerCase();
  if (
    profile.uid !== decoded.uid ||
    !tokenEmail ||
    !profileEmail ||
    tokenEmail !== profileEmail
  ) {
    throw new AdminAuthorizationError("permission_denied", 403);
  }
}

export async function requireAuthenticatedAdmin(
  req: Request,
): Promise<AuthenticatedAdmin> {
  const decoded = await verifyBearerToken(req);
  if (!isAdminToken(decoded) || decoded.partner === true) {
    throw new AdminAuthorizationError("permission_denied", 403);
  }
  const profile = await getUserRecord(decoded.uid);
  if (!profile) {
    throw new AdminAuthorizationError("profile_not_found", 403);
  }
  if (profile.role !== "admin") {
    throw new AdminAuthorizationError("permission_denied", 403);
  }
  if (!isAdminRole(profile.adminRole)) {
    throw new AdminAuthorizationError("permission_denied", 403);
  }
  assertTokenProfileIdentity(decoded, profile);
  return {
    decoded,
    profile,
    context: createAuthorizationContext(profile),
  };
}

export async function requireActiveAdmin(req: Request) {
  const session = await requireAuthenticatedAdmin(req);
  if (!isAccountActive(session.context)) {
    throw new AdminAuthorizationError("inactive_account", 403);
  }
  return session;
}

export async function requirePermission(
  req: Request,
  permission: AdminPermission,
) {
  const session = await requireActiveAdmin(req);
  if (!hasPermission(session.context, permission)) {
    throw new AdminAuthorizationError("permission_denied", 403);
  }
  return session;
}

export async function requireAnyPermission(
  req: Request,
  permissions: readonly AdminPermission[],
) {
  const session = await requireActiveAdmin(req);
  if (!hasAnyPermission(session.context, permissions)) {
    throw new AdminAuthorizationError("permission_denied", 403);
  }
  return session;
}

export async function requireRole(
  req: Request,
  roles: AdminRole | readonly AdminRole[],
) {
  const session = await requireActiveAdmin(req);
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  if (
    !session.context.adminRole ||
    !allowedRoles.includes(session.context.adminRole)
  ) {
    throw new AdminAuthorizationError("permission_denied", 403);
  }
  return session;
}

export function assertAdminScope(
  context: AuthorizationContext,
  resource: AdminResourceDescriptor,
  requiredScope?: AdminScope,
) {
  if (!canAccessResource(context, resource, requiredScope)) {
    throw new AdminAuthorizationError("scope_denied", 403);
  }
}

export async function requireAdmin(req: Request) {
  return (await requireActiveAdmin(req)).decoded;
}

export async function requireAdminCapability(
  req: Request,
  capability: AdminCapability,
) {
  // Compatibility wrapper for existing API routes. New routes should use
  // requirePermission and keep the returned authorization context.
  return (await requirePermission(req, capability)).decoded;
}

export async function getAdminSession(req: Request) {
  const { decoded, profile, context } = await requireActiveAdmin(req);
  return {
    decoded,
    profile,
    context,
    permissions: context.permissions,
    capabilities: resolveAdminCapabilities(profile),
  };
}

export function isActiveAdminProfile(
  profile: Pick<UserRecord, "role" | "status" | "accountStatus"> | null,
) {
  return profile?.role === "admin" && isAccountActive(profile);
}

export function isActivePartnerProfile(
  profile: Pick<
    UserRecord,
    "role" | "status" | "accountStatus" | "partnerId"
  > | null,
) {
  return (
    profile?.role === "partner" &&
    isAccountActive(profile) &&
    Boolean(profile.partnerId)
  );
}

export async function requireMember(req: Request) {
  const decoded = await verifyBearerToken(req);
  if (decoded.admin === true || decoded.partner === true) {
    throw new AdminAuthorizationError("permission_denied", 403);
  }
  const profile = await getUserRecord(decoded.uid);
  if (!profile) {
    throw new AdminAuthorizationError("profile_not_found", 403);
  }
  if (profile.role !== "member") {
    throw new AdminAuthorizationError("permission_denied", 403);
  }
  assertTokenProfileIdentity(decoded, profile);
  return { decoded, profile };
}

export async function requireActiveMember(req: Request) {
  const session = await requireMember(req);
  if (session.profile.status !== "active") {
    throw new AdminAuthorizationError("inactive_account", 403);
  }
  return session;
}

export async function requireQuoteInboxMember(req: Request) {
  const session = await requireMember(req);
  if (
    session.profile.status !== "active" &&
    session.profile.status !== "temporary_quote_member"
  ) {
    throw new AdminAuthorizationError("inactive_account", 403);
  }
  return session;
}

export async function requireWritableActiveMember(req: Request) {
  const session = await requireActiveMember(req);
  if (session.profile.cooperativeId) {
    try {
      await assertInstitutionWriteAllowed(
        adminDb(),
        session.profile.cooperativeId,
      );
    } catch (error) {
      if (!(error instanceof InstitutionPurgeLockedError)) throw error;
      throw new AdminAuthorizationError("institution_purge_in_progress", 403);
    }
  }
  return session;
}

export async function requirePartner(req: Request) {
  const decoded = await verifyBearerToken(req);
  if (decoded.partner !== true || decoded.admin === true) {
    throw new AdminAuthorizationError("permission_denied", 403);
  }
  const profile = await getUserRecord(decoded.uid);
  if (!profile) {
    throw new AdminAuthorizationError("profile_not_found", 403);
  }
  if (!isActivePartnerProfile(profile)) {
    throw new AdminAuthorizationError("inactive_account", 403);
  }
  assertTokenProfileIdentity(decoded, profile);
  const partnerId = String(profile.partnerId ?? "").trim();
  if (!partnerId) {
    throw new AdminAuthorizationError("profile_not_found", 403);
  }
  if (
    typeof decoded.partnerId === "string" &&
    decoded.partnerId.trim() &&
    decoded.partnerId.trim() !== partnerId
  ) {
    throw new AdminAuthorizationError("permission_denied", 403);
  }
  const partnerSnapshot = await adminDb()
    .collection("partners")
    .doc(partnerId)
    .get();
  if (!partnerSnapshot.exists) {
    throw new AdminAuthorizationError("profile_not_found", 403);
  }
  const partner = {
    ...(partnerSnapshot.data() as PartnerRecord),
    id: partnerId,
  };
  if (partner.status !== "active") {
    throw new AdminAuthorizationError("inactive_account", 403);
  }
  return { decoded, profile, partner };
}

export function canPartnerReadAssignment(
  assignment: PartnerAssignmentRecord,
  partnerId: string,
) {
  return assignment.partnerId === partnerId && assignment.status !== "revoked";
}

export function authErrorStatus(error: unknown) {
  if (error instanceof AdminAuthorizationError) return error.status;
  if (
    error instanceof Error &&
    (error.message === "missing_token" || error.message === "invalid_token")
  ) {
    return 401;
  }
  return 403;
}

export function authErrorCode(error: unknown) {
  if (error instanceof AdminAuthorizationError) return error.code;
  if (
    error instanceof Error &&
    (error.message === "missing_token" || error.message === "invalid_token")
  ) {
    return error.message;
  }
  return "permission_denied";
}

export function authErrorResponse(error: unknown) {
  return Response.json(
    { ok: false, error: authErrorCode(error) },
    { status: authErrorStatus(error) },
  );
}

export function getRequestId(req: Request) {
  return req.headers.get("x-request-id") ??
    req.headers.get("x-vercel-id") ??
    crypto.randomUUID();
}

export async function getUserRecord(uid: string) {
  const snapshot = await adminDb().collection("users").doc(uid).get();
  return snapshot.exists ? (snapshot.data() as UserRecord) : null;
}

export function normalizeVisibility(visibility: string) {
  const normalized = visibility.toLowerCase();
  return normalized === "org_only" ? "nonghyup" : normalized;
}

export function canReadRequest(
  request: {
    uid: string;
    cooperativeId?: string;
    nh_org_id?: string;
    visibility: string;
  },
  user: UserRecord,
) {
  const visibility = normalizeVisibility(request.visibility);
  if (request.uid === user.uid) return true;
  if (visibility === "public") return true;
  if (visibility === "nonghyup") {
    const requestOrgId = request.nh_org_id ?? request.cooperativeId;
    const userOrgId = user.nh_org_id ?? user.cooperativeId;
    return Boolean(requestOrgId && userOrgId && requestOrgId === userOrgId);
  }
  return false;
}

export function validateAnswerPointCost(pointCost: unknown) {
  const value = Number(pointCost);
  if (!Number.isInteger(value)) return null;
  if (value < ANSWER_POINT_MIN || value > ANSWER_POINT_MAX) return null;
  return value;
}

export function auditLogRef(db: Firestore) {
  return db.collection("auditLogs").doc();
}

export function writeAuditLog(
  transaction: Transaction,
  db: Firestore,
  input: Omit<AuditLogRecord, "id" | "createdAt"> & { createdAt?: string },
) {
  const ref = auditLogRef(db);
  transaction.set(
    ref,
    withoutUndefined({
      id: ref.id,
      createdAt: input.createdAt ?? new Date().toISOString(),
      ...input,
    } satisfies AuditLogRecord)
  );
}

export async function addAuditLog(
  db: Firestore,
  input: Omit<AuditLogRecord, "id" | "createdAt"> & { createdAt?: string },
) {
  const ref = auditLogRef(db);
  await ref.set(
    withoutUndefined({
      id: ref.id,
      createdAt: input.createdAt ?? new Date().toISOString(),
      ...input,
    } satisfies AuditLogRecord)
  );
}

export function writeAdminAuditLog(
  transaction: Transaction,
  db: Firestore,
  input: AdminAuditLogInput,
) {
  writeAuditLog(transaction, db, prepareAdminAuditLog(input));
}

export async function addAdminAuditLog(
  db: Firestore,
  input: AdminAuditLogInput,
) {
  await addAuditLog(db, prepareAdminAuditLog(input));
}
