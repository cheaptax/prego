import { createHash } from "node:crypto";
import {
  escapeEmailHtml,
  getTransactionalEmailConfigurationError,
  sendTransactionalEmail,
} from "@/lib/email/resend";

type EnvMap = Record<string, string | undefined>;
type Fetcher = typeof fetch;

const EMAIL_WEBHOOK_TIMEOUT_MS = 10_000;

export type AuditEvaluationAccessEmail = {
  recipientEmail: string;
  magicLink: string;
  expiresAt: string;
};

export interface AuditEvaluationAccessEmailAdapter {
  readonly available: boolean;
  sendAccessLink(message: AuditEvaluationAccessEmail): Promise<void>;
}

type TransactionalEmailSender = typeof sendTransactionalEmail;

class DisabledAccessEmailAdapter
  implements AuditEvaluationAccessEmailAdapter
{
  readonly available = false;

  async sendAccessLink() {
    throw new Error("audit_evaluation_email_provider_unavailable");
  }
}

class LocalDevelopmentAccessEmailAdapter
  implements AuditEvaluationAccessEmailAdapter
{
  readonly available = true;

  async sendAccessLink(message: AuditEvaluationAccessEmail) {
    console.info("[audit-evaluation][local-access-link-created]", {
      expiresAt: message.expiresAt,
    });
  }
}

export class WebhookAccessEmailAdapter
  implements AuditEvaluationAccessEmailAdapter
{
  readonly available: boolean;
  private readonly url: string;
  private readonly bearerToken: string;
  private readonly fetcher: Fetcher;

  constructor(input: {
    url: string;
    bearerToken: string;
    fetcher?: Fetcher;
  }) {
    this.url = input.url.trim();
    this.bearerToken = input.bearerToken.trim();
    this.fetcher = input.fetcher ?? fetch;
    this.available =
      isSecureWebhookUrl(this.url) &&
      this.bearerToken.length >= 16;
  }

  async sendAccessLink(message: AuditEvaluationAccessEmail) {
    if (!this.available) {
      throw new Error("audit_evaluation_email_provider_unavailable");
    }
    const response = await this.fetcher(this.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.bearerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        schemaVersion: 1,
        event: "AUDIT_EVALUATION_ACCESS_LINK",
        recipientEmail: message.recipientEmail,
        magicLink: message.magicLink,
        expiresAt: message.expiresAt,
      }),
      signal: AbortSignal.timeout(EMAIL_WEBHOOK_TIMEOUT_MS),
      redirect: "error",
    });
    if (!response.ok) {
      throw new Error("audit_evaluation_email_delivery_failed");
    }
  }
}

export class ResendAccessEmailAdapter
  implements AuditEvaluationAccessEmailAdapter
{
  readonly available: boolean;
  private readonly sender: TransactionalEmailSender;

  constructor(input: {
    available?: boolean;
    sender?: TransactionalEmailSender;
  } = {}) {
    this.available =
      input.available ?? getTransactionalEmailConfigurationError() === null;
    this.sender = input.sender ?? sendTransactionalEmail;
  }

  async sendAccessLink(message: AuditEvaluationAccessEmail) {
    if (!this.available) {
      throw new Error("audit_evaluation_email_provider_unavailable");
    }
    const safeLink = escapeEmailHtml(message.magicLink);
    const safeExpiry = escapeEmailHtml(message.expiresAt);
    await this.sender({
      to: message.recipientEmail,
      subject: "농협지원센터 감사인 견적 평가 접속 안내",
      html: [
        "<p>감사인 견적 비교·평가 화면 접속 요청이 접수되었습니다.</p>",
        `<p><a href="${safeLink}">일회용 접속 링크 열기</a></p>`,
        `<p>링크 만료 시각: ${safeExpiry}</p>`,
        "<p>본인이 요청하지 않았다면 이 메일을 무시해 주세요.</p>",
      ].join(""),
      text: [
        "감사인 견적 비교·평가 화면 일회용 접속 링크입니다.",
        message.magicLink,
        `링크 만료 시각: ${message.expiresAt}`,
        "본인이 요청하지 않았다면 이 메일을 무시해 주세요.",
      ].join("\n"),
      idempotencyKey: `audit-evaluation-access/${createHash("sha256")
        .update(message.magicLink, "utf8")
        .digest("hex")}`,
    });
  }
}

export function getAuditEvaluationAccessEmailAdapter(
  env: EnvMap = process.env,
): AuditEvaluationAccessEmailAdapter {
  const provider = env.AUDIT_EVALUATION_EMAIL_PROVIDER?.trim().toLowerCase();
  const resendAvailable = Boolean(
    env.RESEND_API_KEY?.trim() &&
      (
        env.RESEND_FROM_EMAIL?.trim() ||
        env.NH_SUPPORT_FROM_EMAIL?.trim()
      ),
  );
  if (provider === "local" && env.NODE_ENV === "development") {
    return new LocalDevelopmentAccessEmailAdapter();
  }
  if (provider === "webhook") {
    return new WebhookAccessEmailAdapter({
      url: env.AUDIT_EVALUATION_EMAIL_WEBHOOK_URL ?? "",
      bearerToken: env.AUDIT_EVALUATION_EMAIL_WEBHOOK_TOKEN ?? "",
    });
  }
  if (provider === "resend" || resendAvailable) {
    return new ResendAccessEmailAdapter({
      available: resendAvailable,
    });
  }
  return new DisabledAccessEmailAdapter();
}

function isSecureWebhookUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
