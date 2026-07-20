import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  auditCmsDefinitions,
  auditCmsRouteCoverage,
  runCmsAudit,
} from "@/lib/cms/audit";
import {
  CMS_FEATURE_REGISTRY,
  type CmsFeatureDefinition,
} from "@/lib/cms/feature-registry";
import type { CmsRepository } from "@/lib/cms/repository";
import { resolvePublishedPage } from "@/lib/cms/resolver";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const definitions = Object.values(CMS_FEATURE_REGISTRY);

describe("central CMS feature registry", () => {
  it("covers every App Router user page or a documented exception", () => {
    const result = runCmsAudit(root);
    assert.deepEqual(result.issues, []);
    assert.equal(
      result.discoveredRoutes.length,
      result.registeredRoutes.length + result.exceptionRoutes.length,
    );
  });

  it("detects a newly routed screen without CMS registration", () => {
    const issues = auditCmsRouteCoverage(
      ["/", "/new-hardcoded-screen"],
      [CMS_FEATURE_REGISTRY.home],
      [],
    );
    assert.ok(
      issues.some(
        (auditIssue) =>
          auditIssue.code === "unregistered_route" &&
          auditIssue.target === "/new-hardcoded-screen",
      ),
    );
  });

  it("rejects incomplete definitions and missing fallback tests", () => {
    const incomplete = {
      ...CMS_FEATURE_REGISTRY.home,
      protectedTargets: [],
      fallbackTest: "lib/cms/testing/does-not-exist.test.ts",
    } as CmsFeatureDefinition;
    const issues = auditCmsDefinitions([incomplete], root);
    assert.ok(
      issues.some(
        (auditIssue) => auditIssue.code === "missing_protected_targets",
      ),
    );
    assert.ok(
      issues.some((auditIssue) => auditIssue.code === "missing_fallback_test"),
    );
  });

  it("returns isolated code defaults for every registered page", async () => {
    const repository = {
      getPublishedPage: async () => null,
    } as unknown as CmsRepository;

    for (const definition of definitions) {
      const resolved = await resolvePublishedPage(
        repository,
        definition.pageKey,
      );
      assert.equal(resolved.source, "default");
      assert.deepEqual(resolved.content, definition.defaultContent);
      assert.notEqual(resolved.content, definition.defaultContent);
    }
  });
});
