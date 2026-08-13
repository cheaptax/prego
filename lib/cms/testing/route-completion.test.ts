import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CMS_PAGE_DEFAULTS,
  CMS_PROTECTED_PAGE_ACTION_IDS,
  CMS_PROTECTED_PAGE_ITEM_IDS,
} from "@/lib/cms/defaults";
import {
  validatePageContentForPublish,
} from "@/lib/cms/editor-validation";
import { normalizeCmsPageContent } from "@/lib/cms/page-content";
import { loadCmsPageEditorData } from "@/lib/cms/page-editor-data";
import type { FirestoreCmsRepository } from "@/lib/cms/repository";
import {
  CMS_ROUTE_MESSAGE_PRESENTATION,
  CMS_ROUTE_SECTION_PRESENTATION,
} from "@/lib/cms/route-presentation";
import type {
  CmsDraftPage,
  CmsPageRevision,
  CmsPublishedPage,
} from "@/lib/cms/schemas";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const timestamp = "2026-07-21T00:00:00.000Z";
const scopedPageKeys = [
  "auth.login",
  "auth.partnerLogin",
  "auth.adminLogin",
  "auth.signup",
  "auth.pendingApproval",
  "auth.portalAccessDenied",
  "legal.terms",
  "legal.privacy",
  "public.consult",
  "public.inquiries",
  "public.faq",
  "public.support",
  "event.auditQuoteEvaluate",
  "event.auditQuoteEvaluation",
  "event.auditQuoteEvaluationReview",
  "event.auditQuoteEvaluationReport",
  "partner.portal",
  "framework.notFound",
] as const;

