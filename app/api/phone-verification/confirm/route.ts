import { NextResponse } from "next/server";
import { getAuditQuoteConfig } from "@/lib/audit-quote/config";
import { guardAuditQuoteRequest } from "@/lib/audit-quote/http";
import { adminDb } from "@/lib/firebase/admin";
import { isPhoneOtpPurpose } from "@/lib/phone-verification/otp";
import { confirmPhoneOtpChallenge } from "@/lib/phone-verification/service";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const config = getAuditQuoteConfig();
  if (!config.enabled) {
    return NextResponse.json(
      { ok: false, error: "event_disabled" },
      { status: 403 },
    );
  }
  const guarded = await guardAuditQuoteRequest(req, config);
  if (!guarded.ok) {
    return NextResponse.json(
      { ok: false, error: guarded.error },
      { status: guarded.status },
    );
  }
  let body: { phone?: unknown; purpose?: unknown; code?: unknown };
  try {
    body = JSON.parse(guarded.rawBody) as {
      phone?: unknown;
      purpose?: unknown;
      code?: unknown;
    };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (
    !isPhoneOtpPurpose(body.purpose) ||
    typeof body.phone !== "string" ||
    typeof body.code !== "string"
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid_input" },
      { status: 400 },
    );
  }
  const result = await confirmPhoneOtpChallenge({
    db: adminDb(),
    phone: body.phone,
    purpose: body.purpose,
    code: body.code,
    pepper: config.hashPepper || "audit-quote-fallback",
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true, token: result.token });
}
