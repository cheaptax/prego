import {
  escapeEmailHtml,
  getCustomerFacingAppBaseUrl,
  getTransactionalEmailConfigurationError,
  sendTransactionalEmail,
} from "@/lib/email/resend";
import {
  buildTemporaryMemberAccountNotice,
  resolveTemporaryAccountPassword,
} from "@/lib/email/temporary-account-notice";
import { adminDb } from "@/lib/firebase/admin";
import type { QuoteEmailDeliveryRecord } from "@/lib/firebase/schema";
import { quoteRequestIdFor } from "@/lib/quotes/quote-requests";

export type CustomerRequestEmailInput = {
  email: string;
  publicReference: string;
  contactName?: string;
  targetCooperativeName?: string;
  fiscalYear?: number;
  requestId: string;
  phone?: string | null;
  initialPassword?: string | null;
  attemptKey?: string;
};

export function requestEmailDeliveryId(requestId: string) {
  return `aqreq_${requestId}`;
}

export async function hasSuccessfulCustomerRequestEmail(requestId: string) {
  const snapshot = await adminDb()
    .collection("quoteEmailDeliveries")
    .doc(requestEmailDeliveryId(requestId))
    .get();
  return snapshot.exists && snapshot.data()?.status === "sent";
}

async function persistRequestEmailDelivery(
  record: QuoteEmailDeliveryRecord,
) {
  await adminDb()
    .collection("quoteEmailDeliveries")
    .doc(record.id)
    .set(record, { merge: true });
}

export function buildCustomerAuditQuoteRequestEmail(input: {
  publicReference: string;
  contactName?: string;
  targetCooperativeName?: string;
  fiscalYear?: number;
  mypageUrl: string;
  loginUrl: string;
  eventUrl: string;
  accountEmail: string;
  initialPassword?: string | null;
}) {
  const greeting = input.contactName?.trim()
    ? `${input.contactName.trim()}님, `
    : "";
  const subject = `[농협지원센터] 회계감사 견적 요청이 접수되었습니다 (${input.publicReference})`;
  const lines = [
    `${greeting}회계감사 견적 요청이 정상적으로 접수되었습니다.`,
    `접수번호: ${input.publicReference}`,
  ];
  if (input.targetCooperativeName) {
    lines.push(`대상 농협: ${input.targetCooperativeName}`);
  }
  if (input.fiscalYear) {
    lines.push(`사업연도: ${input.fiscalYear}`);
  }
  lines.push(
    "담당자가 제휴사 배정과 견적 취합을 진행합니다. 견적이 도착하면 이메일로 안내드리며, 마이페이지에서도 확인할 수 있습니다.",
  );
  const accountNotice = buildTemporaryMemberAccountNotice({
    loginUrl: input.loginUrl,
    accountEmail: input.accountEmail,
    initialPassword: input.initialPassword,
  });
  if (accountNotice.textLines.length > 0) {
    lines.push("", ...accountNotice.textLines);
  }
  lines.push(
    `마이페이지: ${input.mypageUrl}`,
    `견적 신청 안내: ${input.eventUrl}`,
  );

  const html = [
    `<p>${escapeEmailHtml(`${greeting}회계감사 견적 요청이 정상적으로 접수되었습니다.`)}</p>`,
    `<p>접수번호: <strong>${escapeEmailHtml(input.publicReference)}</strong></p>`,
    input.targetCooperativeName
      ? `<p>대상 농협: ${escapeEmailHtml(input.targetCooperativeName)}</p>`
      : "",
    input.fiscalYear ? `<p>사업연도: ${input.fiscalYear}</p>` : "",
    "<p>담당자가 제휴사 배정과 견적 취합을 진행합니다. 견적이 도착하면 이메일로 안내드리며, 마이페이지에서도 확인할 수 있습니다.</p>",
    accountNotice.html,
    `<p><a href="${escapeEmailHtml(input.mypageUrl)}">마이페이지에서 확인하기</a></p>`,
  ]
    .filter(Boolean)
    .join("");

  return { subject, html, text: lines.join("\n") };
}

/**
 * Confirmation mail for the requester. Failures are recorded and never thrown.
 */
export async function notifyCustomerAuditQuoteRequestReceived(
  input: CustomerRequestEmailInput,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const accountEmail = input.email.trim().toLowerCase();
  const now = new Date().toISOString();
  const deliveryId = requestEmailDeliveryId(input.requestId);
  const existing = await adminDb()
    .collection("quoteEmailDeliveries")
    .doc(deliveryId)
    .get();
  const previous = existing.exists
    ? (existing.data() as QuoteEmailDeliveryRecord)
    : null;
  const attemptCount = Number(previous?.attemptCount ?? 0) + 1;
  const baseDelivery = {
    id: deliveryId,
    quoteId: deliveryId,
    quoteRequestId: quoteRequestIdFor("audit_quote", input.requestId),
    auditQuoteRequestId: input.requestId,
    purpose: "audit_quote_request" as const,
    accountEmail,
    recipientEmail: accountEmail,
    provider: "resend" as const,
    attemptCount,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };

  const configError = getTransactionalEmailConfigurationError();
  if (configError) {
    console.info("[audit-quote] customer_request_email_skipped", {
      requestId: input.requestId,
      error: configError,
    });
    await persistRequestEmailDelivery({
      ...baseDelivery,
      status: "failed",
      lastError: configError,
    });
    return { ok: false, skipped: true, error: configError };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) {
    await persistRequestEmailDelivery({
      ...baseDelivery,
      status: "failed",
      lastError: "invalid_email",
    });
    return { ok: false, skipped: true, error: "invalid_email" };
  }

  const baseUrl = getCustomerFacingAppBaseUrl();
  const email = buildCustomerAuditQuoteRequestEmail({
    publicReference: input.publicReference,
    contactName: input.contactName,
    targetCooperativeName: input.targetCooperativeName,
    fiscalYear: input.fiscalYear,
    mypageUrl: `${baseUrl}/mypage`,
    loginUrl: `${baseUrl}/login`,
    eventUrl: `${baseUrl}/events/audit-quote`,
    accountEmail,
    initialPassword: resolveTemporaryAccountPassword(
      input.phone,
      input.initialPassword,
    ),
  });
  const attemptKey = input.attemptKey?.trim() || `attempt-${attemptCount}`;

  try {
    const sent = await sendTransactionalEmail({
      to: accountEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: `audit-quote-request/${input.requestId}/${accountEmail}/${attemptKey}`,
    });
    await persistRequestEmailDelivery({
      ...baseDelivery,
      recipientEmail: sent.recipientEmail,
      status: "sent",
      provider: sent.provider,
      providerMessageId: sent.id,
      sentAt: now,
      lastError: "",
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "send_failed";
    console.error("[audit-quote] customer_request_email_failed", {
      requestId: input.requestId,
      error: message,
    });
    await persistRequestEmailDelivery({
      ...baseDelivery,
      status: "failed",
      lastError: message,
    });
    return { ok: false, error: message };
  }
}
