import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
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

function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("member screen CMS integration", () => {
  it("provides business labels and help for every member field and message", () => {
    for (const pageKey of [
      "member.mypage",
      "member.requestDetail",
    ] as const) {
      const defaults = CMS_PAGE_DEFAULTS[pageKey];
      const sectionPresentation = CMS_ROUTE_SECTION_PRESENTATION[pageKey];
      const messagePresentation = CMS_ROUTE_MESSAGE_PRESENTATION[pageKey];
      assert.ok(sectionPresentation);
      assert.ok(messagePresentation);

      for (const section of defaults.sections) {
        const presentation = sectionPresentation[section.id];
        assert.ok(presentation, `missing presentation for ${pageKey}.${section.id}`);
        assert.ok(presentation.name.trim());
        for (const textKey of Object.keys(section.text)) {
          const field = presentation.textFields?.[textKey];
          assert.ok(field, `missing field label for ${pageKey}.${section.id}.${textKey}`);
          assert.ok(field.label.trim());
          assert.ok(field.help.trim());
        }
      }

      for (const messageKey of Object.keys(defaults.messages)) {
        const field = messagePresentation[messageKey];
        assert.ok(field, `missing message label for ${pageKey}.${messageKey}`);
        assert.ok(field.label.trim());
        assert.ok(field.help.trim());
      }
    }
  });

  it("protects member tabs and required customer-facing messages", () => {
    const mypage = structuredClone(CMS_PAGE_DEFAULTS["member.mypage"]);
    const navigation = mypage.sections.find(
      (section) => section.id === "navigation",
    );
    assert.ok(navigation);
    assert.deepEqual(
      navigation.items.map((item) => item.id),
      ["overview", "inquiries", "quotes", "points", "profile", "sitemap"],
    );
    navigation.items.find((item) => item.id === "points")!.visible = false;
    mypage.messages.loadFailed = "";

    const issues = validatePageContentForPublish(mypage, "member.mypage");
    assert.ok(
      issues.some(
        (issue) =>
          issue.severity === "error" &&
          issue.id.startsWith("member-protected-tab"),
      ),
    );
    assert.ok(
      issues.some((issue) =>
        issue.id.startsWith("member-required-message-loadFailed"),
      ),
    );
  });

  it("keeps quote inbox under inquiries in the mypage sidebar", () => {
    const mypage = source("components/MyPageDashboard.tsx");
    assert.match(mypage, /quotes:\s*"\/mypage\/quotes"/);
    assert.ok(mypage.includes('"inquiries"'));
    assert.ok(mypage.includes('"quotes"'));
    assert.ok(
      mypage.indexOf('"inquiries"') < mypage.indexOf('"quotes"'),
      "quotes nav item must follow inquiries",
    );
    assert.equal(
      mypage.includes('href="/mypage/quotes"\n              견적함'),
      false,
      "topbar quote shortcut should be removed",
    );
  });

  it("keeps member API routes, auth headers, payload fields, and completion order fixed", () => {
    const mypage = source("components/MyPageDashboard.tsx");
    const detail = source("components/RequestDetailPage.tsx");

    assert.ok(mypage.includes('fetch("/api/me/overview"'));
    assert.ok(mypage.includes('fetch("/api/me/consents"'));
    assert.match(mypage, /authorization: `Bearer \$\{idToken\}`/);
    assert.ok(
      mypage.includes("JSON.stringify({ consents: { [key]: value } })"),
    );

    for (const endpoint of [
      "`/api/me/answers/${requestId}/view`",
      "`/api/me/answers/${requestId}/rating`",
      "`/api/me/requests/${requestId}/complete`",
    ]) {
      assert.ok(detail.includes(endpoint), `missing fixed endpoint ${endpoint}`);
    }
    for (const payloadField of [
      "score: effectiveRatingScore",
      "helpful: effectiveRatingHelpful",
      "comment: effectiveRatingComment",
    ]) {
      assert.ok(detail.includes(payloadField));
    }
    assert.ok(
      detail.indexOf("if (!visibleAnswer)") <
        detail.indexOf("if (!hasRating)"),
      "answer view must remain required before rating and completion",
    );
    assert.match(detail, /const FOLLOWUP_SUBJECT_PREFIX = "\[추가 문의\]"/);
    assert.match(
      detail,
      /const ESTIMATE_SUBJECT_PREFIX = "\[추가상담·견적진행\]"/,
    );
  });

  it("preserves guest, approval-pending, active-member, and safe preview paths", () => {
    const mypage = source("components/MyPageDashboard.tsx");
    const detail = source("components/RequestDetailPage.tsx");
    const preview = source("components/cms-editor/CmsActualPagePreview.tsx");

    for (const component of [mypage, detail]) {
      assert.ok(component.includes('router.push("/login")'));
      assert.ok(component.includes('err.message === "approval_pending"'));
      assert.ok(component.includes('router.push("/pending-approval")'));
      assert.ok(component.includes("if (previewMode) return"));
      assert.ok(component.includes("preventPreviewLinkNavigation"));
    }
    assert.ok(mypage.includes('setState("ready")'));
    assert.ok(
      detail.includes(
        'some((request) => request.id === requestId) ? "ready" : "not-found"',
      ),
    );
    assert.match(
      preview,
      /<MyPageDashboard \{\.\.\.shared\} \/>/,
    );
    assert.match(
      preview,
      /requestId="preview-request"[\s\S]*content=\{content\}[\s\S]*previewMode/,
    );
  });

  it("loads published member content for metadata and route rendering", () => {
    const mypageRoute = source("app/mypage/page.tsx");
    const detailRoute = source("app/mypage/requests/[requestId]/page.tsx");

    for (const [route, pageKey] of [
      [mypageRoute, "member.mypage"],
      [detailRoute, "member.requestDetail"],
    ] as const) {
      assert.ok(route.includes(`loadPublishedCmsPage("${pageKey}")`));
      assert.ok(
        route.includes(
          "cmsPageMetadata(bundle.content, bundle.assetUrls)",
        ),
      );
    }
    assert.match(mypageRoute, /initialTab=\{params\?\.tab\}/);
    assert.match(detailRoute, /requestId=\{requestId\} content=\{content\}/);
  });
});
