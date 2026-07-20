import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";
import {
  contrastRatio,
  normalizePageContentForPublish,
  validatePageContentForPublish,
} from "@/lib/cms/editor-validation";
import { loadCmsPageEditorData } from "@/lib/cms/page-editor-data";
import { activeCmsMediaAssetIds } from "@/lib/cms/media";
import { matchesCmsFileSignature } from "@/lib/cms/file-signature";
import type { FirestoreCmsRepository } from "@/lib/cms/repository";
import {
  cmsPageContentSchema,
  cmsSectionStyleSchema,
  type CmsDraftPage,
  type CmsPublishedPage,
} from "@/lib/cms/schemas";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const timestamp = "2026-07-20T12:00:00.000Z";

describe("CMS page editor schema and checks", () => {
  it("accepts approved responsive styles and rejects values outside safe ranges", () => {
    const style = {
      title: {
        fontFamily: "pretendard",
        sizePreset: "large",
        customSizePx: { desktop: 64, tablet: 48, mobile: 34 },
        fontWeight: "700",
        lineHeightPreset: "default",
        customLineHeight: { desktop: 1.4, mobile: 1.3 },
        alignment: "center",
        color: "text",
      },
      body: {
        fontFamily: "system",
        sizePreset: "default",
        fontWeight: "400",
        lineHeightPreset: "relaxed",
        alignment: "left",
        color: "muted",
      },
      container: {
        background: "softBlue",
        spacing: "relaxed",
        customPaddingY: { desktop: 96, tablet: 72, mobile: 40 },
        border: "subtle",
        radius: "rounded",
        shadow: "soft",
      },
    };
    assert.equal(cmsSectionStyleSchema.safeParse(style).success, true);
    assert.equal(
      cmsSectionStyleSchema.safeParse({
        ...style,
        title: { ...style.title, customSizePx: { desktop: 200 } },
      }).success,
      false,
    );
    assert.equal(
      cmsSectionStyleSchema.safeParse({
        ...style,
        container: { ...style.container, rawCss: "display:none" },
      }).success,
      false,
    );
  });

  it("separates internal and external links", () => {
    const content = structuredClone(CMS_PAGE_DEFAULTS.home);
    const action = content.sections[0].actions[0];
    action.linkType = "external";
    action.href = "/consult";
    assert.equal(cmsPageContentSchema.safeParse(content).success, false);
    action.href = "https://example.com/support";
    assert.equal(cmsPageContentSchema.safeParse(content).success, true);
  });

  it("warns for heading order and low contrast before publishing", () => {
    const content = structuredClone(CMS_PAGE_DEFAULTS.home);
    content.sections[0].headingLevel = 3;
    content.sections[0].style.title.color = "white";
    content.sections[0].style.container.background = "surface";
    const issues = validatePageContentForPublish(content);
    assert.ok(issues.some((issue) => issue.code === "heading_order"));
    assert.ok(issues.some((issue) => issue.code === "low_contrast"));
    assert.ok(contrastRatio("white", "surface") < 3);
  });

  it("removes soft-deleted repeat items from the public snapshot", () => {
    const content = structuredClone(CMS_PAGE_DEFAULTS.home);
    const sectionIndex = content.sections.findIndex(
      (section) => section.items.length > 0,
    );
    assert.ok(sectionIndex >= 0);
    content.sections[sectionIndex].items[0].deleted = true;
    const normalized = normalizePageContentForPublish(content);
    assert.equal(
      normalized.sections[sectionIndex].items.some(
        (item) => item.id === content.sections[sectionIndex].items[0].id,
      ),
      false,
    );
    assert.equal(content.sections[sectionIndex].items[0].deleted, true);
  });

  it("keeps deleted images recoverable without publishing their asset", () => {
    const content = structuredClone(CMS_PAGE_DEFAULTS.home);
    content.sections[0].media = {
      assetId: "recoverableHero",
      alt: "복원 가능한 첫 화면 이미지",
      aspectRatio: "16:9",
      deleted: true,
    };
    const parsed = cmsPageContentSchema.parse(content);
    assert.equal(parsed.sections[0].media?.deleted, true);
    assert.deepEqual(activeCmsMediaAssetIds(parsed.sections), []);

    parsed.sections[0].media!.deleted = false;
    assert.deepEqual(activeCmsMediaAssetIds(parsed.sections), [
      "recoverableHero",
    ]);
  });

  it("checks uploaded file signatures instead of trusting MIME metadata", () => {
    assert.equal(
      matchesCmsFileSignature(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/png",
      ),
      true,
    );
    assert.equal(
      matchesCmsFileSignature(
        new TextEncoder().encode("<svg onload=alert(1)>"),
        "image/png",
      ),
      false,
    );
    assert.equal(
      matchesCmsFileSignature(
        new TextEncoder().encode("%PDF-1.7"),
        "application/pdf",
      ),
      true,
    );
  });
});

describe("CMS page editor data separation", () => {
  it("loads draft for editing and published content for comparison", async () => {
    const published: CmsPublishedPage = {
      schemaVersion: 1,
      pageKey: "home",
      route: "/",
      content: structuredClone(CMS_PAGE_DEFAULTS.home),
      version: 3,
      status: "published",
      publishedAt: timestamp,
    };
    const draft: CmsDraftPage = {
      schemaVersion: 1,
      pageKey: "home",
      route: "/",
      content: structuredClone(CMS_PAGE_DEFAULTS.home),
      version: 7,
      basePublishedVersion: 3,
      status: "draft",
      createdAt: timestamp,
      createdBy: "admin-one",
      updatedAt: timestamp,
      updatedBy: "admin-two",
    };
    draft.content.sections[0].title = "편집 중인 제목";
    const repository = {
      getDraftPage: async () => draft,
      getPublishedPage: async () => published,
      listPageRevisions: async () => [],
      getAssets: async () => [],
    } as unknown as FirestoreCmsRepository;
    const editor = await loadCmsPageEditorData("home", repository);
    assert.equal(editor.content.sections[0].title, "편집 중인 제목");
    assert.notEqual(
      editor.publishedContent.sections[0].title,
      editor.content.sections[0].title,
    );
    assert.equal(editor.draftVersion, 7);
    assert.equal(editor.hasUnpublishedChanges, true);
  });
});

describe("CMS page editor security and usability contract", () => {
  it("guards every draft, publish, restore, and asset endpoint", () => {
    for (const relativePath of [
      "app/api/admin/cms/pages/[pageKey]/route.ts",
      "app/api/admin/cms/pages/[pageKey]/publish/route.ts",
      "app/api/admin/cms/pages/[pageKey]/revisions/[revisionId]/restore/route.ts",
      "app/api/admin/cms/assets/finalize/route.ts",
    ]) {
      const source = readFileSync(path.join(root, relativePath), "utf8");
      assert.match(source, /requireAdmin\(request\)/);
    }
  });

  it("does not expose raw code editors or protected implementation labels", () => {
    const source = [
      "components/cms-editor/CmsPageEditor.tsx",
      "components/cms-editor/CmsEditorSettings.tsx",
      "components/cms-editor/CmsEditorSidebar.tsx",
    ]
      .map((relativePath) =>
        readFileSync(path.join(root, relativePath), "utf8"),
      )
      .join("\n");
    assert.doesNotMatch(source, /contentEditable/i);
    assert.doesNotMatch(source, /dangerouslySetInnerHTML/i);
    assert.doesNotMatch(
      source,
      />\s*(JSON|HTML|CSS|schemaVersion|Firestore|API endpoint)\s*</i,
    );
  });
});
