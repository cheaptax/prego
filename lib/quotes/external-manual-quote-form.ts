import { formatCurrencyInput } from "@/lib/currency-input";
import {
  NH_AUDIT_COOPERATIVE_TYPES_2025,
  type NhAuditCooperativeType2025,
} from "@/lib/audit-evaluation/nh-audit-v2-types";
import {
  EMPTY_NH_AUDIT_PARTNER_FORM,
  type NhAuditPartnerFormValues,
} from "@/lib/quotes/nh-audit-quote-form";
import type { ExternalManualQuoteRecord } from "@/lib/quotes/quote-automation-types";
import type { QuoteSupplierProfile } from "@/lib/quotes/supplier-profile";

export function formStateFromExternalManualQuote(
  quote: ExternalManualQuoteRecord,
): {
  supplier: QuoteSupplierProfile;
  auditValues: NhAuditPartnerFormValues;
} {
  const types = (quote.auditedNonghyupTypes2025 ?? []).filter(
    (value): value is NhAuditCooperativeType2025 =>
      NH_AUDIT_COOPERATIVE_TYPES_2025.includes(
        value as NhAuditCooperativeType2025,
      ),
  );
  const expenseBillingMode =
    quote.expenseBillingMode || "INCLUDED_IN_AUDIT_FEE";
  return {
    supplier: {
      name: quote.supplierName || quote.accountingFirmName,
      businessRegistrationNumber:
        quote.supplierBusinessRegistrationNumber ?? "",
      address: quote.supplierAddress ?? "",
      contactName: quote.supplierContactName ?? "",
      contactEmail: quote.supplierContactEmail ?? "",
      contactPhone: quote.supplierContactPhone ?? "",
    },
    auditValues: {
      ...EMPTY_NH_AUDIT_PARTNER_FORM,
      engagementPartnerName: quote.engagementPartnerName ?? "",
      proposerType: quote.proposerType || "ACCOUNTING_FIRM",
      auditFeeWon: formatCurrencyInput(quote.auditFeeWon, 15),
      expenseBillingMode,
      expectedExpenseWon:
        expenseBillingMode === "SEPARATELY_BILLED"
          ? formatCurrencyInput(quote.expectedExpenseWon, 15)
          : "0",
      localNonghyupAuditCount2025: countDraft(
        quote.localNonghyupAuditCount2025,
      ),
      certifiedPublicAccountantCount: countDraft(
        quote.certifiedPublicAccountantCount,
      ),
      accountingFirmRevenueWon:
        quote.accountingFirmRevenueWon && quote.accountingFirmRevenueWon !== "0"
          ? formatCurrencyInput(quote.accountingFirmRevenueWon, 15)
          : "",
      auditedNonghyupTypes2025: types,
      noAuditedNonghyupTypes2025:
        quote.noAuditedNonghyupTypes2025 || types.length === 0,
      nonghyupTaxAgencyPerformed2025: quote.nonghyupTaxAgencyPerformed2025
        ? "YES"
        : "NO",
      nonghyupSubsidySettlementPerformed2025:
        quote.nonghyupSubsidySettlementPerformed2025 ? "YES" : "NO",
      factsConfirmed: false,
    },
  };
}

function countDraft(value: number | undefined) {
  return value && value > 0 ? String(value) : "";
}
