import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import {
  ANSWER_POINT_MAX,
  ANSWER_POINT_MIN,
} from "@/lib/answer-points";
import type { AuditLogRecord, UserRecord } from "@/lib/firebase/schema";

export { ANSWER_POINT_MIN, ANSWER_POINT_MAX };

export function getBearerToken(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const [type, token] = authorization.split(" ");
  return type?.toLowerCase() === "bearer" ? token : "";
}

export async function verifyBearerToken(req: Request) {
  const token = getBearerToken(req);
  if (!token) throw new Error("missing_token");
  return adminAuth().verifyIdToken(token);
}

export function isAdminToken(decoded: DecodedIdToken) {
  return decoded.admin === true;
}

export async function requireAdmin(req: Request) {
  const decoded = await verifyBearerToken(req);
  if (!isAdminToken(decoded)) throw new Error("permission_denied");
  return decoded;
}

export function authErrorStatus(error: unknown) {
  if (error instanceof Error && error.message === "missing_token") return 401;
  return 403;
}

export function authErrorCode(error: unknown) {
  if (error instanceof Error && error.message === "missing_token") {
    return "missing_token";
  }
  return "permission_denied";
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
