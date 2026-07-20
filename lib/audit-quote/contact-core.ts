/** Browser-safe contact field helpers (no Node crypto, no Admin SDK imports). */

const NAME_PATTERN = /^[가-힣a-zA-Z][가-힣a-zA-Z ]{0,29}$/;

export function normalizeContactName(raw: string) {
  return raw.trim().replace(/\s+/g, " ");
}

export function isValidContactName(name: string) {
  return NAME_PATTERN.test(name);
}

export function normalizePhoneDigits(raw: string) {
  return raw.replace(/\D/g, "");
}

/** Korean mobile numbers: 010/011/016/017/018/019 + 7~8 digits. */
export function isValidKoreanMobile(digits: string) {
  return /^01[016789]\d{7,8}$/.test(digits);
}

export function formatKoreanMobile(digits: string) {
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return digits;
}
