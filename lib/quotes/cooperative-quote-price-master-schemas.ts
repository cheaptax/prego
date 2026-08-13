import { z } from "zod";
import { isWonAmount } from "@/lib/audit-evaluation/money";
import {
  NH_AUDIT_EXPENSE_BILLING_MODES,
} from "@/lib/audit-evaluation/nh-audit-v2-types";
import type { WonAmount } from "@/lib/audit-evaluation/types";

const resourceId = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);

const wonSchema = z.custom<WonAmount>(
  isWonAmount,
  "canonical won amount required",
);

const positiveWonSchema = wonSchema.refine(
  (value) => BigInt(value) > 0n,
  "must be greater than zero",
);

export const cooperativeQuotePartnerPriceInputSchema = z
  .object({
    cooperativeId: resourceId,
    cooperativeName: z.string().trim().min(1).max(200),
    partnerId: resourceId,
    partnerName: z.string().trim().min(1).max(200).optional(),
    plannedAuditFeeWon: positiveWonSchema,
    expenseBillingMode: z
      .enum(NH_AUDIT_EXPENSE_BILLING_MODES)
      .optional()
      .transform((value) => value ?? ("INCLUDED_IN_AUDIT_FEE" as const)),
    expectedExpenseWon: wonSchema
      .optional()
      .transform((value) => value ?? ("0" as WonAmount)),
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

export const cooperativeQuotePricePlanInputSchema = z
  .object({
    fiscalYear: z.number().int().min(2020).max(2100),
    cooperativeId: resourceId,
    cooperativeName: z.string().trim().min(1).max(200),
    plannedWinnerPartnerId: resourceId.nullable(),
    notes: z.string().trim().max(2_000).optional().transform((value) => value ?? ""),
    partnerPrices: z
      .array(cooperativeQuotePartnerPriceInputSchema)
      .min(1)
      .max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    const partnerIds = new Set<string>();
    for (const [index, price] of value.partnerPrices.entries()) {
      if (price.cooperativeId !== value.cooperativeId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["partnerPrices", index, "cooperativeId"],
          message: "cooperative_mismatch",
        });
      }
      if (partnerIds.has(price.partnerId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["partnerPrices", index, "partnerId"],
          message: "duplicate_partner",
        });
      }
      partnerIds.add(price.partnerId);
    }
    const winners = value.partnerPrices.filter((item) => item.isPlannedWinner);
    if (winners.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["partnerPrices"],
        message: "multiple_planned_winners",
      });
    }
    if (
      value.plannedWinnerPartnerId &&
      !winners.some((item) => item.partnerId === value.plannedWinnerPartnerId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["plannedWinnerPartnerId"],
        message: "planned_winner_mismatch",
      });
    }
  });

export const cooperativeQuotePriceListQuerySchema = z.object({
  fiscalYear: z.number().int().min(2020).max(2100),
  cooperativeId: z.string().trim().max(160).optional(),
  partnerId: z.string().trim().max(160).optional(),
  pageSize: z.number().int().min(10).max(100).optional(),
});

export function parseWonCell(value: unknown): WonAmount | null {
  if (value === null || value === undefined || value === "") return null;
  const digits = String(value).replace(/\D/gu, "");
  return digits && isWonAmount(digits) && BigInt(digits) > 0n
    ? (digits as WonAmount)
    : null;
}
