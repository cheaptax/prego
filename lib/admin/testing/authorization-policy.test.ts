import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prepareAdminAuditLog } from "@/lib/admin/audit";
import {
  ADMIN_PERMISSIONS,
  ADMIN_ROLE_PRESETS,
  canAccessResource,
  canManageOperator,
  canManagePartner,
  createAuthorizationContext,
  getEffectivePermissions,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  isSuperAdmin,
  wouldRemoveLastSuperAdmin,
} from "@/lib/admin/rbac";
import type {
  AdminPermission,
  AuthorizationContext,
  OperatorProfile,
  UserRecord,
} from "@/lib/firebase/schema";

function operatorProfile(
  input: Partial<OperatorProfile> = {},
): OperatorProfile {
  return {
    uid: "admin-1",
    name: "관리자",
    phone: "",
    email: "admin@example.com",
    position: "운영자",
    duty: "관리자",
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
}

function context(
  input: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  return {
    uid: "actor-1",
    email: "actor@example.com",
    accountType: "admin",
    status: "active",
    adminRole: "operations_manager",
    permissions: [],
    scopes: ["ALL"],
    ...input,
  };
}

describe("admin authorization policy", () => {
  it("resolves every role from the type-safe permission matrix", () => {
    const superAdmin = operatorProfile({ adminRole: "super_admin" });
    assert.deepEqual(
      getEffectivePermissions(superAdmin),
      [...ADMIN_PERMISSIONS].sort(),
    );

    const operations = operatorProfile({ adminRole: "operations_manager" });
    assert.equal(hasPermission(operations, "members:write"), true);
    assert.equal(hasPermission(operations, "operators:manageRoles"), false);

    const partnerManager = operatorProfile({ adminRole: "partner_manager" });
    assert.equal(hasPermission(partnerManager, "partners:manageMembers"), true);
    assert.equal(hasPermission(partnerManager, "points:adjust"), false);

    const cmsEditor = operatorProfile({ adminRole: "cms_editor" });
    assert.equal(hasAllPermissions(cmsEditor, ["cms:read", "cms:write"]), true);

    const readOnly = operatorProfile({ adminRole: "read_only" });
    assert.equal(hasPermission(readOnly, "partners:read"), true);
    assert.equal(hasAnyPermission(readOnly, [
      "partners:update",
      "members:write",
    ]), false);

    assert.deepEqual(
      [...ADMIN_ROLE_PRESETS.super_admin].sort(),
      [...ADMIN_PERMISSIONS].sort(),
    );
  });

  it("adds individual permissions after the role preset", () => {
    const profile = operatorProfile({
      adminRole: "read_only",
      adminCapabilityAllow: ["partners:update"],
    });
    assert.equal(hasPermission(profile, "partners:update"), true);
  });

  it("applies deny overrides after presets and legacy expansion", () => {
    const profile = operatorProfile({
      adminRole: "partner_manager",
      adminCapabilityDeny: ["partners:write"],
    });
    assert.equal(hasPermission(profile, "partners:write"), false);
    assert.equal(hasPermission(profile, "partners:update"), false);
    assert.equal(hasPermission(profile, "partners:manageMembers"), false);
  });

  it("blocks all permissions for inactive accounts", () => {
    const profile = operatorProfile({
      accountStatus: "suspended",
      status: "active",
      adminRole: "super_admin",
    });
    assert.deepEqual(getEffectivePermissions(profile), []);
    assert.equal(hasPermission(profile, "admin:access"), false);
  });

  it("identifies SUPER_ADMIN through role and active status only", () => {
    const active = operatorProfile({ adminRole: "super_admin" });
    const suspended = operatorProfile({
      adminRole: "super_admin",
      accountStatus: "suspended",
    });
    assert.equal(isSuperAdmin(active), true);
    assert.equal(isSuperAdmin(suspended), false);
    assert.equal(hasAllPermissions(active, ADMIN_PERMISSIONS), true);
  });

  it("prevents a lower role from managing a higher role", () => {
    const actorProfile = operatorProfile({
      uid: "operations-1",
      adminRole: "operations_manager",
      adminCapabilityAllow: ["operators:update"],
    });
    const actor = createAuthorizationContext(actorProfile);
    const target = operatorProfile({
      uid: "super-1",
      adminRole: "super_admin",
    });
    assert.equal(canManageOperator(actor, target), false);
  });

  it("provides the last SUPER_ADMIN protection predicate", () => {
    const target = operatorProfile({
      uid: "super-1",
      adminRole: "super_admin",
    });
    assert.equal(wouldRemoveLastSuperAdmin({
      target,
      activeSuperAdminCount: 1,
      deleting: true,
    }), true);

    const actor = createAuthorizationContext(operatorProfile({
      uid: "super-2",
      adminRole: "super_admin",
    }));
    assert.equal(canManageOperator(actor, target, {
      permission: "operators:disable",
      activeSuperAdminCount: 1,
      nextStatus: "disabled",
    }), false);
  });

  it("separates same-partner and different-partner resources", () => {
    const partnerContext = context({
      accountType: "partner",
      adminRole: undefined,
      permissions: [],
      scopes: ["PARTNER", "ASSIGNED"],
      partnerId: "partner-a",
    });
    assert.equal(canAccessResource(
      partnerContext,
      { partnerId: "partner-a" },
      "PARTNER",
    ), true);
    assert.equal(canAccessResource(
      partnerContext,
      { partnerId: "partner-b" },
      "PARTNER",
    ), false);
  });

  it("evaluates ALL, PARTNER, and ASSIGNED scopes", () => {
    assert.equal(canAccessResource(
      context({ scopes: ["ALL"] }),
      { partnerId: "any-partner" },
    ), true);

    const partnerContext = context({
      accountType: "partner",
      adminRole: undefined,
      scopes: ["PARTNER", "ASSIGNED"],
      partnerId: "partner-a",
    });
    assert.equal(canAccessResource(
      partnerContext,
      { partnerId: "partner-a" },
      "PARTNER",
    ), true);
    assert.equal(canAccessResource(
      partnerContext,
      { assignedPartnerId: "partner-a" },
      "ASSIGNED",
    ), true);
    assert.equal(canAccessResource(
      partnerContext,
      { assignedPartnerId: "partner-b" },
      "ASSIGNED",
    ), false);
  });

  it("checks partner management with both permission and scope", () => {
    const partnerManager = createAuthorizationContext(operatorProfile({
      adminRole: "partner_manager",
    }));
    assert.equal(
      canManagePartner(partnerManager, { id: "partner-a" }),
      true,
    );
    assert.equal(
      canManagePartner(
        context({ permissions: [], scopes: ["ALL"] }),
        { id: "partner-a" },
      ),
      false,
    );
  });

  it("redacts secrets from audit before/after snapshots", () => {
    const log = prepareAdminAuditLog({
      actorId: "admin-1",
      action: "operator.updated",
      targetType: "user",
      targetId: "admin-2",
      requestId: "request-1",
      before: {
        name: "기존 이름",
        password: "never-log-this",
        nested: { refreshToken: "never-log-this-either" },
      },
      after: { name: "새 이름" },
      createdAt: "2026-07-22T00:00:00.000Z",
    });
    assert.equal(log.actorUid, "admin-1");
    assert.equal(log.requestId, "request-1");
    assert.equal(log.before?.password, "[REDACTED]");
    assert.deepEqual(log.before?.nested, {
      refreshToken: "[REDACTED]",
    });
  });

  it("rejects unknown permission strings at compile time", () => {
    const knownPermission: AdminPermission = "admin:access";
    assert.equal(knownPermission, "admin:access");

    // @ts-expect-error Unknown permission strings must fail type checking.
    const unknownPermission: AdminPermission = "unknown:permission";
    assert.equal(typeof unknownPermission, "string");
  });
});

// Compile-time fixture compatibility for existing profile readers.
const legacyProfile: UserRecord = {
  ...operatorProfile(),
  accountStatus: undefined,
};
assert.equal(legacyProfile.status, "active");
