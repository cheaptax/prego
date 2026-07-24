import "server-only";

import { createHmac } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { AUDIT_EVALUATION_COLLECTIONS } from "@/lib/audit-evaluation/collections";
import { getAuditEvaluationAccessSecret } from "@/lib/audit-evaluation/customer-access-token";
import { adminDb } from "@/lib/firebase/admin";
import {
  AuditEvaluationApiSecurityError,
  nextRateLimitState,
} from "@/lib/audit-evaluation/api-security-core";

const SAFE_CASE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
export {
  assertTrustedMutationRequest,
  readLimitedJson,
} from "@/lib/audit-evaluation/api-security-core";

export async function enforceAuditEvaluationRateLimit(input: {
  request: Request;
  scope:
    | "access-request"
    | "access-exchange"
    | "temporary-account-activation";
  maximumAttempts: number;
  windowMs: number;
  now?: string;
  db?: Firestore;
}) {
  const now = input.now ?? new Date().toISOString();
  const nowMs = Date.parse(now);
  const clientAddress = trustedClientAddress(input.request);
  const secret = getAuditEvaluationAccessSecret();
  const key = createHmac("sha256", secret)
    .update(`${input.scope}|${clientAddress}`, "utf8")
    .digest("hex");
  const db = input.db ?? adminDb();
  const reference = db
    .collection(AUDIT_EVALUATION_COLLECTIONS.rateLimits)
    .doc(`${input.scope}-${key}`);
  const allowed = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.exists
      ? snapshot.data() as {
          count?: unknown;
          windowStartedAt?: unknown;
        }
      : null;
    const next = nextRateLimitState(
      current,
      now,
      input.windowMs,
      input.maximumAttempts,
    );
    transaction.set(reference, {
      scope: input.scope,
      keyHash: key,
      count: next.count,
      windowStartedAt: next.windowStartedAt,
      expiresAt: new Date(nowMs + input.windowMs * 2).toISOString(),
      updatedAt: now,
    });
    return next.allowed;
  });
  if (!allowed) {
    await recordSecurityAuditLog({
      action: "ACCESS_DENIED",
      detail: `rate_limited:${input.scope}`,
      occurredAt: now,
    }).catch(() => undefined);
    throw new AuditEvaluationApiSecurityError("rate_limited");
  }
}

export async function recordSecurityAuditLog(input: {
  action: "ACCESS_DENIED" | "ACCESS_SESSION_REVOKED";
  detail: string;
  occurredAt: string;
  caseId?: string | null;
  db?: Firestore;
}) {
  const db = input.db ?? adminDb();
  const caseId =
    input.caseId && SAFE_CASE_ID.test(input.caseId)
      ? input.caseId
      : null;
  const reference = db
    .collection(AUDIT_EVALUATION_COLLECTIONS.auditLogs)
    .doc();
  await reference.set({
    id: reference.id,
    caseId,
    reportVersion: null,
    documentId: null,
    action: input.action,
    actor: {
      type: "SYSTEM",
      service: "audit-evaluation-api-security",
    },
    occurredAt: input.occurredAt,
    detail: input.detail.slice(0, 200),
    errorCode: input.action === "ACCESS_DENIED"
      ? "ACCESS_DENIED"
      : null,
    retryCount: null,
  });
}

export function apiSecurityErrorResponse(error: unknown) {
  if (!(error instanceof AuditEvaluationApiSecurityError)) return null;
  if (error.code === "rate_limited") {
    return { status: 429, error: "temporarily_unavailable" };
  }
  if (error.code === "payload_too_large") {
    return { status: 413, error: "invalid_request" };
  }
  return { status: 403, error: "invalid_request" };
}

function trustedClientAddress(request: Request) {
  return (
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  ).slice(0, 128);
}
