import {
  escapeEmailHtml,
  getCustomerFacingAppBaseUrl,
  getTransactionalEmailConfigurationError,
  sendTransactionalEmail,
} from "@/lib/email/resend";

export type CustomerRequestEmailInput = {
  email: string;
  publicReference: string;
  contactName?: string;
  targetCooperativeName?: string;
  fiscalYear?: number;
  requestId: string;
  initialPassword?: string | null;
};

export function buildCustomerAuditQuoteRequestEmail(input: {
  publicReference: string;
  contactName?: string;
  targetCooperativeName?: string;
  fiscalYear?: number;
  mypageUrl: string;
  loginUrl: string;
  eventUrl: string;
  accountEmail: string;
  initialPassword?: string | null;
}) {
  const greeting = input.contactName?.trim()
    ? `${input.contactName.trim()}님, `
    : "";
  const subject = `[농협지원센터] 회계감사 견적 요청이 접수되었습니다 (${input.publicReference})`;
  const lines = [
    `${greeting}회계감사 견적 요청이 정상적으로 접수되었습니다.`,
    `접수번호: ${input.publicReference}`,
  ];
  if (input.targetCooperativeName) {
    lines.push(`대상 농협: ${input.targetCooperativeName}`);
  }
  if (input.fiscalYear) {
    lines.push(`사업연도: ${input.fiscalYear}`);
  }
  if (input.initialPassword) {
    lines.push(
      "",
      "농협지원센터 임시회원 계정이 준비되었습니다.",
      `로그인 주소: ${input.loginUrl}`,
      `아이디: ${input.accountEmail}`,
      `초기 비밀번호: ${input.initialPassword}`,
      "초기 비밀번호는 nh + 담당자 휴대폰 번호 뒷자리 4자리 두 번 반복입니다.",
      "로그인 후 견적함에서 가격비교 등 기능을 바로 사용할 수 있으며, 보안을 위해 로그인 후 비밀번호를 변경해 주세요.",
    );
  }
  lines.push(
    "담당자가 제휴사 배정과 견적 취합을 진행합니다. 견적이 도착하면 이메일로 안내드리며, 마이페이지에서도 확인할 수 있습니다.",
    `마이페이지: ${input.mypageUrl}`,
    `견적 신청 안내: ${input.eventUrl}`,
  );

  const html = [
    `<p>${escapeEmailHtml(`${greeting}회계감사 견적 요청이 정상적으로 접수되었습니다.`)}</p>`,
    `<p>접수번호: <strong>${escapeEmailHtml(input.publicReference)}</strong></p>`,
    input.targetCooperativeName
      ? `<p>대상 농협: ${escapeEmailHtml(input.targetCooperativeName)}</p>`
      : "",
    input.fiscalYear ? `<p>사업연도: ${input.fiscalYear}</p>` : "",
    input.initialPassword
      ? [
          "<hr>",
          "<p><strong>농협지원센터 임시회원 계정이 준비되었습니다.</strong></p>",
          `<p>로그인 주소: <a href="${escapeEmailHtml(input.loginUrl)}">${escapeEmailHtml(input.loginUrl)}</a></p>`,
          `<p>아이디: <strong>${escapeEmailHtml(input.accountEmail)}</strong></p>`,
          `<p>초기 비밀번호: <strong>${escapeEmailHtml(input.initialPassword)}</strong></p>`,
          "<p>초기 비밀번호는 nh + 담당자 휴대폰 번호 뒷자리 4자리 두 번 반복입니다.</p>",
          "<p>로그인 후 견적함에서 가격비교 등 기능을 바로 사용할 수 있으며, 보안을 위해 로그인 후 비밀번호를 변경해 주세요.</p>",
        ].join("")
      : "",
    "<p>담당자가 제휴사 배정과 견적 취합을 진행합니다. 견적이 도착하면 이메일로 안내드리며, 마이페이지에서도 확인할 수 있습니다.</p>",
    `<p><a href="${escapeEmailHtml(input.mypageUrl)}">마이페이지에서 확인하기</a></p>`,
  ]
    .filter(Boolean)
    .join("");

  return { subject, html, text: lines.join("\n") };
}

/**
 * Fire-and-forget safe confirmation mail for the requester.
 */
export async function notifyCustomerAuditQuoteRequestReceived(
  input: CustomerRequestEmailInput,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const configError = getTransactionalEmailConfigurationError();
  if (configError) {
    console.info("[audit-quote] customer_request_email_skipped", {
      requestId: input.requestId,
      error: configError,
    });
    return { ok: false, skipped: true, error: configError };
  }

  const to = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { ok: false, skipped: true, error: "invalid_email" };
  }

  const baseUrl = getCustomerFacingAppBaseUrl();
  const email = buildCustomerAuditQuoteRequestEmail({
    publicReference: input.publicReference,
    contactName: input.contactName,
    targetCooperativeName: input.targetCooperativeName,
    fiscalYear: input.fiscalYear,
    mypageUrl: `${baseUrl}/mypage`,
    loginUrl: `${baseUrl}/login`,
    eventUrl: `${baseUrl}/events/audit-quote`,
    accountEmail: to,
    initialPassword: input.initialPassword,
  });

  try {
    await sendTransactionalEmail({
      to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: `audit-quote-request/${input.requestId}/${to}`,
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "send_failed";
    console.error("[audit-quote] customer_request_email_failed", {
      requestId: input.requestId,
      error: message,
    });
    return { ok: false, error: message };
  }
}
