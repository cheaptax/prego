import { escapeEmailHtml } from "@/lib/email/resend";
import { buildTemporaryQuoteMemberInitialPassword } from "@/lib/members/temporary-quote-member";

export function resolveTemporaryAccountPassword(
  phone?: string | null,
  issuedPassword?: string | null,
) {
  const issued = issuedPassword?.trim();
  if (issued) return issued;
  return buildTemporaryQuoteMemberInitialPassword(phone ?? "") ?? null;
}

/**
 * Shared footer for quote-request completion and quote-delivery mail.
 * Matches the original customer notice: login URL, id, nh + last-4 twice.
 */
export function buildTemporaryMemberAccountNotice(input: {
  loginUrl: string;
  accountEmail: string;
  initialPassword?: string | null;
}) {
  const accountEmail = input.accountEmail.trim();
  const loginUrl = input.loginUrl.trim();
  if (!accountEmail || !loginUrl) {
    return { html: "", textLines: [] as string[] };
  }

  const textLines = [
    "농협지원센터 임시회원 계정이 준비되었습니다.",
    `로그인 주소: ${loginUrl}`,
    `아이디: ${accountEmail}`,
  ];
  if (input.initialPassword) {
    textLines.push(`초기 비밀번호: ${input.initialPassword}`);
  }
  textLines.push(
    "초기 비밀번호는 nh + 담당자 휴대폰 번호 뒷자리 4자리 두 번 반복입니다.",
    "로그인 후 견적함에서 가격비교 등 기능을 바로 사용할 수 있으며, 보안을 위해 로그인 후 비밀번호를 변경해 주세요.",
  );

  const html = [
    "<hr>",
    "<p><strong>농협지원센터 임시회원 계정이 준비되었습니다.</strong></p>",
    `<p>로그인 주소: <a href="${escapeEmailHtml(loginUrl)}">${escapeEmailHtml(loginUrl)}</a></p>`,
    `<p>아이디: <strong>${escapeEmailHtml(accountEmail)}</strong></p>`,
    input.initialPassword
      ? `<p>초기 비밀번호: <strong>${escapeEmailHtml(input.initialPassword)}</strong></p>`
      : "",
    "<p>초기 비밀번호는 nh + 담당자 휴대폰 번호 뒷자리 4자리 두 번 반복입니다.</p>",
    "<p>로그인 후 견적함에서 가격비교 등 기능을 바로 사용할 수 있으며, 보안을 위해 로그인 후 비밀번호를 변경해 주세요.</p>",
  ]
    .filter(Boolean)
    .join("");

  return { html, textLines };
}
