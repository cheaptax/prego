import type { Firestore } from "firebase-admin/firestore";
import { getAuditQuoteConfig } from "@/lib/audit-quote/config";
import { hashRateLimitKey } from "@/lib/audit-quote/security";
import { withoutUndefined } from "@/lib/firebase/clean";
import { isValidKrMobilePhone, normalizeKrMobilePhone } from "@/lib/phone";
import { sendTransactionalSms } from "@/lib/sms/transactional";
import {
  PHONE_OTP_CODE_TTL_MS,
  PHONE_OTP_MAX_CONFIRM_ATTEMPTS,
  PHONE_OTP_SEND_MAX_PER_IP,
  PHONE_OTP_SEND_MAX_PER_PHONE,
  PHONE_OTP_SEND_WINDOW_MS,
  buildPhoneOtpSmsText,
  equalPhoneOtpHash,
  generatePhoneOtpCode,
  hashPhoneOtpCode,
  hashPhoneOtpValue,
  issuePhoneOtpProofToken,
  phoneOtpChallengeId,
  type PhoneOtpPurpose,
} from "@/lib/phone-verification/otp";

export const PHONE_VERIFICATION_CHALLENGES = "phoneVerificationChallenges";
export const PHONE_VERIFICATION_RATE_LIMITS = "phoneVerificationRateLimits";

export function isLocalPhoneOtpDeliveryAllowed(
  env: Record<string, string | undefined> = process.env,
) {
  return (
    env.NODE_ENV !== "production" &&
    env.VERCEL !== "1" &&
    env.AUDIT_QUOTE_DISABLE_LOCAL_PHONE_OTP !== "true"
  );
}

type ChallengeRecord = {
  purpose: PhoneOtpPurpose;
  phoneHash: string;
  codeHash: string;
  expiresAtMs: number;
  attemptCount: number;
  createdAtMs: number;
  consumedAtMs?: number;
};

type RateLimitRecord = {
  count: number;
  windowStartMs: number;
};

type SendSms = typeof sendTransactionalSms;

function bumpRateLimit(
  record: RateLimitRecord | undefined,
  nowMs: number,
  max: number,
) {
  if (!record || nowMs - record.windowStartMs >= PHONE_OTP_SEND_WINDOW_MS) {
    return { count: 1, windowStartMs: nowMs, limited: false };
  }
  const count = record.count + 1;
  return {
    count,
    windowStartMs: record.windowStartMs,
    limited: count > max,
  };
}

export async function sendPhoneOtpChallenge(input: {
  db: Firestore;
  phone: string;
  purpose: PhoneOtpPurpose;
  ipHash: string;
  pepper?: string;
  nowMs?: number;
  sendSms?: SendSms;
  allowLocalDelivery?: boolean;
}): Promise<
  | { ok: true; localCode?: string }
  | {
      ok: false;
      error:
        | "invalid_phone"
        | "rate_limited"
        | "sms_not_configured"
        | "sms_send_failed";
      status: number;
    }