function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("scoped route CMS completion", () => {
  it("gives every editor field and state message a Korean business label", () => {
    for (const pageKey of scopedPageKeys) {
      const sectionPresentation = CMS_ROUTE_SECTION_PRESENTATION[pageKey];
      assert.ok(sectionPresentation, `missing section presentation: ${pageKey}`);
      for (const section of CMS_PAGE_DEFAULTS[pageKey].sections) {
        const presentation = sectionPresentation[section.id];
        assert.ok(presentation, `missing presentation: ${pageKey}.${section.id}`);
        assert.match(presentation.name, /[가-힣]/);
        for (const textKey of Object.keys(section.text)) {
          const editorField = presentation.textFields?.[textKey];
          assert.ok(
            editorField,
            `missing editor field: ${pageKey}.${section.id}.${textKey}`,
          );
          assert.match(editorField.label, /[가-힣]/);
          assert.match(editorField.help, /[가-힣]/);
        }
      }

      const messagePresentation = CMS_ROUTE_MESSAGE_PRESENTATION[pageKey] ?? {};
      for (const messageKey of Object.keys(CMS_PAGE_DEFAULTS[pageKey].messages)) {
        const editorField = messagePresentation[messageKey];
        assert.ok(editorField, `missing message field: ${pageKey}.${messageKey}`);
        assert.match(editorField.label, /[가-힣]/);
        assert.match(editorField.help, /[가-힣]/);
      }
    }
  });

  it("rejects and normalizes hidden protected options and changed consent links", () => {
    for (const pageKey of ["auth.signup", "public.consult"] as const) {
      const content = structuredClone(CMS_PAGE_DEFAULTS[pageKey]);
      const [sectionId, itemIds] = Object.entries(
        CMS_PROTECTED_PAGE_ITEM_IDS[pageKey] ?? {},
      )[0];
      const section = content.sections.find((candidate) => candidate.id === sectionId);
      assert.ok(section);
      section.items.find((item) => item.id === itemIds[0])!.deleted = true;

      const issues = validatePageContentForPublish(content, pageKey);
      assert.ok(
        issues.some(
          (issue) =>
            issue.severity === "error" && issue.id.startsWith("protected-option"),
        ),
      );

      const normalized = normalizeCmsPageContent(pageKey, content);
      const restored = normalized.sections
        .find((candidate) => candidate.id === sectionId)
        ?.items.find((item) => item.id === itemIds[0]);
      assert.ok(restored);
      assert.equal(restored.deleted, false);
      assert.equal(restored.visible, true);
    }

    const signup = structuredClone(CMS_PAGE_DEFAULTS["auth.signup"]);
    const consentSection = signup.sections.find(
      (section) => section.id === "consents",
    );
    assert.ok(consentSection);
    consentSection.actions.find((action) => action.id === "terms")!.href =
      "/support";
    assert.ok(
      validatePageContentForPublish(signup, "auth.signup").some(
        (issue) => issue.id.startsWith("protected-consent-link"),
      ),
    );
    const normalizedSignup = normalizeCmsPageContent("auth.signup", signup);
    assert.equal(
      normalizedSignup.sections
        .find((section) => section.id === "consents")
        ?.actions.find((action) => action.id === "terms")?.href,
      "/terms",
    );
    assert.deepEqual(CMS_PROTECTED_PAGE_ACTION_IDS["auth.signup"]?.consents, [
      "terms",
      "privacy",
    ]);
  });

  it("keeps legal sections required and records legal or consent copy revisions", async () => {
    const terms = structuredClone(CMS_PAGE_DEFAULTS["legal.terms"]);
    terms.sections.find((section) => section.id === "responsibility")!.visible =
      false;
    assert.ok(
      validatePageContentForPublish(terms, "legal.terms").some(
        (issue) =>
          issue.severity === "error" && issue.code === "required_section",
      ),
    );

    const pageKey = "auth.signup" as const;
    const published: CmsPublishedPage = {
      schemaVersion: 1,
      pageKey,
      route: "/signup",
      content: structuredClone(CMS_PAGE_DEFAULTS[pageKey]),
      version: 1,
      status: "published",
      publishedAt: timestamp,
    };
    const draft: CmsDraftPage = {
      schemaVersion: 1,
      pageKey,
      route: "/signup",
      content: structuredClone(published.content),
      version: 2,
      basePublishedVersion: 1,
      status: "draft",
      createdAt: timestamp,
      createdBy: "admin",
      updatedAt: timestamp,
      updatedBy: "admin",
    };
    draft.content.sections[0].title = "편집 중인 회원가입 제목";
    const revisionContent = structuredClone(published.content);
    revisionContent.sections.find(
      (section) => section.id === "consents",
    )!.text.termsLabel = "변경된 이용약관 동의";
    const revision: CmsPageRevision = {
      ...published,
      content: revisionContent,
      revisionId: "r20260721",
      revisionAction: "publish",
      createdAt: timestamp,
      createdBy: "admin",
    };
    const repository = {
      getDraftPage: async () => draft,
      getPublishedPage: async () => published,
      listPageRevisions: async () => [revision],
      getAssets: async () => [],
    } as unknown as FirestoreCmsRepository;
    const editor = await loadCmsPageEditorData(pageKey, repository);
    assert.equal(editor.content.sections[0].title, "편집 중인 회원가입 제목");
    assert.notEqual(
      editor.content.sections[0].title,
      editor.publishedContent.sections[0].title,
    );
    assert.equal(editor.revisions[0].legalCopyChanged, true);
  });
});

