import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CMS_GLOBAL_DEFAULTS,
  CMS_PAGE_DEFAULTS,
} from "@/lib/cms/defaults";
import { normalizePageContentForPublish } from "@/lib/cms/editor-validation";
import { loadCmsGlobalEditorData } from "@/lib/cms/global-editor-data";
import type { FirestoreCmsRepository } from "@/lib/cms/repository";
import {
  cmsGlobalContentSchema,
  cmsPageContentSchema,
  type CmsDraftGlobal,
  type CmsPublishedGlobal,
} from "@/lib/cms/schemas";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const timestamp = "2026-07-21T00:00:00.000Z";

describe("homepage CMS operating defaults", () => {
  it("matches every existing homepage business area", () => {
    const home = cmsPageContentSchema.parse(CMS_PAGE_DEFAULTS.home);
    assert.deepEqual(
      home.sections.map((section) => section.id),
      [
        "hero",
        "about",
        "expertise",
        "services",
        "process",
        "caseStudies",
        "faqPreview",
      ],
    );
    assert.equal(
      home.sections.find((section) => section.id === "hero")?.title,
      "농협 업무의\n복잡한 전문 문의를",
    );
    assert.equal(
      home.sections
        .find((section) => section.id === "hero")
        ?.groups.find((group) => group.id === "serviceSummary")?.items.length,
      4,
    );
    assert.equal(
      home.sections
        .find((section) => section.id === "about")
        ?.groups.find((group) => group.id === "customerValue")?.items.length,
      4,
    );
    assert.equal(
      home.sections.find((section) => section.id === "expertise")?.items.length,
      4,
    );
    assert.equal(
      home.sections.find((section) => section.id === "services")?.items.length,
      9,
    );
    assert.equal(
      home.sections.find((section) => section.id === "process")?.items.length,
      4,
    );
    assert.equal(
      home.sections.find((section) => section.id === "faqPreview")?.items.length,
      4,
    );
  });

  it("keeps existing navigation, authentication, footer and support links", () => {
    const header = cmsGlobalContentSchema.parse(CMS_GLOBAL_DEFAULTS.header);
    const footer = cmsGlobalContentSchema.parse(CMS_GLOBAL_DEFAULTS.footer);
    const support = cmsGlobalContentSchema.parse(CMS_GLOBAL_DEFAULTS.support);
    assert.deepEqual(
      header.navigation.map(({ label, href }) => [label, href]),
      [
        ["센터소개", "/#about"],
        ["전문성", "/#expertise"],
        ["지원분야", "/#services"],
        ["상담흐름", "/#process"],
        ["문의게시판", "/inquiries"],
        ["FAQ", "/#faq"],
      ],
    );
    assert.equal(header.links.consult.href, "/consult");
    assert.equal(header.links.login.href, "/login");
    assert.equal(header.links.signup.href, "/signup");
    assert.equal(header.links.mypage.href, "/mypage");
    assert.equal(footer.links.consult.href, "/consult");
    assert.equal(footer.links.inquiries.href, "/inquiries");
    assert.equal(footer.links.partnerLogin.label, "제휴사 로그인");
    assert.equal(footer.links.partnerLogin.href, "/partner/login");
    assert.equal(footer.links.operatorLogin.label, "운영자 로그인");
    assert.equal(footer.links.operatorLogin.href, "/admin/login");
    assert.equal(
      footer.text.portalLoginNavigationLabel,
      "제휴사 및 운영자 로그인",
    );
    assert.equal(support.links.support.href, "/support");
  });

  it("supports explicit page overrides without copying common documents", () => {
    const content = structuredClone(CMS_PAGE_DEFAULTS.home);
    content.commonOverrides = {
      header: { hidden: true },
      footer: {
        text: { copyright: "페이지 전용 하단 문구" },
      },
    };
    const result = cmsPageContentSchema.parse(content);
    assert.equal(result.commonOverrides?.header?.hidden, true);
    assert.equal(
      result.commonOverrides?.footer?.text?.copyright,
      "페이지 전용 하단 문구",
    );
  });

  it("removes soft-deleted nested homepage items before publishing", () => {
    const content = structuredClone(CMS_PAGE_DEFAULTS.home);
    const group = content.sections[0].groups[0];
    group.items[0].deleted = true;
    const normalized = normalizePageContentForPublish(content);
    assert.equal(normalized.sections[0].groups[0].items.length, 3);
    assert.equal(content.sections[0].groups[0].items.length, 4);
  });
});