> {
  const phone = normalizeKrMobilePhone(input.phone);
  if (!isValidKrMobilePhone(phone)) {
    return { ok: false, error: "invalid_phone", status: 400 };
  }
  const pepper = input.pepper || getAuditQuoteConfig().hashPepper;
  const nowMs = input.nowMs ?? Date.now();
  const sendSms = input.sendSms ?? sendTransactionalSms;
  const phoneHash = hashPhoneOtpValue(phone, pepper);
  const phoneLimitId = hashRateLimitKey("otp-send-phone", phoneHash, pepper);
  const ipLimitId = hashRateLimitKey("otp-send-ip", input.ipHash, pepper);
  const phoneLimitRef = input.db
    .collection(PHONE_VERIFICATION_RATE_LIMITS)
    .doc(phoneLimitId);
  const ipLimitRef = input.db
    .collection(PHONE_VERIFICATION_RATE_LIMITS)
    .doc(ipLimitId);

  const [phoneLimitSnap, ipLimitSnap] = await Promise.all([
    phoneLimitRef.get(),
    ipLimitRef.get(),
  ]);
  const phoneLimit = bumpRateLimit(
    phoneLimitSnap.data() as RateLimitRecord | undefined,
    nowMs,
    PHONE_OTP_SEND_MAX_PER_PHONE,
  );
  const ipLimit = bumpRateLimit(
    ipLimitSnap.data() as RateLimitRecord | undefined,
    nowMs,
    PHONE_OTP_SEND_MAX_PER_IP,
  );
  if (phoneLimit.limited || ipLimit.limited) {
    return { ok: false, error: "rate_limited", status: 429 };
  }

  await Promise.all([
    phoneLimitRef.set({
      count: phoneLimit.count,
      windowStartMs: phoneLimit.windowStartMs,
    }),
    ipLimitRef.set({
      count: ipLimit.count,
      windowStartMs: ipLimit.windowStartMs,
    }),
  ]);

  const challengeId = phoneOtpChallengeId({
    purpose: input.purpose,
    phone,
    pepper,
  });
  const code = generatePhoneOtpCode();
  const sent = await sendSms({
    to: phone,
    text: buildPhoneOtpSmsText(code),
    idempotencyKey: `phone-otp/${challengeId}/${nowMs}`,
  });
  const allowLocalDelivery =
    input.allowLocalDelivery ?? isLocalPhoneOtpDeliveryAllowed();
  if (!sent.ok) {
    if (sent.error !== "sms_not_configured" || !allowLocalDelivery) {
      return {
        ok: false,
        error:
          sent.error === "sms_not_configured"
            ? "sms_not_configured"
            : "sms_send_failed",
        status: 503,
      };
    }
  }

  const challenge: ChallengeRecord = {
    purpose: input.purpose,
    phoneHash,
    codeHash: hashPhoneOtpCode({ challengeId, code, pepper }),
    expiresAtMs: nowMs + PHONE_OTP_CODE_TTL_MS,
    attemptCount: 0,
    createdAtMs: nowMs,
  };
  await input.db
    .collection(PHONE_VERIFICATION_CHALLENGES)
    .doc(challengeId)
    .set(withoutUndefined(challenge));
  return sent.ok ? { ok: true } : { ok: true, localCode: code };
}

export async function confirmPhoneOtpChallenge(input: {
  db: Firestore;
  phone: string;
  purpose: PhoneOtpPurpose;
  code: string;
  pepper?: string;
  nowMs?: number;
}): Promise<
  | { ok: true; token: string }
  | {
      ok: false;
      error:
        | "invalid_phone"
        | "invalid_phone_verification"
        | "phone_verification_expired";
      status: number;
    }
> {
  const phone = normalizeKrMobilePhone(input.phone);
  const code = input.code.replace(/\D/gu, "").slice(0, 6);
  if (!isValidKrMobilePhone(phone) || code.length !== 6) {
    return { ok: false, error: "invalid_phone_verification", status: 400 };
  }
  const pepper = input.pepper || getAuditQuoteConfig().hashPepper;
  const nowMs = input.nowMs ?? Date.now();
  const challengeId = phoneOtpChallengeId({
    purpose: input.purpose,
    phone,
    pepper,
  });
  const challengeRef = input.db
    .collection(PHONE_VERIFICATION_CHALLENGES)
    .doc(challengeId);
  const snapshot = await challengeRef.get();
  if (!snapshot.exists) {
    return { ok: false, error: "invalid_phone_verification", status: 400 };
  }
  const challenge = snapshot.data() as ChallengeRecord;
  if (challenge.consumedAtMs) {
    return { ok: false, error: "invalid_phone_verification", status: 400 };
  }
  if (challenge.expiresAtMs <= nowMs) {
    return { ok: false, error: "phone_verification_expired", status: 400 };
  }
  if (challenge.attemptCount >= PHONE_OTP_MAX_CONFIRM_ATTEMPTS) {
    return { ok: false, error: "invalid_phone_verification", status: 400 };
  }
  const nextAttempts = challenge.attemptCount + 1;
  const expected = hashPhoneOtpCode({ challengeId, code, pepper });
  if (!equalPhoneOtpHash(challenge.codeHash, expected)) {
    await challengeRef.set({
      ...challenge,
      attemptCount: nextAttempts,
    });
    return { ok: false, error: "invalid_phone_verification", status: 400 };
  }
  await challengeRef.set({
    ...challenge,
    attemptCount: nextAttempts,
    consumedAtMs: nowMs,
  });
  return {
    ok: true,
    token: issuePhoneOtpProofToken({
      purpose: input.purpose,
      phone,
      pepper,
      nowMs,
    }),
  };
}
