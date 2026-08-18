import "server-only";

import {
  COOPERATIVE_MASTER_COLLECTION,
  COOPERATIVE_MASTER_CONFIG_COLLECTION,
  COOPERATIVE_MASTER_CONFIG_ID,
  normalizeCooperativeSearchText,
  parseProductionCooperativeMaster,
} from "@/lib/cooperatives/master";
import { adminDb } from "@/lib/firebase/admin";
import type { PartnerRecord } from "@/lib/firebase/schema";
import { isPartnerActive } from "@/lib/partners";
import { nonghyupMaster } from "@/lib/platform";
import { isPartnerEligibleForAuditQuote } from "@/lib/quotes/audit-quote-assignment";
import {
  nonSelectedMasterPriceFields,
  normalizePartnerMatchKey,
  orderNonSelectedPartners,
  safeMinFromPlanned,
} from "@/lib/quotes/cooperative-quote-price-master-pricing";
import type {
  QuotePriceMasterExcelRow,
  QuotePriceMasterExcelValidation,
} from "@/lib/quotes/cooperative-quote-price-master-workbook";
import type { WonAmount } from "@/lib/audit-evaluation/types";

export {
  buildQuotePriceMasterWorkbook,
  parseQuotePriceMasterWorkbook,
  type QuotePriceMasterExcelCooperative,
  type QuotePriceMasterExcelPartner,
  type QuotePriceMasterExcelRow,
  type QuotePriceMasterExcelValidation,
} from "@/lib/quotes/cooperative-quote-price-master-workbook";

export type ResolvedWideMasterPayload = {
  fiscalYear: number;
  cooperativeId: string;
  cooperativeName: string;
  plannedWinnerPartnerId: string;
  notes: string;
  partnerPrices: Array<{
    cooperativeId: string;
    cooperativeName: string;
    partnerId: string;
    partnerName: string;
    plannedAuditFeeWon: WonAmount;
    expenseBillingMode: "INCLUDED_IN_AUDIT_FEE";
    expectedExpenseWon: WonAmount;
    safePriceMinWon: WonAmount;
    safePriceMaxWon: WonAmount;
    isPlannedWinner: boolean;
    locked: boolean;
  }>;
};

type CooperativeRef = {
  cooperativeId: string;
  cooperativeName: string;
};

type CooperativeLookup = {
  byId: Map<string, CooperativeRef>;
  byName: Map<string, CooperativeRef>;
};

export async function validateQuotePriceMasterExcelRows(
  rows: QuotePriceMasterExcelRow[],
  _fiscalYear: number,
): Promise<QuotePriceMasterExcelValidation> {
  const errors: QuotePriceMasterExcelValidation["errors"] = [];
  const fillableRows = rows.filter(
    (row) =>
      row.plannedAuditFeeWon ||
      row.selectedPartnerName ||
      row.safePriceMinWon,
  );
  const [partners, cooperatives] = await Promise.all([
    loadEligiblePartners(),
    loadCooperativeLookup(),
  ]);
  for (const row of fillableRows) {
    const rowErrors: string[] = [];
    const cooperative = resolveCooperativeFromLookup(cooperatives, row);
    if (!cooperative) rowErrors.push("cooperative_not_found");
    if (!row.plannedAuditFeeWon) rowErrors.push("invalid_price");
    const selected = resolvePartnerByName(partners, row.selectedPartnerName);
    if (!selected) rowErrors.push("selected_partner_not_found");
    if (
      row.safePriceMinWon &&
      row.plannedAuditFeeWon &&
      BigInt(row.safePriceMinWon) > BigInt(row.plannedAuditFeeWon)
    ) {
      rowErrors.push("safe_price_max_below_min");
    }
    for (const code of rowErrors) {
      errors.push({ rowNumber: row.rowNumber, code, message: code });
    }
  }
  const errorRows = new Set(errors.map((error) => error.rowNumber));
  const validRows = fillableRows.filter((row) => !errorRows.has(row.rowNumber));
  return {
    ok: errors.length === 0,
    validRows,
    errors,
    summary: {
      totalRows: rows.length,
      validRows: validRows.length,
      errorRows: errorRows.size,
      cooperativeCount: new Set(validRows.map((row) => row.cooperativeName)).size,
      partnerCount: new Set(
        validRows.map((row) => row.selectedPartnerName).filter(Boolean),
      ).size,
    },
  };
}

