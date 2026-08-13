import type {
  NhAuditExpenseBillingMode,
} from "@/lib/audit-evaluation/nh-audit-v2-types";
import type { WonAmount } from "@/lib/audit-evaluation/types";

export const COOPERATIVE_QUOTE_PRICE_MASTER_COLLECTIONS = {
  plans: "cooperativeQuotePricePlans",
  partnerPrices: "cooperativeQuotePartnerPrices",
  changeEvents: "cooperativeQuotePriceChangeEvents",
} as const;

export type CooperativeQuotePricePlan = {
  id: string;
  fiscalYear: number;
  cooperativeId: string;
  cooperativeName: string;
  plannedWinnerPartnerId: string | null;
  notes: string;
  updatedBy: string;
  updatedByEmail?: string;
  createdAt: string;
  updatedAt: string;
};

export type CooperativeQuotePartnerPrice = {
  id: string;
  fiscalYear: number;
  cooperativeId: string;
  cooperativeName: string;
  partnerId: string;
  partnerName: string;
  plannedAuditFeeWon: WonAmount;
  expenseBillingMode: NhAuditExpenseBillingMode;
  expectedExpenseWon: WonAmount;
  safePriceMinWon: WonAmount;
  safePriceMaxWon: WonAmount;
  isPlannedWinner: boolean;
  locked: boolean;
  updatedBy: string;
  updatedByEmail?: string;
  createdAt: string;
  updatedAt: string;
};

export type CooperativeQuotePriceChangeEvent = {
  id: string;
  fiscalYear: number;
  cooperativeId: string;
  partnerId?: string;
  action:
    | "master.upserted"
    | "master.imported"
    | "master.deleted"
    | "request.seeded"
    | "quote.source_rewritten";
  actorUid: string;
  actorEmail?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type CooperativeQuotePriceMasterRow = {
  plan: CooperativeQuotePricePlan;
  prices: CooperativeQuotePartnerPrice[];
};
