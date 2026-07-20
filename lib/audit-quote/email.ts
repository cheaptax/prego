import { createHmac, randomBytes } from "crypto";
import {
  isNonghyupEmail,
  isValidBusinessEmail,
  maskEmail,
  normalizeEmail,
} from "@/lib/audit-quote/email-core";

export { isNonghyupEmail, isValidBusinessEmail, maskEmail, normalizeEmail };

/** Server-only: HMAC-SHA256 email hash. Never use plain SHA for emailHash. */
export function hmacEmailHash(email: string, pepper: string) {
  return createHmac("sha256", pepper).update(email, "utf8").digest("hex");
}

export function fakePublicReference() {
  const token = randomBytes(2).toString("hex").toUpperCase();
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `AQ-${stamp}-${token}`;
}
