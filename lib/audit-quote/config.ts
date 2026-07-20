const DEFAULT_CAMPAIGNS = ["fy27-audit-quote"] as const;
const DEFAULT_CHANNELS = ["event_page", "direct", "share"] as const;

type EnvMap = Record<string, string | undefined>;

function readBool(env: EnvMap, name: string, fallback: boolean) {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return fallback;
}

function readList(env: EnvMap, name: string, fallback: readonly string[]) {
  const raw = env[name]?.trim();
  if (!raw) return [...fallback];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readInt(env: EnvMap, name: string, fallback: number) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export type AuditQuoteConfig = {
  enabled: boolean;
  privacyPolicyVersion: string;
  hashPepper: string;
  allowedCampaigns: string[];
  allowedChannels: string[];
  allowedOrigins: string[];
  maxBodyBytes: number;
  dedupeWindowMs: number;
  pagePath: string;
  rateLimit: {
    ipWindowMs: number;
    ipMax: number;
    emailWindowMs: number;
    emailMax: number;
  };
  /** Boundary only: when true, requests must pass captcha/App Check adapter. */
  captchaEnabled: boolean;
  appCheckEnabled: boolean;
};

export function getAuditQuoteConfig(
  env: EnvMap = process.env
): AuditQuoteConfig {
  const hashPepper =
    env.AUDIT_QUOTE_HASH_PEPPER?.trim() ||
    env.AUDIT_QUOTE_HMAC_SECRET?.trim() ||
    "";

  return {
    // Default OFF so accidental deploy without env does not open intake.
    enabled: readBool(env, "AUDIT_QUOTE_EVENT_ENABLED", false),
    privacyPolicyVersion:
      env.AUDIT_QUOTE_PRIVACY_POLICY_VERSION?.trim() || "2026-07-20",
    hashPepper,
    allowedCampaigns: readList(
      env,
      "AUDIT_QUOTE_ALLOWED_CAMPAIGNS",
      DEFAULT_CAMPAIGNS
    ),
    allowedChannels: readList(
      env,
      "AUDIT_QUOTE_ALLOWED_CHANNELS",
      DEFAULT_CHANNELS
    ),
    allowedOrigins: readList(env, "AUDIT_QUOTE_ALLOWED_ORIGINS", [
      "http://localhost:3000",
      "https://project-eta-one-64.vercel.app",
    ]),
    maxBodyBytes: readInt(env, "AUDIT_QUOTE_MAX_BODY_BYTES", 8192),
    dedupeWindowMs: readInt(
      env,
      "AUDIT_QUOTE_DEDUPE_WINDOW_MS",
      24 * 60 * 60 * 1000
    ),
    pagePath: "/events/audit-quote",
    rateLimit: {
      ipWindowMs: readInt(env, "AUDIT_QUOTE_RATE_IP_WINDOW_MS", 10 * 60 * 1000),
      ipMax: readInt(env, "AUDIT_QUOTE_RATE_IP_MAX", 20),
      emailWindowMs: readInt(
        env,
        "AUDIT_QUOTE_RATE_EMAIL_WINDOW_MS",
        24 * 60 * 60 * 1000
      ),
      emailMax: readInt(env, "AUDIT_QUOTE_RATE_EMAIL_MAX", 5),
    },
    captchaEnabled: readBool(env, "AUDIT_QUOTE_CAPTCHA_ENABLED", false),
    appCheckEnabled: readBool(env, "AUDIT_QUOTE_APP_CHECK_ENABLED", false),
  };
}

export function assertAuditQuoteSecrets(config: AuditQuoteConfig) {
  if (!config.hashPepper || config.hashPepper.length < 16) {
    throw new Error("missing_audit_quote_hash_pepper");
  }
}
