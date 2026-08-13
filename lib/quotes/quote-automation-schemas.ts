import { z } from "zod";
import { isWonAmount } from "@/lib/audit-evaluation/money";
import {
  NH_AUDIT_COOPERATIVE_TYPES_2025,
  NH_AUDIT_EXPENSE_BILLING_MODES,
  NH_AUDIT_PROPOSER_TYPES,
} from "@/lib/audit-evaluation/nh-audit-v2-types";
import type { WonAmount } from "@/lib/audit-evaluation/types";

const resourceId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const wonSchema = z.custom<WonAmount>(
  isWonAmount,
  "canonical won amount required",
);
const positiveWonSchema = wonSchema.refine(
  (value) => BigInt(value) > 0n,
  "must be greater than zero",
);

export const quoteAutomationPartnerPresetInputSchema = z
  .object({
    assignmentId: resourceId,
    partnerId: resourceId,
    partnerName: z.string().trim().min(1).max(200).optional(),
    plannedAuditFeeWon: positiveWonSchema,
    expenseBillingMode: z.enum(NH_AUDIT_EXPENSE_BILLING_MODES),
    expectedExpenseWon: wonSchema,
    safePriceMinWon: positiveWonSchema,
    safePriceMaxWon: positiveWonSchema,
    isPlannedWinner: z.boolean(),
    locked: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (BigInt(value.safePriceMinWon) > BigInt(value.safePriceMaxWon)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["safePriceMaxWon"],
        message: "safe_price_max_below_min",
      });
    }
    if (
      BigInt(value.plannedAuditFeeWon) < BigInt(value.safePriceMinWon) ||
      BigInt(value.plannedAuditFeeWon) > BigInt(value.safePriceMaxWon)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["plannedAuditFeeWon"],
        message: "planned_fee_outside_safe_range",
      });
    }
    if (
      value.expenseBillingMode === "INCLUDED_IN_AUDIT_FEE" &&
      BigInt(value.expectedExpenseWon) !== 0n
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedExpenseWon"],
        message: "expense_must_be_zero_when_included",
      });
    }
  });

export const quoteAutomationRequestPlanInputSchema = z
  .object({
    plannedWinnerPartnerId: resourceId.nullable(),
    notes: z.string().trim().max(2_000),
    partnerPresets: z.array(quoteAutomationPartnerPresetInputSchema).max(50),
  })
  .strict()
  .superRefine((value, ctx) => {
    const winners = value.partnerPresets.filter((item) => item.isPlannedWinner);
    if (winners.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["partnerPresets"],
        message: "multiple_planned_winners",
      });
    }
    if (
      value.plannedWinnerPartnerId &&
      !value.partnerPresets.some(
        (item) =>
          item.partnerId === value.plannedWinnerPartnerId &&
          item.isPlannedWinner,
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["plannedWinnerPartnerId"],
        message: "planned_winner_mismatch",
      });
    }
  });

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value ?? "");

const optionalNonNegativeInt = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined || value === "") return 0;
    const parsed =
      typeof value === "number" ? value : Number(String(value).replace(/\D/gu, ""));
    if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
    return parsed;
  });

const optionalWon = z
  .union([wonSchema, z.string(), z.number(), z.null(), z.undefined()])
  .transform((value): WonAmount => {
    if (value === null || value === undefined || value === "") {
      return "0" as WonAmount;
    }
    if (typeof value === "number") {
      return String(Math.max(0, Math.trunc(value))) as WonAmount;
    }
    const digits = String(value).replace(/\D/gu, "");
    return (digits || "0") as WonAmount;
  });

const optionalBoolean = z
  .union([z.boolean(), z.null(), z.undefined()])
  .transform((value) => value === true);

/**
 * 비제휴 비교 입력: 제휴사와 동일 항목을 받되, 알고 있는 부분만 선택 입력 가능.
 * 미입력 품질·평가 항목은 0점 처리용 기본값으로 채운다.
 * 식별용 공급자명(회계법인명)과 비교용 감사보수만 필수.
 */