describe("published-only public rendering contract", () => {
  it("loads the public homepage on the server and uses the actual renderer", () => {
    const pageSource = readFileSync(path.join(root, "app/page.tsx"), "utf8");
    const loaderSource = readFileSync(
      path.join(root, "lib/cms/public-content.ts"),
      "utf8",
    );
    const rendererSource = readFileSync(
      path.join(root, "components/HomePageRenderer.tsx"),
      "utf8",
    );
    assert.match(pageSource, /loadPublishedHome\(\)/);
    assert.match(pageSource, /HomePageRenderer/);
    assert.doesNotMatch(pageSource, /getDraft|cmsDraft/i);
    assert.match(loaderSource, /resolvePublishedPage/);
    assert.match(loaderSource, /resolvePublishedGlobals/);
    assert.doesNotMatch(loaderSource, /getDraftPage|getDraftGlobal/);
    for (const component of [
      "Hero",
      "About",
      "Expertise",
      "Services",
      "Process",
      "CaseStudies",
      "FAQ",
      "Topbar",
      "Footer",
    ]) {
      assert.match(rendererSource, new RegExp(`<${component}`));
    }
  });

  it("keeps authenticated consultation routing protected in the header", () => {
    const topbarSource = readFileSync(
      path.join(root, "components/Topbar.tsx"),
      "utf8",
    );
    assert.match(topbarSource, /ConsultRequestLink/);
    assert.match(topbarSource, /onAuthStateChanged/);
    assert.match(topbarSource, /header\.links\.mypage/);
    assert.match(topbarSource, /header\.links\.signup/);
    assert.match(topbarSource, /header\.links\.login/);
  });
});

describe("common-area editor lifecycle", () => {
  it("loads a common draft only into the admin preview", async () => {
    const published: CmsPublishedGlobal = {
      schemaVersion: 1,
      documentKey: "header",
      content: structuredClone(CMS_GLOBAL_DEFAULTS.header),
      version: 2,
      status: "published",
      publishedAt: timestamp,
    };
    const draft: CmsDraftGlobal = {
      schemaVersion: 1,
      documentKey: "header",
      content: structuredClone(CMS_GLOBAL_DEFAULTS.header),
      version: 4,
      basePublishedVersion: 2,
      status: "draft",
      createdAt: timestamp,
      createdBy: "admin-one",
      updatedAt: timestamp,
      updatedBy: "admin-two",
    };
    draft.content.navigation[0].label = "편집 중인 센터 소개";
    const repository = {
      getDraftGlobal: async (key: string) =>
        key === "header" ? draft : null,
      getPublishedGlobal: async (key: string) =>
        key === "header" ? published : null,
      getPublishedGlobals: async () => ({ header: published }),
      listGlobalRevisions: async () => [],
      getDraftPage: async () => null,
      getPublishedPage: async () => null,
      getAssets: async () => [],
    } as unknown as FirestoreCmsRepository;
    const editor = await loadCmsGlobalEditorData("header", repository);
    assert.equal(
      editor.content.navigation[0].label,
      "편집 중인 센터 소개",
    );
    assert.equal(
      editor.publishedContent.navigation[0].label,
      "센터소개",
    );
    assert.equal(
      editor.previewGlobals.header.navigation[0].label,
      "편집 중인 센터 소개",
    );
  });

  it("guards save, publish and rollback endpoints with admin claims", () => {
    for (const relativePath of [
      "app/api/admin/cms/globals/[documentKey]/route.ts",
      "app/api/admin/cms/globals/[documentKey]/publish/route.ts",
      "app/api/admin/cms/globals/[documentKey]/revisions/[revisionId]/restore/route.ts",
    ]) {
      const source = readFileSync(path.join(root, relativePath), "utf8");
      assert.match(source, /requireAdminCapability\(request, "cms:(read|write)"\)/);
    }
  });

  it("uses app dialogs instead of browser confirm prompts", () => {
    const source = [
      "components/cms-editor/CmsCommonAreaEditor.tsx",
      "components/cms-editor/CmsCommonAreaSettings.tsx",
      "components/cms-editor/CmsPageEditor.tsx",
      "components/cms-editor/CmsEditorSettings.tsx",
      "components/cms-editor/CmsEditorDialog.tsx",
    ]
      .map((relativePath) =>
        readFileSync(path.join(root, relativePath), "utf8"),
      )
      .join("\n");
    assert.doesNotMatch(source, /window\.(confirm|prompt)/);
    assert.match(source, /role="dialog"/);
    assert.match(source, /event\.key === "Escape"/);
    assert.match(source, /event\.key !== "Tab"/);
  });

  it("does not lose edits made while a common-area autosave is in flight", () => {
    const source = readFileSync(
      path.join(root, "components/cms-editor/CmsCommonAreaEditor.tsx"),
      "utf8",
    );
    assert.match(source, /pendingSaveRef\.current = true/);
    assert.match(source, /setSaveTick\(\(tick\) => tick \+ 1\)/);
    assert.match(source, /window\.addEventListener\("beforeunload"/);
    assert.match(source, /response\.status === 409[\s\S]*복원할 버전/);
  });
});
