import { Resend } from "resend";

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

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  resendClient ??= new Resend(apiKey);
  return resendClient;
}

export function getEmailFromAddress() {
  const from = (
    process.env.RESEND_FROM_EMAIL?.trim() ||
    process.env.NH_SUPPORT_FROM_EMAIL?.trim() ||
    "농협지원센터 <no-reply@nonghyup-support.local>"
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
    return { provider: "local" as const, id: null };
  }

  const result = await client.emails.send(
    {
      from: getEmailFromAddress(),
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: input.attachments,
    },
    { idempotencyKey: input.idempotencyKey.slice(0, 256) },
  );
  if (result.error) {
    throw new Error(result.error.message || "resend_send_failed");
  }
  return { provider: "resend" as const, id: result.data?.id ?? null };
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
