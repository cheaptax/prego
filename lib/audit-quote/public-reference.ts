import { randomBytes } from "crypto";

export function createPublicReference(now = new Date()) {
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("");
  const token = randomBytes(2).toString("hex").toUpperCase();
  return `AQ-${stamp}-${token}`;
}
