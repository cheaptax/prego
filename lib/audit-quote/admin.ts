import type { AuditQuoteRequestRecord, AuditQuoteStatus } from "@/lib/audit-quote/types";
import { maskEmail } from "@/lib/audit-quote/email";

export type AuditQuoteListItem = {
  requestId: string;
  publicReference: string;
  targetCooperativeName: string;
  emailMasked: string;
  contactName: string;
  status: AuditQuoteStatus;
  quoteCount: number;
  campaign: string;
  channel: string;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  marketingConsent: boolean;
};

export type AuditQuoteDetail = AuditQuoteListItem & {
  email: string;
  phone: string;
  privacyPolicyVersion: string;
  pagePath: string;
  referrerHost?: string;
};

export function toIsoTimestamp(value: unknown) {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return "";
}

export function toAuditQuoteListItem(
  record: AuditQuoteRequestRecord
): AuditQuoteListItem {
  return {
    requestId: record.requestId,
    publicReference: record.publicReference,
    targetCooperativeName: record.targetCooperativeName ?? "",
    emailMasked: maskEmail(record.email),
    contactName: record.contactName ?? "",
    status: record.status,
    quoteCount: record.quoteCount,
    campaign: record.campaign,
    channel: record.channel,
    assignedTo: record.assignedTo,
    createdAt: toIsoTimestamp(record.createdAt),
    updatedAt: toIsoTimestamp(record.updatedAt),
    marketingConsent: Boolean(record.marketingConsent),
  };
}

export function toAuditQuoteDetail(
  record: AuditQuoteRequestRecord
): AuditQuoteDetail {
  return {
    ...toAuditQuoteListItem(record),
    email: record.email,
    phone: record.phone ?? "",
    privacyPolicyVersion: record.privacyPolicyVersion,
    pagePath: record.pagePath,
    referrerHost: record.referrerHost,
  };
}
