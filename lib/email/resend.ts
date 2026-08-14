import { Resend } from "resend";
import { resolveTransactionalRecipient } from "@/lib/test-data/email-classification";

type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
  }>;
};

let resendClient: Resend | null = null;
const EMAIL_SEND_ATTEMPTS = 3;
const EMAIL_SEND_RETRY_DELAYS_MS = [300, 800];

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  resendClient ??= new Resend(apiKey);
  return resendClient;
}

function resetResendClient() {
  resendClient = null;
}

export function isTransientEmailSendError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /unable to fetch data|could not be resolved|fetch failed|econnreset|etimedout|enotfound|eai_again|network|socket|aborted|undici/i.test(
    message,
  );
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getEmailFromAddress() {
  const from = (
    process.env.RESEND_FROM_EMAIL?.trim() ||
    process.env.NH_SUPPORT_FROM_EMAIL?.trim() ||
    "PREGO <no-reply@nonghyup-support.local>"
  );
  if (/[\r\n]/.test(from) || !from.includes("@")) {
    throw new Error("invalid_email_from_address");
  }
  if (
    process.env.NODE_ENV === "production" &&
    from.includes("@nonghyup-support.local")
  ) {
    throw new Error("production_email_from_not_configured");
  }
  return from;
}

/**
 * Resend rejects or mangles RFC 2047 (`=?UTF-8?B?...?=`) and raw Korean in the
 * From display name (Anymail: `?U` / punctuation triggers API or inbox mojibake).
 * Keep an ASCII-only friendly name for the Resend `from` field.
 */
export function sanitizeResendDisplayName(value: string) {
  const override = process.env.RESEND_FROM_DISPLAY_NAME?.trim();
  if (
    override &&
    !/[^\x20-\x7E]/u.test(override) &&
    !/=\?/u.test(override)
  ) {
    return override.replace(/\s+/gu, " ").trim();
  }

  // Strip MIME encoded-words, non-ASCII, and leftover mojibake markers (`?`)
  // that appear when Korean was already corrupted in env / transit.
  const ascii = value
    .replace(/=\?[\w-]+\?[BQbq]\?[A-Za-z0-9+\/=_-]*\?=/gu, " ")
    .replace(/[^\x20-\x7E]/gu, " ")
    .replace(/["\\<>?]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return ascii || "PREGO";
}

/** @deprecated Prefer sanitizeResendDisplayName — kept for tests/callers. */
export function encodeRfc2047Phrase(value: string) {
  // Intentionally unused for Resend From. Kept as a pure helper for other headers.
  const name = value.trim();
  if (!name) return "";
  if (/^=\?[\w-]+\?[BQbq]\?/u.test(name)) return name;
  if (!/[^\x20-\x7E]/u.test(name)) {
    return /[\s]/.test(name) ? name : name;
  }
  const encoded = Buffer.from(name, "utf8").toString("base64");
  return `=?UTF-8?B?${encoded}?=`;
}

export function formatEmailFromHeader(from: string) {
  const trimmed = from.trim();
  const match = trimmed.match(/^(.*)<([^<>]+)>\s*$/u);
  if (!match) {
    if (/[^\x20-\x7E]/u.test(trimmed) || /=\?/u.test(trimmed)) {
      throw new Error("invalid_email_from_address");
    }
    return trimmed;
  }
  const email = match[2].trim();
  if (!email.includes("@") || /[^\x20-\x7E]/u.test(email)) {
    throw new Error("invalid_email_from_address");
  }
  const rawName = match[1]
    .trim()
    .replace(/^"(.*)"$/u, "$1")
    .replace(/\\"/g, '"');
  if (!rawName) return email;
  const displayName = sanitizeResendDisplayName(rawName);
  // Never quote: Resend also mangles quoted From display names.
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._+-]*[A-Za-z0-9]$|^[A-Za-z0-9]$/u.test(displayName)) {
    return `PREGO <${email}>`;
  }
  return `${displayName} <${email}>`;
}

export function getTransactionalEmailConfigurationError():
  | "resend_not_configured"
  | "email_from_not_configured"
  | null {
  if (!process.env.RESEND_API_KEY?.trim()) return "resend_not_configured";
  if (
    !process.env.RESEND_FROM_EMAIL?.trim() &&
    !process.env.NH_SUPPORT_FROM_EMAIL?.trim()
  ) {
    return "email_from_not_configured";
  }
  try {
    getEmailFromAddress();
    return null;
  } catch {
    return "email_from_not_configured";
  }
}

export function getAppBaseUrl() {
  const configured =
    process.env.NH_SUPPORT_BASE_URL?.trim() ||
    process.env.AUDIT_QUOTE_ADMIN_BASE_URL?.trim() ||
    process.env.AUDIT_EVALUATION_BASE_URL?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    "http://localhost:3000";
  const normalized = configured.includes("://")
    ? configured
    : `https://${configured}`;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("invalid_app_base_url");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (process.env.NODE_ENV === "production" && url.protocol !== "https:")
  ) {
    throw new Error("invalid_app_base_url");
  }
  return url.toString().replace(/\/+$/, "");
}

