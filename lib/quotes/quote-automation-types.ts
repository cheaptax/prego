import type {
  NhAuditExpenseBillingMode,
} from "@/lib/audit-evaluation/nh-audit-v2-types";
import type { WonAmount } from "@/lib/audit-evaluation/types";

export const QUOTE_AUTOMATION_COLLECTIONS = {
  requestPlans: "quoteAutomationRequestPlans",
  partnerPresets: "quoteAutomationPartnerPresets",
  priceAdjustmentEvents: "quoteAutomationPriceAdjustmentEvents",
} as const;

export const AUDIT_EVALUATION_EXTERNAL_QUOTES =
  "auditEvaluationExternalQuotes" as const;

export type QuoteAutomationPartnerPreset = {
  id: string;
  quoteRequestId: string;
  auditQuoteRequestId: string;
  assignmentId: string;
  partnerId: string;
  partnerName: string;
  plannedAuditFeeWon: WonAmount;
  expenseBillingMode: NhAuditExpenseBillingMode;
  expectedExpenseWon: WonAmount;
  /** Inclusive lower bound for evaluation-time audit fee adjustment. */
  safePriceMinWon: WonAmount;
  /** Inclusive upper bound for evaluation-time audit fee adjustment. */
  safePriceMaxWon: WonAmount;
  isPlannedWinner: boolean;
  locked: boolean;
  updatedBy: string;
  updatedByEmail?: string;
  createdAt: string;
  updatedAt: string;
};

export type QuoteAutomationRequestPlan = {
  id: string;
  quoteRequestId: string;
  auditQuoteRequestId: string;
  cooperativeName?: string;
  fiscalYear?: number;
  plannedWinnerPartnerId: string | null;
  notes: string;
  updatedBy: string;
  updatedByEmail?: string;
  createdAt: string;
  updatedAt: string;
};

export type ExternalManualQuoteRecord = {
  id: string;
  caseId: string;
  quoteRequestId: string;
  /** 견적서 공급자 정보 — 제휴사 견적과 동일 항목(선택 입력) */
  supplierName: string;
  supplierBusinessRegistrationNumber: string;
  supplierAddress: string;
  supplierContactName: string;
  supplierContactEmail: string;
  supplierContactPhone: string;
  accountingFirmName: string;
  engagementPartnerName: string;
  proposerType: "ACCOUNTING_FIRM" | "AUDIT_GROUP";
  auditFeeWon: WonAmount;
  expenseBillingMode: NhAuditExpenseBillingMode;
  expectedExpenseWon: WonAmount;
  localNonghyupAuditCount2025: number;
  certifiedPublicAccountantCount: number;
  accountingFirmRevenueWon: WonAmount;
  auditedNonghyupTypes2025: string[];
  noAuditedNonghyupTypes2025: boolean;
  nonghyupTaxAgencyPerformed2025: boolean;
  nonghyupSubsidySettlementPerformed2025: boolean;
  enteredBySubjectId: string;
  createdAt: string;
  updatedAt: string;
};

export type SafePriceAdjustmentEvent = {
  id: string;
  caseId: string;
  quoteRequestId: string;
  reportId: string;
  partnerQuoteId: string;
  partnerId: string;
  partnerName: string;
  reason:
    | "BEAT_EXTERNAL_MIN"
    | "CLAMP_TO_SAFE_RANGE"
    | "PLANNED_WINNER"
    | "NON_WINNER_SPREAD";
  beforeAuditFeeWon: WonAmount;
  afterAuditFeeWon: WonAmount;
  beforeTotalBurdenWon: WonAmount;
  afterTotalBurdenWon: WonAmount;
  externalMinBurdenWon: WonAmount | null;
  competingMinBurdenWon?: WonAmount | null;
  safePriceMinWon: WonAmount;
  safePriceMaxWon: WonAmount;
  mutatedSourceQuote?: boolean;
  beforeQuoteVersion?: number;
  afterQuoteVersion?: number;
  rewrittenQuoteId?: string;
  createdAt: string;
};
