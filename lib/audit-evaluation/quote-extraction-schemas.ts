import { z } from "zod";
import { isWonAmount } from "@/lib/audit-evaluation/money";
import {
  NORMALIZED_AUDIT_QUOTE_FIELDS,
  QUOTE_FIELD_SOURCES,
  type NormalizedAuditQuote,
  type NormalizedAuditQuoteField,
  type QuoteEvidenceValue,
  type QuoteFieldSource,
  type WonAmount,
} from "@/lib/audit-evaluation/types";

export const WON_AMOUNT_UNITS = [
  "WON",
  "THOUSAND_WON",
  "MILLION_WON",
  "HUNDRED_MILLION_WON",
] as const;

export type WonAmountUnit = (typeof WON_AMOUNT_UNITS)[number];

const MAX_TEXT = 2_000;
const MAX_LIST_ITEMS = 100;
const SAFE_NUMBER = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const GROUPED_NUMBER =
  /^(?:0|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d+)?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ITEM_ID = /^[a-z][a-zA-Z0-9._-]{0,79}$/;

const safeText = (maximum = MAX_TEXT) =>
  z.string().trim().min(1).max(maximum);
const wonAmountSchema = z.custom<WonAmount>(
  isWonAmount,
  "A canonical integer won amount is required.",
);
const nullableText = (maximum = MAX_TEXT) => safeText(maximum).nullable();

export const rawWonAmountSchema = z
  .object({
    rawNumber: z.string().trim().min(1).max(100),
    unit: z.enum(WON_AMOUNT_UNITS).nullable(),
  })
  .strict();

const experienceSummarySchema = z
  .object({
    hasExperience: z.boolean(),
    descriptions: z.array(safeText(500)).max(MAX_LIST_ITEMS),
  })
  .strict();

const engagementPartnerSchema = z
  .object({
    name: safeText(200),
    title: nullableText(200),
    yearsOfExperience: z.number().int().nonnegative().max(100).nullable(),
  })
  .strict();

const engagementTeamMemberSchema = z
  .object({
    name: safeText(200),
    role: safeText(200),
    plannedHours: z.number().int().nonnegative().safe().nullable(),
  })
  .strict();

const auditScheduleItemSchema = z
  .object({
    id: z.string().regex(ITEM_ID),
    label: safeText(200),
    startsOn: z.string().regex(DATE_ONLY).nullable(),
    endsOn: z.string().regex(DATE_ONLY).nullable(),
  })
  .strict();

const proposalItemValueSchema = z
  .object({
    present: z.boolean(),
    value: nullableText(),
  })
  .strict();

export const quoteExtractionFieldsSchema = z
  .object({
    accountingFirmId: nullableText(128),
    accountingFirmName: nullableText(300),
    auditFee: wonAmountSchema.nullable(),
    vatIncluded: z.boolean().nullable(),
    accountingFirmRevenue: wonAmountSchema.nullable(),
    recentNonghyupAuditCount: z
      .number()
      .int()
      .nonnegative()
      .safe()
      .nullable(),
    auditedNonghyupTypes: z
      .array(safeText(200))
      .max(MAX_LIST_ITEMS)
      .nullable(),
    taxAgencyExperience: experienceSummarySchema.nullable(),
    subsidySettlementExperience: experienceSummarySchema.nullable(),
    engagementPartner: engagementPartnerSchema.nullable(),
    engagementTeam: z
      .array(engagementTeamMemberSchema)
      .max(MAX_LIST_ITEMS)
      .nullable(),
    totalPlannedHours: z.number().int().nonnegative().safe().nullable(),
    partnerHours: z.number().int().nonnegative().safe().nullable(),
    auditSchedule: z
      .array(auditScheduleItemSchema)
      .max(MAX_LIST_ITEMS)
      .nullable(),
    qualityControlPlan: z
      .array(safeText())
      .max(MAX_LIST_ITEMS)
      .nullable(),
    requiredProposalItems: z
      .record(z.string().regex(ITEM_ID), proposalItemValueSchema)
      .nullable(),
  })
  .strict();

const coordinatesSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
  })
  .strict();

export const extractionEvidenceSchema = z
  .object({
    pageNumber: z.number().int().positive().nullable(),
    excerpt: safeText(500),
    coordinates: coordinatesSchema.nullable(),
    cellAddress: nullableText(50),
    validationWarnings: z.array(safeText(500)).max(20),
  })
  .strict();

const evidenceValueSchema: z.ZodType<QuoteEvidenceValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.string().max(MAX_TEXT),
    z.number().finite(),
    z.boolean(),
    z.array(evidenceValueSchema).max(MAX_LIST_ITEMS),
    z.record(z.string().max(100), evidenceValueSchema),
  ]),
);

const storedFieldEvidenceSchema = extractionEvidenceSchema.extend({
  documentId: safeText(128),
  extractedValue: evidenceValueSchema,
  normalizedValue: evidenceValueSchema,
  source: z.enum(QUOTE_FIELD_SOURCES),
  confidence: z.number().min(0).max(100),
}).strict();

