import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ADMIN_ROLE_PRESETS,
  hasAdminCapability,
  resolveAdminCapabilities,
} from "@/lib/admin/rbac";
import type { UserRecord } from "@/lib/firebase/schema";
import { CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";
import { ADMIN_OPERATION_TAB_IDS } from "@/lib/cms/admin-operations-content";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function adminProfile(input: Partial<UserRecord> = {}): UserRecord {
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
    status: "active",
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    ...input,
  };
}

describe("admin RBAC and partner management contract", () => {
  it("keeps missing admin roles least-privileged while enforcing deny overrides", () => {
    const legacy = adminProfile();
    assert.deepEqual(
      resolveAdminCapabilities(legacy),
      [...ADMIN_ROLE_PRESETS.read_only].sort(),
    );

    const scoped = adminProfile({
      adminRole: "partner_manager",
      adminCapabilityDeny: ["inquiries:write"],
    });
    assert.equal(hasAdminCapability(scoped, "partners:write"), true);
    assert.equal(hasAdminCapability(scoped, "inquiries:write"), false);
    assert.equal(hasAdminCapability(scoped, "operators:write"), false);
  });

  it("registers partner management in the admin operations CMS surface", () => {
    assert.ok(ADMIN_OPERATION_TAB_IDS.includes("partners"));
    const adminOperations = CMS_PAGE_DEFAULTS["admin.operations"];
    assert.ok(
      adminOperations.sections.some((section) => section.id === "partners"),
    );
    const navigation = adminOperations.sections.find(
      (section) => section.id === "navigation",
    );
    assert.ok(navigation?.items.some((item) => item.id === "partners"));
  });

  it("keeps partner ACL and answer approval on server-only APIs", () => {
    const server = readFileSync(
      path.join(root, "lib/firebase/server.ts"),
      "utf8",
    );
    const rules = readFileSync(path.join(root, "firestore.rules"), "utf8");
    const partnerDraftApi = readFileSync(
      path.join(root, "app/api/partner/assignments/[assignmentId]/draft/route.ts"),
      "utf8",
    );
    const adminDraftApi = readFileSync(
      path.join(root, "app/api/admin/partner-drafts/[draftId]/route.ts"),
      "utf8",
    );

    assert.match(server, /requirePartner/);
    assert.match(server, /canPartnerReadAssignment/);
    assert.match(rules, /match \/partnerAssignments/);
    assert.match(rules, /resource\.data\.partnerId == partnerId\(\)/);
    assert.match(partnerDraftApi, /requirePartner/);
    assert.match(partnerDraftApi, /partnerId/);
    assert.match(adminDraftApi, /requireAdminCapability\(req, "inquiries:write"\)/);
    assert.match(adminDraftApi, /status: "ANSWER_READY"/);
  });

  it("blocks inactive partners, submitted draft rewrites, and direct attachment reads", () => {
    const server = readFileSync(
      path.join(root, "lib/firebase/server.ts"),
      "utf8",
    );
    const firestoreRules = readFileSync(
      path.join(root, "firestore.rules"),
      "utf8",
    );
    const storageRules = readFileSync(
      path.join(root, "storage.rules"),
      "utf8",
    );
    const partnerDraftApi = readFileSync(
      path.join(root, "app/api/partner/assignments/[assignmentId]/draft/route.ts"),
      "utf8",
    );

    assert.match(server, /partner\.status !== "active"/);
    assert.match(
      firestoreRules,
      /\.data\.status == 'active'/,
    );
    assert.match(partnerDraftApi, /existing\?\.status === "submitted"/);
    assert.doesNotMatch(
      storageRules,
      /allow read: if isAdmin\(\) \|\| isPartner\(\)/,
    );
  });

  it("uses action permissions and operator hierarchy guards in mutation APIs", () => {
    const createRoute = readFileSync(
      path.join(root, "app/api/admin/operators/route.ts"),
      "utf8",
    );
    const operatorRoute = readFileSync(
      path.join(root, "app/api/admin/operators/[uid]/route.ts"),
      "utf8",
    );

    assert.match(createRoute, /requirePermission\(req, "operators:create"\)/);
    assert.match(operatorRoute, /"operators:manageRoles"/);
    assert.match(operatorRoute, /"operators:disable"/);
    assert.match(operatorRoute, /"operators:resetPassword"/);
    assert.match(operatorRoute, /requirePermission\(req, "operators:delete"\)/);
    assert.match(operatorRoute, /canManageOperator/);
  });
});
