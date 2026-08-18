import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySafePriceAdjustments,
  externalManualQuoteAsEvaluationQuote,
} from "@/lib/quotes/safe-price-adjustment";
import type {
  ExternalManualQuoteRecord,
  QuoteAutomationPartnerPreset,
} from "@/lib/quotes/quote-automation-types";
import {
  buildTrustedNhAuditSubmissionV2,
  createNhAuditEvaluationSnapshotV2,
} from "@/lib/quotes/nh-audit-quote-server";
import type { QuoteRecord } from "@/lib/firebase/schema";

const NOW = "2026-08-12T00:00:00.000Z";

describe("safe price adjustment", () => {
  it("sets the selected partner to 타 제휴사 최저가 − 300,000원, not current fee − 300,000원", () => {
    const partnerQuote = partnerQuoteFixture("12000000");
    const external = externalRecord("10000000");
    const preset = presetFor(partnerQuote, {
      planned: "12000000",
      min: "8000000",
      max: "13000000",
      winner: true,
    });
    const result = applySafePriceAdjustments({
      caseId: "case-1",
      quoteRequestId: "req-1",
      reportId: "report-1",
      partnerQuotes: [partnerQuote],
      externalQuotes: [external],
      presets: [preset],
      now: NOW,
    });
    assert.equal(result.events.length, 1);
    assert.equal(
      result.quotes[0]?.nhAuditV2?.submission.auditFeeWon,
      "9700000",
    );
    assert.equal(result.selectedPartnerId, partnerQuote.partnerId);
  });

  it("rounds adjusted audit fees to 100,000원", () => {
    const partnerQuote = partnerQuoteFixture("12000000");
    const external = externalRecord("10050000");
    const preset = presetFor(partnerQuote, {
      planned: "12000000",
      min: "8000000",
      max: "13000000",
      winner: true,
    });
    const result = applySafePriceAdjustments({
      caseId: "case-1",
      quoteRequestId: "req-1",
      reportId: "report-1",
      partnerQuotes: [partnerQuote],
      externalQuotes: [external],
      presets: [preset],
      now: NOW,
    });
    assert.equal(
      result.quotes[0]?.nhAuditV2?.submission.auditFeeWon,
      "9800000",
    );
  });

  it("builds an evaluation quote from a manual external record", () => {
    const quote = externalManualQuoteAsEvaluationQuote(externalRecord("9000000"), {
      quoteRequestId: "req-1",
      cooperativeName: "테스트농협",
      fiscalYear: 2027,
      now: NOW,
    });
    assert.match(quote.id, /^external_/u);
    assert.equal(quote.nhAuditV2?.submission.auditFeeWon, "9000000");
    assert.equal(quote.status, "delivered");
    assert.equal(quote.nhAuditV2?.eligibilityStatus, "ELIGIBLE");
  });

  it("keeps the quality-selected winner fee when a partner is already cheaper than 타 제휴사, and still spreads non-winners", () => {
    const planned = partnerQuoteFixture("9000000", { quality: "high" });
    const competitor = partnerQuoteFixture("9500000", {
      partnerId: "partner-2",
      partnerName: "경쟁회계법인",
      quality: "medium",
    });
    const result = applySafePriceAdjustments({
      caseId: "case-1",
      quoteRequestId: "req-1",
      reportId: "report-1",
      partnerQuotes: [planned, competitor],
      externalQuotes: [externalRecord("12000000")],
      presets: [
        presetFor(planned, {
          planned: "9000000",
          min: "8000000",
          max: "13000000",
          winner: true,
        }),
      ],
      now: NOW,
    });
    assert.equal(result.selectedPartnerId, planned.partnerId);
    assert.equal(
      result.quotes.find((quote) => quote.id === planned.id)?.nhAuditV2
        ?.submission.auditFeeWon,
      "9000000",
    );
    assert.equal(
      result.quotes.find((quote) => quote.id === competitor.id)?.nhAuditV2
        ?.submission.auditFeeWon,
      "9100000",
    );
  });

  it("spreads non-winner partner fees 100,000/200,000원 above the selected partner", () => {
    const winner = partnerQuoteFixture("12000000");
    const second = partnerQuoteFixture("11000000", {
      partnerId: "partner-2",
      partnerName: "제휴사2",
    });
    const third = partnerQuoteFixture("11500000", {
      partnerId: "partner-3",
      partnerName: "제휴사3",
    });
    const result = applySafePriceAdjustments({
      caseId: "case-1",
      quoteRequestId: "req-1",
      reportId: "report-1",
      partnerQuotes: [winner, second, third],
      externalQuotes: [externalRecord("10000000")],
      presets: [
        presetFor(winner, {
          planned: "12000000",
          min: "8000000",
          max: "13000000",
          winner: true,
        }),
        presetFor(second, {
          planned: "11000000",
          min: "8000000",
          max: "13000000",
          winner: false,
        }),
        presetFor(third, {
          planned: "11500000",
          min: "8000000",
          max: "13000000",
          winner: false,
        }),
      ],
      now: NOW,
    });
    assert.equal(
      result.quotes.find((quote) => quote.id === winner.id)?.nhAuditV2
        ?.submission.auditFeeWon,
      "9700000",
    );
    assert.equal(
      result.quotes.find((quote) => quote.id === second.id)?.nhAuditV2
        ?.submission.auditFeeWon,
      "9800000",
    );
    assert.equal(
      result.quotes.find((quote) => quote.id === third.id)?.nhAuditV2
        ?.submission.auditFeeWon,
      "9900000",
    );
  });

  it("spreads a third non-winner 300,000원 above the selected partner", () => {
    const winner = partnerQuoteFixture("12000000", { quality: "high" });
    const second = partnerQuoteFixture("11000000", {
      partnerId: "partner-2",
      partnerName: "제휴사2",
      quality: "medium",
    });
    const third = partnerQuoteFixture("11500000", {
      partnerId: "partner-3",
      partnerName: "제휴사3",
      quality: "medium",
    });
    const fourth = partnerQuoteFixture("11600000", {
      partnerId: "partner-4",
      partnerName: "제휴사4",
      quality: "low",
    });
    const result = applySafePriceAdjustments({
      caseId: "case-1",
      quoteRequestId: "req-1",
      reportId: "report-1",
      partnerQuotes: [winner, second, third, fourth],
      externalQuotes: [externalRecord("10000000")],
      presets: [
        presetFor(winner, {
          planned: "12000000",
          min: "8000000",
          max: "13000000",
          winner: true,
        }),
        presetFor(second, {
          planned: "11000000",
          min: "8000000",
          max: "13000000",
          winner: false,
        }),
        presetFor(third, {
          planned: "11500000",
          min: "8000000",
          max: "13000000",
          winner: false,
        }),
        presetFor(fourth, {
          planned: "11600000",
          min: "8000000",
          max: "13000000",
          winner: false,
        }),
      ],
      now: NOW,
    });
    assert.equal(
      result.quotes.find((quote) => quote.id === fourth.id)?.nhAuditV2
        ?.submission.auditFeeWon,
      "10000000",
    );
  });

  it("reselects the highest-quality partner after ranking, even if the planned winner differs", () => {
    const planned = partnerQuoteFixture("11000000", {
      quality: "low",
    });
    const stronger = partnerQuoteFixture("13800000", {
      partnerId: "partner-2",
      partnerName: "고품질회계법인",
      quality: "high",
    });
    const result = applySafePriceAdjustments({
      caseId: "case-1",
      quoteRequestId: "req-1",
      reportId: "report-1",
      partnerQuotes: [planned, stronger],
      externalQuotes: [externalRecord("14400000", { quality: "low" })],
      presets: [
        presetFor(planned, {
          planned: "11000000",
          min: "8000000",
          max: "13000000",
          winner: true,
        }),
        presetFor(stronger, {
          planned: "13800000",
          min: "8000000",
          max: "13800000",
          winner: false,
        }),
      ],
      now: NOW,
    });
    assert.equal(result.selectedPartnerId, stronger.partnerId);
    assert.equal(
      result.quotes.find((quote) => quote.id === stronger.id)?.nhAuditV2
        ?.submission.auditFeeWon,
      "13800000",
    );
    assert.equal(
      result.quotes.find((quote) => quote.id === planned.id)?.nhAuditV2
        ?.submission.auditFeeWon,
      "13900000",
    );
  });

  it("undercuts 타 제휴사 by 300,000원 using the quality-selected winner, not the planned winner", () => {
    const planned = partnerQuoteFixture("12000000", {
      quality: "low",
    });
    const stronger = partnerQuoteFixture("12000000", {
      partnerId: "partner-2",
      partnerName: "고품질회계법인",
      quality: "high",
    });
    const result = applySafePriceAdjustments({
      caseId: "case-1",
      quoteRequestId: "req-1",
      reportId: "report-1",
      partnerQuotes: [planned, stronger],
      externalQuotes: [externalRecord("10000000", { quality: "high" })],
      presets: [
        presetFor(planned, {
          planned: "12000000",
          min: "8000000",
          max: "13000000",
          winner: true,
        }),
        presetFor(stronger, {
          planned: "12000000",
          min: "8000000",
          max: "13000000",
          winner: false,
        }),
      ],
      now: NOW,
    });
    assert.equal(result.selectedPartnerId, stronger.partnerId);
    assert.equal(
      result.quotes.find((quote) => quote.id === stronger.id)?.nhAuditV2
        ?.submission.auditFeeWon,
      "9700000",
    );
    assert.equal(
      result.quotes.find((quote) => quote.id === planned.id)?.nhAuditV2
        ?.submission.auditFeeWon,
      "9800000",
    );
  });

  it("spreads non-winners 100,000/200,000원 above the quality-selected winner when 타 제휴사 is not cheapest", () => {
    const winner = partnerQuoteFixture("13800000", { quality: "high" });
    const second = partnerQuoteFixture("12000000", {
      partnerId: "partner-2",
      partnerName: "제휴사2",
      quality: "medium",
    });
    const third = partnerQuoteFixture("11999999", {
      partnerId: "partner-3",
      partnerName: "제휴사3",
      quality: "low",
    });
    const result = applySafePriceAdjustments({
      caseId: "case-1",
      quoteRequestId: "req-1",
      reportId: "report-1",
      partnerQuotes: [winner, second, third],
      externalQuotes: [externalRecord("14400000", { quality: "low" })],
      presets: [
        presetFor(winner, {
          planned: "13800000",
          min: "8000000",
          max: "13800000",
          winner: true,
        }),
        presetFor(second, {
          planned: "12000000",
          min: "8000000",
          max: "12000000",
          winner: false,
        }),
        presetFor(third, {
          planned: "11999999",
          min: "8000000",
          max: "11999999",
          winner: false,
        }),
      ],
      now: NOW,
    });
    assert.equal(result.selectedPartnerId, winner.partnerId);
    assert.equal(
      result.quotes.find((quote) => quote.id === winner.id)?.nhAuditV2
        ?.submission.auditFeeWon,
      "13800000",
    );
    assert.equal(
      result.quotes.find((quote) => quote.id === second.id)?.nhAuditV2
        ?.submission.auditFeeWon,
      "13900000",
    );
    assert.equal(
      result.quotes.find((quote) => quote.id === third.id)?.nhAuditV2
        ?.submission.auditFeeWon,
      "14000000",
    );
  });

  it("undercuts 타 제휴사 against the quality-selected winner even if another partner is cheaper", () => {
    const winner = partnerQuoteFixture("15000000", { quality: "high" });
    const cheaper = partnerQuoteFixture("10000000", {
      partnerId: "partner-2",
      partnerName: "저가회계법인",
      quality: "low",
    });
    const result = applySafePriceAdjustments({
      caseId: "case-1",
      quoteRequestId: "req-1",
      reportId: "report-1",
      partnerQuotes: [winner, cheaper],
      externalQuotes: [externalRecord("12000000", { quality: "low" })],
      presets: [
        presetFor(winner, {
          planned: "15000000",
          min: "8000000",
          max: "15000000",
          winner: true,
        }),
        presetFor(cheaper, {
          planned: "10000000",
          min: "8000000",
          max: "10000000",
          winner: false,
        }),
      ],
      now: NOW,
    });
    assert.equal(result.selectedPartnerId, winner.partnerId);
    assert.equal(
      result.quotes.find((quote) => quote.id === winner.id)?.nhAuditV2
        ?.submission.auditFeeWon,
      "11700000",
    );
    assert.equal(
      result.quotes.find((quote) => quote.id === cheaper.id)?.nhAuditV2
        ?.submission.auditFeeWon,
      "11800000",
    );
  });

  it("uses 프리고농협 master 1,250만/1,130만 so 삼덕 1,200만 does not get a low-price warning", () => {
    const winner = partnerQuoteFixture("12400000", { quality: "high" });
    const second = partnerQuoteFixture("12500000", {
      partnerId: "partner-2",
      partnerName: "세연테회계법인",
      quality: "medium",
    });
    const result = applySafePriceAdjustments({
      caseId: "case-1",
      quoteRequestId: "req-1",
      reportId: "report-1",
      partnerQuotes: [winner, second],
      externalQuotes: [externalRecord("12000000", { quality: "low" })],
      presets: [
        presetFor(winner, {
          planned: "12400000",
          min: "12400000",
          max: "12400000",
          winner: true,
        }),
      ],
      cooperativeSafetyBand: {
        safePriceMinWon: "11300000" as never,
        safePriceMaxWon: "12500000" as never,
      },
      now: NOW,
    });
    assert.equal(
      result.quotes.find((quote) => quote.id === winner.id)?.nhAuditV2
        ?.submission.auditFeeWon,
      "11700000",
    );
    assert.equal(result.safePriceMinWon, "11300000");
    assert.ok(BigInt("12000000") >= BigInt(result.safePriceMinWon ?? "0"));
  });

  it("uses the master planned-winner safety band when the selected partner has no matching preset", () => {
    const winner = partnerQuoteFixture("12500000", { quality: "high" });
    const result = applySafePriceAdjustments({
      caseId: "case-1",
      quoteRequestId: "req-1",
      reportId: "report-1",
      partnerQuotes: [winner],
      externalQuotes: [externalRecord("12000000", { quality: "low" })],
      presets: [
        {
          ...presetFor(winner, {
            planned: "12500000",
            min: "11300000",
            max: "12500000",
            winner: true,
          }),
          partnerId: "master-winner-id",
          partnerName: "다른이름회계법인",
        },
      ],
      now: NOW,
    });
    assert.equal(
      result.quotes.find((quote) => quote.id === winner.id)?.nhAuditV2
        ?.submission.auditFeeWon,
      "11700000",
    );
    assert.equal(result.safePriceMinWon, "11300000");
  });

  it("applies the cooperative floor to every partner, not the selected firm's own min", () => {
    const winner = partnerQuoteFixture("15000000", { quality: "high" });
    const second = partnerQuoteFixture("12500000", {
      partnerId: "partner-2",
      partnerName: "비선정제휴사",
      quality: "medium",
    });
    const result = applySafePriceAdjustments({
      caseId: "case-1",
      quoteRequestId: "req-1",
      reportId: "report-1",
      partnerQuotes: [winner, second],
      externalQuotes: [externalRecord("10000000", { quality: "low" })],
      presets: [
        presetFor(winner, {
          planned: "15000000",
          min: "8000000",
          max: "15000000",
          winner: true,
        }),
        presetFor(second, {
          planned: "12500000",
          min: "12500000",
          max: "12500000",
          winner: false,
        }),
      ],
      cooperativeSafetyBand: {
        safePriceMinWon: "11300000" as never,
        safePriceMaxWon: "12500000" as never,
      },
      now: NOW,
    });
    assert.equal(result.selectedPartnerId, winner.partnerId);
    assert.equal(
      result.quotes.find((quote) => quote.id === winner.id)?.nhAuditV2
        ?.submission.auditFeeWon,
      "11300000",
    );
    assert.equal(
      result.quotes.find((quote) => quote.id === second.id)?.nhAuditV2
        ?.submission.auditFeeWon,
      "11400000",
    );
    assert.equal(result.safePriceMinWon, "11300000");
    assert.ok(
      result.events.every((event) => event.safePriceMinWon === "11300000"),
    );
  });

  it("uses the same cooperative floor whichever partner is quality-selected", () => {
    const shared = {
      caseId: "case-1",
      quoteRequestId: "req-1",
      reportId: "report-1",
      externalQuotes: [externalRecord("10000000", { quality: "low" })],
      cooperativeSafetyBand: {
        safePriceMinWon: "11300000" as never,
        safePriceMaxWon: "12500000" as never,
      },
      now: NOW,
    };
    const alpha = partnerQuoteFixture("15000000", {
      partnerId: "partner-a",
      partnerName: "알파회계",
      quality: "high",
    });
    const beta = partnerQuoteFixture("14000000", {
      partnerId: "partner-b",
      partnerName: "베타회계",
      quality: "low",
    });
    const alphaWins = applySafePriceAdjustments({
      ...shared,
      partnerQuotes: [alpha, beta],
      presets: [
        presetFor(alpha, {
          planned: "15000000",
          min: "8000000",
          max: "15000000",
          winner: true,
        }),
        presetFor(beta, {
          planned: "14000000",
          min: "13900000",
          max: "14000000",
          winner: false,
        }),
      ],
    });
    const betaHigh = partnerQuoteFixture("14000000", {
      partnerId: "partner-b",
      partnerName: "베타회계",
      quality: "high",
    });
    const alphaLow = partnerQuoteFixture("15000000", {
      partnerId: "partner-a",
      partnerName: "알파회계",
      quality: "low",
    });
    const betaWins = applySafePriceAdjustments({
      ...shared,
      partnerQuotes: [alphaLow, betaHigh],
      presets: [
        presetFor(alphaLow, {
          planned: "15000000",
          min: "8000000",
          max: "15000000",
          winner: true,
        }),
        presetFor(betaHigh, {
          planned: "14000000",
          min: "13900000",
          max: "14000000",
          winner: false,
        }),
      ],
    });
    assert.equal(alphaWins.selectedPartnerId, "partner-a");
    assert.equal(betaWins.selectedPartnerId, "partner-b");
    assert.equal(
      alphaWins.quotes.find((quote) => quote.partnerId === "partner-a")
        ?.nhAuditV2?.submission.auditFeeWon,
      "11300000",
    );
    assert.equal(
      betaWins.quotes.find((quote) => quote.partnerId === "partner-b")
        ?.nhAuditV2?.submission.auditFeeWon,
      "11300000",
    );
    assert.equal(alphaWins.safePriceMinWon, "11300000");
    assert.equal(betaWins.safePriceMinWon, "11300000");
  });

  it("stops at the safety floor instead of going below 최저안전가격", () => {
    const planned = partnerQuoteFixture("12500000");
    const result = applySafePriceAdjustments({
      caseId: "case-1",
      quoteRequestId: "req-1",
      reportId: "report-1",
      partnerQuotes: [planned],
      externalQuotes: [externalRecord("10000000")],
      presets: [
        presetFor(planned, {
          planned: "12500000",
          min: "11300000",
          max: "12500000",
          winner: true,
        }),
      ],
      now: NOW,
    });
    assert.equal(
      result.quotes.find((quote) => quote.id === planned.id)?.nhAuditV2
        ?.submission.auditFeeWon,
      "11300000",
    );
  });
});

