import type { NhAuditCooperativeType2025 } from "@/lib/audit-evaluation/nh-audit-v2-types";
import type { QuoteRecord, QuoteRequestRecord } from "@/lib/firebase/schema";
import {
  applyQuoteTemplate,
  type QuoteDocumentCopy,
} from "@/lib/quotes/quote-document-content";

type QuoteCopy = Partial<QuoteDocumentCopy>;
type QuoteFactRow = [label: string, value: string];

export const STANDARD_QUOTE_SERVICE_PERIOD = "2026.12 ~ 2028.02";
export const STANDARD_QUOTE_VALID_UNTIL = "발행일로부터 감사계약 체결시까지";
export const STANDARD_QUOTE_TERMS =
  "감사 일정은 자료 수령 일정에 따라 협의합니다.";
export const QUOTE_SCREEN_PREVIEW_NOTES =
  "본 미리보기는 운영자 템플릿 확인용 샘플입니다.";

const CURRENT_EVALUATION_FACTS_HELP =
  "농협 외부회계 감사 선정시 고려할만한 평가지표 및 실적 정보입니다.";
const LEGACY_EVALUATION_FACTS_HELP =
  "농협 외부회계감사 선정 시 참고할 제휴사 실적·역량 정보입니다.";
const CURRENT_LOCAL_AUDIT_COUNT_LABEL = "2025년 지역농협 감사실적";
const LEGACY_LOCAL_AUDIT_COUNT_LABEL = "2025년 지역농협 감사건수";
const CURRENT_CPA_COUNT_LABEL = "공인회계사 인원 수";
const LEGACY_CPA_COUNT_LABEL = "소속 공인회계사";
const CURRENT_EVALUATION_FOOTNOTE =
  "(*) 소속 농협감사 협회사의 상호 공유된 제휴실적을 80%인정한 수치입니다.";
const LEGACY_EVALUATION_FOOTNOTE =
  "(*) 회계법인 소속 농협감사 협회사의 상호동의 제휴실적을 80%인정한 수치입니다.";

function modernizeLabel(value: string | undefined, legacy: string, current: string) {
  const raw = (value ?? "").trim() || current;
  return raw === legacy || raw === `${legacy} (*)` ? current : raw;
}

export function quoteEvaluationFactsHelp(copy?: QuoteCopy) {
  const help = modernizeLabel(
    copy?.evaluationFactsHelp,
    LEGACY_EVALUATION_FACTS_HELP,
    CURRENT_EVALUATION_FACTS_HELP,
  );
  return /\(\*\)/u.test(help) ? help : `${help} (*)`;
}

export function quoteEvaluationFactsFootnote(copy?: QuoteCopy) {
  return modernizeLabel(
    copy?.evaluationFactsFootnoteAssociation,
    LEGACY_EVALUATION_FOOTNOTE,
    CURRENT_EVALUATION_FOOTNOTE,
  );
}

function modernizeConditionValue(value: string) {
  if (value === "2026.09 ~ 2027.02") return STANDARD_QUOTE_SERVICE_PERIOD;
  if (value === "발행일로부터 30일") return STANDARD_QUOTE_VALID_UNTIL;
  return value;
}

export function withStandardQuoteConditions<
  T extends {
    servicePeriod?: string;
    validUntil?: string;
    terms?: string;
    notes?: string;
  },
>(quote: T) {
  const notes = quote.notes?.trim() ?? "";
  return {
    ...quote,
    servicePeriod:
      modernizeConditionValue(quote.servicePeriod?.trim() ?? "") ||
      STANDARD_QUOTE_SERVICE_PERIOD,
    validUntil:
      modernizeConditionValue(quote.validUntil?.trim() ?? "") ||
      STANDARD_QUOTE_VALID_UNTIL,
    terms: quote.terms?.trim() || STANDARD_QUOTE_TERMS,
    notes:
      notes && notes !== QUOTE_SCREEN_PREVIEW_NOTES ? notes : "",
  };
}

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
  const resolved = withStandardQuoteConditions(quote);
  return [
    [copy?.servicePeriodLabel ?? "수행기간", resolved.servicePeriod],
    [copy?.validUntilLabel ?? "유효기간", resolved.validUntil],
    [copy?.termsLabel ?? "조건", resolved.terms],
    [copy?.notesLabel ?? "비고", resolved.notes],
  ].filter((row): row is [string, string] => Boolean(row[1]));
}

