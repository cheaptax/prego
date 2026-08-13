import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { normalizeKrMobilePhone } from "@/lib/phone";

export const PHONE_OTP_PURPOSE_AUDIT_QUOTE = "audit_quote";
export const PHONE_OTP_TOKEN_PREFIX = "pv1";
export const PHONE_OTP_CODE_TTL_MS = 5 * 60 * 1000;
export const PHONE_OTP_PROOF_TTL_MS = 10 * 60 * 1000;
export const PHONE_OTP_MAX_CONFIRM_ATTEMPTS = 5;
export const PHONE_OTP_SEND_WINDOW_MS = 10 * 60 * 1000;
export const PHONE_OTP_SEND_MAX_PER_PHONE = 5;
export const PHONE_OTP_SEND_MAX_PER_IP = 8;

export type PhoneOtpPurpose = typeof PHONE_OTP_PURPOSE_AUDIT_QUOTE;

export function isPhoneOtpPurpose(value: unknown): value is PhoneOtpPurpose {
  return value === PHONE_OTP_PURPOSE_AUDIT_QUOTE;
}

export function generatePhoneOtpCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashPhoneOtpValue(value: string, pepper: string) {
  return createHmac("sha256", pepper).update(value, "utf8").digest("hex");
}

export function phoneOtpChallengeId(input: {
  purpose: PhoneOtpPurpose;
  phone: string;
  pepper: string;
}) {
  return hashPhoneOtpValue(
    `${input.purpose}:${normalizeKrMobilePhone(input.phone)}`,
    input.pepper,
  );
}

export function hashPhoneOtpCode(input: {
  challengeId: string;
  code: string;
  pepper: string;
}) {
  return hashPhoneOtpValue(`${input.challengeId}:${input.code}`, input.pepper);
}

export function equalPhoneOtpHash(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export type PhoneOtpProofPayload = {
  v: 1;
  purpose: PhoneOtpPurpose;
  phoneHash: string;
  exp: number;
};

function encodeProofPayload(payload: PhoneOtpProofPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function signProofBody(body: string, pepper: string) {
  return createHmac("sha256", pepper).update(body, "utf8").digest("base64url");
}

export function issuePhoneOtpProofToken(input: {
  purpose: PhoneOtpPurpose;
  phone: string;
  pepper: string;
  nowMs?: number;
  ttlMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const ttlMs = input.ttlMs ?? PHONE_OTP_PROOF_TTL_MS;
  const payload: PhoneOtpProofPayload = {
    v: 1,
    purpose: input.purpose,
    phoneHash: hashPhoneOtpValue(normalizeKrMobilePhone(input.phone), input.pepper),
    exp: Math.floor((nowMs + ttlMs) / 1000),
  };
  const body = encodeProofPayload(payload);
  return `${PHONE_OTP_TOKEN_PREFIX}.${body}.${signProofBody(body, input.pepper)}`;
}

export function isPhoneOtpProofToken(token: string) {
  return token.trim().startsWith(`${PHONE_OTP_TOKEN_PREFIX}.`);
}

export function verifyPhoneOtpProofToken(input: {
  token: string;
  phone: string;
  purpose: PhoneOtpPurpose;
  pepper: string;
  nowMs?: number;
}): { ok: true } | { ok: false; error: "invalid_phone_verification" | "phone_verification_expired" } {
  const token = input.token.trim();
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PHONE_OTP_TOKEN_PREFIX) {
    return { ok: false, error: "invalid_phone_verification" };
  }
  const [, body, signature] = parts;
  if (!body || !signature) {
    return { ok: false, error: "invalid_phone_verification" };
  }
  const expected = signProofBody(body, input.pepper);
  if (!equalPhoneOtpHash(signature, expected)) {
    return { ok: false, error: "invalid_phone_verification" };
  }
  let payload: PhoneOtpProofPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PhoneOtpProofPayload;
  } catch {
    return { ok: false, error: "invalid_phone_verification" };
  }
  if (
    payload.v !== 1 ||
    payload.purpose !== input.purpose ||
    typeof payload.exp !== "number" ||
    typeof payload.phoneHash !== "string"
  ) {
    return { ok: false, error: "invalid_phone_verification" };
  }
  const nowMs = input.nowMs ?? Date.now();
  if (payload.exp * 1000 <= nowMs) {
    return { ok: false, error: "phone_verification_expired" };
  }
  const phoneHash = hashPhoneOtpValue(
    normalizeKrMobilePhone(input.phone),
    input.pepper,
  );
  if (!equalPhoneOtpHash(payload.phoneHash, phoneHash)) {
    return { ok: false, error: "invalid_phone_verification" };
  }
  return { ok: true };
}

export function buildPhoneOtpSmsText(code: string) {
  return `[농협지원센터] 인증번호 ${code}`;
}
