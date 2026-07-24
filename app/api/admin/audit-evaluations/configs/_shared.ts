import type { DecodedIdToken } from "firebase-admin/auth";
import { NextResponse } from "next/server";
import { AdminConfigRepositoryError } from "@/lib/audit-evaluation/admin-config-repository";
import { getServerFeatureFlags } from "@/lib/audit-evaluation/feature-flags";
import {
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
} from "@/lib/firebase/server";
import { recordSecurityAuditLog } from "@/lib/audit-evaluation/api-security";

export async function requireConfigAdmin(
  request: Request,
): Promise<
  | { admin: DecodedIdToken; response: null }
  | { admin: null; response: NextResponse }
> {
  let admin: DecodedIdToken;
  try {
    admin = await requireAdminCapability(request, "auditEvaluations:write");
  } catch (error) {
    await recordSecurityAuditLog({
      action: "ACCESS_DENIED",
      detail: "admin_config_access_denied",
      occurredAt: new Date().toISOString(),
    }).catch(() => undefined);
    return {
      admin: null,
      response: NextResponse.json(
        { ok: false, error: authErrorCode(error) },
        { status: authErrorStatus(error) },
      ),
    };
  }
  const flags = getServerFeatureFlags().auditEvaluation;
  if (!flags.enabled || !flags.adminEnabled) {
    return {
      admin: null,
      response: NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404 },
      ),
    };
  }
  return { admin, response: null };
}

export function adminConfigErrorResponse(
  error: unknown,
  fallback: string,
) {
  if (error instanceof AdminConfigRepositoryError) {
    const status =
      error.code === "config_not_found" ||
        error.code === "draft_not_found"
        ? 404
        : error.code === "validation_failed"
          ? 422
          : error.code === "data_integrity_error"
            ? 500
            : 409;
    return NextResponse.json(
      {
        ok: false,
        error: error.code,
        ...(error.validation ? { validation: error.validation } : {}),
      },
      { status },
    );
  }
  return NextResponse.json(
    { ok: false, error: fallback },
    { status: 500 },
  );
}
