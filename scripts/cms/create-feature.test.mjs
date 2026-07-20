import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createCmsFeature } from "../create-cms-feature.mjs";

describe("CMS feature generator", () => {
  it("creates defaults, schema, editor definition, registry definition, and fallback test", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "cms-feature-"));
    try {
      const result = createCmsFeature({
        projectRoot,
        key: "public.generatedExample",
        name: "생성 예제",
        route: "/generated-example",
        access: ["guest", "member"],
        previewRenderer: "generic",
      });

      for (const fileName of [
        "schema.ts",
        "default-content.ts",
        "editor.ts",
        "definition.ts",
        "REGISTER.md",
      ]) {
        assert.equal(existsSync(path.join(result.featureDirectory, fileName)), true);
      }
      assert.equal(existsSync(result.testFile), true);
      assert.match(
        readFileSync(
          path.join(result.featureDirectory, "definition.ts"),
          "utf8",
        ),
        /protectedTargets:[\s\S]*previewRenderer:[\s\S]*adminMenu:/,
      );
      assert.match(
        readFileSync(result.testFile, "utf8"),
        /valid code default when CMS data is unavailable/,
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("refuses invalid routes and access values", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "cms-feature-"));
    try {
      assert.throws(
        () =>
          createCmsFeature({
            projectRoot,
            key: "public.invalid",
            name: "잘못된 예제",
            route: "missing-leading-slash",
            access: ["guest"],
          }),
        /App Router/,
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
