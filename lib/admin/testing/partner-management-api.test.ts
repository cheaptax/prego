import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const listRoute = read("app/api/admin/partners/route.ts");
const detailRoute = read("app/api/admin/partners/[partnerId]/route.ts");
const accountsRoute = read(
  "app/api/admin/partners/[partnerId]/accounts/route.ts",
);
const accountRoute = read(
  "app/api/admin/partners/[partnerId]/accounts/[uid]/route.ts",
);
const logoRoute = read("app/api/admin/partners/[partnerId]/logo/route.ts");
const sealRoute = read("app/api/admin/partners/[partnerId]/seal/route.ts");
const quoteProfileRoute = read(
  "app/api/admin/partners/[partnerId]/quote-profile/route.ts",
);
const defaultsRoute = read(
  "app/api/admin/partners/[partnerId]/nh-audit-defaults/route.ts",
);
const panel = read("components/admin/PartnerManagementPanel.tsx");
const quoteProfilePanel = read(
  "components/admin/PartnerQuoteProfileSection.tsx",
);
const partnerServer = read("lib/firebase/server.ts");
const migration = read("scripts/migrate-partners.mjs");

describe("partner management API contract", () => {
  it("requires canonical read and mutation permissions", () => {
    assert.match(listRoute, /requirePermission\(req, "partners:read"\)/);
    assert.match(listRoute, /requirePermission\(req, "partners:create"\)/);
    assert.match(detailRoute, /requirePermission\(req, "partners:read"\)/);
    assert.match(detailRoute, /partners:changeStatus/);
    assert.match(detailRoute, /partners:manageScope/);
    assert.match(accountsRoute, /partners:manageMembers/);
    assert.match(accountRoute, /partners:manageMembers/);
    assert.match(listRoute, /authErrorStatus\(err\)/);
    assert.match(detailRoute, /authErrorStatus\(err\)/);
  });

  it("authorizes basic, status, and scope partner changes independently", () => {
    assert.match(detailRoute, /const basicChanged =/);
    assert.match(
      detailRoute,
      /basicChanged && !hasPermission\(admin\.context, "partners:update"\)/,
    );
    assert.match(
      detailRoute,
      /statusChanged && !hasPermission\(admin\.context, "partners:changeStatus"\)/,
    );
    assert.match(
      detailRoute,
      /scopeChanged && !hasPermission\(admin\.context, "partners:manageScope"\)/,
    );
    assert.doesNotMatch(
      detailRoute,
      /if \(\s*!hasPermission\(admin\.context, "partners:update"\) \|\|/,
    );
  });

  it("implements list search, filters, pagination, and account counts", () => {
    assert.match(listRoute, /searchParams\.get\("search"\)/);
    assert.match(listRoute, /searchParams\.get\("type"\)/);
    assert.match(listRoute, /searchParams\.get\("status"\)/);
    assert.match(listRoute, /paginatePartnerList/);
    assert.match(listRoute, /memberCounts/);
  });

  it("uses transaction-backed normalized unique keys for creation", () => {
    assert.match(listRoute, /partnerUniqueKeyIds\(payload\)/);
    assert.match(listRoute, /runTransaction/);
    assert.match(listRoute, /transaction\.create\(nameKeyRef/);
    assert.match(listRoute, /duplicate_partner_name/);
    assert.match(listRoute, /duplicate_partner_email/);
  });

  it("blocks cross-partner account updates and synchronizes link changes", () => {
    assert.match(
      accountRoute,
      /current\.role !== "partner" \|\| current\.partnerId !== partnerId/,
    );
    assert.match(accountRoute, /partner_account_scope_mismatch/);
    assert.match(accountRoute, /partner\.account_unlinked/);
    assert.match(accountRoute, /partner\.account_linked/);
    assert.match(accountRoute, /setCustomUserClaims/);
    assert.match(accountRoute, /FieldValue\.delete\(\)/);
  });

  it("blocks suspended partner access and terminates instead of hard deleting", () => {
    assert.match(partnerServer, /partner\.status !== "active"/);
    assert.match(detailRoute, /status: "terminated"/);
    assert.match(detailRoute, /hardDeleted: false/);
    assert.doesNotMatch(detailRoute, /ref\.delete\(\)/);
    assert.match(detailRoute, /syncPartnerAccountAccess/);
  });

  it("keeps migration dry-run by default and repeat-safe on apply", () => {
    assert.match(migration, /Default mode is dry-run/);
    assert.match(migration, /args\.includes\("--apply"\)/);
    assert.match(migration, /--confirm-production/);
    assert.match(migration, /transaction\.set\(row\.ref/);
    assert.match(migration, /conflicts\.length > 0/);
    assert.match(migration, /failures=/);
  });

  it("lets operators manage quote assets, consent, and evaluation defaults", () => {
    assert.match(logoRoute, /requirePermission\(req, "partners:read"\)/);
    assert.match(logoRoute, /requirePermission\(req, "partners:update"\)/);
    assert.match(sealRoute, /requirePermission\(req, "partners:update"\)/);
    assert.match(quoteProfileRoute, /opsProxyQuoteSendConsent/);
    assert.match(quoteProfileRoute, /nhAuditEvaluationDefaults/);
    assert.match(
      defaultsRoute,
      /requireAnyPermission\(req, \[\s*"partners:update",\s*"auditQuotes:write",\s*\]\)/,
    );
    assert.match(panel, /<PartnerQuoteProfileSection/);
    assert.match(
      quoteProfilePanel,
      /\/api\/admin\/partners\/\$\{encodeURIComponent\(partner\.id\)\}\/\$\{kind\}/,
    );
    assert.match(quoteProfilePanel, /\/quote-profile/);
    assert.match(quoteProfilePanel, /type="file"/);
    assert.match(quoteProfilePanel, /opsProxyQuoteSendConsent/);
    assert.match(quoteProfilePanel, /showCostFields=\{false\}/);
  });
});
