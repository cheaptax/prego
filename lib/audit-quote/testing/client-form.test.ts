import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IdempotencyKeySession,
  formatPhoneInput,
  mapAuditQuoteApiError,
  validateAuditQuoteEmail,
  validateAuditQuoteFiscalYear,
  validateAuditQuoteName,
  validateAuditQuotePhone,
  validateAuditQuoteTargetCooperative,
  findExactCooperativeMatch,
} from "@/lib/audit-quote/client-form";
import { getPublicAuditQuoteConfig } from "@/lib/audit-quote/public-config";

describe("audit-quote client form helpers", () => {
  it("checks email syntax client-side and maps API errors", () => {
    assert.equal(validateAuditQuoteEmail("  Kim.NH@nonghyup.com ").ok, true);
    assert.equal(validateAuditQuoteEmail("a@b.co").ok, true);
    assert.equal(validateAuditQuoteEmail("bad").ok, false);
    assert.equal(
      mapAuditQuoteApiError("consent_required").includes("@"),
      false
    );
    assert.match(mapAuditQuoteApiError("consent_required"), /개인정보/);
    assert.match(mapAuditQuoteApiError("invalid_phone"), /휴대폰/);
    assert.match(mapAuditQuoteApiError("missing_phone_verification"), /문자 인증/);
    assert.match(mapAuditQuoteApiError("phone_quote_limit_exceeded"), /5번/);
  });

  it("validates contact name and mobile phone", () => {
    assert.equal(validateAuditQuoteName("  김농협 ").ok, true);
    assert.equal(validateAuditQuoteName("").ok, false);

    const phone = validateAuditQuotePhone("01012345678");
    assert.equal(phone.ok, true);
    if (phone.ok) assert.equal(phone.phone, "010-1234-5678");
    assert.equal(validateAuditQuotePhone("011-123-4567").ok, false);
    assert.equal(validateAuditQuotePhone("02-123-4567").ok, false);

    assert.equal(formatPhoneInput("0101234"), "010-1234");
    assert.equal(formatPhoneInput("01012345678"), "010-1234-5678");
  });

  it("validates the target cooperative and fiscal year", () => {
    const cooperative =
      validateAuditQuoteTargetCooperative("  프리고 농협  ");
    assert.equal(cooperative.ok, true);
    if (cooperative.ok) {
      assert.equal(cooperative.targetCooperativeName, "프리고 농협");
    }
    assert.equal(validateAuditQuoteTargetCooperative("").ok, false);
    assert.equal(validateAuditQuoteFiscalYear("2027").ok, true);
    assert.equal(validateAuditQuoteFiscalYear("2026").ok, false);
    assert.equal(validateAuditQuoteFiscalYear("20e6").ok, false);
    assert.equal(validateAuditQuoteFiscalYear("1999").ok, false);
  });

  it("auto-selects a cooperative when the typed name matches exactly", () => {
    const results = [
      { cooperative_name: "북부산농협", cooperative_id: "bukbusan" },
      { cooperative_name: "부산농협", cooperative_id: "busan" },
    ];
    assert.equal(
      findExactCooperativeMatch("북부산농협", results)?.cooperative_id,
      "bukbusan",
    );
    assert.equal(
      findExactCooperativeMatch("북부산 농협", results)?.cooperative_id,
      "bukbusan",
    );
    assert.equal(findExactCooperativeMatch("북부산", results), null);
    assert.equal(
      findExactCooperativeMatch("북부산농협", [
        { cooperative_name: "북부산농협", cooperative_id: "a" },
        { cooperative_name: "북부산농협", cooperative_id: "b" },
      ]),
      null,
    );
  });

  it("reuses idempotency key until success clear", () => {
    const session = new IdempotencyKeySession();
    const first = session.getForAttempt();
    const second = session.getForAttempt();
    assert.equal(first, second);
    session.clearAfterSuccess();
    const third = session.getForAttempt();
    assert.notEqual(first, third);
  });

  it("hides points benefit unless label and flag are both set", () => {
    const hidden = getPublicAuditQuoteConfig({
      AUDIT_QUOTE_SHOW_POINTS_BENEFIT: "true",
      AUDIT_QUOTE_POINTS_BASE_LABEL: "",
      AUDIT_QUOTE_EVENT_ENABLED: "true",
    });
    assert.equal(hidden.showPointsBenefit, false);

    const shown = getPublicAuditQuoteConfig({
      AUDIT_QUOTE_SHOW_POINTS_BENEFIT: "true",
      AUDIT_QUOTE_POINTS_BASE_LABEL: "계약 감사보수",
      AUDIT_QUOTE_EVENT_ENABLED: "true",
    });
    assert.equal(shown.showPointsBenefit, true);
    assert.equal(shown.pointsBenefitBaseLabel, "계약 감사보수");
  });

  it("disables event when endsAt is in the past", () => {
    const closed = getPublicAuditQuoteConfig({
      AUDIT_QUOTE_EVENT_ENABLED: "true",
      AUDIT_QUOTE_ENDS_AT: "2020-01-01T00:00:00.000Z",
    });
    assert.equal(closed.enabled, false);
  });
});
