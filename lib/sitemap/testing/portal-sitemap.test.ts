import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { GENERATED_APP_PAGES } from "@/lib/sitemap/generated-app-pages";
import {
  buildPortalSitemap,
  type PortalSitemapRole,
} from "@/lib/sitemap/portal-sitemap";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const appDirectory = path.join(root, "app");
const hiddenRoutes = new Set([
  "/login",
  "/signup",
  "/pending-approval",
  "/portal-access-denied",
  "/admin/login",
  "/partner/login",
]);

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
  });
}

function routesFor(role: PortalSitemapRole, isSuperAdmin = false) {
  return new Set(
    buildPortalSitemap(role, { isSuperAdmin }).groups.flatMap((group) =>
      group.items.map((item) => item.route),
    ),
  );
}

test("generated manifest matches every App Router page source", () => {
  const discovered = walk(appDirectory)
    .filter((filePath) => /[/\\]page\.(?:js|jsx|ts|tsx)$/u.test(filePath))
    .map((filePath) => path.relative(root, filePath).replaceAll("\\", "/"))
    .sort();
  const generated = GENERATED_APP_PAGES.map((page) => page.sourcePath).sort();
  assert.deepEqual(generated, discovered);
});

test("each portal sitemap contains only public and matching role pages", () => {
  for (const role of ["customer", "partner", "admin"] as const) {
    const sitemap = buildPortalSitemap(role);
    assert.equal(
      sitemap.routeCount,
      sitemap.groups.reduce((count, group) => count + group.items.length, 0),
    );
    for (const group of sitemap.groups) {
      assert.ok(group.id === "public" || group.id === role);
      for (const item of group.items) {
        assert.ok(item.audience === "public" || item.audience === role);
        assert.ok(!item.route.includes("["));
        assert.ok(!hiddenRoutes.has(item.route));
      }
    }
  }
});

test("new static pages automatically appear in their accessible portal sitemap", () => {
  const roleRoutes = {
    customer: routesFor("customer"),
    partner: routesFor("partner"),
    admin: routesFor("admin", true),
  };
  for (const page of GENERATED_APP_PAGES) {
    if (page.dynamic || hiddenRoutes.has(page.route)) continue;
    const expectedRoles: readonly PortalSitemapRole[] =
      page.audience === "public"
        ? (["customer", "partner", "admin"] as const)
        : [page.audience];
    for (const role of expectedRoles) {
      assert.ok(
        roleRoutes[role].has(page.route),
        `${page.route} must appear in the ${role} sitemap`,
      );
    }
  }
});

test("portal-only pages never leak into another portal sitemap", () => {
  const customer = routesFor("customer");
  const partner = routesFor("partner");
  const admin = routesFor("admin");
  const superAdmin = routesFor("admin", true);
  assert.ok(customer.has("/mypage"));
  assert.ok(!customer.has("/partner"));
  assert.ok(!customer.has("/admin"));
  assert.ok(partner.has("/partner"));
  assert.ok(!partner.has("/mypage"));
  assert.ok(!partner.has("/admin"));
  assert.ok(admin.has("/admin"));
  assert.ok(!admin.has("/admin/test-data"));
  assert.ok(superAdmin.has("/admin/test-data"));
  assert.ok(!admin.has("/mypage"));
  assert.ok(!admin.has("/partner"));
});
