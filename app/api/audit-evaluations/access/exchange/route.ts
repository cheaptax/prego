import { NextResponse } from "next/server";
import {
  AUDIT_EVALUATION_SESSION_COOKIE,
} from "@/lib/audit-evaluation/customer-access-token";
import { AuditEvaluationCustomerAccessService } from "@/lib/audit-evaluation/customer-access-service";
import {
  apiSecurityErrorResponse,
  assertTrustedMutationRequest,
  enforceAuditEvaluationRateLimit,
  readLimitedJson,
  recordSecurityAuditLog,
} from "@/lib/audit-evaluation/api-security";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    assertTrustedMutationRequest(req);
    await enforceAuditEvaluationRateLimit({
      request: req,
      scope: "access-exchange",
      maximumAttempts: 20,
      windowMs: 15 * 60 * 1_000,
    });
    const body = await readLimitedJson(req, 1_024) as {
      token?: unknown;
    };
    if (typeof body.token !== "string") {
      throw new Error("invalid_token");
    }
    const service = new AuditEvaluationCustomerAccessService();
    const grant = await service.exchangeAccessToken(
      body.token,
      new Date().toISOString(),
    );
    if (!grant) throw new Error("invalid_token");

    const response = NextResponse.json({
      ok: true,
      caseId: grant.evaluationCase.id,
    });
    response.cookies.set({
      name: AUDIT_EVALUATION_SESSION_COOKIE,
      value: grant.rawSessionToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      expires: new Date(grant.session.expiresAt),
    });
    return response;
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security?.status === 429) {
      return NextResponse.json(
        { ok: false, error: security.error },
        { status: security.status },
      );
    }
    await recordSecurityAuditLog({
      action: "ACCESS_DENIED",
      detail: "invalid_or_expired_access_link",
      occurredAt: new Date().toISOString(),
    }).catch(() => undefined);
    return NextResponse.json(
      { ok: false, error: "invalid_or_expired_access_link" },
      { status: 401 },
    );
  }
}
