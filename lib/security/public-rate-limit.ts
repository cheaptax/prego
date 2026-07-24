import { createHmac } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";

type RateLimitInput = {
  db: Firestore;
  request: Request;
  namespace: string;
  secret: string;
  limit: number;
  windowMs: number;
  nowMs?: number;
};

function clientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  ).slice(0, 128);
}

export async function consumePublicRateLimit(input: RateLimitInput) {
  const nowMs = input.nowMs ?? Date.now();
  const windowStart = Math.floor(nowMs / input.windowMs) * input.windowMs;
  const key = createHmac("sha256", input.secret)
    .update(`${input.namespace}:${clientIp(input.request)}:${windowStart}`)
    .digest("hex");
  const ref = input.db.collection("publicRateLimits").doc(key);
  return input.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const count = snapshot.exists ? Number(snapshot.data()?.count ?? 0) : 0;
    if (count >= input.limit) {
      return {
        allowed: false as const,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((windowStart + input.windowMs - nowMs) / 1000),
        ),
      };
    }
    transaction.set(
      ref,
      {
        namespace: input.namespace,
        count: count + 1,
        windowStart: new Date(windowStart).toISOString(),
        expiresAt: new Date(windowStart + input.windowMs * 2).toISOString(),
        updatedAt: new Date(nowMs).toISOString(),
      },
      { merge: true },
    );
    return { allowed: true as const, retryAfterSeconds: 0 };
  });
}
