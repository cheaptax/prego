import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseNhAuditPartnerSubmissionInputV2 } from "@/lib/audit-evaluation/nh-audit-v2-schemas";
import {
  EMPTY_NH_AUDIT_PARTNER_FORM,
  calculateNhAuditCostPreview,
  sanitizeNhAuditPartnerFormDraft,
  validateNhAuditPartnerForm,
  type NhAuditPartnerFormValues,
} from "@/lib/quotes/nh-audit-quote-form";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function completeValues(
  overrides: Partial<NhAuditPartnerFormValues> = {},
): NhAuditPartnerFormValues {
  return {
    ...EMPTY_NH_AUDIT_PARTNER_FORM,
    engagementPartnerName: "  홍길동  ",
    proposerType: "ACCOUNTING_FIRM",
    auditFeeWon: "10,000,000",
    expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
    expectedExpenseWon: "0",
    localNonghyupAuditCount2025: "0",
    certifiedPublicAccountantCount: "0",
    accountingFirmRevenueWon: "0",
    noAuditedNonghyupTypes2025: true,
    nonghyupTaxAgencyPerformed2025: "NO",
    nonghyupSubsidySettlementPerformed2025: "NO",
    factsConfirmed: true,
    ...overrides,
  };
}

describe("NH audit partner quote form", () => {
  it("distinguishes missing numeric values from zero", () => {
    const missing = validateNhAuditPartnerForm(
      completeValues({ localNonghyupAuditCount2025: "" }),
    );
    assert.equal(missing.valid, false);
    assert.match(
      missing.fieldErrors.localNonghyupAuditCount2025 ?? "",
      /0 이상의 정수/,
    );

    const zero = validateNhAuditPartnerForm(completeValues());
    assert.equal(zero.valid, true);
    assert.equal(zero.submissionInput?.localNonghyupAuditCount2025, 0);
  });

  it("requires explicit yes/no choices and facts confirmation", () => {
    const result = validateNhAuditPartnerForm(
      completeValues({
        nonghyupTaxAgencyPerformed2025: "",
        nonghyupSubsidySettlementPerformed2025: "",
        factsConfirmed: false,
      }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.fieldErrors.nonghyupTaxAgencyPerformed2025);
    assert.ok(result.fieldErrors.nonghyupSubsidySettlementPerformed2025);
    assert.ok(result.fieldErrors.factsConfirmed);
  });

  it("normalizes included expenses to zero and requires separate expenses", () => {
    const included = validateNhAuditPartnerForm(
      completeValues({ expectedExpenseWon: "50,000" }),
    );
    assert.equal(included.valid, true);
    assert.equal(included.submissionInput?.expectedExpenseWon, "0");

    const separateMissing = validateNhAuditPartnerForm(
      completeValues({
        expenseBillingMode: "SEPARATELY_BILLED",
        expectedExpenseWon: "",
      }),
    );
    assert.equal(separateMissing.valid, false);
    assert.ok(separateMissing.fieldErrors.expectedExpenseWon);
  });

  it("rejects decimals, exponents, negatives and non-finite text", () => {
    for (const value of ["1.5", "1e6", "-1", "NaN", "Infinity"]) {
      const result = validateNhAuditPartnerForm(
        completeValues({ auditFeeWon: value }),
      );
      assert.equal(result.valid, false, value);
    }
  });

  it("trims the engagement partner and computes the VAT-inclusive preview", () => {
    const values = completeValues({
      expenseBillingMode: "SEPARATELY_BILLED",
      expectedExpenseWon: "1,000,000",
    });
    const result = validateNhAuditPartnerForm(values);
    assert.equal(result.submissionInput?.engagementPartnerName, "홍길동");
    assert.equal(calculateNhAuditCostPreview(values), 12_100_000n);
  });

  it("allows audit groups while preserving the proposer type", () => {
    const result = validateNhAuditPartnerForm(
      completeValues({ proposerType: "AUDIT_GROUP" }),
    );
    assert.equal(result.valid, true);
    assert.equal(result.submissionInput?.proposerType, "AUDIT_GROUP");
  });

  it("sanitizes incomplete drafts without retaining client scores", () => {
    const draft = sanitizeNhAuditPartnerFormDraft({
      engagementPartnerName: "홍길동",
      proposerType: "AUDIT_GROUP",
      auditFeeWon: "1e6원",
      expectedExpenseWon: "NaN",
      localNonghyupAuditCount2025: "",
      qualityScore: 100,
    });
    assert.equal(draft.auditFeeWon, "");
    assert.equal(draft.expectedExpenseWon, "");
    assert.equal(draft.localNonghyupAuditCount2025, "");
    assert.equal("qualityScore" in draft, false);
  });

  it("ignores client-calculated score fields at the server boundary", () => {
    const valid = validateNhAuditPartnerForm(completeValues());
    assert.ok(valid.submissionInput);
    const parsed = parseNhAuditPartnerSubmissionInputV2({
      ...valid.submissionInput,
      qualityScore: 100,
      priceScore: 100,
      overallScore: 100,
    });
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal("qualityScore" in parsed.data, false);
      assert.equal("overallScore" in parsed.data, false);
    }
  });

  it("keeps the fixed accessible UI contract without legacy free text", () => {
    const source = readFileSync(
      path.join(root, "components/PartnerNhAuditQuoteForm.tsx"),
      "utf8",
    );
    assert.equal((source.match(/type="text"/gu) ?? []).length, 5);
    assert.equal((source.match(/inputMode="numeric"/gu) ?? []).length, 4);
    assert.doesNotMatch(source, /<textarea|type="file"/u);
    assert.doesNotMatch(
      source,
      /totalPlannedHours|partnerHours|auditSchedule|현장방문|강점|수행계획|비고|증빙/u,
    );
    assert.match(
      source,
      /감사반은 현재 평가기준상 부적격으로 처리되며 종합순위에 포함되지 않습니다/u,
    );
    assert.match(source, /aria-describedby/u);
    assert.match(source, /<fieldset/u);
    assert.match(source, /<label/u);
  });
});