export function getCustomerFacingAppBaseUrl(
  env: Record<string, string | undefined> = process.env,
) {
  if (env.NODE_ENV !== "production" && env.VERCEL !== "1") {
    return "http://localhost:3000";
  }
  return getAppBaseUrl();
}

export async function sendTransactionalEmail(input: SendEmailInput) {
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to) ||
    /[\r\n]/.test(input.subject) ||
    !input.idempotencyKey.trim()
  ) {
    throw new Error("invalid_email_payload");
  }
  const client = getResendClient();
  if (!client) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("resend_not_configured");
    }
    console.info("[email] resend_not_configured", {
      to: maskEmail(input.to),
      subject: input.subject,
      idempotencyKey: input.idempotencyKey,
    });
    return {
      provider: "local" as const,
      id: null,
      recipientEmail: resolveTransactionalRecipient(input.to),
    };
  }

  const recipientEmail = resolveTransactionalRecipient(input.to);
  const payload = {
    from: formatEmailFromHeader(getEmailFromAddress()),
    to: recipientEmail,
    subject: input.subject,
    html: input.html,
    text: input.text,
    attachments: input.attachments,
  };
  const idempotencyKey = input.idempotencyKey.slice(0, 256);
  let lastError: unknown;
  for (let attempt = 1; attempt <= EMAIL_SEND_ATTEMPTS; attempt += 1) {
    try {
      const activeClient = attempt === 1 ? client : getResendClient();
      if (!activeClient) throw new Error("resend_not_configured");
      const result = await activeClient.emails.send(payload, { idempotencyKey });
      if (result.error) {
        throw new Error(result.error.message || "resend_send_failed");
      }
      return {
        provider: "resend" as const,
        id: result.data?.id ?? null,
        recipientEmail,
      };
    } catch (error) {
      lastError = error;
      if (
        attempt === EMAIL_SEND_ATTEMPTS ||
        !isTransientEmailSendError(error)
      ) {
        break;
      }
      resetResendClient();
      await wait(EMAIL_SEND_RETRY_DELAYS_MS[attempt - 1] ?? 800);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("resend_send_failed");
}

export function verifyResendWebhook(
  payload: string,
  requestHeaders: Headers,
) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  const id = requestHeaders.get("svix-id")?.trim();
  const timestamp = requestHeaders.get("svix-timestamp")?.trim();
  const signature = requestHeaders.get("svix-signature")?.trim();
  if (!webhookSecret) throw new Error("resend_webhook_not_configured");
  if (!id || !timestamp || !signature) {
    throw new Error("resend_webhook_signature_missing");
  }
  return new Resend().webhooks.verify({
    payload,
    headers: { id, timestamp, signature },
    webhookSecret,
  });
}

export function maskEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

export function escapeEmailHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}
