import { NextResponse } from "next/server";
import {
  assertTrustedMutationRequest,
  enforceAuditEvaluationRateLimit,
  readLimitedJson,
} from "@/lib/audit-evaluation/api-security";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { activateTemporaryMemberPassword } from "@/lib/members/temporary-quote-member";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertTrustedMutationRequest(request);
    await enforceAuditEvaluationRateLimit({
      request,
      scope: "temporary-account-activation",
      maximumAttempts: 10,
      windowMs: 15 * 60 * 1_000,
    });
    const body = (await readLimitedJson(request, 4_096)) as {
      token?: unknown;
      password?: unknown;
    };
    if (
      typeof body.token !== "string" ||
      typeof body.password !== "string"
    ) {
      return NextResponse.json(
        { ok: false, error: "invalid_request" },
        { status: 400 },
      );
    }
    const activated = await activateTemporaryMemberPassword({
      db: adminDb(),
      auth: adminAuth(),
      token: body.token,
      password: body.password,
    });
    const customToken = await adminAuth().createCustomToken(activated.uid);
    return NextResponse.json({
      ok: true,
      customToken,
      quoteId: activated.quoteId,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "invalid_password") {
      return NextResponse.json(
        { ok: false, error: "invalid_password" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "invalid_or_expired_activation" },
      { status: 401 },
    );
  }
}
