import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  auditEvaluationConfigVersionDocumentId,
} from "@/lib/audit-evaluation/admin-config-repository";
import { createDefaultAuditQualityDraft } from "@/lib/audit-evaluation/default-evaluation-draft";
import {
  adminConfigActionPayloadSchema,
  adminConfigCalculatePayloadSchema,
  adminConfigPatchPayloadSchema,
  buildPatchedDraft,
  calculateEvaluationPreview,
  validateEvaluationConfigForPublish,
} from "@/lib/audit-evaluation/admin-config-validation";
import { createValidEvaluationConfig } from "@/lib/audit-evaluation/testing/fixtures";

describe("admin config API payload validation", () => {
  it("authenticates before checking server-only feature flags", () => {
    const shared = readFileSync(
      join(
        process.cwd(),
        "app/api/admin/audit-evaluations/configs/_shared.ts",
      ),
      "utf8",
    );
    assert.ok(
      shared.indexOf('requireAdminCapability(request, "auditEvaluations:write")') >= 0,
    );
    assert.ok(
      shared.indexOf('requireAdminCapability(request, "auditEvaluations:write")') <
        shared.indexOf("getServerFeatureFlags()"),
    );
    for (const route of [
      "app/api/admin/audit-evaluations/configs/route.ts",
      "app/api/admin/audit-evaluations/configs/calculate/route.ts",
      "app/api/admin/audit-evaluations/configs/[configId]/[version]/route.ts",
      "app/api/admin/audit-evaluations/configs/[configId]/[version]/publish/route.ts",
    ]) {
      assert.match(
        readFileSync(join(process.cwd(), route), "utf8"),
        /requireConfigAdmin\(request\)/,
      );
    }
  });

  it("accepts only structured actions and patch allowlist fields", () => {
    assert.equal(
      adminConfigActionPayloadSchema.safeParse({
        action: "cloneVersion",
        configId: "fy27.default",
        version: 1,
      }).success,
      true,
    );
    assert.equal(
      adminConfigPatchPayloadSchema.safeParse({
        expectedDraftRevision: 1,
        changes: {
          name: "수정된 평가기준",
          status: "PUBLISHED",
        },
      }).success,
      false,
    );
    assert.equal(
      adminConfigPatchPayloadSchema.safeParse({
        expectedDraftRevision: 1,
        config: createValidEvaluationConfig(),
      }).success,
      false,
    );
  });

  it("requires a structured calculator sample instead of raw quote JSON", () => {
    const config = createValidEvaluationConfig();
    assert.equal(
      adminConfigCalculatePayloadSchema.safeParse({
        config,
        sample: { rawJson: "{}" },
      }).success,
      false,
    );
  });
});

describe("admin config repository invariants", () => {
  it("uses stable collision-free document ids for config versions", () => {
    const first = auditEvaluationConfigVersionDocumentId("a.v1", 2);
    const second = auditEvaluationConfigVersionDocumentId("a", 12);
    assert.notEqual(first, second);
    assert.equal(
      first,
      auditEvaluationConfigVersionDocumentId("a.v1", 2),
    );
  });

  it("edits bounded retention periods without changing protected policies", () => {
    const existing = {
      ...createValidEvaluationConfig(),
      draftRevision: 3,
    };
    const patched = buildPatchedDraft({
      existing,
      changes: {
        name: "새 이름",
        status: "PUBLISHED",
        requiredFields: ["accountingFirmName", "auditFee"],
        retentionPolicy: {
          sourceDocumentDays: 1,
          normalizedDataDays: 1,
          reportDays: 1,
          expiredAccessTokenDays: 1,
          auditLogDays: 365,
          deleteAfterExpiry: true,
        },
      } as never,
      actorUid: "admin-next",
      now: "2026-07-21T01:00:00.000Z",
    });
    assert.equal(patched.name, "새 이름");
    assert.equal(patched.status, "DRAFT");
    assert.deepEqual(patched.requiredFields, [
      "accountingFirmName",
      "auditFee",
    ]);
    assert.deepEqual(patched.retentionPolicy, {
      sourceDocumentDays: 1,
      normalizedDataDays: 1,
      reportDays: 1,
      expiredAccessTokenDays: 1,
      auditLogDays: 365,
      deleteAfterExpiry: true,
    });
    assert.deepEqual(
      patched.customerAccessPolicy,
      existing.customerAccessPolicy,
    );
    assert.equal(patched.draftRevision, 4);
    assert.equal(patched.updatedBy, "admin-next");
  });
});

