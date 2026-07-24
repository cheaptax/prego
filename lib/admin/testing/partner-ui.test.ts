import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isDangerousPartnerStatusChange,
  partnerServerErrorCopyKey,
  validatePartnerAccountForm,
  validatePartnerForm,
} from "@/lib/admin/partner-ui";

describe("partner management UI policy", () => {
  it("validates required fields, contact values, scopes, and point range", () => {
    assert.deepEqual(
      validatePartnerForm({
        name: "",
        displayName: "",
        partnerType: "",
        fields: [],
        managerName: "",
        contactEmail: "invalid",
        contactPhone: "abc",
        businessRegistrationNumber: "",
        businessAddress: "",
        status: "pending",
        pointMin: 100_001,
        pointMax: 30_000,
        memo: "",
      }),
      {
        name: "required",
        partnerType: "required",
        fields: "required",
        managerName: "required",
        contactEmail: "invalid",
        contactPhone: "invalid",
        businessRegistrationNumber: "required",
        businessAddress: "required",
        pointRange: "invalid",
      },
    );
  });

  it("accepts the STEP 6 partner schema without excluded contract fields", () => {
    assert.deepEqual(
      validatePartnerForm({
        name: "세무 제휴사",
        displayName: "세무 전문가",
        partnerType: "전문가",
        fields: ["세무·회계"],
        managerName: "담당자",
        contactEmail: "manager@example.com",
        contactPhone: "02-1234-5678",
        businessRegistrationNumber: "123-45-67890",
        businessAddress: "서울특별시 중구 세종대로 1",
        status: "active",
        pointMin: 30_000,
        pointMax: 100_000,
        memo: "",
      }),
      {},
    );
  });

  it("requires a strong initial password when creating a login account", () => {
    assert.deepEqual(
      validatePartnerForm({
        name: "세무 제휴사",
        displayName: "세무 전문가",
        partnerType: "전문가",
        fields: ["세무·회계"],
        managerName: "담당자",
        contactEmail: "manager@example.com",
        contactPhone: "02-1234-5678",
        businessRegistrationNumber: "123-45-67890",
        businessAddress: "서울특별시 중구 세종대로 1",
        status: "active",
        pointMin: 30_000,
        pointMax: 100_000,
        memo: "",
        createLoginAccount: true,
        loginPassword: "short1",
      }),
      { loginPassword: "invalid" },
    );
    assert.deepEqual(
      validatePartnerForm({
        name: "세무 제휴사",
        displayName: "세무 전문가",
        partnerType: "세무사",
        profession: "TAX_ACCOUNTANT",
        fields: ["세무·회계"],
        managerName: "담당자",
        contactEmail: "manager@example.com",
        contactPhone: "02-1234-5678",
        businessRegistrationNumber: "123-45-67890",
        businessAddress: "서울특별시 중구 세종대로 1",
        status: "active",
        pointMin: 30_000,
        pointMax: 100_000,
        memo: "",
        createLoginAccount: true,
        loginPassword: "pass1234",
      }),
      {},
    );
  });

  it("requires confirmation only for access-blocking status changes", () => {
    assert.equal(isDangerousPartnerStatusChange("active", "paused"), true);
    assert.equal(isDangerousPartnerStatusChange("active", "terminated"), true);
    assert.equal(isDangerousPartnerStatusChange("paused", "terminated"), true);
    assert.equal(isDangerousPartnerStatusChange("pending", "active"), false);
    assert.equal(isDangerousPartnerStatusChange("paused", "active"), false);
  });

  it("maps duplicate and authorization API errors to safe copy keys", () => {
    assert.equal(
      partnerServerErrorCopyKey("duplicate_partner_name"),
      "duplicateNameError",
    );
    assert.equal(
      partnerServerErrorCopyKey("duplicate_partner_email"),
      "duplicateEmailError",
    );
    assert.equal(
      partnerServerErrorCopyKey("permission_denied"),
      "permissionDeniedError",
    );
    assert.equal(
      partnerServerErrorCopyKey("partner_request_failed"),
      "partnerRequestFailed",
    );
  });

  it("validates partner account creation without storing password data", () => {
    assert.deepEqual(
      validatePartnerAccountForm({
        mode: "create",
        name: "",
        email: "invalid",
        password: "short",
        phone: "invalid",
        accountStatus: "invited",
      }),
      {
        name: "required",
        email: "invalid",
        password: "invalid",
        phone: "invalid",
      },
    );
    assert.deepEqual(
      validatePartnerAccountForm({
        mode: "create",
        name: "운영자",
        email: "operator@example.com",
        password: "temporary-password-1",
        phone: "010-1234-5678",
        accountStatus: "invited",
      }),
      {},
    );
  });
});
