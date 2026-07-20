import { createHmac } from "crypto";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidIdempotencyKey(value: string) {
  const key = value.trim();
  if (key.length < 8 || key.length > 128) return false;
  return UUID_RE.test(key);
}

export function hashIdempotencyKey(key: string, pepper: string) {
  return createHmac("sha256", pepper).update(key.trim(), "utf8").digest("hex");
}