const fieldEvidenceShape = Object.fromEntries(
  NORMALIZED_AUDIT_QUOTE_FIELDS.map((field) => [
    field,
    z.array(extractionEvidenceSchema).max(20).optional(),
  ]),
) as Record<NormalizedAuditQuoteField, z.ZodOptional<z.ZodArray<
  typeof extractionEvidenceSchema
>>>;

export const extractionWarningSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    field: z.enum(NORMALIZED_AUDIT_QUOTE_FIELDS).nullable(),
    message: safeText(500),
  })
  .strict();

export const quoteExtractionCandidateSchema = z
  .object({
    fields: quoteExtractionFieldsSchema,
    confidenceByField: z
      .object(
        Object.fromEntries(
          NORMALIZED_AUDIT_QUOTE_FIELDS.map((field) => [
            field,
            z.number().min(0).max(100).optional(),
          ]),
        ) as Record<
          NormalizedAuditQuoteField,
          z.ZodOptional<z.ZodNumber>
        >,
      )
      .partial()
      .strict(),
    evidenceByField: z.object(fieldEvidenceShape).partial().strict(),
    warnings: z.array(extractionWarningSchema).max(200),
  })
  .strict();

const normalizedMetadataShape = Object.fromEntries(
  NORMALIZED_AUDIT_QUOTE_FIELDS.map((field) => [
    field,
    z.number().min(0).max(100).optional(),
  ]),
) as Record<NormalizedAuditQuoteField, z.ZodOptional<z.ZodNumber>>;
const normalizedSourceShape = Object.fromEntries(
  NORMALIZED_AUDIT_QUOTE_FIELDS.map((field) => [
    field,
    z.enum(QUOTE_FIELD_SOURCES).optional(),
  ]),
) as unknown as Record<
  NormalizedAuditQuoteField,
  z.ZodType<QuoteFieldSource | undefined>
>;
const normalizedEvidenceShape = Object.fromEntries(
  NORMALIZED_AUDIT_QUOTE_FIELDS.map((field) => [
    field,
    z.array(storedFieldEvidenceSchema).max(20).optional(),
  ]),
) as Record<
  NormalizedAuditQuoteField,
  z.ZodOptional<z.ZodArray<typeof storedFieldEvidenceSchema>>
>;

export const normalizedAuditQuoteSchema: z.ZodType<NormalizedAuditQuote> = z
  .object({
    quoteId: safeText(128),
    caseId: safeText(128),
    documentId: safeText(128),
    accountingFirmId: quoteExtractionFieldsSchema.shape.accountingFirmId,
    accountingFirmName: z.string().trim().max(300),
    auditFee: quoteExtractionFieldsSchema.shape.auditFee,
    vatIncluded: quoteExtractionFieldsSchema.shape.vatIncluded,
    accountingFirmRevenue:
      quoteExtractionFieldsSchema.shape.accountingFirmRevenue,
    recentNonghyupAuditCount:
      quoteExtractionFieldsSchema.shape.recentNonghyupAuditCount,
    auditedNonghyupTypes: z.array(safeText(200)).max(MAX_LIST_ITEMS),
    taxAgencyExperience: experienceSummarySchema,
    subsidySettlementExperience: experienceSummarySchema,
    engagementPartner: engagementPartnerSchema.nullable(),
    engagementTeam: z.array(engagementTeamMemberSchema).max(MAX_LIST_ITEMS),
    totalPlannedHours: quoteExtractionFieldsSchema.shape.totalPlannedHours,
    partnerHours: quoteExtractionFieldsSchema.shape.partnerHours,
    auditSchedule: z.array(auditScheduleItemSchema).max(MAX_LIST_ITEMS),
    qualityControlPlan: z.array(safeText()).max(MAX_LIST_ITEMS),
    requiredProposalItems: z.record(
      z.string().regex(ITEM_ID),
      proposalItemValueSchema,
    ),
    missingFields: z.array(z.enum(NORMALIZED_AUDIT_QUOTE_FIELDS)).max(
      NORMALIZED_AUDIT_QUOTE_FIELDS.length,
    ),
    warnings: z.array(extractionWarningSchema).max(500),
    confidenceByField: z.object(normalizedMetadataShape).partial().strict(),
    evidenceByField: z.object(normalizedEvidenceShape).partial().strict(),
    source: z.object(normalizedSourceShape).partial().strict(),
    confirmedByCustomer: z.boolean(),
    confirmedAt: z.string().datetime({ offset: true }).nullable(),
    revision: z.number().int().nonnegative().optional(),
    updatedAt: z.string().datetime({ offset: true }).optional(),
    pendingAdminReviewFields: z
      .array(z.enum(NORMALIZED_AUDIT_QUOTE_FIELDS))
      .max(NORMALIZED_AUDIT_QUOTE_FIELDS.length)
      .optional(),
  })
  .strict();

