import { createHash } from "node:crypto";
import {
  calculateNhAuditExpectedCostV2,
  calculateNhAuditQualityScoreV2,
  compareExactScores,
} from "@/lib/audit-evaluation/nh-audit-v2-engine";
import {
  HUNDRED_THOUSAND_WON,
  normalizeWonAmount,
  roundWonHalfUpToHundredThousand,
} from "@/lib/audit-evaluation/money";
import {
  createDefaultNhAuditCustomerWeightsV2,
  validateNhAuditCustomerWeightsV2,
} from "@/lib/audit-evaluation/nh-audit-v2-schemas";
import type {
  ExactScore,
  NhAuditCustomerWeightsV2,
  NhAuditQuoteSubmissionV2,
} from "@/lib/audit-evaluation/nh-audit-v2-types";
import type { WonAmount } from "@/lib/audit-evaluation/types";
import type { QuoteRecord } from "@/lib/firebase/schema";
import type {
  ExternalManualQuoteRecord,
  QuoteAutomationPartnerPreset,
  SafePriceAdjustmentEvent,
} from "@/lib/quotes/quote-automation-types";
import { createNhAuditEvaluationSnapshotV2 } from "@/lib/quotes/nh-audit-quote-server";
import { normalizePartnerMatchKey } from "@/lib/quotes/cooperative-quote-price-master-pricing";

const VAT_NUM = 1_100n;
const VAT_DEN = 1_000n;

/** 선정 제휴사는 비제휴 최저가보다 이 금액만큼 낮은 감사보수로 맞춘다. */
export const SAFE_PRICE_WINNER_UNDERCUT_WON = 300_000n;
/** 비선정 n번째는 선정 제휴사보다 n×10만원 높은 감사보수로 맞춘다. */
export function safePriceNonWinnerPremiumWon(index: number) {
  return 100_000n * BigInt(Math.max(0, index) + 1);
}

/** @deprecated Prefer safePriceNonWinnerPremiumWon(index). */
export const SAFE_PRICE_NON_WINNER_PREMIUMS_WON = [
  safePriceNonWinnerPremiumWon(0),
  safePriceNonWinnerPremiumWon(1),
] as const;

export type SafePriceAdjustmentResult = {
  quotes: QuoteRecord[];
  events: SafePriceAdjustmentEvent[];
  externalQuoteIds: string[];
  selectedPartnerId: string | null;
  safePriceMinWon: WonAmount | null;
};

export function isExternalEvaluationQuoteId(quoteId: string) {
  return quoteId.startsWith("external_");
}

/**
 * 비제휴(타 제휴사) 적격 견적은 순위에 포함한다. 제휴사 견적만 자동 수정한다.
 *
 * 1) 품질순위와 적격(자동검증) 통과 후, 제휴사 중 품질 1등을 최종 선정 제휴사로 둔다.
 * 2) 그 최종 선정 제휴사를 기준으로 가격을 맞춘다.
 *    - 타 제휴사가 선정 제휴사보다 싸면
 *      선정 제휴사 = 타 제휴사 최저가 − 30만원.
 *      그 값이 농협 최저안전가격보다 낮으면 최저안전가격까지만 내린다.
 *    - 비선정 제휴사는 품질 순으로 선정 제휴사보다 10/20/30만원… 높게 맞춘다.
 * 3) 최저안전가격(하한)은 선정된 제휴사 개인 프리셋이 아니라 해당 농협 전체에 동일하게 적용한다.
 */
