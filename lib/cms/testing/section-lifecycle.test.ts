import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";
import {
  createBlankCmsSection,
  duplicateCmsSection,
  normalizePageContentForPublish,
  validatePageContentForPublish,
} from "@/lib/cms/editor-validation";
import { normalizeCmsPageContent } from "@/lib/cms/page-content";
import {
  canSoftDeleteCmsSection,
  getCmsSupplementalSections,
} from "@/lib/cms/section-lifecycle";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("CMS section add/delete lifecycle", () => {
  it("soft-deletes non-locked sections and strips them before publish", () => {
    const content = structuredClone(CMS_PAGE_DEFAULTS.home);
    const target = content.sections.find((section) => !section.locked);
    assert.ok(target);
    assert.equal(canSoftDeleteCmsSection(content, target.id), true);
    target.deleted = true;
    target.visible = false;

    const published = normalizePageContentForPublish(content);
    assert.equal(
      published.sections.some((section) => section.id === target.id),
      false,
    );
    assert.equal(
      content.sections.some((section) => section.id === target.id),
      true,
    );
  });

  it("blocks deleting locked or last remaining sections", () => {
    const partner = structuredClone(CMS_PAGE_DEFAULTS["partner.apply"]);
    for (const section of partner.sections) {
      assert.equal(canSoftDeleteCmsSection(partner, section.id), false);
    }

    const single = structuredClone(CMS_PAGE_DEFAULTS["framework.notFound"]);
    assert.equal(canSoftDeleteCmsSection(single, single.sections[0].id), false);
  });

  it("rejects publishing when a required section is soft-deleted", () => {
    const content = structuredClone(CMS_PAGE_DEFAULTS["partner.apply"]);
    content.sections[0].deleted = true;
    content.sections[0].locked = false;
    const issues = validatePageContentForPublish(content, "partner.apply");
    assert.ok(
      issues.some(
        (issue) =>
          issue.severity === "error" && issue.code === "required_section",
      ),
    );
  });

  it("restores locked required sections if a draft marks them deleted", () => {
    const content = structuredClone(CMS_PAGE_DEFAULTS["legal.terms"]);
    const required = content.sections.find((section) => section.locked);
    assert.ok(required);
    required.deleted = true;
    const normalized = normalizeCmsPageContent("legal.terms", content);
    const restored = normalized.sections.find(
      (section) => section.id === required.id,
    );
    assert.ok(restored);
    assert.equal(restored.deleted, false);
    assert.equal(restored.visible, true);
    assert.equal(restored.locked, true);
  });

  it("creates blank and duplicated sections as unlocked custom sections", () => {
    const blank = createBlankCmsSection("안내 영역");
    assert.equal(blank.locked, false);
    assert.equal(blank.deleted, false);
    assert.match(blank.id, /^section_/);

    const source = structuredClone(CMS_PAGE_DEFAULTS.home.sections[0]);
    const copy = duplicateCmsSection(source);
    assert.notEqual(copy.id, source.id);
    assert.equal(copy.locked, false);
    assert.equal(copy.deleted, false);
    assert.match(copy.title, /복사본$/);

    const page = structuredClone(CMS_PAGE_DEFAULTS["partner.apply"]);
    page.sections.push(blank);
    const extras = getCmsSupplementalSections(page, "partner.apply");
    assert.equal(extras.length, 1);
    assert.equal(extras[0].id, blank.id);
  });

  it("exposes add/delete/restore controls in the page editor sidebar", () => {
    const sidebar = readFileSync(
      path.join(root, "components/cms-editor/CmsEditorSidebar.tsx"),
      "utf8",
    );
    const editor = readFileSync(
      path.join(root, "components/cms-editor/CmsPageEditor.tsx"),
      "utf8",
    );
    assert.match(sidebar, /영역 추가/);
    assert.match(sidebar, /onRequestDeleteSection/);
    assert.match(sidebar, /onRestoreSection/);
    assert.match(editor, /createBlankCmsSection/);
    assert.match(editor, /softDeleteSection/);
    assert.match(editor, /영역 삭제하고 보관/);
  });
});
