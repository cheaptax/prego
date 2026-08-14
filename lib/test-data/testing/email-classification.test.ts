import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyCustomerEmail,
  classifyCustomerDataRecord,
  hasUnlimitedTestSignup,
  isAllowedCustomerEmail,
  resolveTransactionalRecipient,
  TEST_CUSTOMER_EMAILS,
} from "@/lib/test-data/email-classification";

describe("customer email data classification", () => {
  it("classifies only exact Nonghyup-domain addresses as production", () => {
    assert.equal(classifyCustomerEmail(" USER@NONGHYUP.COM "), "PRODUCTION");
    assert.equal(classifyCustomerEmail("user@sub.nonghyup.com"), "UNSUPPORTED");
    assert.equal(classifyCustomerEmail("user@nonghyup.com.example"), "UNSUPPORTED");
  });

  it("allows exactly the approved test addresses", () => {
    assert.equal(TEST_CUSTOMER_EMAILS.length, 6);
    for (const email of TEST_CUSTOMER_EMAILS) {
      assert.equal(classifyCustomerEmail(email), "TEST");
      assert.equal(isAllowedCustomerEmail(` ${email.toUpperCase()} `), true);
      const [local, domain] = email.split("@");
      const alias = `${local}+pwtest1@${domain}`;
      assert.equal(classifyCustomerEmail(alias), "TEST");
      assert.equal(isAllowedCustomerEmail(alias), true);
      assert.equal(
        hasUnlimitedTestSignup({ email: alias, phone: "01012345678" }),
        true,
      );
    }
    assert.equal(isAllowedCustomerEmail("someone@example.com"), false);
    assert.equal(isAllowedCustomerEmail("prego.ceo+pwtest1@gmail.com"), true);
    assert.equal(classifyCustomerEmail("prego.ceo+pwtest1@gmail.com"), "TEST");
    assert.equal(isAllowedCustomerEmail("cheaptax+signup2@naver.com"), true);
    assert.equal(isAllowedCustomerEmail("random+test@gmail.com"), false);
    assert.equal(isAllowedCustomerEmail("cheaptax+test@example.com"), false);
  });

  it("delivers Naver plus-aliases to the base inbox and keeps Gmail plus-aliases", () => {
    assert.equal(
      resolveTransactionalRecipient("cheaptax+pwtest1@naver.com"),
      "cheaptax@naver.com",
    );
    assert.equal(
      resolveTransactionalRecipient("bsmta+signup@naver.com"),
      "bsmta@naver.com",
    );
    assert.equal(
      resolveTransactionalRecipient("prego.ceo+pwtest1@gmail.com"),
      "prego.ceo+pwtest1@gmail.com",
    );
    assert.equal(
      resolveTransactionalRecipient("bsmta1277+signup@gmail.com"),
      "bsmta1277+signup@gmail.com",
    );
    assert.equal(
      resolveTransactionalRecipient("cheaptax@naver.com"),
      "cheaptax@naver.com",
    );
    assert.equal(
      resolveTransactionalRecipient("user+tag@nonghyup.com"),
      "user+tag@nonghyup.com",
    );
  });

  it("exempts an approved test email or phone from signup count limits", () => {
    assert.equal(
      hasUnlimitedTestSignup({
        email: TEST_CUSTOMER_EMAILS[0],
        phone: "01012345678",
      }),
      true,
    );
    assert.equal(
      hasUnlimitedTestSignup({
        email: "real@nonghyup.com",
        phone: "010-6387-7780",
      }),
      true,
    );
    assert.equal(
      hasUnlimitedTestSignup({
        email: "real@nonghyup.com",
        phone: "01012345678",
      }),
      false,
    );
  });

  it("classifies reassigned prelaunch accounts by stored test metadata", () => {
    assert.equal(
      classifyCustomerDataRecord({
        email: "legacy-dummy@example.com",
        dataClassification: "DEMO",
        cooperativeId: "demo-prego",
      }),
      "TEST",
    );
    assert.equal(
      classifyCustomerDataRecord({
        email: "real@nonghyup.com",
        dataClassification: "PRODUCTION",
        cooperativeId: "coop-001",
      }),
      "PRODUCTION",
    );
  });
});
