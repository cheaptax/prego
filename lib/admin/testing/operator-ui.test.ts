import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dangerousOperatorChanges,
  getAssignableAdminRoles,
  getRolePermissionPreview,
  operatorProtection,
  operatorServerErrorCopyKey,
  permissionCopyKeys,
  validateOperatorForm,
} from "@/lib/admin/operator-ui";
import type { UserRecord } from "@/lib/firebase/schema";

function operator(input: Partial<UserRecord> = {}): UserRecord {
  return {
    uid: "operator-1",
    name: "운영 담당자",
    phone: "",
    email: "operator@example.com",
    position: "팀장",
    duty: "운영관리자",
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

describe("operator management UI policy", () => {
  it("validates required fields, email format, and password policy", () => {
    assert.deepEqual(
      validateOperatorForm({
        mode: "create",
        name: "",
        email: "invalid",
        password: "short",
        adminRole: "operations_manager",
      }),
      {
        name: "required",
        email: "invalid",
        password: "required_policy",
      },
    );
    assert.deepEqual(
      validateOperatorForm({
        mode: "create",
        name: "운영자",
        email: "operator@example.com",
        password: "temporary-password",
        adminRole: "operations_manager",
      }),
      {},
    );
  });

  it("limits assignable roles and previews role permissions", () => {
    assert.deepEqual(getAssignableAdminRoles("read_only"), []);
    assert.deepEqual(getAssignableAdminRoles("operations_manager"), [
      "partner_manager",
      "cms_editor",
      "read_only",
    ]);
    assert.ok(
      getRolePermissionPreview("operations_manager").includes("members:write"),
    );
    assert.deepEqual(permissionCopyKeys("operators:manageRoles"), {
      resource: "permissionResource.operators",
      action: "permissionAction.manageRoles",
    });
  });

  it("identifies protected and dangerous operator changes", () => {
    const superAdmin = operator({
      uid: "super-1",
      adminRole: "super_admin",
    });
    assert.deepEqual(
      operatorProtection({
        operator: superAdmin,
        actorUid: "super-1",
        actorRole: "super_admin",
        activeSuperAdminCount: 1,
      }),
      {
        self: true,
        lastSuperAdmin: true,
        actorCanReachTarget: true,
        blocksSensitiveChange: true,
      },
    );
    assert.deepEqual(
      dangerousOperatorChanges(superAdmin, {
        adminRole: "read_only",
        status: "rejected",
      }),
      {
        superAdminRoleChange: true,
        roleDemotion: true,
        deactivation: true,
      },
    );
  });

  it("maps duplicate and server authorization errors to safe copy keys", () => {
    assert.equal(
      operatorServerErrorCopyKey("email_already_exists"),
      "operatorDuplicateEmail",
    );
    assert.equal(
      operatorServerErrorCopyKey("operator_management_denied"),
      "operatorPermissionDeniedError",
    );
    assert.equal(
      operatorServerErrorCopyKey("unexpected"),
      "operatorSaveFailed",
    );
  });
});