export function applySafePriceAdjustments(input: {
  caseId: string;
  quoteRequestId: string;
  reportId: string;
  partnerQuotes: readonly QuoteRecord[];
  externalQuotes: readonly ExternalManualQuoteRecord[];
  presets: readonly QuoteAutomationPartnerPreset[];
  now: string;
  weights?: unknown;
  cooperativeSafetyBand?: {
    safePriceMinWon: WonAmount;
    safePriceMaxWon: WonAmount;
  } | null;
}): SafePriceAdjustmentResult {
  const weights = resolveWeights(input.weights);
  const externalQuoteIds = input.externalQuotes.map((item) => item.id);
  const evaluationExternals = input.externalQuotes.map((record) =>
    externalManualQuoteAsEvaluationQuote(record, {
      quoteRequestId: input.quoteRequestId,
      cooperativeName: record.accountingFirmName || "대상 농협",
      fiscalYear: 2026,
      now: input.now,
    }),
  );
  const eligiblePartners = input.partnerQuotes.filter(isEligibleCompetitor);
  const eligibleExternals = evaluationExternals.filter(isEligibleCompetitor);

  if (eligiblePartners.length === 0) {
    return {
      quotes: [...input.partnerQuotes],
      events: [],
      externalQuoteIds,
      selectedPartnerId: null,
      safePriceMinWon: null,
    };
  }

  const planned =
    input.presets.find((preset) => preset.isPlannedWinner) ??
    input.presets[0] ??
    null;
  const plannedQuote =
    (planned &&
      (eligiblePartners.find(
        (quote) => quote.partnerId === planned.partnerId,
      ) ||
        eligiblePartners.find(
          (quote) =>
            normalizePartnerMatchKey(quote.partnerName) ===
            normalizePartnerMatchKey(planned.partnerName),
        ))) ||
    eligiblePartners[0];

  const selected = selectWinnerByQuality({
    planned: plannedQuote,
    partners: eligiblePartners,
    weights,
  });

  const cooperativeFloor = firstRealSafeMin([
    input.cooperativeSafetyBand,
    planned,
  ]);
  const minExternalFee = minAuditFee(eligibleExternals);
  const winnerCurrent = BigInt(selected.nhAuditV2!.submission.auditFeeWon);
  const winnerPreset = resolveWinnerPreset({
    selected,
    presets: input.presets,
    currentFee: winnerCurrent,
    cooperativeSafetyBand: input.cooperativeSafetyBand ?? null,
    cooperativeFloor,
  });
  const winnerDesired =
    minExternalFee !== null && minExternalFee <= winnerCurrent
      ? undercutFee(minExternalFee)
      : winnerCurrent;
  const winnerFee =
    minExternalFee !== null && minExternalFee <= winnerCurrent
      ? finalizeAdjustedAuditFee(
          winnerDesired,
          winnerPreset.safePriceMinWon,
          winnerPreset.safePriceMaxWon,
        )
      : winnerCurrent;

  const adjustedById = new Map<string, QuoteRecord>();
  const events: SafePriceAdjustmentEvent[] = [];
  const winnerAdjusted = applyFeeIfChanged({
    quote: selected,
    nextFee: winnerFee,
    preset: winnerPreset,
    reason:
      planned?.partnerId === selected.partnerId
        ? "PLANNED_WINNER"
        : "BEAT_EXTERNAL_MIN",
    context: input,
    minExternalFee,
  });
  if (winnerAdjusted) {
    adjustedById.set(winnerAdjusted.quote.id, winnerAdjusted.quote);
    events.push(winnerAdjusted.event);
  }

  const winnerAfterFee = BigInt(
    (adjustedById.get(selected.id) ?? selected).nhAuditV2!.submission
      .auditFeeWon,
  );
  const nonWinners = orderedNonWinners({
    partners: eligiblePartners,
    selectedId: selected.id,
    weights,
  });
  nonWinners.forEach((quote, index) => {
    const premium = safePriceNonWinnerPremiumWon(index);
    const target = winnerAfterFee + premium;
    const matched =
      resolvePartnerPreset(quote, input.presets) ??
      synthesizePresetFromQuote(quote, target);
    const preset = cooperativeFloor
      ? { ...matched, safePriceMinWon: cooperativeFloor }
      : matched;
    const nextFee = finalizeAdjustedAuditFee(
      target,
      cooperativeFloor,
      null,
    );
    const adjusted = applyFeeIfChanged({
      quote,
      nextFee,
      preset,
      reason: "NON_WINNER_SPREAD",
      context: input,
      minExternalFee,
    });
    if (adjusted) {
      adjustedById.set(adjusted.quote.id, adjusted.quote);
      events.push(adjusted.event);
    }
  });

  return {
    quotes: input.partnerQuotes.map(
      (quote) => adjustedById.get(quote.id) ?? quote,
    ),
    events,
    externalQuoteIds,
    selectedPartnerId: selected.partnerId,
    safePriceMinWon: cooperativeFloor,
  };
}

