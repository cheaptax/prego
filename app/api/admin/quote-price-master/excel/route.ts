import { NextResponse } from "next/server";
import {
  COOPERATIVE_MASTER_COLLECTION,
  COOPERATIVE_MASTER_CONFIG_COLLECTION,
  COOPERATIVE_MASTER_CONFIG_ID,
  parseProductionCooperativeMaster,
} from "@/lib/cooperatives/master";
import { adminDb } from "@/lib/firebase/admin";
import type { PartnerRecord } from "@/lib/firebase/schema";
import {
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
} from "@/lib/firebase/server";
import { isPartnerActive } from "@/lib/partners";
import { nonghyupMaster } from "@/lib/platform";
import { isPartnerEligibleForAuditQuote } from "@/lib/quotes/audit-quote-assignment";
import {
  buildQuotePriceMasterWorkbook,
} from "@/lib/quotes/cooperative-quote-price-master-excel";
import {
  listSavedPartnerPricesForFiscalYear,
} from "@/lib/quotes/cooperative-quote-price-master-repository";
import type {
  CooperativeQuotePriceMasterRow,
} from "@/lib/quotes/cooperative-quote-price-master-types";
import feeSeeds from "@/lib/quotes/data/quote-price-master-fee-seed.json";
import {
  mergeTemplateCooperativesWithTestRows,
  quotePriceMasterTestFeeSeeds,
} from "@/lib/quotes/quote-price-master-test-cooperatives";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function listTemplateCooperatives() {
  const db = adminDb();
  const config = await db
    .collection(COOPERATIVE_MASTER_CONFIG_COLLECTION)
    .doc(COOPERATIVE_MASTER_CONFIG_ID)
    .get();
  if (config.exists && config.data()?.status === "ACTIVE") {
    const snapshot = await db.collection(COOPERATIVE_MASTER_COLLECTION).get();
    const fromFirestore = snapshot.docs.flatMap((document) => {
      const record = parseProductionCooperativeMaster(document.data());
      if (!record || record.status !== "active") return [];
      return [
        {
          cooperativeId: record.cooperativeId,
          cooperativeName: record.cooperativeName,
        },
      ];
    });
    if (fromFirestore.length > 0) return fromFirestore;
  }
  return nonghyupMaster
    .filter((item) => item.status === "active")
    .map((item) => ({
      cooperativeId: item.cooperative_id,
      cooperativeName: item.cooperative_name,
    }));
}

async function listTemplatePartners() {
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

export async function GET(request: Request) {
  try {
    await requireAdminCapability(request, "auditQuotes:read");
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }
  const url = new URL(request.url);
  const fiscalYear = Number(
    url.searchParams.get("fiscalYear") ?? new Date().getFullYear() + 1,
  );
  if (!Number.isSafeInteger(fiscalYear) || fiscalYear < 2020 || fiscalYear > 2100) {
    return NextResponse.json(
      { ok: false, error: "invalid_fiscal_year" },
      { status: 400 },
    );
  }

  const [cooperativesRaw, partners, savedPrices] = await Promise.all([
    listTemplateCooperatives(),
    listTemplatePartners(),
    listSavedPartnerPricesForFiscalYear(fiscalYear),
  ]);
  const cooperatives = mergeTemplateCooperativesWithTestRows(cooperativesRaw);

  const savedByCooperative = new Map<string, CooperativeQuotePriceMasterRow>();
  for (const price of savedPrices) {
    const key = `${price.fiscalYear}_${price.cooperativeId}`;
    const existing = savedByCooperative.get(key);
    if (existing) {
      existing.prices.push(price);
      continue;
    }
    savedByCooperative.set(key, {
      plan: {
        id: key,
        fiscalYear: price.fiscalYear,
        cooperativeId: price.cooperativeId,
        cooperativeName: price.cooperativeName,
        plannedWinnerPartnerId: price.isPlannedWinner ? price.partnerId : null,
        notes: "",
        updatedBy: price.updatedBy,
        updatedByEmail: price.updatedByEmail,
        createdAt: price.createdAt,
        updatedAt: price.updatedAt,
      },
      prices: [price],
    });
  }

  const buffer = await buildQuotePriceMasterWorkbook({
    fiscalYear,
    cooperatives,
    partners,
    savedRows: [...savedByCooperative.values()],
    feeSeeds: [...feeSeeds, ...quotePriceMasterTestFeeSeeds()],
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="quote-price-master-${fiscalYear}.xlsx"`,
      "cache-control": "private, no-store",
      "content-length": String(buffer.byteLength),
    },
  });
}
