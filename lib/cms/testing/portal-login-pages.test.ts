import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  PORTAL_LOGIN_PAGE_CONFIG,
} from "@/lib/auth/login-page";
import {
  getPortalMismatchResult,
  type AccountStatus,
  type AccountType,
  type AuthenticatedAccountContext,
} from "@/lib/auth/portal";
import { CMS_PAGE_ROUTES } from "@/lib/cms/constants";
import { CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";

const root = process.cwd();
const source = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), "utf8");

function account(
  accountType: AccountType,
  status: AccountStatus = "ACTIVE",
): AuthenticatedAccountContext {
  const defaultPortal =
    accountType === "CUSTOMER"
      ? "customer"
      : accountType === "PARTNER_OPERATOR"
        ? "partner"
        : "admin";
  return {
    uid: "user-1",
    email: "user@example.com",
    accountType,
    role:
      accountType === "CUSTOMER"
        ? "member"
        : accountType === "PARTNER_OPERATOR"
          ? "partner"
          : "operations_manager",
    status,
    partnerId:
      accountType === "PARTNER_OPERATOR" ? "partner-1" : undefined,
    permissions: [],
    defaultPortal,
  };
}

describe("portal login page rendering contract", () => {
  const pages = [
    ["app/login/page.tsx", "auth.login"],
    ["app/partner/login/page.tsx", "auth.partnerLogin"],
    ["app/admin/login/page.tsx", "auth.adminLogin"],
  ] as const;

  it("renders all three routes through the shared noindex renderer", () => {
    for (const [file, pageKey] of pages) {
      const page = source(file);
      assert.match(
        page,
        new RegExp(`loadPublishedCmsPage\\(\\s*"${pageKey}"`),
      );
      assert.match(page, new RegExp(`pageKey="${pageKey}"`));
      assert.match(
        page,
        /robots: \{ index: false, follow: false \}/,
      );
      assert.match(page, /<LoginPageRenderer/);
    }
  });

  it("keeps one accessible LoginForm implementation", () => {
    const form = source("components/LoginForm.tsx");
    const renderer = source("components/LoginPageRenderer.tsx");
    assert.match(renderer, /<LoginForm/);
    assert.match(renderer, /HomePromoFloat/);
    assert.match(form, /<form className="login-form" onSubmit=\{submit\}/);
    assert.match(form, /autoComplete="email"/);
    assert.match(form, /autoComplete="current-password"/);
    assert.match(form, /submittingRef\.current/);
    assert.match(form, /sendPasswordResetEmail/);
    assert.match(form, /aria-label=/);
  });

  it("uses customer, partner, and operator-specific CMS copy", () => {
    const customer = CMS_PAGE_DEFAULTS["auth.login"];
    const partner = CMS_PAGE_DEFAULTS["auth.partnerLogin"];
    const admin = CMS_PAGE_DEFAULTS["auth.adminLogin"];
    assert.match(JSON.stringify(customer), /농협지원센터 로그인/);
    assert.match(
      JSON.stringify(customer),
      /농협 이메일\(@nonghyup\.com\) 또는 승인된 테스트 계정/,
    );
    assert.doesNotMatch(
      JSON.stringify(customer),
      /가입한 농협 이메일 계정으로 로그인해 주세요/,
    );
    assert.doesNotMatch(JSON.stringify(customer), /내부 운영자 전용/);
    assert.match(JSON.stringify(partner), /제휴사 로그인/);
    assert.match(JSON.stringify(partner), /등록된 제휴사 운영자 계정/);
    assert.doesNotMatch(JSON.stringify(partner), /\/signup/);
    const promo = customer.sections.find((section) => section.id === "promoFloat");
    assert.equal(promo?.title, "2027년도 외부회계감사 견적 신청하기");
    assert.equal(promo?.actions[0]?.href, "/events/audit-quote");
    assert.equal(
      partner.sections.some((section) => section.id === "promoFloat"),
      false,
    );
    assert.equal(
      admin.sections.some((section) => section.id === "promoFloat"),
      false,
    );
    assert.match(
      partner.sections.find((section) => section.id === "loginForm")
        ?.actions[0]?.href ?? "",
      /^\/partner\/apply$/,
    );
    assert.match(JSON.stringify(admin), /운영자 로그인/);
    assert.match(JSON.stringify(admin), /내부 운영자 전용/);
    assert.equal(
      admin.sections.find((section) => section.id === "loginForm")
        ?.actions.length,
      0,
    );
  });
});

describe("portal login redirect contract", () => {
  it("maps each login route to one expected portal and home", () => {
    assert.deepEqual(PORTAL_LOGIN_PAGE_CONFIG["auth.login"], {
      expectedPortal: "customer",
      legacyCrossPortal: true,
      showEmailLookup: true,
    });
    assert.equal(
      PORTAL_LOGIN_PAGE_CONFIG["auth.partnerLogin"].expectedPortal,
      "partner",
    );
    assert.equal(
      PORTAL_LOGIN_PAGE_CONFIG["auth.adminLogin"].expectedPortal,
      "admin",
    );

    assert.equal(
      getPortalMismatchResult(account("CUSTOMER"), "customer")
        .redirectPath,
      "/mypage",
    );
    assert.equal(
      getPortalMismatchResult(
        account("PARTNER_OPERATOR"),
        "partner",
      ).redirectPath,
      "/partner",
    );
    assert.equal(
      getPortalMismatchResult(
        account("INTERNAL_OPERATOR"),
        "admin",
      ).redirectPath,
      "/admin",
    );
  });

  it("distinguishes mismatches and blocks inactive accounts", () => {
    const mismatch = getPortalMismatchResult(
      account("CUSTOMER"),
      "admin",
    );
    assert.equal(mismatch.reason, "portal_mismatch");
    assert.equal(mismatch.redirectPath, "/mypage");

    const inactive = getPortalMismatchResult(
      account("PARTNER_OPERATOR", "SUSPENDED"),
      "partner",
    );
    assert.equal(inactive.reason, "account_unavailable");
    assert.equal(inactive.redirectPath, null);
  });

  it("keeps the legacy login alias without redirect loops", () => {
    assert.equal(CMS_PAGE_ROUTES["auth.login"], "/login");
    assert.equal(
      CMS_PAGE_ROUTES["auth.partnerLogin"],
      "/partner/login",
    );
    assert.equal(CMS_PAGE_ROUTES["auth.adminLogin"], "/admin/login");
    assert.equal(
      new Set([
        CMS_PAGE_ROUTES["auth.login"],
        CMS_PAGE_ROUTES["auth.partnerLogin"],
        CMS_PAGE_ROUTES["auth.adminLogin"],
      ]).size,
      3,
    );
    for (const file of [
      "app/login/page.tsx",
      "app/partner/login/page.tsx",
      "app/admin/login/page.tsx",
    ]) {
      assert.doesNotMatch(source(file), /\bredirect\(/);
    }
  });
});