export const externalManualQuoteInputSchema = z
  .object({
    supplierName: optionalTrimmed(200),
    supplierBusinessRegistrationNumber: optionalTrimmed(20),
    supplierAddress: optionalTrimmed(300),
    supplierContactName: optionalTrimmed(80),
    supplierContactEmail: optionalTrimmed(254),
    supplierContactPhone: optionalTrimmed(40),
    accountingFirmName: optionalTrimmed(200),
    engagementPartnerName: optionalTrimmed(200),
    proposerType: z
      .enum(NH_AUDIT_PROPOSER_TYPES)
      .optional()
      .transform((value) => value ?? ("ACCOUNTING_FIRM" as const)),
    auditFeeWon: positiveWonSchema,
    expenseBillingMode: z
      .enum(NH_AUDIT_EXPENSE_BILLING_MODES)
      .optional()
      .transform((value) => value ?? ("INCLUDED_IN_AUDIT_FEE" as const)),
    expectedExpenseWon: optionalWon.optional(),
    localNonghyupAuditCount2025: optionalNonNegativeInt,
    certifiedPublicAccountantCount: optionalNonNegativeInt,
    accountingFirmRevenueWon: optionalWon,
    auditedNonghyupTypes2025: z
      .array(z.enum(NH_AUDIT_COOPERATIVE_TYPES_2025))
      .max(4)
      .optional(),
    noAuditedNonghyupTypes2025: optionalBoolean,
    nonghyupTaxAgencyPerformed2025: optionalBoolean,
    nonghyupSubsidySettlementPerformed2025: optionalBoolean,
  })
  .strict()
  .superRefine((value, ctx) => {
    const firmName = (value.supplierName || value.accountingFirmName).trim();
    if (!firmName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supplierName"],
        message: "accounting_firm_name_required",
      });
    }
  })
  .transform((value) => {
    const accountingFirmName = (
      value.supplierName ||
      value.accountingFirmName
    ).trim();
    const expenseBillingMode = value.expenseBillingMode;
    const expectedExpenseWon =
      expenseBillingMode === "INCLUDED_IN_AUDIT_FEE"
        ? ("0" as WonAmount)
        : ((value.expectedExpenseWon ?? "0") as WonAmount);
    const noAudited =
      value.noAuditedNonghyupTypes2025 ||
      !value.auditedNonghyupTypes2025 ||
      value.auditedNonghyupTypes2025.length === 0;
    return {
      supplierName: accountingFirmName,
      supplierBusinessRegistrationNumber:
        value.supplierBusinessRegistrationNumber,
      supplierAddress: value.supplierAddress,
      supplierContactName: value.supplierContactName,
      supplierContactEmail: value.supplierContactEmail.toLowerCase(),
      supplierContactPhone: value.supplierContactPhone,
      accountingFirmName,
      engagementPartnerName: value.engagementPartnerName.trim(),
      proposerType: value.proposerType,
      auditFeeWon: value.auditFeeWon,
      expenseBillingMode,
      expectedExpenseWon,
      localNonghyupAuditCount2025: value.localNonghyupAuditCount2025,
      certifiedPublicAccountantCount: value.certifiedPublicAccountantCount,
      accountingFirmRevenueWon: value.accountingFirmRevenueWon,
      // 미선택·해당 없음 → 빈 배열(유형 다양성 0점). 전체 유형 자동 채우지 않음.
      auditedNonghyupTypes2025: noAudited
        ? ([] as typeof NH_AUDIT_COOPERATIVE_TYPES_2025[number][])
        : [...new Set(value.auditedNonghyupTypes2025)],
      noAuditedNonghyupTypes2025: noAudited,
      nonghyupTaxAgencyPerformed2025: value.nonghyupTaxAgencyPerformed2025,
      nonghyupSubsidySettlementPerformed2025:
        value.nonghyupSubsidySettlementPerformed2025,
    };
  });

const MUTATION_QUOTE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;

/** POST body에서 수정용 quoteId를 분리한다. 스키마는 quoteId를 허용하지 않는다. */
export function splitExternalManualQuoteMutationBody(body: unknown): {
  quoteId?: string;
  payload: unknown;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { payload: body };
  }
  const record = { ...(body as Record<string, unknown>) };
  const rawId = record.quoteId;
  delete record.quoteId;
  if (typeof rawId !== "string") return { payload: record };
  const quoteId = rawId.trim();
  if (!MUTATION_QUOTE_ID.test(quoteId)) return { payload: record };
  return { quoteId, payload: record };
}
