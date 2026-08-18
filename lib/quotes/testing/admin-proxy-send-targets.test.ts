import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeWonAmount } from "@/lib/audit-evaluation/money";
import type { PartnerRecord } from "@/lib/firebase/schema";
import { resolveAdminProxySendTargets } from "@/lib/quotes/admin-proxy-send-targets";
import {
  nonSelectedFeeBps,
  nonSelectedFeeFromPlanned,
  orderNonSelectedPartners,
} from "@/lib/quotes/cooperative-quote-price-master-pricing";
import type {
  CooperativeQuotePartnerPrice,
  CooperativeQuotePriceMasterRow,
} from "@/lib/quotes/cooperative-quote-price-master-types";

describe("admin proxy send targets", () => {
  it("steps non-selected fees at 110%, 115%, 120%, 125%", () => {
    assert.equal(nonSelectedFeeBps(0), 11_000n);
    assert.equal(nonSelectedFeeBps(1), 11_500n);
    assert.equal(nonSelectedFeeBps(2), 12_000n);
    assert.equal(nonSelectedFeeBps(3), 12_500n);
    assert.equal(
      nonSelectedFeeFromPlanned("10000000" as never, nonSelectedFeeBps(2)),
      "12000000",
    );
  });

  it("keeps preferred non-selected partners then appends the rest by name", () => {
    assert.deepEqual(
      orderNonSelectedPartners(
        [
          { id: "inseong", name: "인성회계법인" },
          { id: "sangji", name: "상지회계법인" },
          { id: "seyeon", name: "세연회계법인" },
        ],
        ["seyeon"],
      ).map((item) => item.id),
      ["seyeon", "sangji", "inseong"],
    );
  });

  it("sends every active audit partner, synthesizing prices past the old 2-slot cap", () => {
    const master = masterRow([
      price("테스트", true, "8500000"),
      price("프리고테", false, "9350000"),
      price("세연", false, "9780000"),
    ]);
    const targets = resolveAdminProxySendTargets({
      master,
      activePartners: [
        partner("테스트", "테스트회계법인"),
        partner("프리고테", "프리고테회계법인"),
        partner("세연", "세연회계법인"),
        partner("인성", "인성회계법인"),
        partner("상지", "상지회계법인"),
        partner("종료", "종료회계법인", { status: "terminated" }),
      ],
    });

    assert.deepEqual(
      targets.map((item) => item.partner.id),
      ["테스트", "프리고테", "세연", "상지", "인성"],
    );
    assert.equal(targets[0]?.priceSource, "master");
    assert.equal(targets[0]?.price.isPlannedWinner, true);
    assert.equal(targets[3]?.priceSource, "synthesized");
    assert.equal(targets[4]?.priceSource, "synthesized");
    assert.equal(targets[3]?.price.plannedAuditFeeWon, "10200000");
    assert.equal(targets[4]?.price.plannedAuditFeeWon, "10600000");
  });

  it("proxy-send uses live active partners instead of the 2-slot master cap", () => {
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../..",
    );
    const src = readFileSync(
      path.join(root, "app/api/admin/audit-quotes/proxy-send/route.ts"),
      "utf8",
    );
    assert.match(src, /resolveAdminProxySendTargets/);
    assert.match(src, /loadActiveAuditPartners/);
    assert.equal(src.includes("slice(0, 2)"), false);
  });
});

function partner(
  id: string,
  name: string,
  overrides: Partial<PartnerRecord> = {},
): PartnerRecord {
  const now = "2026-08-19T00:00:00.000Z";
  return {
    id,
    name,
    displayName: name,
    partnerType: "corporation",
    profession: "ACCOUNTANT",
    fields: ["감사"],
    managerName: "담당",
    contactEmail: `${id}@example.com`,
    contactPhone: "010-0000-0000",
    status: "active",
    pointMin: 0,
    pointMax: 100,
    createdBy: "admin",
    createdAt: now,
    updatedBy: "admin",
    updatedAt: now,
    ...overrides,
  };
}

function price(
  partnerId: string,
  isPlannedWinner: boolean,
  planned: string,
): CooperativeQuotePartnerPrice {
  const now = "2026-08-19T00:00:00.000Z";
  return {
    id: `2027_jaegyeong_${partnerId}`,
    fiscalYear: 2027,
    cooperativeId: "jaegyeong",
    cooperativeName: "재경농협",
    partnerId,
    partnerName: `${partnerId}회계법인`,
    plannedAuditFeeWon: normalizeWonAmount(BigInt(planned)),
    expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
    expectedExpenseWon: normalizeWonAmount(0n),
    safePriceMinWon: normalizeWonAmount((BigInt(planned) * 90n) / 100n),
    safePriceMaxWon: normalizeWonAmount(BigInt(planned)),
    isPlannedWinner,
    locked: false,
    updatedBy: "admin",
    createdAt: now,
    updatedAt: now,
  };
}

function masterRow(
  prices: CooperativeQuotePartnerPrice[],
): CooperativeQuotePriceMasterRow {
  const winner = prices.find((item) => item.isPlannedWinner)!;
  return {
    plan: {
      id: "2027_jaegyeong",
      fiscalYear: 2027,
      cooperativeId: "jaegyeong",
      cooperativeName: "재경농협",
      plannedWinnerPartnerId: winner.partnerId,
      notes: "",
      updatedBy: "admin",
      createdAt: winner.createdAt,
      updatedAt: winner.updatedAt,
    },
    prices,
  };
}