describe("admin config publication validation", () => {
  it("reports range gaps as Korean path issues", () => {
    const config = createValidEvaluationConfig();
    const firstRule = config.criteria[0].rule;
    if (firstRule.type !== "range") assert.fail("range fixture required");
    firstRule.bands[1].minimumInclusive = {
      kind: "DECIMAL_STRING",
      value: "6000000000",
    };
    const validation = validateEvaluationConfigForPublish(config);
    assert.equal(validation.valid, false);
    assert.equal(
      validation.issues.some(
        (issue) =>
          issue.path.includes("bands") &&
          issue.message.includes("공백"),
      ),
      true,
    );
  });

  it("requires confirmation when published effective periods overlap", () => {
    const draft = createValidEvaluationConfig();
    draft.effectiveFrom = "2027-01-01T00:00:00.000Z";
    draft.effectiveTo = "2028-01-01T00:00:00.000Z";
    const published = {
      ...createValidEvaluationConfig(),
      version: 2,
      status: "PUBLISHED" as const,
      effectiveFrom: "2027-06-01T00:00:00.000Z",
      effectiveTo: null,
      publishedBy: "admin-old",
      publishedAt: "2026-07-20T00:00:00.000Z",
    };
    const validation = validateEvaluationConfigForPublish(draft, [published]);
    assert.equal(validation.valid, true);
    assert.equal(
      validation.issues.some((issue) => issue.severity === "warning"),
      true,
    );
  });

  it("blocks cross-config overlap and report retention shorter than download window", () => {
    const draft = createValidEvaluationConfig();
    draft.effectiveFrom = "2027-01-01T00:00:00.000Z";
    draft.effectiveTo = "2028-01-01T00:00:00.000Z";
    draft.reportRenderingPolicy = {
      watermarkEnabled: false,
      watermarkText: "내부 검토용",
      downloadUrlLifetimeSeconds: 60,
      customerDownloadDays: 30,
    };
    draft.retentionPolicy.reportDays = 7;
    const published = {
      ...createValidEvaluationConfig(),
      id: "fy27.other",
      version: 1,
      status: "PUBLISHED" as const,
      effectiveFrom: "2027-06-01T00:00:00.000Z",
      effectiveTo: null,
      publishedBy: "admin-old",
      publishedAt: "2026-07-20T00:00:00.000Z",
    };
    const validation = validateEvaluationConfigForPublish(draft, [published]);
    assert.equal(validation.valid, false);
    assert.ok(
      validation.issues.some(
        (issue) =>
          issue.severity === "error" &&
          issue.message.includes("다른 평가기준"),
      ),
    );
    assert.ok(
      validation.issues.some(
        (issue) =>
          issue.severity === "error" &&
          issue.path === "retentionPolicy.reportDays",
      ),
    );
  });

  it("archives overlapping published versions of the same config when publishing", () => {
    const repository = readFileSync(
      join(process.cwd(), "lib/audit-evaluation/admin-config-repository.ts"),
      "utf8",
    );
    assert.match(repository, /status:\s*"ARCHIVED"/);
    assert.match(repository, /periodsOverlap\(config,\s*published\)/);
  });

  it("locks mandatory report sections at publication", () => {
    const config = createDefaultAuditQualityDraft({
      createdBy: "admin-test",
      createdAt: "2026-07-21T00:00:00.000Z",
    });
    const cover = config.reportSections.find(
      ({ type }) => type === "COVER",
    );
    if (!cover) assert.fail("cover fixture required");
    cover.enabled = false;
    const validation = validateEvaluationConfigForPublish(config);
    assert.equal(validation.valid, false);
    assert.equal(
      validation.issues.some(
        (issue) =>
          issue.path === "reportSections" &&
          issue.message.includes("숨길 수 없습니다"),
      ),
      true,
    );
  });

  it("runs the existing deterministic scoring engine for preview", () => {
    const config = createValidEvaluationConfig();
    const payload = adminConfigCalculatePayloadSchema.parse({
      config,
      sample: {
        accountingFirmName: "미리보기 회계법인",
        accountingFirmRevenueWon: "6000000000",
        recentNonghyupAuditCount: 2,
        auditedNonghyupTypes: ["지역농협", "품목농협"],
        taxAgencyExperience: true,
        subsidySettlementExperience: true,
      },
    });
    const result = calculateEvaluationPreview(payload);
    assert.equal(result.engineVersion, "quality-scoring-engine-v1");
    assert.equal(result.score.totalScoreBasisPoints, 10_000);
  });
});
