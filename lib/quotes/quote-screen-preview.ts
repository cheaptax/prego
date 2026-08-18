import { normalizeWonAmount } from "@/lib/audit-evaluation/money";
import {
  NH_AUDIT_QUOTE_SUBMISSION_SCHEMA_VERSION,
  type NhAuditQuoteSubmissionV2,
} from "@/lib/audit-evaluation/nh-audit-v2-types";
import type {
  PartnerRecord,
  QuoteRecord,
  QuoteRequestRecord,
} from "@/lib/firebase/schema";
import { calculateQuoteTotals } from "@/lib/quotes/quote-calculation";
import { applyNhAuditEvaluationDefaults } from "@/lib/quotes/nh-audit-evaluation-defaults";
import { createNhAuditEvaluationSnapshotV2 } from "@/lib/quotes/nh-audit-quote-server";
import {
  QUOTE_SCREEN_PREVIEW_NOTES,
  STANDARD_QUOTE_SERVICE_PERIOD,
  STANDARD_QUOTE_TERMS,
  STANDARD_QUOTE_VALID_UNTIL,
} from "@/lib/quotes/quote-presentation";
import {
  normalizeQuoteScreenProfile,
  type QuoteScreenProfile,
  type QuoteScreenProfilePayload,
} from "@/lib/quotes/quote-screen-profile";

const PREVIEW_REVENUE_WON = "12000000000";
const PREVIEW_AUDIT_FEE_WON = "18500000";
const PREVIEW_EXPENSE_WON = "1200000";

export { usableQuoteImageDataUri } from "@/lib/quotes/quote-pdf-assets";

export function parseQuoteScreenPreviewProfile(
  payload: unknown,
  actor: { uid: string; email?: string },
  now: string,
): QuoteScreenProfile | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const sections = Array.isArray(record.sections)
    ? record.sections.map((section) => {
        if (!section || typeof section !== "object") return section;
        const item = section as Record<string, unknown>;
        const titleOverride =
          typeof item.titleOverride === "string"
            ? item.titleOverride.trim()
            : "";
        return titleOverride
          ? { ...item, titleOverride }
          : { ...item, titleOverride: undefined };
      })
    : undefined;
  try {
    return normalizeQuoteScreenProfile(
      {
        ...(record as QuoteScreenProfilePayload),
        sections,
      },
      actor,
      now,
    );
  } catch {
    return null;
  }
}

export function buildQuoteScreenPreviewRequest(
  now: string,
): QuoteRequestRecord {
  return {
    id: "quote-screen-preview-request",
    sourceType: "audit_quote",
    sourceId: "quote-screen-preview-audit-request",
    sourceReference: "AQ-PREVIEW",
    customerEmail: "audit.manager@example.com",
    customerName: "최감사",
    customerPhone: "010-1234-5678",
    cooperativeId: "preview-cooperative",
    cooperativeName: "프리고농협",
    fiscalYear: 2027,
    subject: "2027년도 외부회계감사 견적 요청",
    status: "quoted",
    submittedQuoteCount: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function safeWon(value: unknown, fallback: string) {
  const digits = String(value ?? "").replace(/\D/gu, "");
  try {
    return normalizeWonAmount(digits || fallback);
  } catch {
    return normalizeWonAmount(fallback);
  }
}

function safeCount(value: unknown, fallback: number) {
  const digits = String(value ?? "").replace(/\D/gu, "");
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function buildQuoteScreenPreviewQuote(
  partner: PartnerRecord,
  quoteRequest: QuoteRequestRecord,
  now: string,
): QuoteRecord {
  const form = applyNhAuditEvaluationDefaults(
    partner.nhAuditEvaluationDefaults,
  );
  const auditFeeWon = normalizeWonAmount(PREVIEW_AUDIT_FEE_WON);
  const expectedExpenseWon = normalizeWonAmount(PREVIEW_EXPENSE_WON);
  const submission: NhAuditQuoteSubmissionV2 = {
    schemaVersion: NH_AUDIT_QUOTE_SUBMISSION_SCHEMA_VERSION,
    submissionId: "quote-screen-preview",
    quoteRequestId: quoteRequest.id,
    targetCooperative: {
      id: quoteRequest.cooperativeId ?? null,
      name: quoteRequest.cooperativeName ?? "프리고농협",
    },
    fiscalYear: quoteRequest.fiscalYear ?? 2027,
    partnerAccountId: partner.id,
    accountingFirmName: partner.displayName || partner.name,
    engagementPartnerName: form.engagementPartnerName.trim() || "김회계",
    proposerType:
      form.proposerType === "AUDIT_GROUP" ? "AUDIT_GROUP" : "ACCOUNTING_FIRM",
    auditFeeWon,
    expenseBillingMode: "SEPARATELY_BILLED",
    expectedExpenseWon,
    localNonghyupAuditCount2025: safeCount(
      form.localNonghyupAuditCount2025,
      8,
    ),
    certifiedPublicAccountantCount: safeCount(
      form.certifiedPublicAccountantCount,
      12,
    ),
    accountingFirmRevenueWon: safeWon(
      form.accountingFirmRevenueWon,
      PREVIEW_REVENUE_WON,
    ),
    auditedNonghyupTypes2025: form.auditedNonghyupTypes2025.length
      ? form.auditedNonghyupTypes2025
      : ["LOCAL_AGRICULTURAL_COOPERATIVE", "LOCAL_LIVESTOCK_COOPERATIVE"],
    nonghyupTaxAgencyPerformed2025:
      form.nonghyupTaxAgencyPerformed2025 !== "NO",
    nonghyupSubsidySettlementPerformed2025:
      form.nonghyupSubsidySettlementPerformed2025 !== "NO",
    factsConfirmed: true,
    submittedAt: now,
  };
  const lineItems = [
    {
      id: "audit-fee",
      name: "외부회계감사 보수",
      description: "재무제표 감사 및 감사보고서 발행",
      quantity: 1,
      unitPrice: Number(auditFeeWon),
      supplyAmount: Number(auditFeeWon),
    },
    {
      id: "expected-expense",
      name: "예상 제경비",
      description: "출장 및 자료 검토 관련 실비 예상액",
      quantity: 1,
      unitPrice: Number(expectedExpenseWon),
      supplyAmount: Number(expectedExpenseWon),
    },
  ];
  const totals = calculateQuoteTotals(lineItems, true);
  return {
    id: "quote-screen-preview",
    quoteRequestId: quoteRequest.id,
    quoteAssignmentId: "quote-screen-preview-assignment",
    partnerId: partner.id,
    partnerName: partner.displayName || partner.name,
    status: "finalized",
    version: 1,
    customerEmail: quoteRequest.customerEmail,
    supplierName: partner.displayName || partner.name,
    supplierBusinessRegistrationNumber: partner.businessRegistrationNumber,
    supplierAddress: partner.businessAddress,
    supplierContactName: partner.managerName,
    supplierContactEmail: partner.contactEmail,
    supplierContactPhone: partner.contactPhone,
    logoPath: partner.logoPath,
    sealPath: partner.sealPath,
    lineItems,
    ...totals,
    vatIncluded: true,
    servicePeriod: STANDARD_QUOTE_SERVICE_PERIOD,
    validUntil: STANDARD_QUOTE_VALID_UNTIL,
    terms: STANDARD_QUOTE_TERMS,
    notes: QUOTE_SCREEN_PREVIEW_NOTES,
    nhAuditV2: createNhAuditEvaluationSnapshotV2(submission, now),
    finalizedAt: now,
    createdBy: "quote-screen-preview",
    createdAt: now,
    updatedAt: now,
  };
}
