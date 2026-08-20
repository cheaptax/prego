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
      ["hero", "intakeForm", "benefits", "steps", "legalNotice"],
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
    const steps = content.sections.find((section) => section.id === "steps");
    assert.deepEqual(
      steps?.items.map((item) => [item.title, item.description]),
      [
        ["신청", "농협과 담당자 정보를 남겨주세요."],
        ["견적 발송", "제휴사들이 각각의 견적을 메일로 발송해요."],
        [
          "견적 확인 및 비교검토 보고서 다운로드",
          "수신한 견적을 바탕으로 프리고에서 검토보고서를 내려받아요.",
        ],
      ],
    );
    assert.equal(
      content.sections.some((section) => section.id === "faq"),
      false,
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
      {
        ...legacy.sections[3],
        id: "faq",
        title: "자주 묻는 질문",
      },
      legacy.sections[4],
    ];
    const normalized = normalizeAuditQuoteCmsContent(legacy);
    assert.equal(normalized.sections[0].title, "게시된 제목");
    assert.equal(normalized.sections[1].id, "benefits");
    assert.equal(normalized.sections[1].items.length, 3);
    assert.equal(
      normalized.sections.some((section) => section.id === "faq"),
      false,
    );
    assert.equal(normalized.messages.genericError, "기존 오류");
    assert.ok(normalized.messages.successTitle);
  });
});

describe("FY27 audit-quote guide CMS defaults", () => {
  it("funnels users from the guide into the protected quote application", () => {
    const content = CMS_PAGE_DEFAULTS["event.auditQuoteGuide"];
    assert.deepEqual(
      content.sections.map((section) => section.id),
      [
        "hero",
        "lawAmendment",
        "mandate",
        "pain",
        "hassleFree",
        "steps",
        "benefits",
        "faq",
        "cta",
        "legalNotice",
      ],
    );
    const hero = content.sections.find((section) => section.id === "hero");
    const lawAmendment = content.sections.find(
      (section) => section.id === "lawAmendment",
    );
    const hassleFree = content.sections.find(
      (section) => section.id === "hassleFree",
    );
    const pain = content.sections.find((section) => section.id === "pain");
    const steps = content.sections.find((section) => section.id === "steps");
    const faq = content.sections.find((section) => section.id === "faq");
    const cta = content.sections.find((section) => section.id === "cta");
    const legal = content.sections.find((section) => section.id === "legalNotice");
    assert.match(hero?.title ?? "", /2027년도 재무제표 감사/);
    assert.match(hero?.description ?? "", /감사인 선임 계약/);
    assert.equal(hero?.actions.find((action) => action.id === "apply")?.href, "/events/audit-quote");
    assert.equal(
      lawAmendment?.description,
      "26년 초에 25년 재무제표 감사를 마쳤는데,\n벌써 또 감사계약을 해야 하나요?",
    );
    assert.equal(
      lawAmendment?.text.toggleLabel,
      "농협법 개정내용 보기",
    );
    assert.match(
      lawAmendment?.items.find((item) => item.id === "effectiveDate")
        ?.description ?? "",
      /2026년 9월 11일/,
    );
    assert.match(
      lawAmendment?.items.find((item) => item.id === "fy27Impact")
        ?.description ?? "",
      /2027년도 재무제표/,
    );
    assert.match(
      lawAmendment?.items.find((item) => item.id === "howToPrepare")
        ?.description ?? "",
      /농협 감사인 협회 소속/,
    );
    assert.match(lawAmendment?.text.note ?? "", /필요할 때 언제든 바로 꺼내보실 수 있습니다/);
    assert.equal(lawAmendment?.text.printBrand, "농협지원센터");
    assert.match(lawAmendment?.text.printSource ?? "", /내부 보고/);
    assert.equal(cta?.actions.find((action) => action.id === "apply")?.href, "/events/audit-quote");
    assert.doesNotMatch(pain?.title ?? "", /일이 너무 많습니다|최소화/);
    assert.doesNotMatch(steps?.title ?? "", /최소화|할 일은/);
    assert.equal(
      hassleFree?.description,
      "참여 회계법인 견적과 외부 견적을 같은 기준으로 비교하고, 상부 보고용 검토보고서까지 만들어 드립니다.",
    );
    assert.doesNotMatch(hassleFree?.description ?? "", /단순 비교표가 아니라/);
    const targetFaq = faq?.items.find((item) => item.id === "target");
    assert.equal(
      targetFaq?.description,
      "자산총액 500억원 이상 농협은 이번 법 개정으로 2년마다 회계감사를 받아야 합니다. (3,000억원 이상 농협은 매년으로 입법예고)\n따라서 올해 초 25년 재무제표 감사를 마무리한 회계법인은 27년에 대한 재무제표 감사계약을 올해 체결해야 합니다.",
    );
    assert.equal(
      faq?.items.some((item) => item.id === "official"),
      false,
    );
    assert.equal(
      hassleFree?.text.tableCaption,
      "실제 검토보고서 결과 화면 예시의 일부입니다. 프리고가 개발한 표준 양식의 최신 버전입니다.",
    );
    assert.equal(
      hassleFree?.actions.find((action) => action.id === "sample")?.href,
      "/api/audit-quote/sample-report",
    );
    assert.equal(legal?.locked, true);
    assert.match(legal?.text.regulationNote ?? "", /농업협동조합법 시행령/);
  });

  it("uses the actual guide renderer in route and CMS previews", () => {
    const route = readFileSync(
      path.join(root, "app/events/audit-quote/guide/page.tsx"),
      "utf8",
    );
    const component = readFileSync(
      path.join(root, "components/AuditQuoteGuidePage.tsx"),
      "utf8",
    );
    const actualPreview = readFileSync(
      path.join(root, "components/cms-editor/CmsActualPagePreview.tsx"),
      "utf8",
    );
    const editorPreview = readFileSync(
      path.join(root, "components/cms-editor/CmsPageEditor.tsx"),
      "utf8",
    );
    assert.match(route, /loadPublishedCmsPage\("event\.auditQuoteGuide"\)/);
    assert.match(route, /createSampleAuditReportViewModel/);
    assert.match(route, /<AuditQuoteGuidePage content=\{content\} sampleReport=\{sampleReport\}/);
    assert.match(component, /AuditEvaluationReportDocument/);
    assert.match(component, /trackAuditQuoteEvent\("audit_quote_cta_click"/);
    assert.match(component, /placement/);
    assert.match(actualPreview, /pageKey === "event\.auditQuoteGuide"/);
    assert.match(editorPreview, /pageKey === "event\.auditQuoteGuide"/);
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
