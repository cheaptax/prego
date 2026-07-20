import type { AuditQuoteStatus } from "@/lib/audit-quote/types";

export const AUDIT_QUOTE_STATUSES: AuditQuoteStatus[] = [
  "received",
  "contacting",
  "qualified",
  "info_complete",
  "quotes_requested",
  "delivered",
  "report_delivered",
  "closed",
  "invalid",
];

export const AUDIT_QUOTE_STATUS_LABELS: Record<AuditQuoteStatus, string> = {
  received: "접수",
  contacting: "연락 중",
  qualified: "요건 확인",
  info_complete: "정보 완료",
  quotes_requested: "견적 요청",
  delivered: "견적 전달",
  report_delivered: "검토보고서 전달",
  closed: "종료",
  invalid: "무효",
};

const TRANSITIONS: Record<AuditQuoteStatus, AuditQuoteStatus[]> = {
  received: ["contacting", "closed", "invalid"],
  contacting: ["qualified", "closed", "invalid"],
  qualified: ["info_complete", "closed", "invalid"],
  info_complete: ["quotes_requested", "closed", "invalid"],
  quotes_requested: ["delivered", "closed", "invalid"],
  delivered: ["report_delivered", "closed"],
  report_delivered: ["closed"],
  closed: [],
  invalid: [],
};

export function isAuditQuoteStatus(value: string): value is AuditQuoteStatus {
  return AUDIT_QUOTE_STATUSES.includes(value as AuditQuoteStatus);
}

export function canTransitionAuditQuoteStatus(
  from: AuditQuoteStatus,
  to: AuditQuoteStatus
) {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

export function allowedNextStatuses(from: AuditQuoteStatus) {
  return TRANSITIONS[from];
}