export function quoteIssueDate(
  quote: Pick<QuoteRecord, "finalizedAt" | "createdAt">,
) {
  const iso = quote.finalizedAt || quote.createdAt || "";
  const date = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return "";
  const [year, month, day] = date.split("-");
  return `${year}.${month}.${day}`;
}

export function quotePartnerCredentialRows(
  quote: Pick<
    QuoteRecord,
    | "supplierBusinessRegistrationNumber"
    | "supplierAddress"
    | "supplierContactName"
    | "supplierContactPhone"
    | "supplierContactEmail"
    | "nhAuditV2"
    | "auditEvaluation"
  >,
  copy?: QuoteCopy,
): QuoteFactRow[] {
  const missing = text(copy?.missingValue, "미등록");
  const submission = quote.nhAuditV2?.submission;
  const partner = quote.auditEvaluation?.normalizedQuote?.engagementPartner;
  const engagementPartner =
    submission?.engagementPartnerName?.trim() || partner?.name?.trim() || "";
  const proposerType = submission
    ? submission.proposerType === "AUDIT_GROUP"
      ? text(copy?.proposerAuditGroupLabel, "감사반")
      : text(copy?.proposerAccountingFirmLabel, "회계법인")
    : "";
  const contact = [quote.supplierContactPhone, quote.supplierContactEmail]
    .filter(Boolean)
    .join(" / ");

  return compactRows([
    [
      text(copy?.businessNumberLabel, "사업자등록번호"),
      quote.supplierBusinessRegistrationNumber?.trim() || missing,
    ],
    [
      text(copy?.addressLabel, "사업장 주소"),
      quote.supplierAddress?.trim() || missing,
    ],
    [
      text(copy?.supplierContactLabel, "견적 담당자"),
      quote.supplierContactName?.trim() || missing,
    ],
    quote.supplierContactPhone?.trim()
      ? [text(copy?.phoneLabel, "전화"), quote.supplierContactPhone.trim()]
      : null,
    quote.supplierContactEmail?.trim()
      ? [text(copy?.emailLabel, "이메일"), quote.supplierContactEmail.trim()]
      : null,
    !quote.supplierContactPhone?.trim() && !quote.supplierContactEmail?.trim()
      ? [text(copy?.contactLabel, "연락처"), missing]
      : null,
    engagementPartner
      ? [text(copy?.engagementPartnerLabel, "담당회계사"), engagementPartner]
      : null,
    proposerType
      ? [text(copy?.proposerTypeLabel, "제안 주체"), proposerType]
      : null,
  ]);
}

