export const AUDIT_QUOTE_REQUESTS = "auditQuoteRequests";
export const AUDIT_QUOTE_IDEMPOTENCY = "auditQuoteIdempotency";
export const AUDIT_QUOTE_EMAIL_DEDUP = "auditQuoteEmailDedup";
export const AUDIT_QUOTE_RATE_LIMITS = "auditQuoteRateLimits";

function dedupSegment(value: string | number) {
  return encodeURIComponent(String(value || "none")).replace(/\./g, "%2E");
}

export function emailDedupDocId(input: {
  campaign: string;
  emailHash: string;
  targetCooperativeId: string;
  fiscalYear: number;
}) {
  return [
    dedupSegment(input.campaign),
    dedupSegment(input.emailHash),
    dedupSegment(input.targetCooperativeId),
    dedupSegment(input.fiscalYear),
  ].join("_");
}
