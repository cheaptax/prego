import { createHmac, randomBytes } from "node:crypto";
import {
  isValidKrMobilePhone,
  normalizeKrMobilePhone,
} from "@/lib/phone";

export type SendSmsInput = {
  to: string;
  text: string;
  idempotencyKey: string;
};

export type SendSmsResult =
  | { ok: true; provider: "solapi"; id: string | null }
  | { ok: false; skipped: true; error: string }
  | { ok: false; skipped: false; error: string };

function solapiConfig() {
  const apiKey = process.env.SOLAPI_API_KEY?.trim() || "";
  const apiSecret = process.env.SOLAPI_API_SECRET?.trim() || "";
  const from = process.env.SOLAPI_FROM_NUMBER?.trim() || "";
  if (!apiKey || !apiSecret || !from) return null;
  return { apiKey, apiSecret, from };
}

export function getTransactionalSmsConfigurationError() {
  if (!solapiConfig()) return "sms_not_configured";
  return null;
}

function solapiAuthHeader(apiKey: string, apiSecret: string) {
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", apiSecret)
    .update(date + salt)
    .digest("hex");
  return {
    Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
  };
}

/**
 * Optional transactional SMS. Skips cleanly when Solapi is not configured.
 * Quote-request volume is low; Solapi account limits still apply upstream.
 */
export async function sendTransactionalSms(
  input: SendSmsInput,
): Promise<SendSmsResult> {
  const text = input.text.trim();
  if (!text || /[\r\n]/.test(input.idempotencyKey) || !input.idempotencyKey.trim()) {
    return { ok: false, skipped: false, error: "invalid_sms_payload" };
  }
  const to = normalizeKrMobilePhone(input.to);
  if (!isValidKrMobilePhone(to)) {
    return { ok: false, skipped: false, error: "invalid_sms_recipient" };
  }
  const config = solapiConfig();
  if (!config) {
    if (process.env.NODE_ENV === "production") {
      console.info("[sms] solapi_not_configured", {
        to: `${to.slice(0, 3)}****${to.slice(-4)}`,
        idempotencyKey: input.idempotencyKey.slice(0, 64),
      });
    }
    return { ok: false, skipped: true, error: "sms_not_configured" };
  }

  const response = await fetch("https://api.solapi.com/messages/v4/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...solapiAuthHeader(config.apiKey, config.apiSecret),
    },
    body: JSON.stringify({
      message: {
        to,
        from: config.from,
        text: text.slice(0, 90),
      },
    }),
  });
  const body = (await response.json().catch(() => null)) as {
    groupId?: string;
    errorCode?: string;
    errorMessage?: string;
  } | null;
  if (!response.ok) {
    return {
      ok: false,
      skipped: false,
      error:
        body?.errorMessage ||
        body?.errorCode ||
        `sms_http_${response.status}`,
    };
  }
  return {
    ok: true,
    provider: "solapi",
    id: typeof body?.groupId === "string" ? body.groupId : null,
  };
}

/** Exported for tests — keeps sender numbers out of production logs. */
export function maskPhoneForLog(value: string) {
  const normalized = normalizeKrMobilePhone(value);
  if (normalized.length < 7) return "***";
  return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
}

export function resolveSmsFromNumberForTests() {
  return solapiConfig()?.from ?? null;
}