export function externalManualQuoteAsEvaluationQuote(
  record: ExternalManualQuoteRecord,
  context: {
    quoteRequestId: string;
    cooperativeName: string;
    fiscalYear: number;
    now: string;
  },
): QuoteRecord {
  const firmName =
    record.accountingFirmName?.trim() ||
    record.supplierName?.trim() ||
    "비제휴 회계법인";
  const quoteRequestId = sanitizeResourceId(
    context.quoteRequestId,
    "quote-request",
  );
  const submissionId = sanitizeResourceId(
    `external_${record.id}`,
    "external-submission",
  );
  const submission: NhAuditQuoteSubmissionV2 = {
    schemaVersion: 2,
    submissionId,
    quoteRequestId,
    targetCooperative: {
      id: null,
      name: context.cooperativeName || "대상 농협",
    },
    fiscalYear: context.fiscalYear,
    partnerAccountId: sanitizeResourceId(
      `external_${record.id}`,
      "external-partner",
    ),
    accountingFirmName: firmName,
    engagementPartnerName: record.engagementPartnerName?.trim() || "(미입력)",
    proposerType: record.proposerType || "ACCOUNTING_FIRM",
    auditFeeWon: record.auditFeeWon,
    expenseBillingMode: record.expenseBillingMode,
    expectedExpenseWon: record.expectedExpenseWon,
    localNonghyupAuditCount2025: record.localNonghyupAuditCount2025 ?? 0,
    certifiedPublicAccountantCount:
      record.certifiedPublicAccountantCount ?? 0,
    accountingFirmRevenueWon: (record.accountingFirmRevenueWon ||
      "0") as WonAmount,
    auditedNonghyupTypes2025:
      (record.auditedNonghyupTypes2025 ??
        []) as NhAuditQuoteSubmissionV2["auditedNonghyupTypes2025"],
    nonghyupTaxAgencyPerformed2025:
      record.nonghyupTaxAgencyPerformed2025 ?? false,
    nonghyupSubsidySettlementPerformed2025:
      record.nonghyupSubsidySettlementPerformed2025 ?? false,
    factsConfirmed: true,
    submittedAt: record.updatedAt || context.now,
  };
  const cost = calculateNhAuditExpectedCostV2(submission);
  const nhAuditV2 = createNhAuditEvaluationSnapshotV2(submission, context.now);
  return {
    id: `external_${record.id}`,
    quoteRequestId: context.quoteRequestId,
    quoteAssignmentId: `external_assignment_${record.id}`,
    partnerId: `external_${record.id}`,
    partnerName: firmName,
    status: "delivered",
    version: 1,
    customerEmail: "",
    supplierName: firmName,
    supplierBusinessRegistrationNumber:
      record.supplierBusinessRegistrationNumber || undefined,
    supplierAddress: record.supplierAddress || undefined,
    supplierContactName: record.supplierContactName || undefined,
    supplierContactEmail: record.supplierContactEmail || "",
    supplierContactPhone: record.supplierContactPhone || undefined,
    lineItems: [],
    subtotal: Number(record.auditFeeWon),
    taxAmount: 0,
    totalAmount: Number(cost.expectedTotalBurdenWon),
    vatIncluded: true,
    createdBy: record.enteredBySubjectId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    nhAuditV2,
  };
}

function selectWinnerByQuality(input: {
  planned: QuoteRecord;
  partners: readonly QuoteRecord[];
  weights: NhAuditCustomerWeightsV2;
}) {
  return bestQuality(input.partners, input.weights).quote ?? input.planned;
}

function bestQuality(
  quotes: readonly QuoteRecord[],
  weights: NhAuditCustomerWeightsV2,
) {
  return quotes.reduce<{ quote: QuoteRecord | null; score: ExactScore | null }>(
    (best, quote) => {
      const score = qualityScore(quote, weights);
      if (!score) return best;
      if (
        !best.quote ||
        !best.score ||
        compareExactScores(score, best.score) > 0 ||
        (compareExactScores(score, best.score) === 0 &&
          quote.id.localeCompare(best.quote.id) < 0)
      ) {
        return { quote, score };
      }
      return best;
    },
    { quote: null, score: null },
  );
}

function qualityScore(
  quote: QuoteRecord,
  weights: NhAuditCustomerWeightsV2,
): ExactScore | null {
  const submission = quote.nhAuditV2?.submission;
  if (!submission || submission.proposerType === "AUDIT_GROUP") return null;
  return calculateNhAuditQualityScoreV2(submission, weights).qualityScore;
}

function isEligibleCompetitor(quote: QuoteRecord) {
  const submission = quote.nhAuditV2?.submission;
  if (!submission) return false;
  if (submission.proposerType === "AUDIT_GROUP") return false;
  if (
    quote.nhAuditV2?.eligibilityStatus &&
    quote.nhAuditV2.eligibilityStatus !== "ELIGIBLE"
  ) {
    return false;
  }
  return BigInt(submission.auditFeeWon) > 0n;
}

function minAuditFee(quotes: readonly QuoteRecord[]) {
  const fees = quotes.flatMap((quote) => {
    const fee = quote.nhAuditV2?.submission.auditFeeWon;
    return fee ? [BigInt(fee)] : [];
  });
  if (fees.length === 0) return null;
  return fees.reduce((min, value) => (value < min ? value : min));
}

