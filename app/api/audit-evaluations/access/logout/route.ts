import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { AuditEvaluationCustomerAccessService } from "@/lib/audit-evaluation/customer-access-service";
import { AUDIT_EVALUATION_SESSION_COOKIE } from "@/lib/audit-evaluation/customer-access-token";
import {
  assertTrustedMutationRequest,
} from "@/lib/audit-evaluation/api-security";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertTrustedMutationRequest(req, { requireJson: false });
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_request" },
      { status: 403 },
    );
  }
  const rawSessionToken =
    req.cookies.get(AUDIT_EVALUATION_SESSION_COOKIE)?.value ?? "";
  if (rawSessionToken) {
    try {
      const service = new AuditEvaluationCustomerAccessService();
      await service.revokeSession(
        rawSessionToken,
        new Date().toISOString(),
      );
    } catch {
      // Cookie removal is still completed if the server store is unavailable.
    }
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: AUDIT_EVALUATION_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
