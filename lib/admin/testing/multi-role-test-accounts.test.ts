import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMultiRoleOperatorProfile,
  buildMultiRolePartnerAttachment,
  canPromoteEmailToMultiRoleOperator,
} from "@/lib/admin/multi-role-operator";
import {
  canAccessPortal,
  getPortalMismatchResult,
  getPostLoginPath,
} from "@/lib/auth/portal";
import {
  AccountContextResolutionError,
  resolveAccountContextFromRecords,
} from "@/lib/auth/account-context";
import type { PartnerRecord, UserRecord } from "@/lib/firebase/schema";
import {
  isMultiRoleTestEmail,
  MULTI_ROLE_TEST_EMAILS,
} from "@/lib/test-data/multi-role-test-accounts";

function profile(input: Partial<UserRecord> = {}): UserRecord {
  return {
    uid: "user-1",
    name: "김지혜",
    phone: "01063877780",
    email: "prego.ceo@gmail.com",
    position: "테스트",
    duty: "멀티롤",
    consents: {
      terms: true,
      privacy: true,
      marketing: false,
      email: false,
      sms: false,
      kakao: false,
    },
    role: "member",
    status: "temporary_quote_member",
    cooperativeId: "demo-prego-nh",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...input,
  };
}

function partner(input: Partial<PartnerRecord> = {}): PartnerRecord {
  return {
    id: "partner-1",
    name: "테스트회계법인",
    displayName: "테스트회계법인",
    partnerType: "회계",
    fields: ["감사"],
    managerName: "담당",
    contactEmail: "prego.ceo@gmail.com",
    contactPhone: "",
    status: "active",
    pointMin: 0,
    pointMax: 0,
    createdBy: "admin",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedBy: "admin",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...input,
  };
}

describe("multi-role test accounts", () => {
  it("allowlists only the approved shared-login emails", () => {
    assert.deepEqual([...MULTI_ROLE_TEST_EMAILS], ["prego.ceo@gmail.com"]);
    assert.equal(isMultiRoleTestEmail("PREGO.CEO@gmail.com"), true);
    assert.equal(canPromoteEmailToMultiRoleOperator("prego.ceo@gmail.com"), true);
    assert.equal(isMultiRoleTestEmail("cheaptaxworld@gmail.com"), false);
    assert.equal(canPromoteEmailToMultiRoleOperator("admin@gmail.com"), false);
  });

  it("promotes an existing customer profile into a multi-role super admin", () => {
    const next = buildMultiRoleOperatorProfile({
      authUser: {
        uid: "user-1",
        customClaims: {},
      } as never,
      existingProfile: profile(),
      name: "김지혜",
      email: "prego.ceo@gmail.com",
      position: "운영자",
      duty: "관리자",
      status: "active",
      adminRole: "super_admin",
      adminCapabilityAllow: [],
      adminCapabilityDeny: [],
      now: "2026-08-13T00:00:00.000Z",
    });
    assert.equal(next.role, "admin");
    assert.equal(next.adminRole, "super_admin");
    assert.equal(next.multiRoleTestAccount, true);
    assert.deepEqual(next.enabledPortals?.sort(), ["admin", "customer"]);
    assert.equal(next.cooperativeId, "demo-prego-nh");
  });

  it("attaches partner access without dropping admin portals", () => {
    const adminProfile = buildMultiRoleOperatorProfile({
      authUser: { uid: "user-1", customClaims: {} } as never,
      existingProfile: profile(),
      name: "김지혜",
      email: "prego.ceo@gmail.com",
      position: "운영자",
      duty: "관리자",
      status: "active",
      adminRole: "super_admin",
      adminCapabilityAllow: [],
      adminCapabilityDeny: [],
      now: "2026-08-13T00:00:00.000Z",
    });
    const attached = buildMultiRolePartnerAttachment({
      authUser: { uid: "user-1", customClaims: { admin: true } } as never,
      existingProfile: adminProfile,
      partnerId: "partner-1",
      partnerDisplayName: "테스트회계법인",
      name: "김지혜",
      phone: "01063877780",
      position: "제휴 전문가",
      duty: "테스트회계법인",
      accountStatus: "active",
      status: "active",
      now: "2026-08-13T00:00:00.000Z",
    });
    assert.equal(attached.role, "admin");
    assert.equal(attached.partnerId, "partner-1");
    assert.deepEqual(attached.enabledPortals?.sort(), [
      "admin",
      "customer",
      "partner",
    ]);
  });

  it("lets a multi-role super admin enter customer, partner, and admin portals", () => {
    const account = resolveAccountContextFromRecords({
      identity: {
        uid: "user-1",
        email: "prego.ceo@gmail.com",
        admin: true,
        partner: true,
        partnerId: "partner-1",
        multiRole: true,
      },
      profiles: [
        profile({
          role: "admin",
          adminRole: "super_admin",
          accountStatus: "active",
          status: "active",
          multiRoleTestAccount: true,
          enabledPortals: ["admin", "customer", "partner"],
          partnerId: "partner-1",
        }),
      ],
      partner: partner(),
    });
    assert.equal(account.multiRoleTestAccount, true);
    assert.equal(canAccessPortal(account, "admin"), true);
    assert.equal(canAccessPortal(account, "customer"), true);
    assert.equal(canAccessPortal(account, "partner"), true);
    assert.equal(getPostLoginPath(account, "customer"), "/mypage");
    assert.equal(getPostLoginPath(account, "partner"), "/partner");
    assert.equal(getPostLoginPath(account, "admin"), "/admin");
    assert.equal(
      getPortalMismatchResult(account, "customer").reason,
      "allowed",
    );
  });

  it("still rejects admin+partner claims for ordinary accounts", () => {
    assert.throws(
      () =>
        resolveAccountContextFromRecords({
          identity: {
            uid: "user-1",
            email: "ops@example.com",
            admin: true,
            partner: true,
          },
          profiles: [
            profile({
              email: "ops@example.com",
              role: "admin",
              adminRole: "super_admin",
              accountStatus: "active",
              status: "active",
            }),
          ],
        }),
      (error: unknown) =>
        error instanceof AccountContextResolutionError &&
        error.code === "account_configuration_error",
    );
  });
});
