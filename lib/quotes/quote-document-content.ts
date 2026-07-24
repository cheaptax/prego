import { CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";
import { getCmsSection } from "@/lib/cms/runtime";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";

export type QuoteDocumentCopy = {
  auditTitleTemplate: string;
  generalTitleTemplate: string;
  recipientTemplate: string;
  quoteNumberLabel: string;
  documentVersionLabel: string;
  recipientSectionTitle: string;
  recipientEmailLabel: string;
  supplierSectionTitle: string;
  businessNumberLabel: string;
  addressLabel: string;
  supplierContactLabel: string;
  contactLabel: string;
  missingValue: string;
  sealMissing: string;
  quoteIntro: string;
  itemHeader: string;
  quantityHeader: string;
  unitPriceHeader: string;
  supplyAmountHeader: string;
  subtotalLabel: string;
  vatLabel: string;
  totalLabel: string;
  currencySuffix: string;
  scoreSuffix: string;
  countSuffix: string;
  hourSuffix: string;
  peopleSuffix: string;
  conditionsTitle: string;
  servicePeriodLabel: string;
  validUntilLabel: string;
  termsLabel: string;
  notesLabel: string;
  evaluationTitle: string;
  evaluationConfigLabel: string;
  evaluationScoreLabel: string;
  criterionWeightLabel: string;
  criterionScoreLabel: string;
  revenueLabel: string;
  recentAuditCountLabel: string;
  auditedTypesLabel: string;
  taxExperienceLabel: string;
  subsidyExperienceLabel: string;
  totalHoursLabel: string;
  partnerHoursLabel: string;
  teamCountLabel: string;
  yesLabel: string;
  noLabel: string;
  footerStatement: string;
  emailSubjectTemplate: string;
  emailArrivalTemplate: string;
  emailTemporaryAccountNotice: string;
  emailAccountIdLabel: string;
  emailActivationLinkLabel: string;
  emailSecurityNotice: string;
  emailExistingAccountPrefix: string;
  emailDownloadLinkLabel: string;
  emailDownloadTextLabel: string;
};

export type QuoteDocumentContent = {
  copy: QuoteDocumentCopy;
  style: CmsSection["style"];
};

const COPY_KEYS = [
  "auditTitleTemplate",
  "generalTitleTemplate",
  "recipientTemplate",
  "quoteNumberLabel",
  "documentVersionLabel",
  "recipientSectionTitle",
  "recipientEmailLabel",
  "supplierSectionTitle",
  "businessNumberLabel",
  "addressLabel",
  "supplierContactLabel",
  "contactLabel",
  "missingValue",
  "sealMissing",
  "quoteIntro",
  "itemHeader",
  "quantityHeader",
  "unitPriceHeader",
  "supplyAmountHeader",
  "subtotalLabel",
  "vatLabel",
  "totalLabel",
  "currencySuffix",
  "scoreSuffix",
  "countSuffix",
  "hourSuffix",
  "peopleSuffix",
  "conditionsTitle",
  "servicePeriodLabel",
  "validUntilLabel",
  "termsLabel",
  "notesLabel",
  "evaluationTitle",
  "evaluationConfigLabel",
  "evaluationScoreLabel",
  "criterionWeightLabel",
  "criterionScoreLabel",
  "revenueLabel",
  "recentAuditCountLabel",
  "auditedTypesLabel",
  "taxExperienceLabel",
  "subsidyExperienceLabel",
  "totalHoursLabel",
  "partnerHoursLabel",
  "teamCountLabel",
  "yesLabel",
  "noLabel",
  "footerStatement",
  "emailSubjectTemplate",
  "emailArrivalTemplate",
  "emailTemporaryAccountNotice",
  "emailAccountIdLabel",
  "emailActivationLinkLabel",
  "emailSecurityNotice",
  "emailExistingAccountPrefix",
  "emailDownloadLinkLabel",
  "emailDownloadTextLabel",
] as const satisfies readonly (keyof QuoteDocumentCopy)[];

export function quoteDocumentContentFromCms(
  content: CmsPageContent = CMS_PAGE_DEFAULTS["partner.portal"],
): QuoteDocumentContent {
  const section = getCmsSection(content, "partner.portal", "quoteDocument");
  const fallback = getCmsSection(
    CMS_PAGE_DEFAULTS["partner.portal"],
    "partner.portal",
    "quoteDocument",
  );
  const copy = Object.fromEntries(
    COPY_KEYS.map((key) => [
      key,
      section.text[key]?.trim() || fallback.text[key]?.trim() || key,
    ]),
  ) as QuoteDocumentCopy;
  return { copy, style: section.style };
}

export function applyQuoteTemplate(
  template: string,
  values: Record<string, string | number | undefined>,
) {
  return template.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/gu, (_, key) =>
    String(values[key] ?? ""),
  ).replace(/\s{2,}/gu, " ").trim();
}
