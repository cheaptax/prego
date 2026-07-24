import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluationConfigSchema } from "@/lib/audit-evaluation/schemas";
import { createValidEvaluationConfig } from "@/lib/audit-evaluation/testing/fixtures";

describe("evaluation config schema", () => {
  it("accepts a complete draft configuration", () => {
    const result = evaluationConfigSchema.safeParse(
      createValidEvaluationConfig(),
    );
    assert.equal(result.success, true);
  });

  it("requires scored criteria weights to total 10000 basis points", () => {
    const config = createValidEvaluationConfig();
    config.criteria[0].weightBasisPoints = 5_000;
    const result = evaluationConfigSchema.safeParse(config);
    assert.equal(result.success, false);
  });

  it("requires publication metadata for published versions", () => {
    const config = createValidEvaluationConfig();
    config.status = "PUBLISHED";
    const result = evaluationConfigSchema.safeParse(config);
    assert.equal(result.success, false);
  });

  it("rejects arbitrary executable rule expressions", () => {
    const config = createValidEvaluationConfig() as unknown as {
      criteria: Array<Record<string, unknown>>;
    };
    config.criteria[0].rule = {
      type: "javascript",
      expression: "return 10000",
    };
    const result = evaluationConfigSchema.safeParse(config);
    assert.equal(result.success, false);
  });

  it("rejects invalid quote and upload limits", () => {
    const config = createValidEvaluationConfig();
    config.uploadLimit = 4;
    config.maximumQuoteCount = 5;
    const result = evaluationConfigSchema.safeParse(config);
    assert.equal(result.success, false);
  });

  it("rejects unsafe customer access lifetimes", () => {
    const config = createValidEvaluationConfig();
    config.customerAccessPolicy.magicLinkLifetimeMinutes = 0;
    config.customerAccessPolicy.sessionLifetimeMinutes = 43_201;
    const result = evaluationConfigSchema.safeParse(config);
    assert.equal(result.success, false);
  });

  it("validates versioned OCR and AI extraction policy", () => {
    const config = createValidEvaluationConfig();
    assert.equal(evaluationConfigSchema.safeParse(config).success, true);
    if (!config.quoteExtractionPolicy) assert.fail("missing extraction policy");
    config.quoteExtractionPolicy.aiPromptVersion = "unsafe prompt version";
    assert.equal(evaluationConfigSchema.safeParse(config).success, false);
  });

  it("accepts only constrained report presentation settings", () => {
    const config = createValidEvaluationConfig();
    config.reportRenderingPolicy = {
      watermarkEnabled: true,
      watermarkText: "내부 검토용",
      downloadUrlLifetimeSeconds: 60,
      reportTitle: "감사인 선임 검토보고서",
      centerContact: "농협지원센터 02-0000-0000",
      logoAssetId: null,
      primaryColor: "#1F5D42",
      accentColor: "#D8A93A",
      fileNameRule: "FISCAL_YEAR_VERSION",
      customerDownloadDays: 30,
    };
    assert.equal(evaluationConfigSchema.safeParse(config).success, true);

    config.reportRenderingPolicy.reportTitle =
      '<script>alert("unsafe")</script>';
    config.reportRenderingPolicy.primaryColor = "var(--unsafe)";
    config.reportRenderingPolicy.customerDownloadDays = 0;
    assert.equal(evaluationConfigSchema.safeParse(config).success, false);
  });
});
