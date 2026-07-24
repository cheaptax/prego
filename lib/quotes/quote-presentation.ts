import type { QuoteRecord, QuoteRequestRecord } from "@/lib/firebase/schema";
import {
  applyQuoteTemplate,
  type QuoteDocumentCopy,
} from "@/lib/quotes/quote-document-content";

export function quoteDocumentTitle(
  quote: Pick<QuoteRecord, "supplierName">,
  quoteRequest: Pick<
    QuoteRequestRecord,
    "sourceType" | "fiscalYear" | "cooperativeName"
  >,
  copy?: Pick<QuoteDocumentCopy, "auditTitleTemplate" | "generalTitleTemplate">,
) {
  if (
    quoteRequest.sourceType === "audit_quote" &&
    quoteRequest.fiscalYear &&
    quoteRequest.cooperativeName
  ) {
    return applyQuoteTemplate(
      copy?.auditTitleTemplate ??
        "{{year}}년도 {{cooperativeName}} 외부회계감사 견적서 : {{supplierName}}",
      {
        year: quoteRequest.fiscalYear,
        cooperativeName: quoteRequest.cooperativeName,
        supplierName: quote.supplierName,
      },
    );
  }
  return applyQuoteTemplate(
    copy?.generalTitleTemplate ?? "견적서 : {{supplierName}}",
    { supplierName: quote.supplierName },
  );
}

export function quoteDisplayNumber(
  quote: Pick<
    QuoteRecord,
    "id" | "version" | "createdAt" | "finalizedAt"
  >,
  quoteRequest: Pick<QuoteRequestRecord, "fiscalYear">,
) {
  const storedYear =
    quote.finalizedAt?.slice(0, 4) || quote.createdAt?.slice(0, 4) || "";
  const year =
    quoteRequest.fiscalYear ??
    (/^\d{4}$/.test(storedYear) ? Number(storedYear) : 0);
  const suffix = numericHash(`${quote.id}:${quote.version}`)
    .toString()
    .padStart(8, "0");
  return `${year || "0000"}-${suffix}`;
}

export function quoteRecipient(
  quoteRequest: Pick<
    QuoteRequestRecord,
    "sourceType" | "customerName" | "customerEmail" | "cooperativeName"
  >,
  copy?: Pick<QuoteDocumentCopy, "recipientTemplate">,
) {
  return {
    name:
          quoteRequest.sourceType === "audit_quote"
            ? applyQuoteTemplate(
                copy?.recipientTemplate ??
                  "{{cooperativeName}} {{customerName}} 담당자님",
                {
                  cooperativeName: quoteRequest.cooperativeName || "농협",
                  customerName:
                    quoteRequest.customerName?.trim() || "회계감사",
                },
              )
        : quoteRequest.customerName || "고객 담당자님",
    email: quoteRequest.customerEmail,
  };
}

export function quoteConditionRows(
  quote: Pick<
    QuoteRecord,
    "servicePeriod" | "validUntil" | "terms" | "notes"
  >,
  copy?: Pick<
    QuoteDocumentCopy,
    | "servicePeriodLabel"
    | "validUntilLabel"
    | "termsLabel"
    | "notesLabel"
  >,
): Array<[label: string, value: string]> {
  return [
    [copy?.servicePeriodLabel ?? "수행기간", quote.servicePeriod?.trim() ?? ""],
    [copy?.validUntilLabel ?? "유효기간", quote.validUntil?.trim() ?? ""],
    [copy?.termsLabel ?? "조건", quote.terms?.trim() ?? ""],
    [copy?.notesLabel ?? "비고", quote.notes?.trim() ?? ""],
  ].filter((row): row is [string, string] => Boolean(row[1]));
}

function numericHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100000000;
}
