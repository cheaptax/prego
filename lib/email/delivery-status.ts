import type { QuoteEmailDeliveryRecord } from "@/lib/firebase/schema";

export const CUSTOMER_EMAIL_STATUS_LABELS: Record<
  QuoteEmailDeliveryRecord["status"],
  string
> = {
  pending: "대기",
  sending: "발송 중",
  sent: "발송됨",
  delivered: "수신 확인",
  bounced: "반송",
  complained: "스팸 신고",
  failed: "실패",
};

export function customerEmailStatusLabel(status: string) {
  return (
    CUSTOMER_EMAIL_STATUS_LABELS[
      status as QuoteEmailDeliveryRecord["status"]
    ] ?? status
  );
}

export type CustomerEmailDeliveryView = {
  id: string;
  purpose: "quote" | "audit_quote_request";
  purposeLabel: string;
  status: QuoteEmailDeliveryRecord["status"];
  statusLabel: string;
  accountEmail?: string;
  recipientEmail: string;
  ccEmails: string[];
  attemptCount: number;
  lastError?: string;
  sentAt?: string;
  updatedAt: string;
};

export function toCustomerEmailDeliveryView(
  record: QuoteEmailDeliveryRecord,
): CustomerEmailDeliveryView {
  const purpose = record.purpose === "audit_quote_request" ? "audit_quote_request" : "quote";
  return {
    id: record.id,
    purpose,
    purposeLabel:
      purpose === "audit_quote_request"
        ? "견적 요청 완료 안내"
        : "견적서 발송 안내",
    status: record.status,
    statusLabel: customerEmailStatusLabel(record.status),
    accountEmail: record.accountEmail,
    recipientEmail: record.recipientEmail,
    ccEmails: Array.isArray(record.ccEmails)
      ? record.ccEmails.filter(Boolean)
      : [],
    attemptCount: record.attemptCount,
    lastError: record.lastError,
    sentAt: record.sentAt,
    updatedAt: record.updatedAt,
  };
}
