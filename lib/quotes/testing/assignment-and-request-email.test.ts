import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCustomerAuditQuoteRequestEmail } from "@/lib/audit-quote/customer-request-email";
import { buildPartnerAssignmentEmail } from "@/lib/quotes/partner-assignment-email";

describe("partner assignment email", () => {
  it("includes portal link and request summary", () => {
    const email = buildPartnerAssignmentEmail({
      partnerName: "테스트회계법인",
      subject: "감사 견적 요청 AQ-1",
      publicReference: "AQ-20260812-5AC0",
      cooperativeName: "테스트농협",
      fiscalYear: 2027,
      customerName: "홍길동",
      portalUrl: "https://nh.prego.im/partner",
    });
    assert.match(email.subject, /새로운 견적 요청이 배정/);
    assert.match(email.text, /AQ-20260812-5AC0/);
    assert.match(email.text, /테스트농협/);
    assert.match(email.html, /https:\/\/nh\.prego\.im\/partner/);
  });
});

describe("customer audit quote request email", () => {
  it("confirms intake with public reference", () => {
    const email = buildCustomerAuditQuoteRequestEmail({
      publicReference: "AQ-20260812-5AC0",
      contactName: "홍길동",
      targetCooperativeName: "테스트농협",
      fiscalYear: 2027,
      mypageUrl: "https://nh.prego.im/mypage",
      loginUrl: "https://nh.prego.im/login",
      eventUrl: "https://nh.prego.im/events/audit-quote",
      accountEmail: "hong@nonghyup.com",
    });
    assert.match(email.subject, /견적 요청이 접수/);
    assert.match(email.text, /AQ-20260812-5AC0/);
    assert.match(email.html, /홍길동님/);
    assert.match(email.html, /마이페이지에서 확인하기/);
    assert.match(email.text, /농협지원센터 임시회원 계정이 준비되었습니다/);
    assert.doesNotMatch(email.text, /초기 비밀번호:/u);
  });

  it("includes temporary account login details when an initial password is issued", () => {
    const email = buildCustomerAuditQuoteRequestEmail({
      publicReference: "AQ-20260812-5AC0",
      contactName: "홍길동",
      targetCooperativeName: "테스트농협",
      fiscalYear: 2027,
      mypageUrl: "https://nh.prego.im/mypage",
      loginUrl: "https://nh.prego.im/login",
      eventUrl: "https://nh.prego.im/events/audit-quote",
      accountEmail: "hong@nonghyup.com",
      initialPassword: "nh56785678",
    });

    assert.match(email.text, /로그인 주소: https:\/\/nh\.prego\.im\/login/u);
    assert.match(email.text, /아이디: hong@nonghyup\.com/u);
    assert.match(email.text, /초기 비밀번호: nh56785678/u);
    assert.match(email.text, /가격비교/u);
    assert.match(email.html, /nh56785678/u);
    assert.match(
      email.text,
      /초기 비밀번호는 nh \+ 담당자 휴대폰 번호 뒷자리 4자리 두 번 반복입니다/u,
    );
  });

  it("keeps the plus-alias as the login id even when the inbox is a base address", () => {
    const email = buildCustomerAuditQuoteRequestEmail({
      publicReference: "AQ-20260813-8B2A",
      contactName: "김재경",
      targetCooperativeName: "재경농협",
      fiscalYear: 2027,
      mypageUrl: "https://nh.prego.im/mypage",
      loginUrl: "https://nh.prego.im/login",
      eventUrl: "https://nh.prego.im/events/audit-quote",
      accountEmail: "cheaptax+pwtest1@naver.com",
      initialPassword: "nh77807780",
    });
    assert.match(email.text, /아이디: cheaptax\+pwtest1@naver\.com/u);
    assert.match(email.html, /cheaptax\+pwtest1@naver\.com/u);
    assert.match(email.text, /초기 비밀번호: nh77807780/u);
  });
});