describe("auth, guest/member, and payload safety", () => {
  it("keeps auth verification, endpoints, payload keys, limits, and consent requiredness in code", () => {
    const login = source("components/LoginForm.tsx");
    const loginClient = source("lib/auth/login-client.ts");
    const signup = source("components/SignupForm.tsx");
    const signupApi = source("app/api/signup/route.ts");
    const consult = source("components/ConsultForm.tsx");

    for (const endpoint of [
      "/api/auth/portal-session",
      "/api/auth/find-email",
      "/api/auth/check-email",
      "/api/signup",
      "/api/consult",
    ]) {
      assert.ok(
        `${login}\n${loginClient}\n${signup}\n${consult}`.includes(endpoint),
        `missing protected endpoint ${endpoint}`,
      );
    }
    for (const payloadKey of [
      "phoneVerificationIdToken",
      "cooperativeId",
      "businessCardPath",
      "terms: form.termsConsent",
      "privacy: form.privacyConsent",
    ]) {
      assert.ok(signup.includes(payloadKey), `missing signup payload ${payloadKey}`);
    }
    assert.match(signup, /const MAX_BUSINESS_CARD_SIZE = 10 \* 1024 \* 1024/);
    assert.match(signup, /const PHONE_VERIFICATION_TTL_MS = 30 \* 60 \* 1000/);
    assert.match(signupApi, /!body\.consents\?\.terms/);
    assert.match(signupApi, /!body\.consents\?\.privacy/);
    assert.match(signupApi, /phone_account_limit_exceeded/);
    assert.match(signup, /const DUTY_VALUES: Record<string, string>/);
  });

  it("keeps inquiry category, visibility, guest/member ACL, and attachment limits fixed", () => {
    const form = source("components/ConsultForm.tsx");
    const api = source("app/api/consult/route.ts");
    const boardApi = source("app/api/inquiries/route.ts");

    assert.match(form, /const CATEGORY_VALUES: Record<string, InquiryCategory>/);
    assert.match(form, /const VISIBILITY_VALUES:/);
    assert.match(form, /formData\.set\("visibility", form\.visibility\)/);
    assert.match(form, /formData\.set\("category", form\.category\)/);
    assert.match(api, /const MAX_ATTACHMENTS = 6/);
    assert.match(api, /const MAX_ATTACHMENT_SIZE = 10 \* 1024 \* 1024/);
    assert.match(api, /userData\?\.status !== "active"/);
    assert.match(boardApi, /visibility === "public"/);
    assert.match(boardApi, /canReadRequest\(request, user\)/);
    assert.match(boardApi, /requestOrgId === userOrgId/);
    assert.match(boardApi, /request\.uid === user\.uid/);
  });
});

