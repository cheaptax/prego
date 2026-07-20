import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canTransitionAuditQuoteStatus,
  allowedNextStatuses,
} from "@/lib/audit-quote/status";
import { buildAuditQuoteNotifyPayload } from "@/lib/audit-quote/notify";

describe("audit-quote status transitions", () => {
  it("allows only defined transitions", () => {
    assert.equal(canTransitionAuditQuoteStatus("received", "contacting"), true);
    assert.equal(canTransitionAuditQuoteStatus("received", "delivered"), false);
    assert.equal(canTransitionAuditQuoteStatus("closed", "received"), false);
    assert.deepEqual(allowedNextStatuses("report_delivered"), ["closed"]);
  });
});

describe("audit-quote notify payload", () => {
  it("keeps email out of the title", () => {
    const payload = buildAuditQuoteNotifyPayload({
      requestId: "req1",
      publicReference: "AQ-20260720-ABCD",
      email: "secret@example.com",
      campaign: "fy27-audit-quote",
    });
    assert.match(payload.title, /신규 회계감사 견적 요청/);
    assert.match(payload.title, /AQ-20260720-ABCD/);
    assert.equal(payload.title.includes("secret@example.com"), false);
    assert.equal(payload.text.includes("secret@example.com"), false);
    assert.match(payload.text, /s\*\*\*@example\.com/);
  });
});
