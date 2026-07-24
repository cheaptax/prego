import { randomUUID } from "node:crypto";
import type { DecodedIdToken } from "firebase-admin/auth";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  adminAuditEvaluationErrorCode,
  adminAuditEvaluationErrorStatus,
  AdminAuditEvaluationError,
} from "@/lib/audit-evaluation/admin-repository";
import {
  assertAuditEvaluationCapabilityEnabled,
  AuditEvaluationFeatureDisabledError,
} from "@/lib/audit-evaluation/feature-flags";
import {
  AdminAuthorizationError,
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
} from "@/lib/firebase/server";
import { recordSecurityAuditLog } from "@/lib/audit-evaluation/api-security";
import type { AdminPermission } from "@/lib/firebase/schema";

const MAX_ADMIN_BODY_BYTES = 20_000;

export async function requireAuditEvaluationAdmin(
  request: Request,
  permission: Extract<
    AdminPermission,
    "auditEvaluations:read" | "auditEvaluations:write"
  > = "auditEvaluations:read",
): Promise<DecodedIdToken> {
  let admin: DecodedIdToken;
  try {
    admin = await requireAdminCapability(request, permission);
  } catch (error) {
    await recordSecurityAuditLog({
      action: "ACCESS_DENIED",
      detail: "admin_access_denied",
      occurredAt: new Date().toISOString(),
    }).catch(() => undefined);
    throw error;
  }
  assertAuditEvaluationCapabilityEnabled("enabled");
  assertAuditEvaluationCapabilityEnabled("adminEnabled");
  return admin;
}

export async function readAdminJson(
  request: Request,
  maximumBytes = MAX_ADMIN_BODY_BYTES,
) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > maximumBytes
  ) {
    throw new AdminAuditEvaluationError("payload_too_large");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new AdminAuditEvaluationError("payload_too_large");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AdminAuditEvaluationError("invalid_json");
  }
}

export function adminAuditEvaluationApiError(error: unknown) {
  if (
    error instanceof AdminAuthorizationError ||
    error instanceof Error &&
    (
      error.message === "missing_token" ||
      error.message === "invalid_token" ||
      error.message === "permission_denied" ||
      error.message === "inactive_account"
    )
  ) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }
  if (error instanceof AuditEvaluationFeatureDisabledError) {
    return NextResponse.json(
      { ok: false, error: "audit_evaluation_admin_disabled" },
      { status: 404 },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { ok: false, error: "invalid_input" },
      { status: 400 },
    );
  }
  const code = adminAuditEvaluationErrorCode(error);
  if (code !== "internal_error") {
    const status = adminAuditEvaluationErrorStatus(error);
    if (status >= 500) {
      const correlationId = randomUUID();
      console.error("audit_evaluation_admin_data_error", { correlationId });
      return NextResponse.json(
        { ok: false, error: code, correlationId },
        { status },
      );
    }
    return NextResponse.json(
      { ok: false, error: code },
      { status },
    );
  }
  const correlationId = randomUUID();
  console.error("audit_evaluation_admin_api_failed", { correlationId });
  return NextResponse.json(
    { ok: false, error: "internal_error", correlationId },
    { status: 500 },
  );
}
