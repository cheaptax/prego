import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeAuditQuoteCmsContent } from "@/lib/cms/audit-quote-content";
import {
  CMS_PAGE_DEFAULTS,
  validatePageIdentity,
} from "@/lib/cms/defaults";
import { validatePageContentForPublish } from "@/lib/cms/editor-validation";
import { loadCmsPageEditorData } from "@/lib/cms/page-editor-data";
import type { FirestoreCmsRepository } from "@/lib/cms/repository";
import type {
  CmsDraftPage,
  CmsPublishedPage,
} from "@/lib/cms/schemas";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const timestamp = "2026-07-20T12:00:00.000Z";

describe("FY27 audit-quote CMS defaults", () => {
  it("matches every current public section and legally locks intake and disclaimer", () => {
    const content = CMS_PAGE_DEFAULTS["event.auditQuote"];
    assert.deepEqual(
      content.sections.map((section) => section.id),
      ["hero", "intakeForm", "benefits", "steps", "faq", "legalNotice"],
    );
    assert.equal(content.sections[0].eyebrow, "FY27 회계감사 견적");
    assert.equal(
      content.sections[0].title,
      "회계법인 견적,\n한 번에 비교하세요",
    );
    const intake = content.sections.find(
      (section) => section.id === "intakeForm",
    );
    const legal = content.sections.find(
      (section) => section.id === "legalNotice",
    );
    assert.equal(intake?.locked, true);
    assert.equal(intake?.visible, true);
    assert.equal(legal?.locked, true);
    assert.equal(legal?.visible, true);
    assert.equal(
      intake?.text.privacyConsentLabel,
      "[필수] 개인정보 수집·이용 동의",
    );
    assert.match(legal?.description ?? "", /감사의견이나 감사결과/);
    assert.equal(
      content.sections.find((section) => section.id === "benefits")?.items
        .length,
      3,
    );
    assert.equal(
      content.sections.find((section) => section.id === "steps")?.items.length,
      3,
    );
    assert.equal(
      content.sections.find((section) => section.id === "faq")?.items.length,
      3,
    );
  });

  it("hydrates legacy published content without exposing drafts or losing order", () => {
    const legacy = structuredClone(CMS_PAGE_DEFAULTS["event.auditQuote"]);
    legacy.messages = { genericError: "기존 오류" };
    legacy.sections[0].title = "게시된 제목";
    legacy.sections[2].items = [];
    legacy.sections = [
      legacy.sections[0],
      legacy.sections[2],
      legacy.sections[1],
      legacy.sections[3],
      legacy.sections[4],
      legacy.sections[5],
    ];
    const normalized = normalizeAuditQuoteCmsContent(legacy);
    assert.equal(normalized.sections[0].title, "게시된 제목");
    assert.equal(normalized.sections[1].id, "benefits");
    assert.equal(normalized.sections[1].items.length, 3);
    assert.equal(normalized.messages.genericError, "기존 오류");
    assert.ok(normalized.messages.successTitle);
  });
});

