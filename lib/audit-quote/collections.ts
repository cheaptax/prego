export const AUDIT_QUOTE_REQUESTS = "auditQuoteRequests";
export const AUDIT_QUOTE_IDEMPOTENCY = "auditQuoteIdempotency";
export const AUDIT_QUOTE_EMAIL_DEDUP = "auditQuoteEmailDedup";
export const AUDIT_QUOTE_RATE_LIMITS = "auditQuoteRateLimits";

export function emailDedupDocId(campaign: string, emailHash: string) {
  return `${campaign}_${emailHash}`;
}
