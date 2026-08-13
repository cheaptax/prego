import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateNhAuditQualityScoreV2 } from "@/lib/audit-evaluation/nh-audit-v2-engine";
import { createDefaultNhAuditCustomerWeightsV2 } from "@/lib/audit-evaluation/nh-audit-v2-schemas";
import {
  applyNhAuditEvaluationDefaults,
  extractNhAuditEvaluationDefaults,
  overlayPartnerQualityDefaultsOnQuote,
  resolveInitialNhAuditPartnerForm,
} from "@/lib/quotes/nh-audit-evaluation-defaults";
import {
  EMPTY_NH_AUDIT_PARTNER_FORM,
  type NhAuditPartnerFormValues,
} from "@/lib/quotes/nh-audit-quote-form";
import {
  buildTrustedNhAuditSubmissionV2,
  createNhAuditEvaluationSnapshotV2,
} from "@/lib/quotes/nh-audit-quote-server";
import type { PartnerRecord, QuoteRecord } from "@/lib/firebase/schema";

function sampleValues(
  overrides: Partial<NhAuditPartnerFormValues> = {},
): NhAuditPartnerFormValues {
  return {
    ...EMPTY_NH_AUDIT_PARTNER_FORM,
    engagementPartnerName: "김회계",
    proposerType: "ACCOUNTING_FIRM",
    auditFeeWon: "12,000,000",
    expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
    expectedExpenseWon: "0",
    localNonghyupAuditCount2025: "3",
    certifiedPublicAccountantCount: "12",
    accountingFirmRevenueWon: "1,000,000,000",
    auditedNonghyupTypes2025: ["LOCAL_AGRICULTURAL_COOPERATIVE"],
    noAuditedNonghyupTypes2025: false,
    nonghyupTaxAgencyPerformed2025: "YES",
    nonghyupSubsidySettlementPerformed2025: "NO",
    factsConfirmed: true,
    ...overrides,
  };
}