function undercutFee(externalMinFee: bigint) {
  return externalMinFee > SAFE_PRICE_WINNER_UNDERCUT_WON
    ? externalMinFee - SAFE_PRICE_WINNER_UNDERCUT_WON
    : 1n;
}

function finalizeAdjustedAuditFee(
  desiredFee: bigint,
  minWon: WonAmount | null | undefined,
  maxWon: WonAmount | null | undefined,
) {
  const min = minWon ? BigInt(minWon) : null;
  const max = maxWon ? BigInt(maxWon) : null;
  let fee = desiredFee < 1n ? 1n : desiredFee;
  if (min !== null && fee < min) fee = min;
  if (max !== null && fee > max) fee = max;
  let rounded = roundWonHalfUpToHundredThousand(fee);
  if (rounded < 1n) rounded = HUNDRED_THOUSAND_WON;
  if (min !== null && rounded < min) {
    rounded =
      ((min + HUNDRED_THOUSAND_WON - 1n) / HUNDRED_THOUSAND_WON) *
      HUNDRED_THOUSAND_WON;
  }
  if (max !== null && rounded > max) {
    const flooredMax = (max / HUNDRED_THOUSAND_WON) * HUNDRED_THOUSAND_WON;
    if (flooredMax >= 1n && (min === null || flooredMax >= min)) {
      rounded = flooredMax;
    }
  }
  return rounded;
}

function orderedNonWinners(input: {
  partners: readonly QuoteRecord[];
  selectedId: string;
  weights: NhAuditCustomerWeightsV2;
}) {
  return input.partners
    .filter((quote) => quote.id !== input.selectedId)
    .sort((left, right) => {
      const leftScore = qualityScore(left, input.weights);
      const rightScore = qualityScore(right, input.weights);
      if (leftScore && rightScore) {
        const qualityDelta = compareExactScores(rightScore, leftScore);
        if (qualityDelta !== 0) return qualityDelta;
      }
      return left.id.localeCompare(right.id);
    });
}

function applyFeeIfChanged(input: {
  quote: QuoteRecord;
  nextFee: bigint;
  preset: QuoteAutomationPartnerPreset;
  reason: SafePriceAdjustmentEvent["reason"];
  context: {
    caseId: string;
    quoteRequestId: string;
    reportId: string;
    now: string;
  };
  minExternalFee: bigint | null;
}) {
  const beforeSubmission = input.quote.nhAuditV2?.submission;
  if (!beforeSubmission) return null;
  if (input.nextFee === BigInt(beforeSubmission.auditFeeWon)) return null;
  const afterSubmission: NhAuditQuoteSubmissionV2 = {
    ...beforeSubmission,
    auditFeeWon: normalizeWonAmount(input.nextFee),
  };
  const beforeCost = calculateNhAuditExpectedCostV2(beforeSubmission);
  const afterCost = calculateNhAuditExpectedCostV2(afterSubmission);
  const quote: QuoteRecord = {
    ...input.quote,
    nhAuditV2: {
      ...input.quote.nhAuditV2!,
      submission: afterSubmission,
      cost: afterCost,
    },
  };
  const externalMinBurdenWon =
    input.minExternalFee === null
      ? null
      : normalizeWonAmount((input.minExternalFee * VAT_NUM) / VAT_DEN);
  const event: SafePriceAdjustmentEvent = {
    id: adjustmentEventId(input.context.reportId, input.quote.id),
    caseId: input.context.caseId,
    quoteRequestId: input.context.quoteRequestId,
    reportId: input.context.reportId,
    partnerQuoteId: input.quote.id,
    partnerId: input.quote.partnerId,
    partnerName: input.quote.partnerName,
    reason: input.reason,
    beforeAuditFeeWon: beforeSubmission.auditFeeWon,
    afterAuditFeeWon: afterSubmission.auditFeeWon,
    beforeTotalBurdenWon: beforeCost.expectedTotalBurdenWon,
    afterTotalBurdenWon: afterCost.expectedTotalBurdenWon,
    externalMinBurdenWon,
    competingMinBurdenWon: externalMinBurdenWon,
    safePriceMinWon: input.preset.safePriceMinWon,
    safePriceMaxWon: input.preset.safePriceMaxWon,
    createdAt: input.context.now,
  };
  return { quote, event };
}

