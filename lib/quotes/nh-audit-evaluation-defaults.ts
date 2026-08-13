import type { PartnerRecord, QuoteRecord } from "@/lib/firebase/schema";
import { normalizeWonAmount } from "@/lib/audit-evaluation/money";
import { createNhAuditEvaluationSnapshotV2 } from "@/lib/quotes/nh-audit-quote-server";
import {
  EMPTY_NH_AUDIT_PARTNER_FORM,
  sanitizeNhAuditPartnerFormDraft,
  valuesFromNhAuditSubmission,
  type NhAuditPartnerFormValues,
} from "@/lib/quotes/nh-audit-quote-form";

/** Reusable firm evaluation fields stored on the partner profile. */
export type NhAuditEvaluationDefaults = Pick<
  NhAuditPartnerFormValues,
  | "engagementPartnerName"
  | "proposerType"
  | "localNonghyupAuditCount2025"
  | "certifiedPublicAccountantCount"
  | "accountingFirmRevenueWon"
  | "auditedNonghyupTypes2025"
  | "noAuditedNonghyupTypes2025"
  | "nonghyupTaxAgencyPerformed2025"
  | "nonghyupSubsidySettlementPerformed2025"
>;

export function extractNhAuditEvaluationDefaults(
  values: NhAuditPartnerFormValues,
): NhAuditEvaluationDefaults | null {
  const sanitized = sanitizeNhAuditPartnerFormDraft(values);
  const hasAny =
    Boolean(sanitized.engagementPartnerName.trim()) ||
    Boolean(sanitized.proposerType) ||
    Boolean(sanitized.localNonghyupAuditCount2025) ||
    Boolean(sanitized.certifiedPublicAccountantCount) ||
    Boolean(sanitized.accountingFirmRevenueWon) ||
    sanitized.auditedNonghyupTypes2025.length > 0 ||
    sanitized.noAuditedNonghyupTypes2025 ||
    Boolean(sanitized.nonghyupTaxAgencyPerformed2025) ||
    Boolean(sanitized.nonghyupSubsidySettlementPerformed2025);
  if (!hasAny) return null;
  return {
    engagementPartnerName: sanitized.engagementPartnerName,
    proposerType: sanitized.proposerType,
    localNonghyupAuditCount2025: sanitized.localNonghyupAuditCount2025,
    certifiedPublicAccountantCount: sanitized.certifiedPublicAccountantCount,
    accountingFirmRevenueWon: sanitized.accountingFirmRevenueWon,
    auditedNonghyupTypes2025: sanitized.auditedNonghyupTypes2025,
    noAuditedNonghyupTypes2025: sanitized.noAuditedNonghyupTypes2025,
    nonghyupTaxAgencyPerformed2025:
      sanitized.nonghyupTaxAgencyPerformed2025,
    nonghyupSubsidySettlementPerformed2025:
      sanitized.nonghyupSubsidySettlementPerformed2025,
  };
}

export function applyNhAuditEvaluationDefaults(
  defaults?: NhAuditEvaluationDefaults | null,
): NhAuditPartnerFormValues {
  if (!defaults) return { ...EMPTY_NH_AUDIT_PARTNER_FORM };
  const sanitized = sanitizeNhAuditPartnerFormDraft({
    ...EMPTY_NH_AUDIT_PARTNER_FORM,
    ...defaults,
    auditFeeWon: "",
    expenseBillingMode: "",
    expectedExpenseWon: "",
    factsConfirmed: false,
  });
  return {
    ...sanitized,
    auditFeeWon: "",
    expenseBillingMode: "",
    expectedExpenseWon: "",
    factsConfirmed: false,
  };
}

export function sanitizeNhAuditEvaluationDefaults(
  value: unknown,
): NhAuditEvaluationDefaults | null {
  return extractNhAuditEvaluationDefaults(
    sanitizeNhAuditPartnerFormDraft(value),
  );
}

/**
 * 제휴사목록 평가 기본값을 이미 발송된 견적의 품질 항목에 덮어쓴다.
 * 감사보수·제경비는 견적 값을 유지한다.
 */
