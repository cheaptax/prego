import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPartnerEvaluationForm,
  normalizePartnerEvaluationAnswers,
  toTrustedStandardQuotePayload,
} from "@/lib/audit-evaluation/partner-quote-form";
import { createValidEvaluationConfig } from "@/lib/audit-evaluation/testing/fixtures";
import {
  formatCurrencyInput,
  parseCurrencyInput,
} from "@/lib/currency-input";
import {
  createQuoteDocumentIdentity,
  serializeEmbeddedQuoteDocumentIdentity,
} from "@/lib/audit-evaluation/standard-quote-identity";
import { embedAuditQuoteIdentityMarker } from "@/lib/quotes/audit-quote-document";

describe("partner quote evaluation form", () => {
  it("derives visible fields from the applied criteria", () => {
    const form = buildPartnerEvaluationForm(
      createValidEvaluationConfig(),
      "published",
    );

    assert.deepEqual(
      form.fields.map((field) => field.id),
      [
        "accountingFirmRevenue",
        "recentNonghyupAuditCount",
        "auditedNonghyupTypes",
        "taxAgencyExperience",
        "subsidySettlementExperience",
        "engagementPartner",
        "engagementTeam",
        "totalPlannedHours",
        "partnerHours",
        "auditSchedule",
        "qualityControlPlan",
      ],
    );
    assert.equal(
      form.fields.find((field) => field.id === "accountingFirmRevenue")
        ?.required,
      true,
    );
    assert.equal(
      form.fields.find((field) => field.id === "engagementPartner")?.required,
      true,
    );
  });

  it("normalizes partner answers and reports missing required values", () => {
    const config = createValidEvaluationConfig();
    const result = normalizePartnerEvaluationAnswers({
      config,
      rawAnswers: {
        accountingFirmRevenue: "7,000,000,000",
        recentNonghyupAuditCount: "15",
        auditedNonghyupTypes: "지역농협\n축협",
        taxAgencyExperience: {
          hasExperience: true,
          descriptions: "세무조정",
        },
        subsidySettlementExperience: {
          hasExperience: false,
          descriptions: "",
        },
        engagementPartner: {
          name: "홍길동",
          title: "이사",
          yearsOfExperience: "18",
        },
        engagementTeam: [
          { name: "김감사", role: "매니저", plannedHours: "80" },
        ],
        totalPlannedHours: "100",
        partnerHours: "20",
        auditSchedule: [
          {
            label: "중간감사",
            startsOn: "2027-01-10",
            endsOn: "2027-01-20",
          },
        ],
        qualityControlPlan: "독립 검토\n주간 보고",
      },
      quoteId: "quote-1",
      quoteRequestId: "request-1",
      partnerId: "partner-1",
      partnerName: "테스트 회계법인",
      auditFeeWon: 7_700_000,
      vatIncluded: true,
      now: "2026-07-22T12:00:00.000Z",
    });

    assert.equal(result.normalizedQuote.accountingFirmRevenue, "7000000000");
    assert.equal(result.normalizedQuote.recentNonghyupAuditCount, 15);
    assert.deepEqual(result.missingRequiredFields, []);
    assert.equal(
      toTrustedStandardQuotePayload(result.normalizedQuote).engagementTeam
        .length,
      1,
    );
    const payload = toTrustedStandardQuotePayload(result.normalizedQuote);
    const marker = serializeEmbeddedQuoteDocumentIdentity(
      createQuoteDocumentIdentity(
        {
          quoteRequestId: "request-1",
          fiscalYear: 2027,
          templateVersion: { id: "partner.audit-quote", version: 1 },
          normalizedPayload: payload,
        },
        "test-signing-secret-that-is-longer-than-32-bytes",
      ),
    );
    const markedPdf = embedAuditQuoteIdentityMarker(
      Buffer.from("%PDF-1.7\nstartxref\n0\n%%EOF"),
      marker,
    ).toString("latin1");
    assert.ok(markedPdf.indexOf(marker) < markedPdf.indexOf("%%EOF"));
  });
});

describe("currency input", () => {
  it("formats thousands while preserving a numeric payload", () => {
    assert.equal(formatCurrencyInput("7000000"), "7,000,000");
    assert.equal(formatCurrencyInput("7,000,000원"), "7,000,000");
    assert.equal(parseCurrencyInput("7,000,000"), 7_000_000);
  });
});