function resolveWinnerPreset(input: {
  selected: QuoteRecord;
  presets: readonly QuoteAutomationPartnerPreset[];
  currentFee: bigint;
  cooperativeSafetyBand?: {
    safePriceMinWon: WonAmount;
    safePriceMaxWon: WonAmount;
  } | null;
  cooperativeFloor: WonAmount | null;
}) {
  const matched = resolvePartnerPreset(input.selected, input.presets);
  const planned =
    input.presets.find((preset) => preset.isPlannedWinner) ??
    input.presets[0] ??
    null;
  const safeMin = input.cooperativeFloor;
  const safeMax = normalizeWonAmount(
    maxBigInt(
      input.currentFee,
      bandMax(input.cooperativeSafetyBand),
      bandMax(matched),
    ),
  );
  const base = matched ?? planned;
  if (safeMin && base) {
    return {
      ...base,
      id: base.id,
      assignmentId: input.selected.quoteAssignmentId,
      partnerId: input.selected.partnerId,
      partnerName: input.selected.partnerName,
      isPlannedWinner: planned?.partnerId === input.selected.partnerId,
      safePriceMinWon: safeMin,
      safePriceMaxWon: safeMax,
    };
  }
  if (safeMin) {
    return synthesizePresetFromQuote(input.selected, input.currentFee, {
      min: safeMin,
      max: safeMax,
    });
  }
  return synthesizePresetFromQuote(input.selected, input.currentFee, {
    min: "1" as WonAmount,
    max: safeMax,
  });
}

function firstRealSafeMin(
  bands: Array<
    | {
        safePriceMinWon?: WonAmount;
        safePriceMaxWon?: WonAmount;
      }
    | null
    | undefined
  >,
) {
  for (const band of bands) {
    const min = band?.safePriceMinWon;
    if (!min || BigInt(min) <= 1n) continue;
    const max = band?.safePriceMaxWon;
    if (max && min === max) continue;
    return min;
  }
  return null;
}

function bandMax(
  band:
    | { safePriceMaxWon?: WonAmount }
    | null
    | undefined,
) {
  return band?.safePriceMaxWon ? BigInt(band.safePriceMaxWon) : 0n;
}

function maxBigInt(...values: bigint[]) {
  return values.reduce((max, value) => (value > max ? value : max), 0n);
}

function resolvePartnerPreset(
  quote: QuoteRecord,
  presets: readonly QuoteAutomationPartnerPreset[],
) {
  const byId = presets.find((preset) => preset.partnerId === quote.partnerId);
  if (byId) return byId;
  const quoteKey = normalizePartnerMatchKey(quote.partnerName);
  if (!quoteKey) return null;
  return (
    presets.find(
      (preset) => normalizePartnerMatchKey(preset.partnerName) === quoteKey,
    ) ?? null
  );
}

function synthesizePresetFromQuote(
  quote: QuoteRecord,
  intendedFee?: bigint,
  band?: { min: WonAmount; max: WonAmount },
): QuoteAutomationPartnerPreset {
  const fee = BigInt(
    quote.nhAuditV2?.submission.auditFeeWon ?? ("1" as WonAmount),
  );
  const intended = intendedFee ?? fee;
  const min = band ? BigInt(band.min) : 1n;
  const max = band
    ? BigInt(band.max)
    : fee > intended
      ? fee
      : intended;
  return {
    id: `synthetic_${quote.id}`,
    quoteRequestId: quote.quoteRequestId,
    auditQuoteRequestId: "",
    assignmentId: quote.quoteAssignmentId,
    partnerId: quote.partnerId,
    partnerName: quote.partnerName,
    plannedAuditFeeWon: normalizeWonAmount(fee),
    expenseBillingMode:
      quote.nhAuditV2?.submission.expenseBillingMode ??
      "INCLUDED_IN_AUDIT_FEE",
    expectedExpenseWon:
      quote.nhAuditV2?.submission.expectedExpenseWon ?? ("0" as WonAmount),
    safePriceMinWon: normalizeWonAmount(min < 1n ? 1n : min),
    safePriceMaxWon: normalizeWonAmount(max < 1n ? 1n : max),
    isPlannedWinner: false,
    locked: false,
    updatedBy: "system",
    createdAt: quote.updatedAt,
    updatedAt: quote.updatedAt,
  };
}

function resolveWeights(value: unknown): NhAuditCustomerWeightsV2 {
  const parsed = validateNhAuditCustomerWeightsV2(value);
  return parsed.success
    ? parsed.data
    : createDefaultNhAuditCustomerWeightsV2();
}

function sanitizeResourceId(value: string, fallback: string) {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128);
  if (/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(cleaned)) return cleaned;
  return fallback;
}

function adjustmentEventId(reportId: string, quoteId: string) {
  return createHash("sha256")
    .update(`adj|${reportId}|${quoteId}`)
    .digest("hex")
    .slice(0, 32);
}
