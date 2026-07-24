import type {
  NormalizedAuditQuote,
  NormalizedAuditQuoteField,
  QuoteWarning,
  WonAmount,
} from "@/lib/audit-evaluation/types";

export type CrossValidationEvidence = {
  extractedValue: unknown;
  normalizedValue: unknown;
  validationWarnings: readonly string[];
};

export type QuoteCrossValidationInput = {
  quote: NormalizedAuditQuote;
  displayedBusinessYear?: number | null;
  trustedServerRecord?: {
    accountingFirmName: string;
    auditFee: WonAmount;
    fiscalYear: number;
  } | null;
  evidenceByField?: Partial<
    Record<NormalizedAuditQuoteField, readonly CrossValidationEvidence[]>
  >;
  otherQuotes?: readonly Pick<
    NormalizedAuditQuote,
    "quoteId" | "accountingFirmName"
  >[];
  requiredProposalItemIds?: readonly string[];
};

export function crossValidateQuote(
  input: QuoteCrossValidationInput,
): QuoteWarning[] {
  const warnings: QuoteWarning[] = [];
  const { quote, trustedServerRecord } = input;

  if (trustedServerRecord) {
    if (
      normalizeFirmName(quote.accountingFirmName) !==
      normalizeFirmName(trustedServerRecord.accountingFirmName)
    ) {
      push(warnings, "SERVER_FIRM_NAME_MISMATCH", "accountingFirmName",
        "서버 등록 법인명과 문서 표시 법인명이 다릅니다.");
    }
    if (quote.auditFee !== trustedServerRecord.auditFee) {
      push(warnings, "SERVER_AUDIT_FEE_MISMATCH", "auditFee",
        "서버 등록 감사보수와 문서 표시 감사보수가 다릅니다.");
    }
    if (
      input.displayedBusinessYear !== undefined &&
      input.displayedBusinessYear !== null &&
      input.displayedBusinessYear !== trustedServerRecord.fiscalYear
    ) {
      push(warnings, "SERVER_FISCAL_YEAR_MISMATCH", null,
        "서버 등록 사업연도와 문서 표시 사업연도가 다릅니다.");
    }
  }

  validateNumericEvidence(
    "auditFee",
    input.evidenceByField?.auditFee,
    warnings,
  );
  validateNumericEvidence(
    "accountingFirmRevenue",
    input.evidenceByField?.accountingFirmRevenue,
    warnings,
  );
  validateNumericEvidence(
    "recentNonghyupAuditCount",
    input.evidenceByField?.recentNonghyupAuditCount,
    warnings,
  );
  validateRevenueUnit(input.evidenceByField?.accountingFirmRevenue, warnings);
  validateTeamHours(quote, warnings);
  validateDuplicateFirm(input, warnings);
  validateRequiredItems(input, warnings);

  return deduplicateWarnings(warnings);
}

function validateNumericEvidence(
  field: "auditFee" | "accountingFirmRevenue" | "recentNonghyupAuditCount",
  evidence: readonly CrossValidationEvidence[] | undefined,
  warnings: QuoteWarning[],
) {
  for (const item of evidence ?? []) {
    if (typeof item.extractedValue !== "string") continue;
    const numeric = item.extractedValue.match(
      /(?:^|\s)(\d[\d,]*(?:\.\d+)?)(?:\s|원|건|$)/,
    )?.[1];
    if (!numeric) {
      push(warnings, "INVALID_NUMERIC_FORMAT", field,
        "근거의 숫자 형식을 확인할 수 없습니다.");
      continue;
    }
    if (
      numeric.includes(",") &&
      !/^(?:0|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d+)?$/.test(numeric)
    ) {
      push(warnings, "INVALID_COMMA_GROUPING", field,
        "숫자의 쉼표 자릿수 구분이 올바르지 않습니다.");
    }
  }
}

function validateRevenueUnit(
  evidence: readonly CrossValidationEvidence[] | undefined,
  warnings: QuoteWarning[],
) {
  for (const item of evidence ?? []) {
    if (
      typeof item.extractedValue === "string" &&
      !/(?:억원|백만원|만원|천원|원)(?:\s|$|[),.])/u.test(
        item.extractedValue,
      )
    ) {
      push(warnings, "REVENUE_UNIT_NOT_STATED", "accountingFirmRevenue",
        "매출액 원문에 금액 단위가 명시되지 않았습니다.");
    }
  }
}

function validateTeamHours(
  quote: NormalizedAuditQuote,
  warnings: QuoteWarning[],
) {
  const statedHours = quote.engagementTeam
    .map((member) => member.plannedHours)
    .filter((hours): hours is number => hours !== null);
  if (
    quote.engagementTeam.length > 0 &&
    statedHours.length !== quote.engagementTeam.length
  ) {
    push(warnings, "TEAM_HOURS_INCOMPLETE", "engagementTeam",
      "일부 투입인력의 예정 시간이 누락되었습니다.");
    return;
  }
  if (quote.totalPlannedHours === null || statedHours.length === 0) return;
  const sum = statedHours.reduce((total, hours) => total + hours, 0);
  if (sum !== quote.totalPlannedHours) {
    push(warnings, "TEAM_HOURS_SUM_MISMATCH", "totalPlannedHours",
      `팀원 시간 합계(${sum})와 총 투입시간(${quote.totalPlannedHours})이 다릅니다.`);
  }
  if (
    quote.partnerHours !== null &&
    quote.partnerHours > quote.totalPlannedHours
  ) {
    push(warnings, "PARTNER_HOURS_EXCEED_TOTAL", "partnerHours",
      "담당이사 시간이 총 투입시간보다 큽니다.");
  }
}

function validateDuplicateFirm(
  input: QuoteCrossValidationInput,
  warnings: QuoteWarning[],
) {
  const firm = normalizeFirmName(input.quote.accountingFirmName);
  if (!firm) return;
  const duplicate = (input.otherQuotes ?? []).some(
    (other) =>
      other.quoteId !== input.quote.quoteId &&
      normalizeFirmName(other.accountingFirmName) === firm,
  );
  if (duplicate) {
    push(warnings, "DUPLICATE_ACCOUNTING_FIRM", "accountingFirmName",
      "같은 회계법인의 견적이 이미 존재합니다.");
  }
}

function validateRequiredItems(
  input: QuoteCrossValidationInput,
  warnings: QuoteWarning[],
) {
  for (const itemId of input.requiredProposalItemIds ?? []) {
    const item = input.quote.requiredProposalItems[itemId];
    if (!item?.present) {
      push(warnings, "REQUIRED_PROPOSAL_ITEM_MISSING", "requiredProposalItems",
        `필수 제안항목 '${itemId}'이(가) 누락되었습니다.`);
    }
  }
}

function normalizeFirmName(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

function push(
  warnings: QuoteWarning[],
  code: string,
  field: NormalizedAuditQuoteField | null,
  message: string,
) {
  warnings.push({ code, field, message: message.slice(0, 500) });
}

function deduplicateWarnings(warnings: readonly QuoteWarning[]) {
  return [...new Map(
    warnings.map((warning) => [
      `${warning.code}|${warning.field ?? ""}|${warning.message}`,
      warning,
    ]),
  ).values()];
}
