import type {
  PartnerProfession,
  PartnerRecord,
  QuoteAssignmentRecord,
} from "@/lib/firebase/schema";

const AUDIT_ELIGIBLE_PROFESSIONS = new Set<PartnerProfession>([
  "ACCOUNTANT",
  "TAX_ACCOUNTANT",
  "OTHER",
]);

/** 고객에게 비교 견적을 보내기 위한 최소 배정 수 */
export const MIN_AUDIT_QUOTE_ASSIGNMENTS = 2;

export function isPartnerEligibleForAuditQuote(
  partner: Pick<PartnerRecord, "fields" | "profession" | "status">,
) {
  if (partner.fields.includes("감사")) return true;
  return AUDIT_ELIGIBLE_PROFESSIONS.has(partner.profession ?? "OTHER");
}

export function formatAssignedPartnerNames(
  assignments: Array<Pick<QuoteAssignmentRecord, "partnerName" | "status">>,
) {
  return assignments
    .filter((item) => item.status !== "revoked")
    .map((item) => item.partnerName.trim())
    .filter(Boolean)
    .join(", ");
}

export function resolveExpectedAuditQuoteCount(
  requestedCount: number,
  activeAssignmentCount: number,
) {
  return Math.max(
    Number.isFinite(requestedCount) ? requestedCount : 0,
    activeAssignmentCount,
    MIN_AUDIT_QUOTE_ASSIGNMENTS,
  );
}
