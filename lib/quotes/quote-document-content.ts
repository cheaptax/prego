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
  logoMissing: string;
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
  documentKindLabel: string;
  issueDateLabel: string;
  customerRefLabel: string;
  phoneLabel: string;
  emailLabel: string;
  credentialsTitle: string;
  credentialsHelp: string;
  evaluationFactsTitle: string;
  evaluationFactsHelp: string;
  engagementPartnerLabel: string;
  proposerTypeLabel: string;
  proposerAccountingFirmLabel: string;
  proposerAuditGroupLabel: string;
  cpaCountLabel: string;
  localAuditCountLabel: string;
  cooperativeTypeLocalAgri: string;
  cooperativeTypeLocalLivestock: string;
  cooperativeTypeItem: string;
  cooperativeTypeGinseng: string;
  noneTypesLabel: string;
  taxRateLabel: string;
  taxRateValue: string;
  comparisonQrTitle: string;
  comparisonQrHelp: string;
  thankYouStatement: string;
  acceptanceTitle: string;
  acceptanceHint: string;
  printNameLabel: string;
  questionsContactLabel: string;
  emailSubjectTemplate: string;
  emailArrivalTemplate: string;
  emailRevisionSubjectTemplate: string;
  emailRevisionArrivalTemplate: string;
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
  "logoMissing",
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
  "documentKindLabel",
  "issueDateLabel",
  "customerRefLabel",
  "phoneLabel",
  "emailLabel",
  "credentialsTitle",
  "credentialsHelp",
  "evaluationFactsTitle",
  "evaluationFactsHelp",
  "engagementPartnerLabel",
  "proposerTypeLabel",
  "proposerAccountingFirmLabel",
  "proposerAuditGroupLabel",
  "cpaCountLabel",
  "localAuditCountLabel",
  "cooperativeTypeLocalAgri",
  "cooperativeTypeLocalLivestock",
  "cooperativeTypeItem",
  "cooperativeTypeGinseng",
  "noneTypesLabel",
  "taxRateLabel",
  "taxRateValue",
  "thankYouStatement",
  "comparisonQrTitle",
  "comparisonQrHelp",
  "acceptanceTitle",
  "acceptanceHint",
  "printNameLabel",
  "questionsContactLabel",
  "emailSubjectTemplate",
  "emailArrivalTemplate",
  "emailRevisionSubjectTemplate",
  "emailRevisionArrivalTemplate",
  "emailTemporaryAccountNotice",
  "emailAccountIdLabel",
  "emailActivationLinkLabel",
  "emailSecurityNotice",
  "emailExistingAccountPrefix",
  "emailDownloadLinkLabel",
  "emailDownloadTextLabel",
] as const satisfies readonly (keyof QuoteDocumentCopy)[];

const OPTIONAL_EMPTY_COPY_KEYS = new Set<keyof QuoteDocumentCopy>([
  "credentialsHelp",
]);

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
    COPY_KEYS.map((key) => {
      const value =
        section.text[key]?.trim() ||
        fallback.text[key]?.trim() ||
        (OPTIONAL_EMPTY_COPY_KEYS.has(key) ? "" : key);
      return [key, value];
    }),
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
