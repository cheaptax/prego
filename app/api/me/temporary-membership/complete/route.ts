import { NextResponse } from "next/server";
import {
  assertTrustedMutationRequest,
  readLimitedJson,
} from "@/lib/audit-evaluation/api-security";
import { resolveSignupCooperative } from "@/lib/cooperatives/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  addAuditLog,
  authErrorCode,
  authErrorStatus,
  requireMember,
} from "@/lib/firebase/server";
import { convertTemporaryMember } from "@/lib/members/temporary-member-conversion";
import { isTemporaryQuoteMember } from "@/lib/members/temporary-quote-member";
import { isTestCustomerEmail } from "@/lib/test-data/email-classification";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let session;
  try {
    assertTrustedMutationRequest(request);
    session = await requireMember(request);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }
  if (
    session.decoded.email_verified !== true ||
    !isTemporaryQuoteMember(session.profile)
  ) {
    return NextResponse.json(
      { ok: false, error: "temporary_membership_required" },
      { status: 403 },
    );
  }

  try {
    const body = (await readLimitedJson(request, 16_384)) as {
      cooperativeId?: unknown;
      position?: unknown;
      duty?: unknown;
      conversionConsent?: unknown;
    };
    if (
      typeof body.cooperativeId !== "string" ||
      typeof body.position !== "string" ||
      typeof body.duty !== "string"
    ) {
      return NextResponse.json(
        { ok: false, error: "missing_fields" },
        { status: 400 },
      );
    }
    const cooperative = await resolveSignupCooperative(body.cooperativeId);
    if (
      !cooperative ||
      (cooperative.isDemoInstitution &&
        !isTestCustomerEmail(session.decoded.email ?? ""))
    ) {
      return NextResponse.json(
        { ok: false, error: "invalid_cooperative" },
        { status: 400 },
      );
    }
    const result = await convertTemporaryMember({
      db: adminDb(),
      uid: session.decoded.uid,
      cooperative,
      conversion: {
        cooperativeId: body.cooperativeId,
        position: body.position,
        duty: body.duty,
        conversionConsent: body.conversionConsent === true,
        existingConsents: session.profile.consents,
      },
    });
    await addAuditLog(adminDb(), {
      actorUid: session.decoded.uid,
      actorEmail: session.decoded.email,
      action: "temporary_member.converted",
      targetType: "user",
      targetId: session.decoded.uid,
      metadata: {
        cooperativeId: cooperative.cooperative_id,
        grantedPoints: result.grantedPoints,
      },
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "conversion_failed";
    const safeCode = [
      "missing_cooperative",
      "invalid_cooperative",
      "invalid_position",
      "invalid_duty",
      "consent_required",
      "phone_account_limit_exceeded",
      "temporary_membership_required",
    ].includes(code)
      ? code
      : "conversion_failed";
    return NextResponse.json(
      { ok: false, error: safeCode },
      { status: safeCode === "conversion_failed" ? 500 : 400 },
    );
  }
}