describe("published routes and side-effect-free previews", () => {
  it("loads only published content for every scoped public route", () => {
    const routes = [
      ["app/login/page.tsx", "auth.login"],
      ["app/partner/login/page.tsx", "auth.partnerLogin"],
      ["app/admin/login/page.tsx", "auth.adminLogin"],
      ["app/signup/page.tsx", "auth.signup"],
      ["app/pending-approval/page.tsx", "auth.pendingApproval"],
      ["app/portal-access-denied/page.tsx", "auth.portalAccessDenied"],
      ["app/terms/page.tsx", "legal.terms"],
      ["app/privacy/page.tsx", "legal.privacy"],
      ["app/consult/page.tsx", "public.consult"],
      ["app/inquiries/page.tsx", "public.inquiries"],
      ["app/faq/page.tsx", "public.faq"],
      ["app/support/page.tsx", "public.support"],
      ["app/partner/page.tsx", "partner.portal"],
      ["app/not-found.tsx", "framework.notFound"],
    ] as const;
    for (const [relativePath, pageKey] of routes) {
      const route = source(relativePath);
      assert.ok(route.includes(`loadPublishedCmsPage("${pageKey}")`));
      assert.doesNotMatch(route, /loadCmsPageEditorData|cmsDraft/i);
      if (relativePath !== "app/not-found.tsx") {
        assert.match(route, /cmsPageMetadata\(bundle\.content, bundle\.assetUrls\)/);
      }
    }
  });

  it("reuses actual renderers in preview and blocks network, mutation, and navigation paths", () => {
    const preview = source("components/cms-editor/CmsActualPagePreview.tsx");
    const simple = source("components/CmsSimplePage.tsx");
    const login = source("components/LoginForm.tsx");
    const signup = source("components/SignupForm.tsx");
    const consult = source("components/ConsultForm.tsx");
    const inquiries = source("components/InquiryBoard.tsx");

    for (const renderer of [
      "LoginPageRenderer",
      "SignupPageRenderer",
      "ConsultPageRenderer",
      "BoardPageRenderer",
      "CmsSimplePage",
    ]) {
      assert.ok(preview.includes(`<${renderer}`));
    }
    for (const renderer of [
      "LoginPageRenderer",
      "SignupPageRenderer",
      "MyPageDashboard",
      "RequestDetailPage",
      "AdminDashboard",
      "CmsAdminConsole",
      "CustomerQuotesPage",
      "PartnerApplicationForm",
      "ConsultPageRenderer",
      "BoardPageRenderer",
    ]) {
      assert.match(
        preview,
        new RegExp(`<${renderer}[\\s\\S]{0,320}\\{\\.\\.\\.shared\\}`),
        `editing props are not forwarded to ${renderer}`,
      );
    }
    for (const relativePath of [
      "components/HomePageRenderer.tsx",
      "components/AuditQuoteEventPage.tsx",
      "components/AuditEvaluationCustomerPage.tsx",
      "components/AuditQuoteReviewWorkspace.tsx",
      "components/cms-editor/CmsActualPagePreview.tsx",
      "components/cms-editor/CmsPageRenderer.tsx",
      "components/LoginPageRenderer.tsx",
      "components/CmsSimplePage.tsx",
      "components/ConsultPageRenderer.tsx",
      "components/ConsultForm.tsx",
      "components/BoardPageRenderer.tsx",
      "components/SignupForm.tsx",
      "components/SignupPageRenderer.tsx",
      "components/MyPageDashboard.tsx",
      "components/RequestDetailPage.tsx",
      "components/CustomerQuotesPage.tsx",
      "components/PartnerApplicationForm.tsx",
      "components/AdminDashboard.tsx",
      "components/CmsAdminConsole.tsx",
      "components/InquiryBoard.tsx",
      "components/FaqBoard.tsx",
    ]) {
      assert.match(
        source(relativePath),
        /cms(?:EditableSection|SectionSelection)Props/,
        `missing click-to-edit section binding: ${relativePath}`,
      );
    }
    const selectionSources = [
      "components/HomePageRenderer.tsx",
      "components/AuditQuoteEventPage.tsx",
      "components/AuditEvaluationCustomerPage.tsx",
      "components/AuditQuoteReviewWorkspace.tsx",
    ]
      .map(source)
      .join("\n");
    assert.doesNotMatch(
      selectionSources,
      /onClick:\s*editing\s*\?\s*\(\)\s*=>\s*onSelectSection/,
      "a route renderer bypasses the shared keyboard-accessible selection contract",
    );
    assert.match(preview, /<CmsSimplePage[\s\S]*previewMode/);
    assert.match(simple, /editing \|\| previewMode/);
    for (const component of [login, signup, consult]) {
      assert.match(component, /if \(previewMode\) return/);
    }
    assert.match(inquiries, /if \(previewMode\) return/);
    assert.doesNotMatch(inquiries, /업무 상담 진행 절차가 궁금합니다/);
    assert.doesNotMatch(signup, /<label className="auth-check auth-check--row">/);
  });

  it("keeps partner route gated with the CMS lockout fallback", () => {
    const partner = CMS_PAGE_DEFAULTS["partner.portal"];
    assert.equal(partner.sections.length, 4);
    const accessNotice = partner.sections.find(
      (section) => section.id === "accessNotice",
    );
    assert.equal(accessNotice?.locked, true);
    assert.equal(accessNotice?.visible, true);
    assert.equal(
      partner.sections.find((section) => section.id === "sitemap")?.locked,
      true,
    );
    assert.equal(
      partner.sections.some((section) => section.id === "quoteEvaluation"),
      true,
    );
    assert.equal(
      partner.sections.find((section) => section.id === "quoteDocument")
        ?.locked,
      true,
    );
    const route = source("app/partner/page.tsx");
    const dashboard = source("components/PartnerDashboard.tsx");
    assert.match(
      route,
      /<PartnerDashboard content=\{content\} sitemap=\{sitemap\} \/>/,
    );
    assert.match(dashboard, /tokenResult\.claims\.partner !== true/);
    assert.match(dashboard, /\/api\/partner\/session/);
    assert.match(dashboard, /accessNotice/);
    assert.doesNotMatch(route, /AdminDashboard|fetch\(/);
  });
});
