import { createHash } from "crypto";
import type { AuditQuoteConfig } from "@/lib/audit-quote/config";

export function isJsonContentType(contentType: string | null) {
  if (!contentType) return false;
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

export function resolveRequestOrigin(req: Request) {
  const origin = req.headers.get("origin")?.trim();
  if (origin) return origin;

  const referer = req.headers.get("referer")?.trim();
  if (!referer) return "";
  try {
    return new URL(referer).origin;
  } catch {
    return "";
  }
}

export function isAllowedOrigin(origin: string, allowedOrigins: string[]) {
  if (!origin) return false;
  return allowedOrigins.some((allowed) => allowed === origin);
}

export function extractReferrerHost(req: Request) {
  const referer = req.headers.get("referer")?.trim();
  if (!referer) return undefined;
  try {
    return new URL(referer).host.slice(0, 253);
  } catch {
    return undefined;
  }
}

export function hashRateLimitKey(scope: string, value: string, pepper: string) {
  return createHash("sha256")
    .update(`${pepper}:${scope}:${value}`, "utf8")
    .digest("hex");
}

export function getClientIpHash(req: Request, pepper: string) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = req.headers.get("x-real-ip")?.trim();
  const ip = forwarded || realIp || "unknown";
  return hashRateLimitKey("ip", ip, pepper);
}

export function isHoneypotTriggered(companyWebsite: unknown) {
  if (typeof companyWebsite !== "string") return false;
  return companyWebsite.trim().length > 0;
}

export function isShortToken(value: string, max = 64) {
  return /^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$/i.test(value) && value.length <= max;
}

export function assertSourceAllowed(
  campaign: string,
  channel: string,
  config: AuditQuoteConfig
) {
  return (
    config.allowedCampaigns.includes(campaign) &&
    config.allowedChannels.includes(channel) &&
    isShortToken(campaign) &&
    isShortToken(channel)
  );
}

/** Extension point for CAPTCHA / App Check. Disabled by default. */
export async function verifyBotProtection(input: {
  captchaEnabled: boolean;
  appCheckEnabled: boolean;
  captchaToken?: string;
  appCheckToken?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (input.captchaEnabled) {
    if (!input.captchaToken?.trim()) {
      return { ok: false, error: "captcha_required" };
    }
    // Adapter intentionally unimplemented until a provider is approved.
    return { ok: false, error: "captcha_not_configured" };
  }
  if (input.appCheckEnabled) {
    if (!input.appCheckToken?.trim()) {
      return { ok: false, error: "app_check_required" };
    }
    return { ok: false, error: "app_check_not_configured" };
  }
  return { ok: true };
}
