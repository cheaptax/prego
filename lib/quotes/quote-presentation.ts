import type { NhAuditCooperativeType2025 } from "@/lib/audit-evaluation/nh-audit-v2-types";
import type { QuoteRecord, QuoteRequestRecord } from "@/lib/firebase/schema";
import {
  applyQuoteTemplate,
  type QuoteDocumentCopy,
} from "@/lib/quotes/quote-document-content";

type QuoteCopy = Partial<QuoteDocumentCopy>;
type QuoteFactRow = [label: string, value: string];

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
  const cpaCount =
    submission && Number.isFinite(submission.certifiedPublicAccountantCount)
      ? `${submission.certifiedPublicAccountantCount}${text(copy?.peopleSuffix, "명")}`
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
    cpaCount
      ? [text(copy?.cpaCountLabel, "소속 공인회계사"), cpaCount]
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
    return compactRows([
      [
        text(copy?.revenueLabel, "회계법인 매출액"),
        formatQuoteWon(
          submission.accountingFirmRevenueWon,
          text(copy?.currencySuffix, "원"),
        ) || text(copy?.missingValue, "미등록"),
      ],
      [
        text(copy?.localAuditCountLabel, "2025년 지역농협 감사건수"),
        `${submission.localNonghyupAuditCount2025}${text(copy?.countSuffix, "건")}`,
      ],
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