export function quotePartnerEvaluationFactRows(
  quote: Pick<QuoteRecord, "nhAuditV2" | "auditEvaluation">,
  copy?: QuoteCopy,
): QuoteFactRow[] {
  const submission = quote.nhAuditV2?.submission;
  if (submission) {
    const types = submission.auditedNonghyupTypes2025
      .map((type) => cooperativeTypeLabel(type, copy))
      .filter(Boolean);
    const cpaCount = Number.isFinite(submission.certifiedPublicAccountantCount)
      ? `${submission.certifiedPublicAccountantCount}${text(copy?.peopleSuffix, "명")}`
      : "";
    return compactRows([
      [
        text(copy?.revenueLabel, "회계법인 매출액"),
        formatQuoteWon(
          submission.accountingFirmRevenueWon,
          text(copy?.currencySuffix, "원"),
        ) || text(copy?.missingValue, "미등록"),
      ],
      [
        modernizeLabel(
          copy?.localAuditCountLabel,
          LEGACY_LOCAL_AUDIT_COUNT_LABEL,
          CURRENT_LOCAL_AUDIT_COUNT_LABEL,
        ),
        `${submission.localNonghyupAuditCount2025}${text(copy?.countSuffix, "건")}`,
      ],
      cpaCount
        ? [
            modernizeLabel(
              copy?.cpaCountLabel,
              LEGACY_CPA_COUNT_LABEL,
              CURRENT_CPA_COUNT_LABEL,
            ),
            cpaCount,
          ]
        : null,
      [
        text(copy?.auditedTypesLabel, "감사 수행 농협 유형"),
        types.join(", ") || text(copy?.noneTypesLabel, "해당 없음"),
      ],
      [
        text(copy?.taxExperienceLabel, "농협 세무대리 경험"),
        submission.nonghyupTaxAgencyPerformed2025
          ? text(copy?.yesLabel, "있음")
          : text(copy?.noLabel, "없음"),
      ],
      [
        text(copy?.subsidyExperienceLabel, "농협 보조금 정산 경험"),
        submission.nonghyupSubsidySettlementPerformed2025
          ? text(copy?.yesLabel, "있음")
          : text(copy?.noLabel, "없음"),
      ],
    ]);
  }

  const audit = quote.auditEvaluation?.normalizedQuote;
  if (!audit) return [];
  return compactRows([
    [
      text(copy?.revenueLabel, "회계법인 매출액"),
      formatQuoteWon(
        audit.accountingFirmRevenue,
        text(copy?.currencySuffix, "원"),
      ) || "-",
    ],
    [
      text(copy?.recentAuditCountLabel, "최근 농협 감사건수"),
      `${audit.recentNonghyupAuditCount ?? 0}${text(copy?.countSuffix, "건")}`,
    ],
    [
      text(copy?.auditedTypesLabel, "감사 수행 농협 유형"),
      audit.auditedNonghyupTypes.join(", ") || "-",
    ],
    [
      text(copy?.taxExperienceLabel, "농협 세무대리 경험"),
      audit.taxAgencyExperience.hasExperience
        ? text(copy?.yesLabel, "있음")
        : text(copy?.noLabel, "없음"),
    ],
    [
      text(copy?.subsidyExperienceLabel, "농협 보조금 정산 경험"),
      audit.subsidySettlementExperience.hasExperience
        ? text(copy?.yesLabel, "있음")
        : text(copy?.noLabel, "없음"),
    ],
  ]);
}

export function quoteEvaluationCapacityRows(
  quote: Pick<QuoteRecord, "auditEvaluation">,
  copy?: QuoteCopy,
): QuoteFactRow[] {
  const audit = quote.auditEvaluation?.normalizedQuote;
  if (!audit) return [];
  return compactRows([
    [
      text(copy?.totalHoursLabel, "총 예정 투입시간"),
      `${audit.totalPlannedHours ?? 0}${text(copy?.hourSuffix, "시간")}`,
    ],
    [
      text(copy?.partnerHoursLabel, "책임회계사 투입시간"),
      `${audit.partnerHours ?? 0}${text(copy?.hourSuffix, "시간")}`,
    ],
    [
      text(copy?.teamCountLabel, "투입인력"),
      `${audit.engagementTeam.length}${text(copy?.peopleSuffix, "명")}`,
    ],
  ]);
}

export function formatQuoteWon(
  value: string | number | null | undefined,
  suffix = "원",
) {
  const digits =
    typeof value === "number"
      ? Number.isSafeInteger(value) && value >= 0
        ? String(value)
        : ""
      : String(value ?? "").trim();
  if (!/^(0|[1-9]\d*)$/u.test(digits)) return "";
  return `${digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ",")}${suffix}`;
}

function cooperativeTypeLabel(
  type: NhAuditCooperativeType2025,
  copy?: QuoteCopy,
) {
  const labels: Record<NhAuditCooperativeType2025, string> = {
    LOCAL_AGRICULTURAL_COOPERATIVE: text(
      copy?.cooperativeTypeLocalAgri,
      "지역농협",
    ),
    LOCAL_LIVESTOCK_COOPERATIVE: text(
      copy?.cooperativeTypeLocalLivestock,
      "지역축협",
    ),
    ITEM_AGRICULTURAL_OR_LIVESTOCK_COOPERATIVE: text(
      copy?.cooperativeTypeItem,
      "품목농협·품목축협(원예농협 포함)",
    ),
    GINSENG_COOPERATIVE: text(copy?.cooperativeTypeGinseng, "인삼농협"),
  };
  return labels[type] ?? type;
}

function compactRows(rows: Array<QuoteFactRow | null>): QuoteFactRow[] {
  return rows.filter((row): row is QuoteFactRow => Boolean(row?.[1]));
}

function text(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

function numericHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100000000;
}
