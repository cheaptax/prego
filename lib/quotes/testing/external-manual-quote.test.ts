import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { formStateFromExternalManualQuote } from "@/lib/quotes/external-manual-quote-form";
import { splitExternalManualQuoteMutationBody } from "@/lib/quotes/quote-automation-schemas";
import type { ExternalManualQuoteRecord } from "@/lib/quotes/quote-automation-types";

const NOW = "2026-08-13T00:00:00.000Z";

describe("external manual quotes", () => {
  it("splits quoteId from mutation body so the strict input schema can parse", () => {
    const split = splitExternalManualQuoteMutationBody({
      quoteId: "ext_abc",
      supplierName: "삼덕회계법인",
      auditFeeWon: "12000000",
    });
    assert.equal(split.quoteId, "ext_abc");
    assert.equal(
      (split.payload as { supplierName?: string }).supplierName,
      "삼덕회계법인",
    );
    assert.equal(
      (split.payload as { quoteId?: string }).quoteId,
      undefined,
    );
  });

  it("loads a saved quote into the edit form including optional evaluation fields", () => {
    const form = formStateFromExternalManualQuote(
      quoteFixture({
        engagementPartnerName: "김담당",
        localNonghyupAuditCount2025: 12,
        certifiedPublicAccountantCount: 0,
        accountingFirmRevenueWon: "0",
        nonghyupTaxAgencyPerformed2025: true,
      }),
    );
    assert.equal(form.supplier.name, "삼덕회계법인");
    assert.equal(form.auditValues.auditFeeWon, "12,000,000");
    assert.equal(form.auditValues.engagementPartnerName, "김담당");
    assert.equal(form.auditValues.localNonghyupAuditCount2025, "12");
    assert.equal(form.auditValues.certifiedPublicAccountantCount, "");
    assert.equal(form.auditValues.nonghyupTaxAgencyPerformed2025, "YES");
    assert.equal(
      form.auditValues.nonghyupSubsidySettlementPerformed2025,
      "NO",
    );
  });

  it("accepts DELETE without JSON and lets the panel edit existing quotes", () => {
    const route = readFileSync(
      join(
        process.cwd(),
        "app/api/audit-evaluations/[caseId]/external-quotes/route.ts",
      ),
      "utf8",
    );
    const panel = readFileSync(
      join(process.cwd(), "components/ExternalManualQuotesPanel.tsx"),
      "utf8",
    );
    assert.match(route, /method === "DELETE"|export async function DELETE/u);
    assert.match(route, /requireJson:\s*false/u);
    assert.match(route, /splitExternalManualQuoteMutationBody/u);
    assert.match(panel, /수정 내용 저장/u);
    assert.match(panel, /quoteId:\s*editingQuoteId/u);
    assert.match(panel, /method:\s*"DELETE"/u);
  });
});

function quoteFixture(
  overrides: Partial<ExternalManualQuoteRecord> = {},
): ExternalManualQuoteRecord {
  return {
    id: "ext_1",
    caseId: "case-1",
    quoteRequestId: "req-1",
    supplierName: "삼덕회계법인",
    supplierBusinessRegistrationNumber: "",
    supplierAddress: "",
    supplierContactName: "",
    supplierContactEmail: "",
    supplierContactPhone: "",
    accountingFirmName: "삼덕회계법인",
    engagementPartnerName: "",
    proposerType: "ACCOUNTING_FIRM",
    auditFeeWon: "12000000" as never,
    expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
    expectedExpenseWon: "0" as never,
    localNonghyupAuditCount2025: 0,
    certifiedPublicAccountantCount: 0,
    accountingFirmRevenueWon: "0" as never,
    auditedNonghyupTypes2025: [],
    noAuditedNonghyupTypes2025: true,
    nonghyupTaxAgencyPerformed2025: false,
    nonghyupSubsidySettlementPerformed2025: false,
    enteredBySubjectId: "customer-1",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}
