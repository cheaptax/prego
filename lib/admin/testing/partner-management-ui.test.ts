import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { canShowAdminAction } from "@/lib/admin/menu-permissions";
import type { AuthorizationContext } from "@/lib/firebase/schema";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const panel = readFileSync(
  path.join(root, "components/admin/PartnerManagementPanel.tsx"),
  "utf8",
);
const dashboard = readFileSync(
  path.join(root, "components/AdminDashboard.tsx"),
  "utf8",
);

function context(
  permissions: AuthorizationContext["permissions"],
): AuthorizationContext {
  return {
    uid: "admin-1",
    accountType: "admin",
    status: "active",
    adminRole: "read_only",
    permissions,
    scopes: ["ALL"],
  };
}

describe("partner management UI integration", () => {
  it("memoizes CMS section copies so list effects do not refetch forever", () => {
    assert.match(
      panel,
      /useMemo\(\(\) => copy\.section\("partners"\), \[copy\]\)/,
    );
    assert.match(panel, /\}, \[loadList, refreshKey, refreshVersion, search\]\);/);
  });

  it("uses the STEP 6 list and detail APIs with search, filters, and pagination", () => {
    assert.match(panel, /\/api\/admin\/partners\?\$\{params\.toString\(\)\}/);
    assert.match(panel, /params\.set\("search", search\.trim\(\)\)/);
    assert.match(panel, /params\.set\("profession", professionFilter\)/);
    assert.match(panel, /params\.set\("status", statusFilter\)/);
    assert.match(panel, /\/api\/admin\/partners\/\$\{partnerId\}/);
    assert.match(panel, /PAGE_SIZES\.map/);
    assert.match(dashboard, /<PartnerManagementApiPanel/);
  });

  it("shows loading, empty, API error, retry, and refresh states", () => {
    for (const token of [
      "listLoading",
      "detailLoading",
      "listError",
      "detailError",
      "noPartners",
      "refreshKey",
      "copy.message(\"retry\")",
    ]) {
      assert.ok(panel.includes(token), `missing partner state: ${token}`);
    }
  });

  it("uses structured partner fields and excludes unadopted contract inputs", () => {
    assert.match(panel, /INQUIRY_SUPPORT_FIELD_OPTIONS\.map/);
    assert.match(panel, /identifierAutoValue/);
    assert.match(panel, /PARTNER_PROFESSION_OPTIONS\.map/);
    assert.doesNotMatch(panel, /businessNumber/);
    assert.doesNotMatch(panel, /contractStartDate|contractEndDate/);
  });

  it("requires confirmation for access-blocking status changes and termination", () => {
    assert.match(panel, /isDangerousPartnerStatusChange/);
    assert.match(panel, /kind: "partner-status"/);
    assert.match(panel, /kind: "terminate"/);
    assert.match(panel, /statusConfirmDescription/);
    assert.match(panel, /terminateConfirmDescription/);
  });

  it("allows granular status or scope editors to submit their own changes", () => {
    assert.match(panel, /const canSubmit =/);
    assert.match(panel, /canChangeStatus && statusChanged/);
    assert.match(panel, /canManageScope && scopeChanged/);
    assert.match(
      panel,
      /disabled=\{loading \|\| suspended \|\| !canSubmit\}/,
    );
  });

  it("displays linked accounts and hides their mutation controls without permission", () => {
    const reader = context(["partners:read"]);
    assert.equal(canShowAdminAction(reader, "partners:manageMembers"), false);
    assert.match(panel, /detail\.accounts\.map/);
    assert.match(panel, /\{canManageMembers &&/);
    assert.match(panel, /setAccountEditor/);
    assert.match(panel, /kind: "unlink-account"/);
    assert.match(panel, /targetPartnerId/);
  });

  it("maps duplicate errors and prevents duplicate submissions", () => {
    assert.match(panel, /partnerServerErrorCopyKey/);
    assert.match(panel, /partner_account_email_exists/);
    assert.match(panel, /disabled=\{loading \|\| suspended/);
    assert.match(panel, /disabled=\{loading\}/);
  });
});
