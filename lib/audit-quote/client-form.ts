import {
  isNonghyupEmail,
  normalizeEmail,
} from "@/lib/audit-quote/email-core";
import {
  formatKoreanMobile,
  isValidContactName,
  isValidKoreanMobile,
  normalizeContactName,
  normalizePhoneDigits,
} from "@/lib/audit-quote/contact-core";

export function validateAuditQuoteEmail(raw: string) {
  const email = normalizeEmail(raw);
  if (!email) return { ok: false as const, error: "농협 이메일을 입력해 주세요." };
  if (!isNonghyupEmail(email)) {
    return {
      ok: false as const,
      error: "농협 이메일(@nonghyup.com)만 신청할 수 있어요.",
    };
  }
  return { ok: true as const, email };
}

export function validateAuditQuoteName(raw: string) {
  const name = normalizeContactName(raw);
  if (!name) return { ok: false as const, error: "담당자 이름을 입력해 주세요." };
  if (!isValidContactName(name)) {
    return { ok: false as const, error: "이름을 정확히 입력해 주세요." };
  }
  return { ok: true as const, name };
}

export function validateAuditQuotePhone(raw: string) {
  const digits = normalizePhoneDigits(raw);
  if (!digits) {
    return { ok: false as const, error: "휴대폰 번호를 입력해 주세요." };
  }
  if (!isValidKoreanMobile(digits)) {
    return { ok: false as const, error: "올바른 휴대폰 번호를 입력해 주세요." };
  }
  return { ok: true as const, phone: formatKoreanMobile(digits) };
}

/** Live input mask: keeps digits only and re-inserts hyphens. */
export function formatPhoneInput(raw: string) {
  const digits = normalizePhoneDigits(raw).slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length < 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export function mapAuditQuoteApiError(code: string | undefined) {
  switch (code) {
    case "invalid_email":
      return "농협 이메일(@nonghyup.com)만 신청할 수 있어요.";
    case "invalid_name":
      return "담당자 이름을 정확히 입력해 주세요.";
    case "invalid_phone":
      return "올바른 휴대폰 번호를 입력해 주세요.";
    case "consent_required":
      return "개인정보 수집·이용에 동의해 주세요.";
    case "privacy_version_mismatch":
      return "동의 버전이 갱신되었습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.";
    case "event_disabled":
      return "현재 접수 기간이 아닙니다.";
    case "rate_limited":
      return "요청이 많아 잠시 후 다시 시도해 주세요.";
    case "origin_not_allowed":
    case "unsupported_media_type":
    case "payload_too_large":
      return "요청을 처리할 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.";
    default:
      return "전송 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";
  }
}

/** Session idempotency helper: reuse until success, then rotate. */
export class IdempotencyKeySession {
  private key: string | null = null;

  peek() {
    return this.key;
  }

  getForAttempt() {
    if (!this.key) {
      this.key =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
    return this.key;
  }

  clearAfterSuccess() {
    this.key = null;
  }
}
