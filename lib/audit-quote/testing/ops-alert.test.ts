import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUDIT_QUOTE_OPS_ALERT_MESSAGE,
  buildOpsAuditQuoteAlertEmail,
  getAuditQuoteOpsAlertEmail,
  getAuditQuoteOpsAlertPhone,
} from "@/lib/audit-quote/ops-alert";
import { maskPhoneForLog } from "@/lib/sms/transactional";

describe("audit quote ops alerts", () => {
  it("uses the fixed operator alert copy", () => {
    assert.equal(
      AUDIT_QUOTE_OPS_ALERT_MESSAGE,
      "농협에서 견적 요청이 도착했습니다.",
    );
    const email = buildOpsAuditQuoteAlertEmail();
    assert.equal(email.subject, AUDIT_QUOTE_OPS_ALERT_MESSAGE);
    assert.equal(email.text, AUDIT_QUOTE_OPS_ALERT_MESSAGE);
    assert.match(email.html, /농협에서 견적 요청이 도착했습니다/);
  });

  it("defaults to the approved ops email and phone", () => {
    const previousEmail = process.env.AUDIT_QUOTE_OPS_ALERT_EMAIL;
    const previousPhone = process.env.AUDIT_QUOTE_OPS_ALERT_PHONE;
    delete process.env.AUDIT_QUOTE_OPS_ALERT_EMAIL;
    delete process.env.AUDIT_QUOTE_OPS_ALERT_PHONE;
    try {
      assert.equal(getAuditQuoteOpsAlertEmail(), "prego.ceo@gmail.com");
      assert.equal(getAuditQuoteOpsAlertPhone(), "01063877780");
      assert.equal(maskPhoneForLog("010-6387-7780"), "010****7780");
    } finally {
      if (previousEmail === undefined) {
        delete process.env.AUDIT_QUOTE_OPS_ALERT_EMAIL;
      } else {
        process.env.AUDIT_QUOTE_OPS_ALERT_EMAIL = previousEmail;
      }
      if (previousPhone === undefined) {
        delete process.env.AUDIT_QUOTE_OPS_ALERT_PHONE;
      } else {
        process.env.AUDIT_QUOTE_OPS_ALERT_PHONE = previousPhone;
      }
    }
  });
});