export function overlayPartnerQualityDefaultsOnQuote(
  quote: QuoteRecord,
  defaults: NhAuditEvaluationDefaults | null | undefined,
  now: string,
): QuoteRecord {
  const submission = quote.nhAuditV2?.submission;
  if (!submission || !defaults) return quote;
  const next = { ...submission };
  const name = defaults.engagementPartnerName.trim();
  if (name) next.engagementPartnerName = name;
  if (defaults.proposerType) next.proposerType = defaults.proposerType;
  const auditCount = integerDraft(defaults.localNonghyupAuditCount2025);
  if (auditCount !== null) next.localNonghyupAuditCount2025 = auditCount;
  const cpaCount = integerDraft(defaults.certifiedPublicAccountantCount);
  if (cpaCount !== null) next.certifiedPublicAccountantCount = cpaCount;
  const revenueDigits = defaults.accountingFirmRevenueWon.replace(/\D/gu, "");
  if (revenueDigits) {
    next.accountingFirmRevenueWon = normalizeWonAmount(revenueDigits);
  }
  next.auditedNonghyupTypes2025 = defaults.noAuditedNonghyupTypes2025
    ? []
    : [...defaults.auditedNonghyupTypes2025];
  if (defaults.nonghyupTaxAgencyPerformed2025) {
    next.nonghyupTaxAgencyPerformed2025 =
      defaults.nonghyupTaxAgencyPerformed2025 === "YES";
  }
  if (defaults.nonghyupSubsidySettlementPerformed2025) {
    next.nonghyupSubsidySettlementPerformed2025 =
      defaults.nonghyupSubsidySettlementPerformed2025 === "YES";
  }
  if (
    next.engagementPartnerName === submission.engagementPartnerName &&
    next.proposerType === submission.proposerType &&
    next.localNonghyupAuditCount2025 ===
      submission.localNonghyupAuditCount2025 &&
    next.certifiedPublicAccountantCount ===
      submission.certifiedPublicAccountantCount &&
    next.accountingFirmRevenueWon === submission.accountingFirmRevenueWon &&
    next.auditedNonghyupTypes2025.join("|") ===
      submission.auditedNonghyupTypes2025.join("|") &&
    next.nonghyupTaxAgencyPerformed2025 ===
      submission.nonghyupTaxAgencyPerformed2025 &&
    next.nonghyupSubsidySettlementPerformed2025 ===
      submission.nonghyupSubsidySettlementPerformed2025
  ) {
    return quote;
  }
  return {
    ...quote,
    nhAuditV2: createNhAuditEvaluationSnapshotV2(next, now),
  };
}

function integerDraft(value: string) {
  const digits = value.replace(/\D/gu, "");
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function resolveInitialNhAuditPartnerForm(input: {
  draft?: QuoteRecord | null;
  partner?: PartnerRecord | null;
  quotes?: QuoteRecord[];
  /** When set, prefer the latest sent quote for this assignment (keeps fees). */
  assignmentId?: string;
  /** Admin-planned fees / safe-range defaults for this assignment. */
  automationPreset?: {
    plannedAuditFeeWon: string;
    expenseBillingMode: string;
    expectedExpenseWon: string;
    safePriceMinWon?: string;
    safePriceMaxWon?: string;
    locked?: boolean;
  } | null;
}): NhAuditPartnerFormValues {
  const { draft, partner, quotes = [], assignmentId, automationPreset } = input;
  if (draft?.nhAuditDraft) {
    return sanitizeNhAuditPartnerFormDraft(draft.nhAuditDraft);
  }
  if (draft?.nhAuditV2?.submission) {
    const fromSubmission = valuesFromNhAuditSubmission(
      draft.nhAuditV2.submission,
    );
    return {
      ...fromSubmission,
      factsConfirmed: false,
    };
  }
  if (assignmentId) {
    const latestSentForAssignment = [...quotes]
      .filter(
        (quote) =>
          quote.quoteAssignmentId === assignmentId &&
          ["finalized", "delivered"].includes(quote.status) &&
          Boolean(quote.nhAuditV2?.submission || quote.nhAuditDraft),
      )
      .sort((left, right) => Number(right.version) - Number(left.version))[0];
    if (latestSentForAssignment?.nhAuditDraft) {
      return {
        ...sanitizeNhAuditPartnerFormDraft(
          latestSentForAssignment.nhAuditDraft,
        ),
        factsConfirmed: false,
      };
    }
    if (latestSentForAssignment?.nhAuditV2?.submission) {
      return {
        ...valuesFromNhAuditSubmission(
          latestSentForAssignment.nhAuditV2.submission,
        ),
        factsConfirmed: false,
      };
    }
  }
  const base = partner?.nhAuditEvaluationDefaults
    ? applyNhAuditEvaluationDefaults(partner.nhAuditEvaluationDefaults)
    : (() => {
        const latestFinalized = [...quotes]
          .filter(
            (quote) =>
              partner &&
              quote.partnerId === partner.id &&
              quote.status !== "draft" &&
              quote.status !== "void" &&
              Boolean(quote.nhAuditV2?.submission || quote.nhAuditDraft),
          )
          .sort((left, right) =>
            (right.finalizedAt || right.updatedAt || "").localeCompare(
              left.finalizedAt || left.updatedAt || "",
            ),
          )[0];
        if (latestFinalized?.nhAuditDraft) {
          return applyNhAuditEvaluationDefaults(
            extractNhAuditEvaluationDefaults(
              sanitizeNhAuditPartnerFormDraft(latestFinalized.nhAuditDraft),
            ),
          );
        }
        if (latestFinalized?.nhAuditV2?.submission) {
          return applyNhAuditEvaluationDefaults(
            extractNhAuditEvaluationDefaults(
              valuesFromNhAuditSubmission(latestFinalized.nhAuditV2.submission),
            ),
          );
        }
        return { ...EMPTY_NH_AUDIT_PARTNER_FORM };
      })();

  if (!automationPreset?.plannedAuditFeeWon) return base;
  return sanitizeNhAuditPartnerFormDraft({
    ...base,
    auditFeeWon: automationPreset.plannedAuditFeeWon,
    expenseBillingMode: automationPreset.expenseBillingMode,
    expectedExpenseWon: automationPreset.expectedExpenseWon,
    factsConfirmed: false,
  });
}
