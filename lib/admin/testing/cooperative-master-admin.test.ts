import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { ADMIN_ROLE_PRESETS } from "@/lib/admin/rbac";

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), "utf8");

describe("production cooperative master administration", () => {
  it("uses dedicated read and write permissions for master operations", () => {
    const collectionRoute = read("app/api/admin/cooperatives/route.ts");
    const itemRoute = read(
      "app/api/admin/cooperatives/[cooperativeId]/route.ts",
    );
    assert.match(
      collectionRoute,
      /requireAdminCapability\(request, "cooperatives:read"\)/,
    );
    assert.match(
      collectionRoute,
      /requireAdminCapability\(request, "cooperatives:write"\)/,
    );
    assert.match(
      itemRoute,
      /requireAdminCapability\(request, "cooperatives:write"\)/,
    );
    const operationsPermissions =
      ADMIN_ROLE_PRESETS.operations_manager as readonly string[];
    assert.ok(operationsPermissions.includes("cooperatives:read"));
    assert.ok(
      !operationsPermissions.includes("cooperatives:write"),
    );
    assert.ok(ADMIN_ROLE_PRESETS.super_admin.includes("cooperatives:write"));
  });

  it("keeps both master collections inaccessible to Firebase clients", () => {
    const rules = read("firestore.rules");
    for (const collection of [
      "cooperativeMaster",
      "cooperativeMasterConfiguration",
    ]) {
      assert.match(
        rules,
        new RegExp(
          `match /${collection}/\\{[^}]+\\} \\{\\s*allow read, write: if false;`,
          "s",
        ),
      );
    }
  });

  it("uses the Firestore search API as the signup source of truth", () => {
    const signup = read("components/SignupForm.tsx");
    assert.match(signup, /\/api\/cooperatives\/search/);
    assert.doesNotMatch(signup, /nonghyupMaster/);
    assert.doesNotMatch(signup, /REAL_COOPERATIVE_CATALOG/);
  });
});
