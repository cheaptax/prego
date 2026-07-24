import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PartnerEvaluationForm } from "@/lib/audit-evaluation/partner-quote-form";
import { validatePartnerQuoteInput } from "@/lib/quotes/partner-quote-validation";

const evaluationForm: PartnerEvaluationForm = {
  configId: "test",
  configVersion: 1,
  configName: "테스트 기준",
  source: "published",
  criteria: [],
  fields: [
    {
      id: "engagementPartner",
      label: "책임회계사",
      help: "",
      section: "투입인력",
      control: "person",
      required: true,
    },
    {
      id: "totalPlannedHours",
      label: "총 예정 투입시간",
      help: "",
      section: "투입인력",
      control: "integer",
      required: true,
    },
    {
      id: "partnerHours",
      label: "책임회계사 예정 투입시간",
      help: "",
      section: "투입인력",
      control: "integer",
      required: true,
    },
  ],
};

describe("partner quote validation", () => {
  it("reports every missing base and dynamic required field", () => {
    const result = validatePartnerQuoteInput({
      itemName: "",
      quantity: "0",
      unitPrice: "",
      servicePeriod: "",
      validUntil: "",
      evaluationForm,
      evaluationAnswers: {},
    });

    assert.equal(result.valid, false);
    assert.deepEqual(Object.keys(result.fieldErrors), [
      "quoteItemName",
      "quoteQuantity",
      "quoteUnitPrice",
      "quoteServicePeriod",
      "quoteValidUntil",
      "engagementPartner",
      "totalPlannedHours",
      "partnerHours",
    ]);
  });

  it("accepts a complete quote and rejects partner hours over total hours", () => {
    const input = {
      itemName: "회계감사 용역",
      quantity: "1",
      unitPrice: "12,000,000",
      servicePeriod: "2026.09 ~ 2027.02",
      validUntil: "발행일로부터 30일",
      evaluationForm,
      evaluationAnswers: {
        engagementPartner: {
          name: "홍길동",
          title: "이사",
          yearsOfExperience: "12",
        },
        totalPlannedHours: "170",
        partnerHours: "20",
      },
    };

    assert.equal(validatePartnerQuoteInput(input).valid, true);
    const invalid = validatePartnerQuoteInput({
      ...input,
      evaluationAnswers: {
        ...input.evaluationAnswers,
        partnerHours: "200",
      },
    });
    assert.equal(invalid.valid, false);
    assert.match(invalid.fieldErrors.partnerHours, /초과/);
  });
});
