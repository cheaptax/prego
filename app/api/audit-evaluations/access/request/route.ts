import { NextResponse } from "next/server";
import { AuditEvaluationCustomerAccessService } from "@/lib/audit-evaluation/customer-access-service";
import {
  apiSecurityErrorResponse,
  assertTrustedMutationRequest,
  enforceAuditEvaluationRateLimit,
  readLimitedJson,
} from "@/lib/audit-evaluation/api-security";
import { normalizeEmail } from "@/lib/audit-quote/email";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    assertTrustedMutationRequest(req);
    await enforceAuditEvaluationRateLimit({
      request: req,
      scope: "access-request",
      // Keep room for retries during local/internal testing without
      // locking out eligible customers after a few failed attempts.
      maximumAttempts: 30,
      windowMs: 15 * 60 * 1_000,
    });
    const body = (await readLimitedJson(req, 4_096)) as {
      email?: unknown;
      publicReference?: unknown;
    };
    const email =
      typeof body.email === "string" ? normalizeEmail(body.email) : "";
    const service = new AuditEvaluationCustomerAccessService();
    await service.requestEmailAccess({
      email,
      publicReference:
        typeof body.publicReference === "string"
          ? body.publicReference.trim().slice(0, 100) || undefined
          : undefined,
      now: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      status: "access_instructions_if_eligible",
    });
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security) {
      return NextResponse.json(
        { ok: false, error: security.error },
        { status: security.status },
      );
    }
    return NextResponse.json({
      ok: true,
      status: "access_instructions_if_eligible",
    });
  }
}
