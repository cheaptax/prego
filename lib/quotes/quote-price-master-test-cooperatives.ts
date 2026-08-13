import {
  DUNGGI_COOPERATIVE_ID,
  JAEGYEONG_COOPERATIVE_ID,
  JIHYE_COOPERATIVE_ID,
  PRIGO_COOPERATIVE_ID,
  SEONGMIN_COOPERATIVE_ID,
} from "@/lib/cooperatives/demo-cooperative";
import type { QuotePriceMasterFeeSeed } from "@/lib/quotes/cooperative-quote-price-master-workbook";
import { safeMinFromPlanned } from "@/lib/quotes/cooperative-quote-price-master-pricing";
import type { WonAmount } from "@/lib/audit-evaluation/types";

/** 견적 마스터 엑셀·신청 테스트용 농협 (예정견적 850만원부터 100만원씩 증가) */
export const QUOTE_PRICE_MASTER_TEST_COOPERATIVES = [
  {
    cooperativeId: JAEGYEONG_COOPERATIVE_ID,
    cooperativeName: "재경농협",
    plannedAuditFeeWon: "8500000",
  },
  {
    cooperativeId: SEONGMIN_COOPERATIVE_ID,
    cooperativeName: "성민농협",
    plannedAuditFeeWon: "9500000",
  },
  {
    cooperativeId: DUNGGI_COOPERATIVE_ID,
    cooperativeName: "둥기농협",
    plannedAuditFeeWon: "10500000",
  },
  {
    cooperativeId: JIHYE_COOPERATIVE_ID,
    cooperativeName: "지혜농협",
    plannedAuditFeeWon: "11500000",
  },
  {
    cooperativeId: PRIGO_COOPERATIVE_ID,
    cooperativeName: "프리고농협",
    plannedAuditFeeWon: "12500000",
  },
] as const;

export function quotePriceMasterTestFeeSeeds(): QuotePriceMasterFeeSeed[] {
  return QUOTE_PRICE_MASTER_TEST_COOPERATIVES.map((item) => ({
    cooperativeName: item.cooperativeName,
    priorAuditorName: "테스트",
    plannedAuditFeeWon: item.plannedAuditFeeWon,
    safePriceMinWon: safeMinFromPlanned(
      item.plannedAuditFeeWon as WonAmount,
    ),
  }));
}

export function mergeTemplateCooperativesWithTestRows(
  cooperatives: Array<{ cooperativeId: string; cooperativeName: string }>,
) {
  const byId = new Map(
    cooperatives.map((item) => [item.cooperativeId, item] as const),
  );
  for (const item of QUOTE_PRICE_MASTER_TEST_COOPERATIVES) {
    byId.set(item.cooperativeId, {
      cooperativeId: item.cooperativeId,
      cooperativeName: item.cooperativeName,
    });
  }
  return [...byId.values()];
}
