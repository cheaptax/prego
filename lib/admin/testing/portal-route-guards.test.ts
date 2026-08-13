import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  getPortalMismatchResult,
  type AuthenticatedAccountContext,
} from "@/lib/auth/portal";
import {
  getProtectedPortalForPath,
  getUnauthenticatedPortalRedirect,
} from "@/lib/auth/portal-routes";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function routeFiles(relativeDirectory: string): string[] {
  const directory = path.join(root, relativeDirectory);
  return readdirSync(directory, { withFileTypes: true }).flatMap(
    (entry) => {
      const child = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) return routeFiles(child);
      return entry.name === "route.ts" ? [child] : [];
    },
  );
}

function account(
  input: Partial<AuthenticatedAccountContext> = {},
): AuthenticatedAccountContext {
  return {
    uid: "uid-1",
    email: "user@example.com",
    accountType: "CUSTOMER",
    role: "member",
    status: "ACTIVE",
    permissions: [],
    defaultPortal: "customer",
    ...input,
  };
}

describe("portal route boundary", () => {
  it("protects portal roots while keeping only explicit login/apply exceptions public", () => {
    assert.equal(getProtectedPortalForPath("/mypage"), "customer");
    assert.equal(getProtectedPortalForPath("/mypage/quotes/q1"), "customer");
    assert.equal(getProtectedPortalForPath("/partner"), "partner");
    assert.equal(getProtectedPortalForPath("/partner/jobs"), "partner");
    assert.equal(getProtectedPortalForPath("/admin"), "admin");
    assert.equal(getProtectedPortalForPath("/admin/operations"), "admin");
    assert.equal(getProtectedPortalForPath("/admin/test-data"), "admin");
    assert.equal(getProtectedPortalForPath("/partner/login"), null);
    assert.equal(getProtectedPortalForPath("/partner/apply"), null);
    assert.equal(getProtectedPortalForPath("/admin/login"), null);
  });

  it("sends logged-out requests to each canonical login without a return URL", () => {
    assert.equal(getUnauthenticatedPortalRedirect("/mypage"), "/login");
    assert.equal(
      getUnauthenticatedPortalRedirect("/partner/quotes"),
      "/partner/login",
    );
    assert.equal(
      getUnauthenticatedPortalRedirect("/admin/operations"),
      "/admin/login",
    );
  });

  it("rejects customer, partner, and operator cross-portal access", () => {
    assert.equal(
      getPortalMismatchResult(account(), "admin").redirectPath,
      "/mypage",
    );
    assert.equal(
      getPortalMismatchResult(account(), "partner").reason,
      "portal_mismatch",
    );
    assert.equal(
      getPortalMismatchResult(
        account({
          accountType: "PARTNER_OPERATOR",
          role: "partner",
          defaultPortal: "partner",
          partnerId: "partner-1",
        }),
        "admin",
      ).redirectPath,
      "/partner",
    );
    assert.equal(
      getPortalMismatchResult(
        account({
          accountType: "INTERNAL_OPERATOR",
          role: "read_only",
          defaultPortal: "admin",
        }),
        "partner",
      ).redirectPath,
      "/admin",
    );
  });

  it("blocks an inactive operator even when the session still exists", () => {
    const result = getPortalMismatchResult(
      account({
        accountType: "INTERNAL_OPERATOR",
        role: "read_only",
        defaultPortal: "admin",
        status: "SUSPENDED",
      }),
      "admin",
    );
    assert.equal(result.reason, "account_unavailable");
    assert.equal(result.redirectPath, null);
  });

  it("uses proxy cookie presence only and always repeats final authorization on the server", () => {
    const proxy = source("proxy.ts");
    const guard = source("lib/auth/portal-page-guard.ts");
    assert.match(proxy, /request\.cookies\.has\(PORTAL_SESSION_COOKIE\)/);
    assert.doesNotMatch(proxy, /verifySessionCookie|adminDb/);
    assert.match(guard, /resolveSessionAccountContext/);
    assert.match(guard, /getPortalMismatchResult/);
    assert.match(guard, /AccountContextResolutionError/);
  });

  it("guards every protected server page and leaves login/apply pages unguarded", () => {
    const protectedPages = [
      ["app/mypage/page.tsx", "customer"],
      ["app/mypage/quotes/page.tsx", "customer"],
      ["app/mypage/quotes/[quoteId]/page.tsx", "customer"],
      ["app/mypage/requests/[requestId]/page.tsx", "customer"],
      ["app/partner/page.tsx", "partner"],
      ["app/admin/page.tsx", "admin"],
      ["app/admin/operations/page.tsx", "admin"],
      ["app/admin/test-data/page.tsx", "admin"],
      ["app/admin/pages/[pageKey]/page.tsx", "admin"],
      ["app/admin/globals/[documentKey]/page.tsx", "admin"],
    ] as const;
    for (const [file, portal] of protectedPages) {
      assert.match(
        source(file),
        new RegExp(`requirePortalPageSession\\("${portal}"`, "u"),
        `missing server guard: ${file}`,
      );
    }
    for (const file of [
      "app/partner/login/page.tsx",
      "app/partner/apply/page.tsx",
      "app/admin/login/page.tsx",
    ]) {
      assert.doesNotMatch(source(file), /requirePortalPageSession/);
    }
  });
});

