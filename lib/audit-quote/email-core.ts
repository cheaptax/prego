const EMAIL_MAX_LENGTH = 254;
const LOCAL_MAX_LENGTH = 64;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Browser-safe email helpers (no Node crypto, no Admin SDK imports). */
export function normalizeEmail(raw: string) {
  return raw.trim().toLowerCase();
}

export function isValidBusinessEmail(email: string) {
  if (!email || email.length > EMAIL_MAX_LENGTH) return false;
  if (email.includes("..")) return false;
  if (email.startsWith(".") || email.endsWith(".")) return false;
  if (!EMAIL_PATTERN.test(email)) return false;

  const [local, domain] = email.split("@");
  if (!local || !domain) return false;
  if (local.length > LOCAL_MAX_LENGTH) return false;
  if (domain.startsWith("-") || domain.endsWith("-")) return false;
  if (!domain.includes(".")) return false;
  if (domain.split(".").some((part) => !part || part.length > 63)) return false;
  return true;
}

export const NONGHYUP_EMAIL_DOMAIN = "nonghyup.com";

/** Event intake only accepts Nonghyup work emails. */
export function isNonghyupEmail(email: string) {
  if (!isValidBusinessEmail(email)) return false;
  return email.split("@")[1] === NONGHYUP_EMAIL_DOMAIN;
}

export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const visible = local.slice(0, 1);
  return `${visible}***@${domain}`;
}
