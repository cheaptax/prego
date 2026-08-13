import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ADMIN_AUDIT_QUOTE_FILTERS,
  ADMIN_FAQ_CATEGORIES,
  ADMIN_FAQ_DISPLAY_FILTERS,
  ADMIN_FAQ_PUBLIC_FILTERS,
  ADMIN_OPERATION_TAB_IDS,
  ADMIN_OPERATION_TAB_SECTION_IDS,
  ADMIN_REQUEST_STATUS_FILTERS,
  ADMIN_VISIBILITY_FILTERS,
  createAdminOperationsCopy,
  formatAdminOperationsMessage,
} from "@/lib/cms/admin-operations-content";
import { CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";
import { validatePageContentForPublish } from "@/lib/cms/editor-validation";
import {
  CMS_ROUTE_MESSAGE_PRESENTATION,
  CMS_ROUTE_SECTION_PRESENTATION,
} from "@/lib/cms/route-presentation";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("admin operations CMS safety contract", () => {
  it("maps every operations tab to an existing CMS section", () => {
    const sectionIds = new Set(
      CMS_PAGE_DEFAULTS["admin.operations"].sections.map(
        (section) => section.id,
      ),
    );
    for (const tabId of ADMIN_OPERATION_TAB_IDS) {
      const sectionId = ADMIN_OPERATION_TAB_SECTION_IDS[tabId];
      assert.ok(
        sectionIds.has(sectionId),
        `tab ${tabId} maps to missing CMS section ${sectionId}`,
      );
    }

    const dashboard = readFileSync(
      path.join(root, "components/AdminDashboard.tsx"),
      "utf8",
    );
    assert.match(dashboard, /ADMIN_OPERATION_TAB_SECTION_IDS\[tab\]/);
  });

  it("keeps section copy references stable across React renders", () => {
    const copy = createAdminOperationsCopy(
      structuredClone(CMS_PAGE_DEFAULTS["admin.operations"]),
    );
    assert.strictEqual(copy.section("partners"), copy.section("partners"));
    assert.notStrictEqual(copy.section("partners"), copy.section("members"));
  });

  it("keeps internal tab and filter values fixed when CMS labels change", () => {
    const content = structuredClone(CMS_PAGE_DEFAULTS["admin.operations"]);
    const navigation = content.sections.find(
      (section) => section.id === "navigation",
    );
    const inquiries = content.sections.find(
      (section) => section.id === "inquiries",
    );
    assert.ok(navigation);
    assert.ok(inquiries);
    navigation.items.find((item) => item.id === "members")!.title =
      "/api/attacker-controlled";
    inquiries.items.find(
      (item) => item.id === "visibility.private",
    )!.title = "표시 이름 변경";

    const copy = createAdminOperationsCopy(content);
    assert.equal(
      copy.tabs.find((tab) => tab.key === "members")?.label,
      "/api/attacker-controlled",
    );
    assert.deepEqual(
      copy.tabs.map((tab) => tab.key),
      [...ADMIN_OPERATION_TAB_IDS],
    );
    assert.deepEqual(
      ADMIN_REQUEST_STATUS_FILTERS.map((option) => option.value),
      ["", "SUBMITTED", "ANSWERED", "ANSWER_PUBLISHED", "FOLLOWUP", "COMPLETED"],
    );
    assert.deepEqual(
      ADMIN_VISIBILITY_FILTERS.map((option) => option.value),
      ["", "PUBLIC", "ORG_ONLY", "PRIVATE"],
    );
    assert.deepEqual(
      ADMIN_FAQ_PUBLIC_FILTERS.map((option) => option.value),
      ["", "public", "private"],
    );
    assert.deepEqual(
      ADMIN_FAQ_DISPLAY_FILTERS.map((option) => option.value),
      ["", "published", "draft"],
    );
    assert.equal(ADMIN_AUDIT_QUOTE_FILTERS[1].value, "received");
    assert.deepEqual(
      ADMIN_FAQ_CATEGORIES.map((option) => option.value),
      ["일반", "회원가입", "문의 진행", "포인트", "정산", "기타"],
    );
  });

  it("rejects publishing when a protected admin option is hidden", () => {
    const content = structuredClone(CMS_PAGE_DEFAULTS["admin.operations"]);
    const inquiries = content.sections.find(
      (section) => section.id === "inquiries",
    );
    assert.ok(inquiries);
    inquiries.items.find(
      (item) => item.id === "requestStatus.completed",
    )!.visible = false;
    const issues = validatePageContentForPublish(
      content,
      "admin.operations",
    );
    assert.ok(
      issues.some(
        (issue) =>
          issue.severity === "error" && issue.sectionId === "inquiries",
      ),
    );
  });

  it("keeps admin auth, API routes, and mutation payload keys in code", () => {
    const dashboard = readFileSync(
      path.join(root, "components/AdminDashboard.tsx"),
      "utf8",
    );
    const auditQuotes = readFileSync(
      path.join(root, "components/AdminAuditQuotesPanel.tsx"),
      "utf8",
    );

    assert.match(dashboard, /tokenResult\.claims\.admin === true/);
    assert.match(dashboard, /getIdToken\(\)/);
    assert.match(dashboard, /authorization: `Bearer \$\{idToken\}`/);
    for (const url of [
      "/api/admin/overview",
      "/api/admin/faqs",
      "/api/admin/points/adjust",
      "/api/admin/operators",
    ]) {
      assert.ok(dashboard.includes(`"${url}"`));
    }
    for (const key of [
      "question: payload.question",
      "answer: payload.answer",
      "category: payload.category",
      "isPublic: payload.isPublic",
      "displayStatus: payload.displayStatus",
      "cooperativeId: pointAdjustmentDraft.cooperativeId",
      "points: pointAdjustmentDraft.points",
      "reason: pointAdjustmentDraft.reason",
      "internalCategory: formData.get",
      "adminTags: formData.get",
      "answerBody: formData.get",
    ]) {
      assert.ok(dashboard.includes(key), `missing protected payload key: ${key}`);
    }

    assert.match(auditQuotes, /getIdToken\(\)/);
    assert.ok(auditQuotes.includes("`/api/admin/audit-quotes${query}`"));
    assert.ok(
      auditQuotes.includes(
        "`/api/admin/audit-quotes/${detail.requestId}`",
      ),
    );
    for (const key of [
      "status: draftStatus",
      "assignedTo: draftAssignee.trim() || null",
      "quoteCount",
      "expectedUpdatedAt: detail.updatedAt || undefined",
    ]) {
      assert.ok(
        auditQuotes.includes(key),
        `missing audit quote payload key: ${key}`,
      );
    }
    assert.doesNotMatch(dashboard, /window\.(confirm|prompt)\(/);
  });

  it("loads published content and uses it for metadata and preview", () => {
    const page = readFileSync(
      path.join(root, "app/admin/operations/page.tsx"),
      "utf8",
    );
    const preview = readFileSync(
      path.join(root, "components/cms-editor/CmsActualPagePreview.tsx"),
      "utf8",
    );
    assert.match(page, /loadPublishedCmsPage\("admin\.operations"\)/);
    assert.match(page, /cmsPageMetadata\(bundle\.content, bundle\.assetUrls\)/);
    assert.match(page, /getServerFeatureFlags\(\)\.auditEvaluation/);
    assert.match(
      page,
      /auditEvaluationFlags\.enabled && auditEvaluationFlags\.adminEnabled/,
    );
    assert.match(
      page,
      /auditEvaluationAdminEnabled=\{auditEvaluationAdminEnabled\}/,
    );
    assert.match(
      preview,
      /<AdminDashboard \{\.\.\.shared\} \/>/,
    );
  });

  it("exposes every admin copy field with an editor presentation label", () => {
    const defaults = CMS_PAGE_DEFAULTS["admin.operations"];
    const sections = CMS_ROUTE_SECTION_PRESENTATION["admin.operations"];
    const messages = CMS_ROUTE_MESSAGE_PRESENTATION["admin.operations"];
    assert.ok(sections);
    assert.ok(messages);
    for (const section of defaults.sections) {
      const presentation = sections[section.id];
      assert.ok(presentation, `missing section presentation: ${section.id}`);
      for (const key of Object.keys(section.text)) {
        assert.ok(
          presentation.textFields?.[key],
          `missing presentation for ${section.id}.${key}`,
        );
      }
    }
    for (const key of Object.keys(defaults.messages)) {
      assert.ok(messages[key], `missing message presentation: ${key}`);
    }
  });

  it("leaves no user-visible Korean literals in the dashboard component", () => {
    const source = readFileSync(
      path.join(root, "components/AdminDashboard.tsx"),
      "utf8",
    );
    const withoutAllowedProtectedValues = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(
        /const LEGACY_NON_ASSIGNEE_TAGS = new Set\(\[[\s\S]*?\]\);/,
        "",
      )
      .replace('operator?.position || "운영자"', "")
      .replace('operator?.duty || "관리자"', "")
      .replace('position.trim() || "운영자"', "")
      .replace('duty.trim() || "관리자"', "");
    assert.doesNotMatch(withoutAllowedProtectedValues, /[가-힣]/);
    assert.doesNotMatch(source, /\b(err|error)\.message\b/);
    assert.doesNotMatch(source, /FirebaseError/);
  });

  it("formats audit notification copy without exposing technical errors", () => {
    const copy = createAdminOperationsCopy(
      structuredClone(CMS_PAGE_DEFAULTS["admin.operations"]),
    );
    assert.equal(
      formatAdminOperationsMessage(
        copy.message("auditQuoteNotifySuccess"),
        { status: "sent", attempts: 2 },
      ),
      "알림 상태: sent (시도 2)",
    );

    const panel = readFileSync(
      path.join(root, "components/AdminAuditQuotesPanel.tsx"),
      "utf8",
    );
    const withoutPreviewFixture = panel.replace(
      /const previewQuote:[\s\S]*?\n};/,
      "",
    );
    assert.doesNotMatch(withoutPreviewFixture, /[가-힣]/);
    assert.match(panel, /new AdminRequestError\("auth_required"\)/);
    assert.match(panel, /copy\.message\("authRequired"\)/);
    assert.match(panel, /copy\.message\("auditQuoteNotifySuccess"\)/);
  });
});