describe("portal API boundary", () => {
  it("requires an admin authorization helper in every admin route", () => {
    const helper =
      /requirePermission\(|requireAnyPermission\(|requireActiveAdmin\(|requireAdminCapability\(|getAdminSession\(|requireAuditEvaluationAdmin\(|requireConfigAdmin\(|authorizePurgeAdmin|requireRole\(/;
    for (const file of routeFiles("app/api/admin")) {
      assert.match(source(file), helper, `missing admin auth: ${file}`);
    }
  });

  it("requires partner authorization and derives scope from the authenticated profile", () => {
    for (const file of routeFiles("app/api/partner")) {
      const route = source(file);
      assert.match(route, /requirePartner\(/, `missing partner auth: ${file}`);
    }
    const server = source("lib/firebase/server.ts");
    assert.match(server, /decoded\.partnerId\.trim\(\) !== partnerId/);
    assert.match(server, /partner\.status !== "active"/);
    assert.match(
      source("app/api/partner/quotes/[assignmentId]/route.ts"),
      /assignment\.partnerId !== partnerId/,
    );
  });

  it("rejects customer and partner claims at admin/member API boundaries", () => {
    const server = source("lib/firebase/server.ts");
    assert.match(
      server,
      /!isAdminToken\(decoded\) \|\|\s*\(decoded\.partner === true && !isMultiRoleToken\(decoded\)\)/,
    );
    assert.match(
      server,
      /decoded\.partner !== true \|\|\s*\(decoded\.admin === true && !multiRole\)/,
    );
    assert.match(
      server,
      /\(decoded\.admin === true \|\| decoded\.partner === true\) &&\s*!multiRole/,
    );
  });

  it("requires active member profiles for customer data and allows status lookup only for members", () => {
    assert.match(
      source("app/api/me/overview/route.ts"),
      /requireActiveMember\(/,
    );
    assert.doesNotMatch(
      source("app/api/me/overview/route.ts"),
      /buildFallbackUser|verifyBearerToken/,
    );
    assert.match(
      source("app/api/me/status/route.ts"),
      /requireMember\(/,
    );
    for (const file of routeFiles("app/api/me")) {
      assert.match(
        source(file),
        /requireActiveMember\(|requireWritableActiveMember\(|requireQuoteInboxMember\(|requireMember\(/,
        `missing member auth: ${file}`,
      );
    }
    assert.match(
      source("app/api/audit-evaluations/access/firebase/route.ts"),
      /requireActiveMember\(|requireWritableActiveMember\(/,
    );
  });

  it("does not expose role, permission, or partner identifiers on the mismatch page", () => {
    const rendered = [
      source("app/portal-access-denied/page.tsx"),
      source("components/PortalAccessDeniedActions.tsx"),
    ].join("\n");
    assert.doesNotMatch(rendered, /accountType|permissions|partnerId/);
  });
});