function partnerQuoteFixture(
  auditFeeWon: string,
  options: {
    partnerId?: string;
    partnerName?: string;
    quality?: "low" | "medium" | "high";
  } = {},
): QuoteRecord {
  const partnerId = options.partnerId ?? "partner-1";
  const partnerName = options.partnerName ?? "제휴회계법인";
  const quality = qualityFields(options.quality ?? "high");
  const trusted = buildTrustedNhAuditSubmissionV2(
    {
      engagementPartnerName: "김감사",
      proposerType: "ACCOUNTING_FIRM",
      auditFeeWon,
      expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
      expectedExpenseWon: "0",
      ...quality,
      factsConfirmed: true,
    },
    {
      submissionId: `sub-${partnerId}`,
      quoteRequestId: "req-1",
      targetCooperativeId: null,
      targetCooperativeName: "테스트농협",
      fiscalYear: 2027,
      partnerAccountId: partnerId,
      accountingFirmName: partnerName,
      submittedAt: NOW,
    },
  );
  assert.equal(trusted.success, true);
  if (!trusted.success) throw new Error("fixture_failed");
  return {
    id: `quote-${partnerId}`,
    quoteRequestId: "audit_quote_req1",
    quoteAssignmentId: `asg-${partnerId}`,
    partnerId,
    partnerName,
    status: "finalized",
    version: 1,
    customerEmail: "a@nonghyup.com",
    supplierName: partnerName,
    supplierContactEmail: "p@example.com",
    lineItems: [],
    subtotal: Number(auditFeeWon),
    taxAmount: 0,
    totalAmount: Number(auditFeeWon),
    vatIncluded: true,
    createdBy: partnerId,
    createdAt: NOW,
    updatedAt: NOW,
    nhAuditV2: createNhAuditEvaluationSnapshotV2(trusted.submission, NOW),
  };
}

