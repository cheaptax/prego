import type {
  QuoteAssignmentRecord,
  QuoteRecord,
  QuoteRequestRecord,
} from "@/lib/firebase/schema";
import {
  sanitizeNhAuditPartnerFormDraft,
  valuesFromNhAuditSubmission,
  type NhAuditPartnerFormValues,
} from "@/lib/quotes/nh-audit-quote-form";

export function partnerQuoteRevisionBlockReason(input: {
  authenticatedPartnerId: string;
  assignment: Pick<QuoteAssignmentRecord, "partnerId" | "status">;
  quoteRequest: Pick<QuoteRequestRecord, "status">;
}):
  | null
  | "permission_denied"
  | "assignment_not_finalized"
  | "assignment_revoked"
  | "quote_request_closed" {
  if (input.assignment.partnerId !== input.authenticatedPartnerId) {
    return "permission_denied";
  }
  if (input.assignment.status === "revoked") {
    return "assignment_revoked";
  }
  if (["closed", "cancelled"].includes(input.quoteRequest.status)) {
    return "quote_request_closed";
  }
  if (!["finalized", "submitted"].includes(input.assignment.status)) {
    return "assignment_not_finalized";
  }
  return null;
}

export function canPartnerReviseQuoteAssignment(input: {
  authenticatedPartnerId: string;
  assignment: Pick<QuoteAssignmentRecord, "partnerId" | "status">;
  quoteRequest: Pick<QuoteRequestRecord, "status">;
}) {
  return partnerQuoteRevisionBlockReason(input) === null;
}

export function isSentPartnerQuote(
  quote: Pick<QuoteRecord, "status">,
): boolean {
  return quote.status === "finalized" || quote.status === "delivered";
}

export function formatQuoteVersionLabel(version: number) {
  const numeric = Number(version);
  if (!Number.isSafeInteger(numeric) || numeric < 1) return "v1";
  return `v${numeric}`;
}

export function pickLatestSentQuote(
  quotes: readonly QuoteRecord[],
  assignmentId: string,
): QuoteRecord | null {
  return (
    [...quotes]
      .filter(
        (quote) =>
          quote.quoteAssignmentId === assignmentId &&
          isSentPartnerQuote(quote),
      )
      .sort((left, right) => Number(right.version) - Number(left.version))[0] ??
    null
  );
}

export function nhAuditFormFromSentQuote(
  quote: QuoteRecord,
): NhAuditPartnerFormValues | null {
  if (quote.nhAuditDraft) {
    return {
      ...sanitizeNhAuditPartnerFormDraft(quote.nhAuditDraft),
      factsConfirmed: false,
    };
  }
  if (quote.nhAuditV2?.submission) {
    return {
      ...valuesFromNhAuditSubmission(quote.nhAuditV2.submission),
      factsConfirmed: false,
    };
  }
  return null;
}

/** Build a mutable draft document seeded from the latest sent quote. */
export function buildRevisionDraftFromSentQuote(input: {
  source: QuoteRecord;
  createdBy: string;
  createdByEmail?: string;
  now: string;
}): QuoteRecord {
  const { source, createdBy, createdByEmail, now } = input;
  const nhAuditDraft = nhAuditFormFromSentQuote(source) ?? undefined;
  return {
    id: `${source.quoteAssignmentId}_draft`,
    quoteRequestId: source.quoteRequestId,
    quoteAssignmentId: source.quoteAssignmentId,
    partnerId: source.partnerId,
    partnerName: source.partnerName,
    status: "draft",
    version: 0,
    customerEmail: source.customerEmail,
    supplierName: source.supplierName,
    supplierBusinessRegistrationNumber:
      source.supplierBusinessRegistrationNumber,
    supplierAddress: source.supplierAddress,
    supplierContactName: source.supplierContactName,
    supplierContactEmail: source.supplierContactEmail,
    supplierContactPhone: source.supplierContactPhone,
    logoPath: source.logoPath,
    sealPath: source.sealPath,
    lineItems: source.lineItems.map((item) => ({ ...item })),
    subtotal: source.subtotal,
    taxAmount: source.taxAmount,
    totalAmount: source.totalAmount,
    vatIncluded: source.vatIncluded,
    servicePeriod: source.servicePeriod,
    validUntil: source.validUntil,
    terms: source.terms,
    notes: source.notes,
    nhAuditDraft,
    createdBy,
    createdByEmail,
    createdAt: now,
    updatedAt: now,
  };
}