describe("FY27 audit-quote legal publishing safeguards", () => {
  it("blocks missing, hidden, or empty required legal content", () => {
    const hidden = structuredClone(CMS_PAGE_DEFAULTS["event.auditQuote"]);
    const intake = hidden.sections.find(
      (section) => section.id === "intakeForm",
    );
    assert.ok(intake);
    intake.visible = false;
    intake.locked = false;
    intake.text.privacyConsentLabel = "";
    const hiddenIssues = validatePageContentForPublish(
      hidden,
      "event.auditQuote",
    );
    assert.equal(
      validatePageIdentity(
        "event.auditQuote",
        "/events/audit-quote",
        hidden,
      ).success,
      false,
    );
    assert.ok(
      hiddenIssues.some(
        (issue) =>
          issue.code === "required_section" &&
          issue.sectionId === "intakeForm",
      ),
    );
    assert.ok(
      hiddenIssues.some(
        (issue) =>
          issue.code === "required_text" &&
          issue.sectionId === "intakeForm",
      ),
    );

    const removed = structuredClone(CMS_PAGE_DEFAULTS["event.auditQuote"]);
    removed.sections = removed.sections.filter(
      (section) => section.id !== "legalNotice",
    );
    const removedIssues = validatePageContentForPublish(
      removed,
      "event.auditQuote",
    );
    assert.ok(
      removedIssues.some(
        (issue) =>
          issue.code === "required_section" &&
          issue.sectionId === "legalNotice",
      ),
    );
  });

  it("allows legal copy edits with an explicit publish warning", () => {
    const content = structuredClone(CMS_PAGE_DEFAULTS["event.auditQuote"]);
    const legal = content.sections.find(
      (section) => section.id === "legalNotice",
    );
    assert.ok(legal);
    legal.description = "검토를 거친 새 면책문구입니다.";
    const issues = validatePageContentForPublish(
      content,
      "event.auditQuote",
    );
    assert.ok(
      issues.some(
        (issue) =>
          issue.code === "legal_copy_changed" &&
          issue.severity === "warning" &&
          issue.sectionId === "legalNotice",
      ),
    );
    assert.equal(issues.some((issue) => issue.severity === "error"), false);
  });
});

describe("FY27 audit-quote draft and public separation", () => {
  it("loads draft only in the administrator editor and keeps published comparison", async () => {
    const publishedContent = structuredClone(
      CMS_PAGE_DEFAULTS["event.auditQuote"],
    );
    const draftContent = structuredClone(publishedContent);
    draftContent.sections[0].title = "아직 게시하지 않은 제목";
    const published: CmsPublishedPage = {
      schemaVersion: 1,
      pageKey: "event.auditQuote",
      route: "/events/audit-quote",
      content: publishedContent,
      version: 4,
      status: "published",
      publishedAt: timestamp,
    };
    const draft: CmsDraftPage = {
      schemaVersion: 1,
      pageKey: "event.auditQuote",
      route: "/events/audit-quote",
      content: draftContent,
      version: 8,
      basePublishedVersion: 4,
      status: "draft",
      createdAt: timestamp,
      createdBy: "admin-one",
      updatedAt: timestamp,
      updatedBy: "admin-one",
    };
    const repository = {
      getDraftPage: async () => draft,
      getPublishedPage: async () => published,
      listPageRevisions: async () => [],
      getAssets: async () => [],
    } as unknown as FirestoreCmsRepository;
    const editor = await loadCmsPageEditorData(
      "event.auditQuote",
      repository,
    );
    assert.equal(editor.content.sections[0].title, "아직 게시하지 않은 제목");
    assert.equal(
      editor.publishedContent.sections[0].title,
      "회계법인 견적,\n한 번에 비교하세요",
    );
    assert.equal(editor.hasUnpublishedChanges, true);
  });

  it("public route resolves only the published CMS page and uses the actual renderer", () => {
    const publicLoader = readFileSync(
      path.join(root, "lib/cms/public-content.ts"),
      "utf8",
    );
    const route = readFileSync(
      path.join(root, "app/events/audit-quote/page.tsx"),
      "utf8",
    );
    const editor = readFileSync(
      path.join(root, "components/cms-editor/CmsPageEditor.tsx"),
      "utf8",
    );
    const editorData = readFileSync(
      path.join(root, "lib/cms/page-editor-data.ts"),
      "utf8",
    );
    assert.match(
      publicLoader,
      /resolvePublishedPage\(\s*repository,\s*"event\.auditQuote"/,
    );
    assert.doesNotMatch(publicLoader, /getDraftPage\("event\.auditQuote"/);
    assert.match(route, /loadPublishedAuditQuote/);
    assert.match(route, /<AuditQuoteEventPage config=\{config\} content=\{content\}/);
    assert.match(editor, /<AuditQuoteEventPage/);
    assert.match(editor, /previewMode/);
    assert.match(editor, /필수 동의·면책문구 수정 이력/);
    assert.match(editorData, /auditQuoteLegalCopyChanged/);
  });
});
