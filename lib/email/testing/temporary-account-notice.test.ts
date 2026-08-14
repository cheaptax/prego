import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTemporaryMemberAccountNotice,
  resolveTemporaryAccountPassword,
} from "@/lib/email/temporary-account-notice";

describe("temporary member account email notice", () => {
  it("builds the original login notice with the deterministic password", () => {
    const notice = buildTemporaryMemberAccountNotice({
      loginUrl: "https://nh.prego.im/login",
      accountEmail: "prego.ceo+pwtest1@gmail.com",
      initialPassword: "nh77807780",
    });
    assert.match(notice.textLines.join("\n"), /농협지원센터 임시회원 계정이 준비되었습니다/);
    assert.match(notice.textLines.join("\n"), /로그인 주소: https:\/\/nh\.prego\.im\/login/);
    assert.match(notice.textLines.join("\n"), /아이디: prego\.ceo\+pwtest1@gmail\.com/);
    assert.match(notice.textLines.join("\n"), /초기 비밀번호: nh77807780/);
    assert.match(
      notice.textLines.join("\n"),
      /초기 비밀번호는 nh \+ 담당자 휴대폰 번호 뒷자리 4자리 두 번 반복입니다/,
    );
    assert.match(notice.html, /nh77807780/);
  });

  it("derives the password from the contact phone when one was not issued", () => {
    assert.equal(
      resolveTemporaryAccountPassword("010-6387-7780", null),
      "nh77807780",
    );
    assert.equal(
      resolveTemporaryAccountPassword("01012345678", "nh99999999"),
      "nh99999999",
    );
  });
});
