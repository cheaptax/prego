import { NextResponse } from "next/server";
import { AuditEvaluationCustomerAccessService } from "@/lib/audit-evaluation/customer-access-service";
import { AUDIT_EVALUATION_SESSION_COOKIE } from "@/lib/audit-evaluation/customer-access-token";
import { canUseFirebaseCustomerEvaluationAccess } from "@/lib/audit-evaluation/firebase-customer-access-policy";
import { requireWritableActiveMember } from "@/lib/firebase/server";
import {
  assertTrustedMutationRequest,
  readLimitedJson,
  recordSecurityAuditLog,
} from "@/lib/audit-evaluation/api-security";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    assertTrustedMutationRequest(req);
    const { decoded, profile } = await requireWritableActiveMember(req);
    if (
      !profile ||
      !canUseFirebaseCustomerEvaluationAccess(
        decoded,
        profile.status,
      )
    ) {
      throw new Error("access_denied");
    }

    const body = await readLimitedJson(req, 1_024) as {
      publicReference?: unknown;
    };
    const service = new AuditEvaluationCustomerAccessService();
    const grant = await service.createFirebaseCustomerSession({
      uid: decoded.uid,
      email: decoded.email,
      publicReference:
        typeof body.publicReference === "string"
          ? body.publicReference.slice(0, 100)
          : undefined,
      now: new Date().toISOString(),
    });
    if (!grant) throw new Error("access_denied");

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
  } catch {
    await recordSecurityAuditLog({
      action: "ACCESS_DENIED",
      detail: "firebase_customer_access_denied",
      occurredAt: new Date().toISOString(),
    }).catch(() => undefined);
    return NextResponse.json(
      { ok: false, error: "access_denied" },
      { status: 403 },
    );
  }
}