export type QuoteExtractionFields = z.infer<
  typeof quoteExtractionFieldsSchema
>;
export type ExtractionEvidence = z.infer<typeof extractionEvidenceSchema>;
export type ExtractionWarning = z.infer<typeof extractionWarningSchema>;
export type QuoteExtractionCandidate = z.infer<
  typeof quoteExtractionCandidateSchema
>;

export type WonNormalizationResult = {
  value: WonAmount | null;
  warning: { code: string; message: string } | null;
};

const UNIT_MULTIPLIERS: Record<WonAmountUnit, bigint> = {
  WON: 1n,
  THOUSAND_WON: 1_000n,
  MILLION_WON: 1_000_000n,
  HUNDRED_MILLION_WON: 100_000_000n,
};

export function normalizeRawWonAmount(
  input: z.infer<typeof rawWonAmountSchema>,
): WonNormalizationResult {
  const parsed = rawWonAmountSchema.safeParse(input);
  if (!parsed.success) {
    return invalidAmount("INVALID_AMOUNT_FORMAT", "금액 숫자 형식이 올바르지 않습니다.");
  }
  if (parsed.data.unit === null) {
    return invalidAmount(
      "MISSING_AMOUNT_UNIT",
      "금액 단위가 없어 원화 금액으로 확정할 수 없습니다.",
    );
  }

  const grouped = parsed.data.rawNumber;
  if (!SAFE_NUMBER.test(grouped) && !GROUPED_NUMBER.test(grouped)) {
    return invalidAmount(
      "INVALID_AMOUNT_FORMAT",
      "쉼표 위치 또는 소수 형식이 올바르지 않습니다.",
    );
  }

  const normalized = grouped.replaceAll(",", "");
  const [integerPart, fractionalPart = ""] = normalized.split(".");
  const scale = 10n ** BigInt(fractionalPart.length);
  const numerator =
    BigInt(`${integerPart}${fractionalPart}`) *
    UNIT_MULTIPLIERS[parsed.data.unit];
  if (numerator % scale !== 0n) {
    return invalidAmount(
      "NON_INTEGER_WON_AMOUNT",
      "단위를 적용한 결과가 정수 원 단위가 아닙니다.",
    );
  }

  const won = (numerator / scale).toString();
  if (!isWonAmount(won)) {
    return invalidAmount(
      "AMOUNT_OUT_OF_RANGE",
      "금액이 지원 범위를 벗어났습니다.",
    );
  }
  return { value: won, warning: null };
}

export function parseWonAmountText(text: string): WonNormalizationResult {
  const match = text
    .slice(0, MAX_TEXT)
    .match(
      /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(억원|백만원|천원|만원|원)?/,
    );
  if (!match) {
    return invalidAmount(
      "AMOUNT_NOT_FOUND",
      "금액 숫자를 찾을 수 없습니다.",
    );
  }
  const aliases: Record<string, WonAmountUnit> = {
    원: "WON",
    천원: "THOUSAND_WON",
    만원: "THOUSAND_WON",
    백만원: "MILLION_WON",
    억원: "HUNDRED_MILLION_WON",
  };
  if (match[2] === "만원") {
    const value = normalizeRawWonAmount({
      rawNumber: match[1],
      unit: "THOUSAND_WON",
    });
    if (!value.value) return value;
    const multiplied = (BigInt(value.value) * 10n).toString();
    return isWonAmount(multiplied)
      ? { value: multiplied, warning: null }
      : invalidAmount("AMOUNT_OUT_OF_RANGE", "금액이 지원 범위를 벗어났습니다.");
  }
  return normalizeRawWonAmount({
    rawNumber: match[1],
    unit: match[2] ? aliases[match[2]] : null,
  });
}

export function parseVatTreatment(text: string): {
  value: boolean | null;
  warning: { code: string; message: string } | null;
} {
  const sample = text.slice(0, MAX_TEXT);
  const included = /(?:부가세|VAT)\s*(?:포함|포함가)/i.test(sample);
  const excluded = /(?:부가세|VAT)\s*(?:별도|미포함|제외)/i.test(sample);
  if (included === excluded) {
    return {
      value: null,
      warning: {
        code: included ? "AMBIGUOUS_VAT" : "VAT_NOT_STATED",
        message: included
          ? "부가세 포함과 별도 표시가 함께 있어 확정할 수 없습니다."
          : "부가세 포함 여부가 명시되지 않았습니다.",
      },
    };
  }
  return { value: included, warning: null };
}

export function emptyExtractionFields(): QuoteExtractionFields {
  return Object.fromEntries(
    NORMALIZED_AUDIT_QUOTE_FIELDS.map((field) => [field, null]),
  ) as QuoteExtractionFields;
}

function invalidAmount(code: string, message: string): WonNormalizationResult {
  return { value: null, warning: { code, message } };
}
