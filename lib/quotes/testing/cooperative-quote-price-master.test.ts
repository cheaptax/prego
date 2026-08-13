import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cooperativeQuotePricePlanInputSchema,
} from "@/lib/quotes/cooperative-quote-price-master-schemas";
import {
  NON_SELECTED_FEE_BPS,
  nonSelectedFeeFromPlanned,
  safeMinFromPlanned,
} from "@/lib/quotes/cooperative-quote-price-master-pricing";
import {
  buildQuotePriceMasterWorkbook,
  parseQuotePriceMasterWorkbook,
  QUOTE_PRICE_MASTER_EXCEL_HEADERS,
} from "@/lib/quotes/cooperative-quote-price-master-workbook";

describe("cooperative quote price master validation", () => {
  it("accepts one planned winner within the safe price band", () => {
    const result = cooperativeQuotePricePlanInputSchema.safeParse({
      fiscalYear: 2027,
      cooperativeId: "coop-1",
      cooperativeName: "테스트농협",
      plannedWinnerPartnerId: "partner-1",
      notes: "",
      partnerPrices: [
        row("partner-1", true, {
          planned: "10000000",
          min: "9000000",
          max: "11000000",
        }),
        row("partner-2", false, {
          planned: "11000000",
          min: "10000000",
          max: "12000000",
        }),
      ],
    });
    assert.equal(result.success, true);
  });

  it("rejects duplicate planned winners and prices outside the safe band", () => {
    const result = cooperativeQuotePricePlanInputSchema.safeParse({
      fiscalYear: 2027,
      cooperativeId: "coop-1",
      cooperativeName: "테스트농협",
      plannedWinnerPartnerId: "partner-1",
      notes: "",
      partnerPrices: [
        row("partner-1", true, {
          planned: "8000000",
          min: "9000000",
          max: "11000000",
        }),
        row("partner-2", true, {
          planned: "11000000",
          min: "10000000",
          max: "12000000",
        }),
      ],
    });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(
        result.error.issues.some(
          (issue) => issue.message === "multiple_planned_winners",
        ),
      );
      assert.ok(
        result.error.issues.some(
          (issue) => issue.message === "planned_fee_outside_safe_range",
        ),
      );
    }
  });

  it("builds wide 시트9 headers and parses selected partner names", async () => {
    assert.deepEqual([...QUOTE_PRICE_MASTER_EXCEL_HEADERS], [
      "cooperativeId",
      "농협명",
      "25년감사인",
      "예정견적",
      "최저안전견적",
      "제휴사_선정",
      "제휴사_비선정1",
      "제휴사_비선정2",
    ]);
    assert.equal(safeMinFromPlanned("19900000" as never), "17900000");
    assert.equal(
      nonSelectedFeeFromPlanned("19900000" as never, NON_SELECTED_FEE_BPS[0]),
      "21900000",
    );
    assert.equal(
      nonSelectedFeeFromPlanned("19900000" as never, NON_SELECTED_FEE_BPS[1]),
      "22900000",
    );

    const buffer = await buildQuotePriceMasterWorkbook({
      fiscalYear: 2027,
      cooperatives: [
        { cooperativeId: "coop-001", cooperativeName: "가농협" },
        { cooperativeId: "coop-002", cooperativeName: "나농협" },
      ],
      partners: [
        { id: "partner-a", name: "A회계법인" },
        { id: "partner-b", name: "B회계법인" },
        { id: "partner-c", name: "C회계법인" },
      ],
      savedRows: [
        {
          plan: {
            id: "2027_coop-001",
            fiscalYear: 2027,
            cooperativeId: "coop-001",
            cooperativeName: "가농협",
            plannedWinnerPartnerId: "partner-a",
            notes: "priorAuditor:예인",
            updatedBy: "tester",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          prices: [
            {
              id: "p1",
              fiscalYear: 2027,
              cooperativeId: "coop-001",
              cooperativeName: "가농협",
              partnerId: "partner-a",
              partnerName: "A회계법인",
              plannedAuditFeeWon: "19900000" as never,
              expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
              expectedExpenseWon: "0" as never,
              safePriceMinWon: "17900000" as never,
              safePriceMaxWon: "19900000" as never,
              isPlannedWinner: true,
              locked: false,
              updatedBy: "tester",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
    });
    assert.equal(buffer.subarray(0, 2).toString("utf8"), "PK");
    const rows = await parseQuotePriceMasterWorkbook(buffer);
    const hit = rows.find((row) => row.cooperativeName === "가농협");
    assert.ok(hit);
    assert.equal(hit?.priorAuditorName, "예인");
    assert.equal(hit?.plannedAuditFeeWon, "19900000");
    assert.equal(hit?.selectedPartnerName, "A회계법인");
    assert.ok(hit?.nonSelectedPartnerName1);
    assert.ok(hit?.nonSelectedPartnerName2);

    const seeded = await buildQuotePriceMasterWorkbook({
      fiscalYear: 2027,
      cooperatives: [
        { cooperativeId: "coop-001", cooperativeName: "서울축산농협" },
      ],
      partners: [
        { id: "partner-a", name: "A회계법인" },
        { id: "partner-b", name: "B회계법인" },
      ],
      feeSeeds: [
        {
          cooperativeName: "서울축산농협",
          priorAuditorName: "예인",
          plannedAuditFeeWon: "19900000",
          safePriceMinWon: "17900000",
        },
      ],
    });
    const seededRows = await parseQuotePriceMasterWorkbook(seeded);
    assert.equal(seededRows[0]?.plannedAuditFeeWon, "19900000");
    assert.equal(seededRows[0]?.priorAuditorName, "예인");
    assert.equal(seededRows[0]?.selectedPartnerName, "");
  });

  it("seeds test cooperatives from 850만원 stepping by 100만원", async () => {
    const {
      QUOTE_PRICE_MASTER_TEST_COOPERATIVES,
      quotePriceMasterTestFeeSeeds,
    } = await import("@/lib/quotes/quote-price-master-test-cooperatives");
    assert.deepEqual(
      QUOTE_PRICE_MASTER_TEST_COOPERATIVES.map((item) => [
        item.cooperativeName,
        item.plannedAuditFeeWon,
      ]),
      [
        ["재경농협", "8500000"],
        ["성민농협", "9500000"],
        ["둥기농협", "10500000"],
        ["지혜농협", "11500000"],
        ["프리고농협", "12500000"],
      ],
    );
    const seeds = quotePriceMasterTestFeeSeeds();
    assert.equal(seeds[0]?.safePriceMinWon, "7700000");
    assert.equal(seeds[4]?.safePriceMinWon, "11300000");
  });
});

function row(
  partnerId: string,
  isPlannedWinner: boolean,
  fees: { planned: string; min: string; max: string },
) {
  return {
    cooperativeId: "coop-1",
    cooperativeName: "테스트농협",
    partnerId,
    partnerName: partnerId,
    plannedAuditFeeWon: fees.planned,
    expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
    expectedExpenseWon: "0",
    safePriceMinWon: fees.min,
    safePriceMaxWon: fees.max,
    isPlannedWinner,
  };
}
