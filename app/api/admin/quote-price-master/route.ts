import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import type { PartnerRecord } from "@/lib/firebase/schema";
import {
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
} from "@/lib/firebase/server";
import { isPartnerActive } from "@/lib/partners";
import { isPartnerEligibleForAuditQuote } from "@/lib/quotes/audit-quote-assignment";
import type { WonAmount } from "@/lib/audit-evaluation/types";
import {
  nonSelectedMasterPriceFields,
  orderNonSelectedPartners,
  safeMinFromPlanned,
} from "@/lib/quotes/cooperative-quote-price-master-pricing";
import {
  listCooperativeQuotePriceMaster,
  saveCooperativeQuotePriceMaster,
} from "@/lib/quotes/cooperative-quote-price-master-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAdminCapability(request, "auditQuotes:read");
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }
  try {
    const url = new URL(request.url);
    const fiscalYear = Number(
      url.searchParams.get("fiscalYear") ?? new Date().getFullYear() + 1,
    );
    if (!Number.isSafeInteger(fiscalYear)) {
      return NextResponse.json(
        { ok: false, error: "invalid_fiscal_year" },
        { status: 400 },
      );
    }
    const [rows, partnersSnapshot] = await Promise.all([
      listCooperativeQuotePriceMaster({
        fiscalYear,
        cooperativeId: url.searchParams.get("cooperativeId") || undefined,
        pageSize: Number(url.searchParams.get("pageSize") ?? 50),
      }),
      adminDb().collection("partners").limit(300).get(),
    ]);
    const partners = partnersSnapshot.docs
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
        contactEmail: partner.contactEmail,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "ko"));
    return NextResponse.json(
      { ok: true, rows, partners },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[quote-price-master] list_failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: "list_failed",
        message: error instanceof Error ? error.message : "list_failed",
      },
      { status: 500 },
    );
  }
}

type WideSaveBody = {
  fiscalYear?: number;
  cooperativeId?: string;
  cooperativeName?: string;
  priorAuditorName?: string;
  plannedAuditFeeWon?: string;
  safePriceMinWon?: string;
  selectedPartnerId?: string;
  keepExistingNonSelected?: boolean;
};

export async function PUT(request: Request) {
  let admin;
  try {
    admin = await requireAdminCapability(request, "auditQuotes:write");
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }
  const body = (await request.json().catch(() => null)) as WideSaveBody | null;
  const fiscalYear = Number(body?.fiscalYear);
  const cooperativeId = String(body?.cooperativeId ?? "").trim();
  const cooperativeName = String(body?.cooperativeName ?? "").trim();
  const selectedPartnerId = String(body?.selectedPartnerId ?? "").trim();
  const planned = String(body?.plannedAuditFeeWon ?? "").replace(/\D/gu, "");
  if (
    !Number.isSafeInteger(fiscalYear) ||
    !cooperativeId ||
    !cooperativeName ||
    !selectedPartnerId ||
    !planned
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid_input" },
      { status: 400 },
    );
  }

  const partnersSnapshot = await adminDb().collection("partners").limit(500).get();
  const partners = partnersSnapshot.docs
    .map((document) => ({ ...(document.data() as PartnerRecord), id: document.id }))
    .filter(
      (partner) =>
        isPartnerActive(partner) && isPartnerEligibleForAuditQuote(partner),
    );
  const selected = partners.find((partner) => partner.id === selectedPartnerId);
  if (!selected) {
    return NextResponse.json(
      { ok: false, error: "invalid_partner" },
      { status: 400 },
    );
  }

  const existing = await listCooperativeQuotePriceMaster({
    fiscalYear,
    cooperativeId,
    pageSize: 1,
  });
  const existingNonSelected =
    body?.keepExistingNonSelected === true
      ? (existing[0]?.prices ?? []).filter(
          (price) => !price.isPlannedWinner && price.partnerId !== selected.id,
        )
      : [];

  const remaining = partners
    .filter((partner) => partner.id !== selected.id)
    .map((partner) => ({
      id: partner.id,
      name: partner.displayName || partner.name,
    }));
  const nonSelected = orderNonSelectedPartners(
    remaining,
    body?.keepExistingNonSelected === true
      ? existingNonSelected.map((price) => price.partnerId)
      : [],
  );

  const plannedWon = planned as WonAmount;
  const safeMin = (String(body?.safePriceMinWon ?? "").replace(/\D/gu, "") ||
    safeMinFromPlanned(plannedWon)) as WonAmount;

  const result = await saveCooperativeQuotePriceMaster({
    payload: {
      fiscalYear,
      cooperativeId,
      cooperativeName,
      plannedWinnerPartnerId: selected.id,
      notes: body?.priorAuditorName
        ? `priorAuditor:${String(body.priorAuditorName).trim()}`
        : "",
      partnerPrices: [
        {
          cooperativeId,
          cooperativeName,
          partnerId: selected.id,
          partnerName: selected.displayName || selected.name,
          plannedAuditFeeWon: plannedWon,
          expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
          expectedExpenseWon: "0",
          safePriceMinWon: safeMin,
          safePriceMaxWon: plannedWon,
          isPlannedWinner: true,
          locked: false,
        },
        ...nonSelected.map((partner, index) => {
          const kept =
            body?.keepExistingNonSelected === true
              ? existingNonSelected.find((price) => price.partnerId === partner.id)
              : null;
          return {
            cooperativeId,
            cooperativeName,
            partnerId: partner.id,
            partnerName: partner.name,
            ...(kept
              ? {
                  plannedAuditFeeWon: kept.plannedAuditFeeWon,
                  expenseBillingMode: kept.expenseBillingMode,
                  expectedExpenseWon: kept.expectedExpenseWon,
                  safePriceMinWon: kept.safePriceMinWon,
                  safePriceMaxWon: kept.safePriceMaxWon,
                  isPlannedWinner: false,
                  locked: kept.locked,
                }
              : nonSelectedMasterPriceFields({
                  plannedWinnerFeeWon: plannedWon,
                  index,
                })),
          };
        }),
      ],
    },
    actor: { uid: admin.uid, email: admin.email },
    now: new Date().toISOString(),
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, issues: result.issues },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, row: result.row });
}