describe("NH audit evaluation defaults", () => {
  it("extracts firm evaluation fields and drops quote-specific amounts", () => {
    const defaults = extractNhAuditEvaluationDefaults(sampleValues());
    assert.ok(defaults);
    assert.equal(defaults.engagementPartnerName, "김회계");
    assert.equal(defaults.localNonghyupAuditCount2025, "3");
    assert.equal(
      "auditFeeWon" in defaults,
      false,
    );
    const applied = applyNhAuditEvaluationDefaults(defaults);
    assert.equal(applied.engagementPartnerName, "김회계");
    assert.equal(applied.auditFeeWon, "");
    assert.equal(applied.expenseBillingMode, "");
    assert.equal(applied.factsConfirmed, false);
  });

  it("prefers assignment draft over partner defaults", () => {
    const partner = {
      id: "partner-1",
      nhAuditEvaluationDefaults: extractNhAuditEvaluationDefaults(
        sampleValues({ engagementPartnerName: "기본담당" }),
      ),
    } as PartnerRecord;
    const draft = {
      id: "a1_draft",
      partnerId: "partner-1",
      status: "draft",
      nhAuditDraft: sampleValues({ engagementPartnerName: "초안담당" }),
    } as QuoteRecord;
    const resolved = resolveInitialNhAuditPartnerForm({
      draft,
      partner,
      quotes: [],
    });
    assert.equal(resolved.engagementPartnerName, "초안담당");
    assert.equal(resolved.auditFeeWon, "12,000,000");
  });

  it("uses partner defaults for a new empty assignment", () => {
    const partner = {
      id: "partner-1",
      nhAuditEvaluationDefaults: extractNhAuditEvaluationDefaults(
        sampleValues({ engagementPartnerName: "기본담당" }),
      ),
    } as PartnerRecord;
    const resolved = resolveInitialNhAuditPartnerForm({
      draft: null,
      partner,
      quotes: [],
    });
    assert.equal(resolved.engagementPartnerName, "기본담당");
    assert.equal(resolved.auditFeeWon, "");
    assert.equal(resolved.factsConfirmed, false);
  });

  it("falls back to latest finalized quote when partner defaults are missing", () => {
    const partner = { id: "partner-1" } as PartnerRecord;
    const quotes = [
      {
        id: "old",
        partnerId: "partner-1",
        status: "finalized",
        finalizedAt: "2026-01-01T00:00:00.000Z",
        nhAuditDraft: sampleValues({
          engagementPartnerName: "이전담당",
          localNonghyupAuditCount2025: "7",
        }),
      },
      {
        id: "newer",
        partnerId: "partner-1",
        status: "delivered",
        finalizedAt: "2026-06-01T00:00:00.000Z",
        nhAuditDraft: sampleValues({
          engagementPartnerName: "최근담당",
          localNonghyupAuditCount2025: "9",
        }),
      },
    ] as QuoteRecord[];
    const resolved = resolveInitialNhAuditPartnerForm({
      draft: null,
      partner,
      quotes,
    });
    assert.equal(resolved.engagementPartnerName, "최근담당");
    assert.equal(resolved.localNonghyupAuditCount2025, "9");
    assert.equal(resolved.auditFeeWon, "");
  });

  it("overlays 제휴사목록 매출액 105억 onto a sent quote so revenue scores 20", () => {
    const now = "2026-08-13T00:00:00.000Z";
    const trusted = buildTrustedNhAuditSubmissionV2(
      {
        engagementPartnerName: "김재경",
        proposerType: "ACCOUNTING_FIRM",
        auditFeeWon: "12400000",
        expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
        expectedExpenseWon: "0",
        localNonghyupAuditCount2025: 50,
        certifiedPublicAccountantCount: 50,
        accountingFirmRevenueWon: "10000000000",
        auditedNonghyupTypes2025: [
          "LOCAL_AGRICULTURAL_COOPERATIVE",
          "LOCAL_LIVESTOCK_COOPERATIVE",
          "ITEM_AGRICULTURAL_OR_LIVESTOCK_COOPERATIVE",
          "GINSENG_COOPERATIVE",
        ],
        nonghyupTaxAgencyPerformed2025: true,
        nonghyupSubsidySettlementPerformed2025: true,
        factsConfirmed: true,
      },
      {
        submissionId: "sub-prigo",
        quoteRequestId: "req-1",
        targetCooperativeId: null,
        targetCooperativeName: "프리고농협",
        fiscalYear: 2027,
        partnerAccountId: "partner-prigo",
        accountingFirmName: "프리고테회계법인",
        submittedAt: now,
      },
    );
    assert.equal(trusted.success, true);
    if (!trusted.success) throw new Error("fixture_failed");
    const quote = {
      id: "quote-prigo",
      quoteRequestId: "audit_quote_req1",
      quoteAssignmentId: "asg-prigo",
      partnerId: "partner-prigo",
      partnerName: "프리고테회계법인",
      status: "delivered",
      version: 1,
      customerEmail: "a@nonghyup.com",
      supplierName: "프리고테회계법인",
      supplierContactEmail: "p@example.com",
      lineItems: [],
      subtotal: 12_400_000,
      taxAmount: 0,
      totalAmount: 12_400_000,
      vatIncluded: true,
      createdBy: "partner-prigo",
      createdAt: now,
      updatedAt: now,
      nhAuditV2: createNhAuditEvaluationSnapshotV2(trusted.submission, now),
    } as QuoteRecord;
    const before = calculateNhAuditQualityScoreV2(
      quote.nhAuditV2!.submission,
      createDefaultNhAuditCustomerWeightsV2(),
    );
    const beforeRevenue = before.criteria.find(
      (item) => item.criterionId === "ACCOUNTING_FIRM_REVENUE",
    );
    assert.equal(beforeRevenue?.recognitionRateBasisPoints, 5_000);
    assert.equal(beforeRevenue?.earnedScore.numerator, "10");
    const overlaid = overlayPartnerQualityDefaultsOnQuote(
      quote,
      extractNhAuditEvaluationDefaults(
        sampleValues({
          accountingFirmRevenueWon: "10,500,000,000",
        }),
      ),
      now,
    );
    assert.equal(
      overlaid.nhAuditV2?.submission.accountingFirmRevenueWon,
      "10500000000",
    );
    assert.equal(overlaid.nhAuditV2?.submission.auditFeeWon, "12400000");
    const after = calculateNhAuditQualityScoreV2(
      overlaid.nhAuditV2!.submission,
      createDefaultNhAuditCustomerWeightsV2(),
    );
    const afterRevenue = after.criteria.find(
      (item) => item.criterionId === "ACCOUNTING_FIRM_REVENUE",
    );
    assert.equal(afterRevenue?.recognitionRateBasisPoints, 10_000);
    assert.equal(afterRevenue?.earnedScore.numerator, "20");
  });
});
