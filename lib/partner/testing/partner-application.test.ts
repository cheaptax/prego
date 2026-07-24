import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizePartnerApplicationPayload } from "@/lib/partner-applications";

function validApplication(overrides: Record<string, unknown> = {}) {
  return {
    organizationName: "프리고회계법인",
    displayName: "프리고회계법인",
    profession: "ACCOUNTANT",
    partnerType: "회계사",
    fields: ["세무·회계"],
    managerName: "김담당",
    contactEmail: "quote@example.com",
    contactPhone: "02-1234-5678",
    businessRegistrationNumber: "123-45-67890",
    businessAddress: "서울특별시 중구 세종대로 1",
    privacyConsent: true,
    ...overrides,
  };
}

describe("partner application supplier profile", () => {
  it("stores supplier defaults needed by generated quotes", () => {
    const result = normalizePartnerApplicationPayload(validApplication());
    assert.ok(result);
    assert.equal(result.businessRegistrationNumber, "123-45-67890");
    assert.equal(result.businessAddress, "서울특별시 중구 세종대로 1");
  });

  it("rejects missing or malformed business identity fields", () => {
    assert.equal(
      normalizePartnerApplicationPayload(
        validApplication({ businessRegistrationNumber: "" }),
      ),
      null,
    );
    assert.equal(
      normalizePartnerApplicationPayload(
        validApplication({ businessRegistrationNumber: "1234" }),
      ),
      null,
    );
    assert.equal(
      normalizePartnerApplicationPayload(
        validApplication({ businessAddress: "" }),
      ),
      null,
    );
  });
});
