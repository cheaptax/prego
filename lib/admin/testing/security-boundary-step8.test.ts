import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  canManageOperator,
  createAuthorizationContext,
  getAdminRole,
  isAccountActive,
  wouldRemoveLastSuperAdmin,
} from "@/lib/admin/rbac";
import type { OperatorProfile, UserRecord } from "@/lib/firebase/schema";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const operatorListRoute = read("app/api/admin/operators/route.ts");
const operatorRoute = read("app/api/admin/operators/[uid]/route.ts");
const partnerRoute = read("app/api/admin/partners/[partnerId]/route.ts");
const partnerAccountsRoute = read(
  "app/api/admin/partners/[partnerId]/accounts/route.ts",
);
const partnerAccountRoute = read(
  "app/api/admin/partners/[partnerId]/accounts/[uid]/route.ts",
);
const partnerAssignmentsRoute = read("app/api/partner/assignments/route.ts");
const firebaseServer = read("lib/firebase/server.ts");
const firestoreRules = read("firestore.rules");
const dashboard = read("components/AdminDashboard.tsx");
const rbac = read("lib/admin/rbac.ts");

function operator(input: Partial<UserRecord> = {}): OperatorProfile {
  const user: UserRecord = {
    uid: "operator-1",
    name: "Operator",
    phone: "",
    email: "operator@example.com",
    position: "Operator",
    duty: "Operator",
    consents: {
      terms: false,
      privacy: false,
      marketing: false,
      email: false,
      sms: false,
      kakao: false,
    },
    role: "admin",
    adminRole: "operations_manager",
    accountStatus: "active",
    status: "active",
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    ...input,
  };
  return { ...user, role: "admin", adminRole: getAdminRole(user) };
}

describe("STEP 8 operator and partner attack boundaries", () => {
  it("blocks self escalation and lower-role management of SUPER_ADMIN", () => {
    assert.match(operatorRoute, /hasSensitiveSelfChange/);
    assert.match(operatorRoute, /protected_operator/);
    const actor = createAuthorizationContext(
      operator({
        uid: "manager-1",
        adminRole: "operations_manager",
      }),
    );
    assert.equal(
      canManageOperator(
        actor,
        operator({ uid: "super-1", adminRole: "super_admin" }),
        { permission: "operators:manageRoles" },
      ),
      false,
    );
  });

  it("blocks last SUPER_ADMIN demotion, disable, and delete in API policy", () => {
    const superAdmin = operator({
      uid: "super-1",
      adminRole: "super_admin",
    });
    assert.equal(
      wouldRemoveLastSuperAdmin({
        target: superAdmin,
        activeSuperAdminCount: 1,
        nextRole: "read_only",
      }),
      true,
    );
    assert.equal(
      wouldRemoveLastSuperAdmin({
        target: superAdmin,
        activeSuperAdminCount: 1,
        nextStatus: "disabled",
      }),
      true,
    );
    assert.match(operatorRoute, /last_super_admin/);
  });

  it("blocks inactive profiles at the API and Rules boundaries", () => {
    assert.equal(
      isAccountActive(
        operator({ accountStatus: "disabled", status: "active" }),
      ),
      false,
    );
    assert.match(firebaseServer, /throw new AdminAuthorizationError\("inactive_account"/);
    assert.match(firestoreRules, /function isActiveAccount\(user\)/);
    assert.match(
      firestoreRules,
      /'accountStatus' in user[\s\S]*?user\.accountStatus == 'active'/,
    );
  });

  it("keeps direct URL controls UX-only and requires API permissions", () => {
    assert.match(dashboard, /canShowAdminMenu\(adminContext, "operators"\)/);
    assert.match(dashboard, /canShowAdminAction\([\s\S]*?"operators:delete"/);
    assert.match(operatorRoute, /requirePermission\(req, "operators:delete"\)/);
    assert.match(operatorListRoute, /requirePermission\(req, "operators:create"\)/);
  });

  it("rejects request-body role and permission escalation", () => {
    assert.match(operatorListRoute, /payload\.adminRole === "super_admin"/);
    assert.match(operatorListRoute, /ADMIN_ROLE_RANK\[payload\.adminRole\]/);
    assert.match(operatorRoute, /operators:manageRoles/);
    assert.match(operatorRoute, /canManageOperator/);
  });

  it("does not expose PARTNER_ADMIN or PARTNER_OPERATOR mutation roles", () => {
    assert.doesNotMatch(rbac, /partner_admin|partner_operator/i);
    assert.match(
      partnerAccountsRoute,
      /requirePermission\(req, "partners:manageMembers"\)/,
    );
    assert.match(partnerAccountsRoute, /role: "partner"/);
  });

  it("isolates partner reads and cross-partner account mutation", () => {
    assert.match(
      partnerAssignmentsRoute,
      /\.where\("partnerId", "==", partnerId\)/,
    );
    assert.match(
      partnerAccountRoute,
      /current\.partnerId !== partnerId/,
    );
    assert.match(partnerAccountRoute, /partner_account_scope_mismatch/);
  });

  it("prevents partner-side status changes and inactive partner access", () => {
    assert.match(partnerRoute, /partners:changeStatus/);
    assert.match(
      firestoreRules,
      /match \/partners\/\{partnerId\} \{[\s\S]*?allow create, update, delete: if false;/,
    );
    assert.match(firebaseServer, /partner\.status !== "active"/);
    assert.match(partnerAccountsRoute, /partner\.status === "terminated"/);
  });

  it("terminates linked partners without hard deleting documents", () => {
    assert.match(partnerRoute, /status: "terminated"/);
    assert.match(partnerRoute, /hardDeleted: false/);
    assert.match(partnerRoute, /hardDeleteBlockReasons/);
    assert.doesNotMatch(partnerRoute, /ref\.delete\(\)/);
  });

  it("keeps passwords and tokens out of logs and blocks client writes", () => {
    const sensitiveRoutes = [
      operatorListRoute,
      operatorRoute,
      partnerAccountsRoute,
      partnerAccountRoute,
    ].join("\n");
    assert.doesNotMatch(
      sensitiveRoutes,
      /console\.(?:log|error|warn)\([^)]*(?:password|token)/i,
    );
    assert.match(
      firestoreRules,
      /match \/users\/\{userId\} \{[\s\S]*?allow create, update, delete: if false;/,
    );
    assert.match(
      firestoreRules,
      /match \/partnerUniqueKeys\/\{keyId\} \{[\s\S]*?allow read, write: if false;/,
    );
  });

  it("rolls back failed operator creation and resolves audit roles centrally", () => {
    assert.match(
      operatorListRoute,
      /await adminAuth\(\)\.deleteUser\(authUser\.uid\)\.catch\(\(\) => undefined\)/,
    );
    assert.match(
      operatorRoute,
      /previousAdminRole: getAdminRole\(current\)/,
    );
    assert.match(operatorRoute, /adminRole: getAdminRole\(operator\)/);
  });
});
