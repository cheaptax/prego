import type { PartnerRecord } from "@/lib/firebase/schema";
import { isPartnerActive } from "@/lib/partners";
import { isPartnerEligibleForAuditQuote } from "@/lib/quotes/audit-quote-assignment";
import {
  nonSelectedMasterPriceFields,
  orderNonSelectedPartners,
} from "@/lib/quotes/cooperative-quote-price-master-pricing";
import type {
  CooperativeQuotePartnerPrice,
  CooperativeQuotePriceMasterRow,
} from "@/lib/quotes/cooperative-quote-price-master-types";

export type AdminProxySendTarget = {
  partner: PartnerRecord;
  price: CooperativeQuotePartnerPrice;
  priceSource: "master" | "synthesized";
};

export function isActiveAuditPartner(partner: PartnerRecord) {
  return isPartnerActive(partner) && isPartnerEligibleForAuditQuote(partner);
}

export function plannedWinnerPrice(master: CooperativeQuotePriceMasterRow) {
  return (
    master.prices.find((price) => price.isPlannedWinner) ??
    master.prices.find(
      (price) => price.partnerId === master.plan.plannedWinnerPartnerId,
    ) ??
    null
  );
}

/**
 * Button-time send roster: every currently active audit partner.
 * Master prices are reused when present; missing partners get the next
 * 비선정 step (110%, 115%, 120%…) from the planned-winner fee.
 */
export function resolveAdminProxySendTargets(input: {
  master: CooperativeQuotePriceMasterRow;
  activePartners: readonly PartnerRecord[];
}): AdminProxySendTarget[] {
  const winnerPrice = plannedWinnerPrice(input.master);
  if (!winnerPrice) return [];

  const active = input.activePartners.filter(isActiveAuditPartner);
  const priceByPartner = new Map(
    input.master.prices.map((price) => [price.partnerId, price]),
  );
  const winnerPartner = active.find(
    (partner) => partner.id === winnerPrice.partnerId,
  );
  const remaining = orderNonSelectedPartners(
    active
      .filter((partner) => partner.id !== winnerPrice.partnerId)
      .map((partner) => ({
        id: partner.id,
        name: partner.displayName || partner.name,
      })),
    input.master.prices
      .filter((price) => price.partnerId !== winnerPrice.partnerId)
      .map((price) => price.partnerId),
  );
  const ordered = [
    ...(winnerPartner ? [winnerPartner] : []),
    ...remaining.flatMap((ref) => {
      const partner = active.find((item) => item.id === ref.id);
      return partner ? [partner] : [];
    }),
  ];

  let nextSyntheticIndex = input.master.prices.filter(
    (price) => !price.isPlannedWinner && price.partnerId !== winnerPrice.partnerId,
  ).length;

  return ordered.map((partner) => {
    const existing = priceByPartner.get(partner.id);
    if (existing) {
      return { partner, price: existing, priceSource: "master" as const };
    }
    const index = nextSyntheticIndex;
    nextSyntheticIndex += 1;
    const fields = nonSelectedMasterPriceFields({
      plannedWinnerFeeWon: winnerPrice.plannedAuditFeeWon,
      index,
    });
    return {
      partner,
      price: {
        id: `${winnerPrice.fiscalYear}_${winnerPrice.cooperativeId}_${partner.id}`,
        fiscalYear: winnerPrice.fiscalYear,
        cooperativeId: winnerPrice.cooperativeId,
        cooperativeName: winnerPrice.cooperativeName,
        partnerId: partner.id,
        partnerName: partner.displayName || partner.name,
        ...fields,
        updatedBy: "system",
        createdAt: winnerPrice.updatedAt,
        updatedAt: winnerPrice.updatedAt,
      },
      priceSource: "synthesized" as const,
    };
  });
}
