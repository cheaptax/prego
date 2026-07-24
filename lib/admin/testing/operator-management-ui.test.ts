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
const dashboard = readFileSync(
  path.join(root, "components/AdminDashboard.tsx"),
  "utf8",
);
const operatorRoute = readFileSync(
  path.join(root, "app/api/admin/operators/route.ts"),
  "utf8",
);

function context(
  permissions: AuthorizationContext["permissions"],
): AuthorizationContext {
  return {
    uid: "viewer",
    accountType: "admin",
    status: "active",
    adminRole: "read_only",
    permissions,
    scopes: ["ALL"],
  };
}

describe("operator management UI integration", () => {
  it("renders structured role, affiliation, scope, and status controls", () => {
    assert.match(dashboard, /roleOptions\.map\(\(role\)/);
    assert.match(dashboard, /getRolePermissionPreview\(adminRole\)/);
    assert.match(dashboard, /value="internal" disabled/);
    assert.match(dashboard, /value="ALL" disabled/);
    assert.match(dashboard, /value="active"/);
    assert.match(dashboard, /value="rejected"/);
    assert.doesNotMatch(
      dashboard,
      /permissionGroupLabel"\)\}\s*<input/,
    );
  });

  it("covers list filters, pagination, loading, error, and refresh states", () => {
    for (const token of [
      "operatorRoleFilter",
      "operatorStatusFilter",
      "operatorPartnerFilter",
      "operatorPageSize",
      "operatorListLoading",
      "operatorListError",
      "operatorRefreshKey",
      "operatorTotalPages",
    ]) {
      assert.ok(dashboard.includes(token), `missing operator state: ${token}`);
    }
    assert.match(operatorRoute, /searchParams\.get\("search"\)/);
    assert.match(operatorRoute, /searchParams\.get\("role"\)/);
    assert.match(operatorRoute, /searchParams\.get\("status"\)/);
    assert.match(operatorRoute, /metadata\.lastSignInTime/);
  });

  it("handles duplicate email, server errors, and duplicate submission", () => {
    assert.match(operatorRoute, /auth\/email-already-exists/);
    assert.match(operatorRoute, /email_already_exists/);
    assert.match(dashboard, /operatorServerErrorCopyKey\(serverError\)/);
    assert.match(
      dashboard,
      /disabled=\{loading \|\| suspended \|\| !canEditProfile\}/,
    );
  });

  it("hides unauthorized create and mutation actions through shared helpers", () => {
    const viewer = context(["operators:read"]);
    assert.equal(canShowAdminAction(viewer, "operators:create"), false);
    assert.equal(canShowAdminAction(viewer, "operators:disable"), false);
    assert.match(dashboard, /\{canCreateOperators && \(/);
    assert.match(dashboard, /\{canDisable && \(/);
    assert.match(dashboard, /\{canDelete && \(/);
    assert.match(dashboard, /\{canResetPassword && \(/);
  });

  it("requires confirmation for deactivation, demotion, and super-admin changes", () => {
    assert.match(dashboard, /dangerousOperatorChanges\(/);
    assert.match(dashboard, /operatorConfirmSuperAdminChange/);
    assert.match(dashboard, /operatorConfirmRoleDemotion/);
    assert.match(dashboard, /operatorConfirmDeactivation/);
    assert.match(dashboard, /kind: "update"/);
  });
});
