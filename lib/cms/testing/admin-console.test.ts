import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Firestore } from "firebase-admin/firestore";
import { loadCmsAdminOverview } from "@/lib/cms/admin-console-data";
import {
  ADMIN_CONSOLE_MENU_MAP,
  ADMIN_CONSOLE_PAGE_FILTER_MAP,
  createAdminConsoleCopy,
} from "@/lib/cms/admin-console-content";
import {
  CMS_GLOBAL_PRESENTATION,
  CMS_PAGE_PRESENTATION,
  hasGlobalChanges,
  hasPageChanges,
} from "@/lib/cms/admin-console-presentation";
import { CMS_GLOBAL_DEFAULTS, CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";
import { validatePageContentForPublish } from "@/lib/cms/editor-validation";
import type {
  CmsDraftGlobal,
  CmsDraftPage,
  CmsPublishedGlobal,
  CmsPublishedPage,
} from "@/lib/cms/schemas";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const timestamp = "2026-07-20T12:00:00.000Z";

function emptyFirestore() {
  const snapshot = { docs: [] };
  const query = {
    get: async () => snapshot,
    orderBy: () => query,
    limit: () => query,
  };
  return {
    collection: () => query,
    getAll: async () => [],
  } as unknown as Firestore;
}

function pageDocuments() {
  const published: CmsPublishedPage = {
    schemaVersion: 1,
    pageKey: "home",
    route: "/",
    content: structuredClone(CMS_PAGE_DEFAULTS.home),
    version: 1,
    status: "published",
    publishedAt: timestamp,
  };
  const draft: CmsDraftPage = {
    schemaVersion: 1,
    pageKey: "home",
    route: "/",
    content: structuredClone(CMS_PAGE_DEFAULTS.home),
    version: 2,
    basePublishedVersion: 1,
    status: "draft",
    createdAt: timestamp,
    createdBy: "admin-uid",
    updatedAt: timestamp,
    updatedBy: "admin-uid",
  };
  return { published, draft };
}

function globalDocuments() {
  const published: CmsPublishedGlobal = {
    schemaVersion: 1,
    documentKey: "header",
    content: structuredClone(CMS_GLOBAL_DEFAULTS.header),
    version: 1,
    status: "published",
    publishedAt: timestamp,
  };
  const draft: CmsDraftGlobal = {
    schemaVersion: 1,
    documentKey: "header",
    content: structuredClone(CMS_GLOBAL_DEFAULTS.header),
    version: 2,
    basePublishedVersion: 1,
    status: "draft",
    createdAt: timestamp,
    createdBy: "admin-uid",
    updatedAt: timestamp,
    updatedBy: "admin-uid",
  };
  return { published, draft };
}

describe("CMS administrator console overview", () => {
  it("shows every page and common area from safe code defaults when Firebase is empty", async () => {
    const overview = await loadCmsAdminOverview(emptyFirestore());
    assert.equal(overview.pages.length, Object.keys(CMS_PAGE_DEFAULTS).length);
    assert.equal(overview.commonAreas.length, 8);
    assert.equal(
      overview.pages.every((page) => page.status === "default"),
      true,
    );
    assert.equal(
      overview.commonAreas.every((area) => area.status === "default"),
      true,
    );
    assert.equal(overview.counts.unpublishedDrafts, 0);
    assert.ok(overview.issues.some((issue) => issue.severity === "warning"));
  });

  it("detects only real unpublished content changes", () => {
    const page = pageDocuments();
    assert.equal(hasPageChanges(page.draft, page.published), false);
    page.draft.content.sections[0].title = "새 첫 화면 제목";
    assert.equal(hasPageChanges(page.draft, page.published), true);

    const global = globalDocuments();
    assert.equal(hasGlobalChanges(global.draft, global.published), false);
    global.draft.content.text.newNotice = "새 공통 안내";
    assert.equal(hasGlobalChanges(global.draft, global.published), true);
  });

  it("uses Korean business labels instead of implementation terminology", () => {
    const labels = [
      ...Object.values(CMS_PAGE_PRESENTATION).flatMap((item) => [
        item.name,
        item.description,
        item.audienceLabel,
        item.categoryLabel,
      ]),
      ...Object.values(CMS_GLOBAL_PRESENTATION).flatMap((item) => [
        item.name,
        item.description,
        item.affectedArea,
      ]),
    ].join(" ");
    for (const forbidden of [
      "heroTitle",
      "isVisible",
      "arrayItem",
      "slug",
      "schemaVersion",
    ]) {
      assert.doesNotMatch(labels, new RegExp(forbidden, "i"));
    }
  });
});

describe("CMS administrator route security contract", () => {
  it("protects overview and publish endpoints with the admin token guard", () => {
    for (const relativePath of [
      "app/api/admin/cms/overview/route.ts",
      "app/api/admin/cms/pages/[pageKey]/publish/route.ts",
    ]) {
      const source = readFileSync(path.join(root, relativePath), "utf8");
      assert.match(source, /await requireAdminCapability\(request, "cms:(read|write)"\)/);
    }
  });

  it("does not render raw structured-data or code editors", () => {
    const source = readFileSync(
      path.join(root, "components/CmsAdminConsole.tsx"),
      "utf8",
    );
    assert.doesNotMatch(source, /<textarea/i);
    assert.doesNotMatch(source, /contentEditable/i);
    assert.doesNotMatch(source, /type=["']file["']/i);
    assert.doesNotMatch(source, />\s*(JSON|HTML|CSS)\s*</i);
    assert.doesNotMatch(
      source,
      /[가-힣]/,
      "visible Korean copy must come from admin.console CMS content",
    );
  });

  it("keeps menu, category, API, auth, and publish values outside CMS copy", () => {
    const content = structuredClone(CMS_PAGE_DEFAULTS["admin.console"]);
    const navigation = content.sections.find(
      (section) => section.id === "navigation",
    );
    const pages = content.sections.find((section) => section.id === "pages");
    assert.ok(navigation);
    assert.ok(pages);
    navigation.items.find((item) => item.id === "pages")!.title =
      "/api/admin/unsafe";
    pages.items.find((item) => item.id === "filter.member")!.title =
      "표시 이름 변경";

    const copy = createAdminConsoleCopy(content);
    assert.equal(
      copy.menus.find((item) => item.key === "pages")?.title,
      "/api/admin/unsafe",
    );
    assert.deepEqual(
      copy.menus.map((item) => item.key),
      ADMIN_CONSOLE_MENU_MAP.map((item) => item.value),
    );
    assert.deepEqual(
      copy.pageFilters.map((item) => item.value),
      ADMIN_CONSOLE_PAGE_FILTER_MAP.map((item) => item.value),
    );

    const source = readFileSync(
      path.join(root, "components/CmsAdminConsole.tsx"),
      "utf8",
    );
    assert.match(source, /tokenResult\.claims\.admin !== true/);
    assert.match(source, /getIdToken\(\)/);
    assert.ok(source.includes('fetch("/api/admin/cms/overview"'));
    assert.ok(
      source.includes(
        "`/api/admin/cms/pages/${encodeURIComponent(publishTarget.id)}/publish`",
      ),
    );
    assert.ok(
      source.includes(
        "expectedDraftVersion: publishTarget.draftVersion",
      ),
    );
  });

  it("rejects publishing when required console tabs or filters are hidden", () => {
    const content = structuredClone(CMS_PAGE_DEFAULTS["admin.console"]);
    const navigation = content.sections.find(
      (section) => section.id === "navigation",
    );
    const pages = content.sections.find((section) => section.id === "pages");
    assert.ok(navigation);
    assert.ok(pages);
    navigation.items.find((item) => item.id === "history")!.visible = false;
    pages.items.find((item) => item.id === "filter.admin")!.deleted = true;

    const issues = validatePageContentForPublish(content, "admin.console");
    assert.ok(
      issues.some(
        (issue) =>
          issue.severity === "error" &&
          issue.sectionId === "navigation",
      ),
    );
    assert.ok(
      issues.some(
        (issue) =>
          issue.severity === "error" && issue.sectionId === "pages",
      ),
    );
  });

  it("renders only published console content and uses an isolated preview fixture", () => {
    const page = readFileSync(
      path.join(root, "app/admin/page.tsx"),
      "utf8",
    );
    const preview = readFileSync(
      path.join(root, "components/cms-editor/CmsActualPagePreview.tsx"),
      "utf8",
    );
    const publicLoader = readFileSync(
      path.join(root, "lib/cms/public-content.ts"),
      "utf8",
    );
    assert.match(page, /loadPublishedCmsPage\("admin\.console"\)/);
    assert.match(page, /cmsPageMetadata\(bundle\.content, bundle\.assetUrls\)/);
    assert.match(page, /<CmsAdminConsole[\s\S]*content=\{content\}/);
    assert.match(
      page,
      /canManageTestData=\{account\.role === "super_admin"\}/,
    );
    assert.doesNotMatch(page, /draft|loadCmsPageEditorData/i);
    assert.match(publicLoader, /resolvePublishedPage\(repository, pageKey\)/);
    assert.match(
      preview,
      /<CmsAdminConsole content=\{content\} previewMode \/>/,
    );

    const consoleSource = readFileSync(
      path.join(root, "components/CmsAdminConsole.tsx"),
      "utf8",
    );
    assert.match(consoleSource, /if \(previewMode\) return undefined/);
    assert.match(
      consoleSource,
      /if \(!currentUser \|\| previewMode\) return/,
    );
    assert.match(
      consoleSource,
      /if \(previewMode \|\| !currentUser \|\| !publishTarget/,
    );
    assert.match(
      consoleSource,
      /previewMode \? ADMIN_CONSOLE_PREVIEW_OVERVIEW : null/,
    );
  });
});
