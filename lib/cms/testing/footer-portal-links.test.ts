import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CMS_GLOBAL_DEFAULTS } from "@/lib/cms/defaults";
import { cmsGlobalContentSchema } from "@/lib/cms/schemas";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("public Footer portal links", () => {
  it("keeps labels, destinations, and accessible navigation copy in CMS defaults", () => {
    const footer = cmsGlobalContentSchema.parse(
      CMS_GLOBAL_DEFAULTS.footer,
    );
    assert.deepEqual(
      [
        footer.links.customerLogin.label,
        footer.links.customerLogin.href,
        footer.links.partnerLogin.label,
        footer.links.partnerLogin.href,
        footer.links.operatorLogin.label,
        footer.links.operatorLogin.href,
      ],
      [
        "고객 로그인",
        "/login",
        "제휴사 로그인",
        "/partner/login",
        "운영자 로그인",
        "/admin/login",
      ],
    );
    assert.equal(
      footer.text.portalLoginNavigationLabel,
      "고객 · 제휴사 · 운영자 로그인",
    );
  });

  it("uses client routing without new-window or nofollow behavior", () => {
    const footer = source("components/Footer.tsx");
    assert.match(footer, /import Link from "next\/link"/);
    assert.match(footer, /className="foot__portal-links"/);
    assert.match(footer, /foot__portal-links-row/);
    assert.match(footer, /customerLogin\.href/);
    assert.match(footer, /partnerLogin\.href/);
    assert.match(footer, /operatorLogin\.href/);
    assert.match(footer, /FOOTER_PORTAL_LINK_DEFAULTS/);
    assert.match(footer, /aria-hidden="true"/);
    assert.doesNotMatch(footer, /target=|rel="nofollow"/);
  });

  it("shows the links on public surfaces and suppresses them in protected portals", () => {
    for (const file of [
      "components/HomePageRenderer.tsx",
      "app/events/audit-quote/page.tsx",
      "app/consult/page.tsx",
      "app/support/page.tsx",
    ]) {
      assert.match(source(file), /<Footer(?:\s|\/|content)/);
      assert.doesNotMatch(source(file), /showPortalLinks=\{false\}/);
    }
    for (const file of [
      "app/partner/page.tsx",
      "app/mypage/quotes/page.tsx",
      "app/mypage/quotes/[quoteId]/page.tsx",
      "app/mypage/requests/[requestId]/page.tsx",
      "app/portal-access-denied/page.tsx",
    ]) {
      assert.match(source(file), /<Footer showPortalLinks=\{false\} \/>/);
    }
    assert.doesNotMatch(source("app/admin/page.tsx"), /<Footer/);
    assert.doesNotMatch(
      source("app/admin/operations/page.tsx"),
      /<Footer/,
    );
  });

  it("keeps the links muted, visible, touchable, responsive, and keyboard focused", () => {
    const css = source("app/globals.css");
    const start = css.indexOf(".foot__portal-links {");
    const end = css.indexOf(".foot__bar small", start);
    assert.ok(start >= 0 && end > start);
    const portalCss = css.slice(start, end);
    assert.match(portalCss, /flex-direction: column/);
    assert.match(portalCss, /foot__portal-links-row/);
    assert.match(portalCss, /font-size: 12\.5px/);
    assert.match(portalCss, /color: var\(--gray-400\)/);
    assert.match(portalCss, /min-height: 44px/);
    assert.match(portalCss, /text-decoration: none/);
    assert.match(portalCss, /:hover[\s\S]*text-decoration: underline/);
    assert.match(portalCss, /:focus-visible[\s\S]*outline: 2px solid/);
    assert.doesNotMatch(portalCss, /display:\s*none|opacity:\s*0/);
    assert.match(
      css,
      /@media \(max-width: 720px\)[\s\S]*\.foot__portal-links \{[\s\S]*width: 100%/,
    );
  });

  it("keeps both login pages noindex and out of an absent sitemap", () => {
    for (const file of [
      "app/partner/login/page.tsx",
      "app/admin/login/page.tsx",
    ]) {
      assert.match(
        source(file),
        /robots: \{ index: false, follow: false \}/,
      );
    }
    for (const file of [
      "app/sitemap.ts",
      "app/sitemap.js",
      "sitemap.ts",
      "sitemap.js",
    ]) {
      assert.equal(existsSync(path.join(root, file)), false);
    }
  });

  it("registers business labels for both CMS footer links", () => {
    const settings = source(
      "components/cms-editor/CmsCommonAreaSettings.tsx",
    );
    assert.match(settings, /customerLogin: "고객 로그인 링크"/);
    assert.match(settings, /partnerLogin: "제휴사 로그인 링크"/);
    assert.match(settings, /operatorLogin: "운영자 로그인 링크"/);
    assert.match(
      settings,
      /portalLoginNavigationLabel:[\s\S]*화면 읽기 도구/,
    );
  });
});
