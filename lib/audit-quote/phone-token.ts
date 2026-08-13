import { isValidKrMobilePhone, normalizeKrMobilePhone } from "@/lib/phone";
import {
  PHONE_OTP_PURPOSE_AUDIT_QUOTE,
  isPhoneOtpProofToken,
  verifyPhoneOtpProofToken,
} from "@/lib/phone-verification/otp";

const FIREBASE_PHONE_AUTH_MAX_AGE_SEC = 10 * 60;

export type AuditQuotePhoneTokenError =
  | "missing_phone_verification"
  | "invalid_phone_verification"
  | "phone_verification_expired";

type FirebasePhoneTokenClaims = {
  phone_number?: unknown;
  auth_time?: unknown;
};

export async function verifyAuditQuotePhoneVerificationToken(input: {
  token: string;
  phone: string;
  pepper: string;
  nowMs?: number;
  verifyFirebaseIdToken: (
    token: string,
  ) => Promise<FirebasePhoneTokenClaims>;
}): Promise<
  | { ok: true }
  | { ok: false; error: AuditQuotePhoneTokenError; status: 400 | 401 }
> {
  const token = input.token.trim();
  if (!token) {
    return { ok: false, error: "missing_phone_verification", status: 400 };
  }

  if (isPhoneOtpProofToken(token)) {
    const verified = verifyPhoneOtpProofToken({
      token,
      phone: input.phone,
      purpose: PHONE_OTP_PURPOSE_AUDIT_QUOTE,
      pepper: input.pepper,
      nowMs: input.nowMs,
    });
    if (!verified.ok) {
      return {
        ok: false,
        error: verified.error,
        status: verified.error === "phone_verification_expired" ? 400 : 401,
      };
    }
    return { ok: true };
  }

  try {
    const decoded = await input.verifyFirebaseIdToken(token);
    const verifiedPhone =
      typeof decoded.phone_number === "string"
        ? normalizeKrMobilePhone(decoded.phone_number)
        : "";
    if (
      verifiedPhone !== normalizeKrMobilePhone(input.phone) ||
      !isValidKrMobilePhone(verifiedPhone)
    ) {
      return { ok: false, error: "invalid_phone_verification", status: 400 };
    }
    const authTime = decoded.auth_time;
    const nowSec = Math.floor((input.nowMs ?? Date.now()) / 1000);
    if (
      typeof authTime !== "number" ||
      nowSec - authTime > FIREBASE_PHONE_AUTH_MAX_AGE_SEC
    ) {
      return { ok: false, error: "phone_verification_expired", status: 400 };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "invalid_phone_verification", status: 401 };
  }
}
