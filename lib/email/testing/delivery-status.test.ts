import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  customerEmailStatusLabel,
  toCustomerEmailDeliveryView,
} from "@/lib/email/delivery-status";
import type { QuoteEmailDeliveryRecord } from "@/lib/firebase/schema";

describe("customer email delivery status", () => {
  it("labels Resend webhook statuses in Korean", () => {
    assert.equal(customerEmailStatusLabel("sent"), "발송됨");
    assert.equal(customerEmailStatusLabel("delivered"), "수신 확인");
    assert.equal(customerEmailStatusLabel("bounced"), "반송");
    assert.equal(customerEmailStatusLabel("failed"), "실패");
  });

  it("distinguishes quote-request confirmation from quote delivery", () => {
    const requestView = toCustomerEmailDeliveryView({
      id: "aqreq_r1",
      quoteId: "aqreq_r1",
      quoteRequestId: "audit_quote_r1",
      auditQuoteRequestId: "r1",
      purpose: "audit_quote_request",
      accountEmail: "cheaptax+pwtest1@naver.com",
      recipientEmail: "cheaptax@naver.com",
      status: "delivered",
      provider: "resend",
      attemptCount: 2,
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:01:00.000Z",
      sentAt: "2026-08-14T00:00:30.000Z",
    } satisfies QuoteEmailDeliveryRecord);
    assert.equal(requestView.purposeLabel, "견적 요청 완료 안내");
    assert.equal(requestView.statusLabel, "수신 확인");
    assert.equal(requestView.accountEmail, "cheaptax+pwtest1@naver.com");
    assert.equal(requestView.recipientEmail, "cheaptax@naver.com");

    const quoteView = toCustomerEmailDeliveryView({
      id: "q1_customer",
      quoteId: "q1",
      quoteRequestId: "audit_quote_r1",
      purpose: "quote",
      recipientEmail: "prego.ceo+pwtest1@gmail.com",
      status: "sent",
      provider: "resend",
      attemptCount: 1,
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    } satisfies QuoteEmailDeliveryRecord);
    assert.equal(quoteView.purposeLabel, "견적서 발송 안내");
    assert.equal(quoteView.statusLabel, "발송됨");
  });
});