export async function buildPayloadsFromWideExcelRows(input: {
  rows: QuotePriceMasterExcelRow[];
  fiscalYear: number;
}): Promise<ResolvedWideMasterPayload[]> {
  const [partners, cooperatives] = await Promise.all([
    loadEligiblePartners(),
    loadCooperativeLookup(),
  ]);
  const payloads: ResolvedWideMasterPayload[] = [];
  for (const row of input.rows) {
    const cooperative = resolveCooperativeFromLookup(cooperatives, row);
    const selected = resolvePartnerByName(partners, row.selectedPartnerName);
    if (!cooperative || !selected || !row.plannedAuditFeeWon) continue;
    const planned = row.plannedAuditFeeWon;
    const safeMin = row.safePriceMinWon ?? safeMinFromPlanned(planned);
    const namedNonSelected = [
      row.nonSelectedPartnerName1,
      row.nonSelectedPartnerName2,
    ]
      .map((name) => resolvePartnerByName(partners, name))
      .filter((partner): partner is { id: string; name: string } =>
        Boolean(partner && partner.id !== selected.id),
      );
    const uniqueNamed = [
      ...new Map(namedNonSelected.map((item) => [item.id, item])).values(),
    ];
    const remaining = partners.filter((partner) => partner.id !== selected.id);
    const nonSelected = orderNonSelectedPartners(
      remaining,
      uniqueNamed.map((item) => item.id),
    );

    payloads.push({
      fiscalYear: input.fiscalYear,
      cooperativeId: cooperative.cooperativeId,
      cooperativeName: cooperative.cooperativeName,
      plannedWinnerPartnerId: selected.id,
      notes: row.priorAuditorName
        ? `priorAuditor:${row.priorAuditorName}`
        : "",
      partnerPrices: [
        {
          cooperativeId: cooperative.cooperativeId,
          cooperativeName: cooperative.cooperativeName,
          partnerId: selected.id,
          partnerName: selected.name,
          plannedAuditFeeWon: planned,
          expenseBillingMode: "INCLUDED_IN_AUDIT_FEE" as const,
          expectedExpenseWon: "0" as WonAmount,
          safePriceMinWon: safeMin,
          safePriceMaxWon: planned,
          isPlannedWinner: true,
          locked: false,
        },
        ...nonSelected.map((partner, index) => ({
          cooperativeId: cooperative.cooperativeId,
          cooperativeName: cooperative.cooperativeName,
          partnerId: partner.id,
          partnerName: partner.name,
          ...nonSelectedMasterPriceFields({
            plannedWinnerFeeWon: planned,
            index,
          }),
        })),
      ],
    });
  }
  return payloads;
}

async function loadEligiblePartners() {
  const snapshot = await adminDb().collection("partners").limit(500).get();
  return snapshot.docs
    .map((document) => ({
      ...(document.data() as PartnerRecord),
      id: document.id,
    }))
    .filter(
      (partner) =>
        isPartnerActive(partner) && isPartnerEligibleForAuditQuote(partner),
    )
    .map((partner) => ({
      id: partner.id,
      name: partner.displayName || partner.name,
    }));
}

async function loadCooperativeLookup(): Promise<CooperativeLookup> {
  const byId = new Map<string, CooperativeRef>();
  const byName = new Map<string, CooperativeRef>();
  const add = (cooperativeId: string, cooperativeName: string) => {
    const ref = { cooperativeId, cooperativeName };
    byId.set(cooperativeId, ref);
    const key = normalizeCooperativeSearchText(cooperativeName);
    if (key && !byName.has(key)) byName.set(key, ref);
  };

  const config = await adminDb()
    .collection(COOPERATIVE_MASTER_CONFIG_COLLECTION)
    .doc(COOPERATIVE_MASTER_CONFIG_ID)
    .get();
  if (config.exists && config.data()?.status === "ACTIVE") {
    const snapshot = await adminDb().collection(COOPERATIVE_MASTER_COLLECTION).get();
    for (const document of snapshot.docs) {
      const record = parseProductionCooperativeMaster(document.data());
      if (!record || record.status !== "active") continue;
      add(record.cooperativeId, record.cooperativeName);
    }
  }
  if (byId.size === 0) {
    for (const item of nonghyupMaster) {
      if (item.status !== "active") continue;
      add(item.cooperative_id, item.cooperative_name);
    }
  }
  return { byId, byName };
}

function resolveCooperativeFromLookup(
  lookup: CooperativeLookup,
  row: QuotePriceMasterExcelRow,
): CooperativeRef | null {
  if (row.cooperativeId) {
    const byId = lookup.byId.get(row.cooperativeId);
    if (byId) return byId;
    // Template ids are authoritative even if master snapshot lagged.
    if (row.cooperativeName.trim()) {
      return {
        cooperativeId: row.cooperativeId,
        cooperativeName: row.cooperativeName.trim(),
      };
    }
  }
  const name = row.cooperativeName.trim();
  if (!name) return null;
  return lookup.byName.get(normalizeCooperativeSearchText(name)) ?? null;
}

function resolvePartnerByName(
  partners: Array<{ id: string; name: string }>,
  name: string,
) {
  const key = normalizePartnerMatchKey(name);
  if (!key) return null;
  return (
    partners.find((partner) => normalizePartnerMatchKey(partner.name) === key) ??
    partners.find((partner) =>
      normalizePartnerMatchKey(partner.name).includes(key),
    ) ??
    partners.find((partner) =>
      key.includes(normalizePartnerMatchKey(partner.name)),
    ) ??
    null
  );
}
