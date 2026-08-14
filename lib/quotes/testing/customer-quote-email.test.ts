import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  auditQuoteEmailYearShort,
  composeCustomerQuoteEmailBodies,
  resolveCustomerQuoteEmailTemplates,
} from "@/lib/quotes/customer-quote-email";

describe("customer quote email versioning", () => {
  it("uses the accounting-firm audit quote subject without a version suffix", () => {
    const email = resolveCustomerQuoteEmailTemplates({
      version: 1,
      partnerName: "프리고테회계법인",
      fiscalYear: 2027,
      sourceType: "audit_quote",
    });
    assert.equal(email.versionLabel, "v1");
    assert.equal(email.isRevision, false);
    assert.equal(
      email.subject,
      "프리고테회계법인의 농협 27년도 외부회계감사 견적서가 도착했습니다.",
    );
    assert.doesNotMatch(email.subject, /농협지원센터|수정되어|\(v1\)/);
    assert.match(email.arrivalText, /도착했습니다/);
  });

  it("keeps the same audit quote subject when a revised quote is sent", () => {
    const email = resolveCustomerQuoteEmailTemplates({
      version: 4,
      partnerName: "세연테회계법인",
      fiscalYear: 2027,
      sourceType: "audit_quote",
    });
    assert.equal(email.versionLabel, "v4");
    assert.equal(email.isRevision, true);
    assert.equal(
      email.subject,
      "세연테회계법인의 농협 27년도 외부회계감사 견적서가 도착했습니다.",
    );
    assert.match(email.arrivalText, /v4으로 수정되어/);
    assert.match(email.arrivalText, /이전 견적서를 대체/);
  });

  it("turns a four-digit fiscal year into a two-digit 년도 label", () => {
    assert.equal(auditQuoteEmailYearShort(2027), "27");
    assert.equal(auditQuoteEmailYearShort(27), "27");
    assert.equal(auditQuoteEmailYearShort(null), "27");
  });

  it("appends the temporary member login notice under the quote arrival mail", () => {
    const email = composeCustomerQuoteEmailBodies({
      arrivalText:
        "안녕하십니까. 농협지원센터에서 테스트회계법인 견적서가 도착했습니다. 확인 부탁드립니다.",
      quoteUrl: "https://nh.prego.im/mypage/quotes/q1",
      loginUrl: "https://nh.prego.im/login",
      accountEmail: "prego.ceo+pwtest1@gmail.com",
      initialPassword: "nh77807780",
      downloadLinkLabel: "로그인 후 견적서 다운로드",
      downloadTextLabel: "다운로드",
    });
    assert.match(email.text, /견적서가 도착했습니다/);
    assert.match(email.text, /농협지원센터 임시회원 계정이 준비되었습니다/);
    assert.match(email.text, /아이디: prego\.ceo\+pwtest1@gmail\.com/);
    assert.match(email.text, /초기 비밀번호: nh77807780/);
    assert.match(email.html, /https:\/\/nh\.prego\.im\/login/);
  });
});