function externalRecord(
  auditFeeWon: string,
  options: { quality?: "low" | "high" } = {},
): ExternalManualQuoteRecord {
  const quality = qualityFields(options.quality ?? "high");
  return {
    id: "ext-1",
    caseId: "case-1",
    quoteRequestId: "req-1",
    supplierName: "비제휴회계법인",
    supplierBusinessRegistrationNumber: "",
    supplierAddress: "",
    supplierContactName: "",
    supplierContactEmail: "",
    supplierContactPhone: "",
    accountingFirmName: "비제휴회계법인",
    engagementPartnerName: "박외부",
    proposerType: "ACCOUNTING_FIRM",
    auditFeeWon: auditFeeWon as never,
    expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
    expectedExpenseWon: "0" as never,
    localNonghyupAuditCount2025: quality.localNonghyupAuditCount2025,
    certifiedPublicAccountantCount: quality.certifiedPublicAccountantCount,
    accountingFirmRevenueWon: quality.accountingFirmRevenueWon as never,
    auditedNonghyupTypes2025: [...quality.auditedNonghyupTypes2025],
    noAuditedNonghyupTypes2025: quality.auditedNonghyupTypes2025.length === 0,
    nonghyupTaxAgencyPerformed2025: quality.nonghyupTaxAgencyPerformed2025,
    nonghyupSubsidySettlementPerformed2025:
      quality.nonghyupSubsidySettlementPerformed2025,
    enteredBySubjectId: "customer-1",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function qualityFields(level: "low" | "medium" | "high") {
  if (level === "low") {
    return {
      localNonghyupAuditCount2025: 0,
      certifiedPublicAccountantCount: 0,
      accountingFirmRevenueWon: "0",
      auditedNonghyupTypes2025: [] as const,
      nonghyupTaxAgencyPerformed2025: false,
      nonghyupSubsidySettlementPerformed2025: false,
    };
  }
  if (level === "medium") {
    return {
      localNonghyupAuditCount2025: 20,
      certifiedPublicAccountantCount: 20,
      accountingFirmRevenueWon: "5000000000",
      auditedNonghyupTypes2025: ["LOCAL_AGRICULTURAL_COOPERATIVE"] as const,
      nonghyupTaxAgencyPerformed2025: false,
      nonghyupSubsidySettlementPerformed2025: false,
    };
  }
  return {
    localNonghyupAuditCount2025: 50,
    certifiedPublicAccountantCount: 30,
    accountingFirmRevenueWon: "10000000000",
    auditedNonghyupTypes2025: [
      "LOCAL_AGRICULTURAL_COOPERATIVE",
      "LOCAL_LIVESTOCK_COOPERATIVE",
    ] as const,
    nonghyupTaxAgencyPerformed2025: true,
    nonghyupSubsidySettlementPerformed2025: true,
  };
}

function presetFor(
  quote: QuoteRecord,
  fees: { planned: string; min: string; max: string; winner: boolean },
): QuoteAutomationPartnerPreset {
  return {
    id: "preset-1",
    quoteRequestId: quote.quoteRequestId,
    auditQuoteRequestId: "req-1",
    assignmentId: quote.quoteAssignmentId,
    partnerId: quote.partnerId,
    partnerName: quote.partnerName,
    plannedAuditFeeWon: fees.planned as never,
    expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
    expectedExpenseWon: "0" as never,
    safePriceMinWon: fees.min as never,
    safePriceMaxWon: fees.max as never,
    isPlannedWinner: fees.winner,
    locked: false,
    updatedBy: "admin",
    createdAt: NOW,
    updatedAt: NOW,
  };
}
