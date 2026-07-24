import type { Firestore } from "firebase-admin/firestore";
import type { QuoteRecord, QuoteRequestRecord } from "@/lib/firebase/schema";
import {
  escapeEmailHtml,
  getAppBaseUrl,
} from "@/lib/email/resend";
import { createTemporaryMemberActivationLink } from "@/lib/members/temporary-quote-member";
import {
  applyQuoteTemplate,
  type QuoteDocumentCopy,
} from "@/lib/quotes/quote-document-content";

type CustomerQuoteEmailCopy = Pick<
  QuoteDocumentCopy,
  | "emailSubjectTemplate"
  | "emailArrivalTemplate"
  | "emailTemporaryAccountNotice"
  | "emailAccountIdLabel"
  | "emailActivationLinkLabel"
  | "emailSecurityNotice"
  | "emailExistingAccountPrefix"
  | "emailDownloadLinkLabel"
  | "emailDownloadTextLabel"
>;

const DEFAULT_COPY: CustomerQuoteEmailCopy = {
  emailSubjectTemplate:
    "[농협지원센터] {{partnerName}} 견적서가 도착했습니다",
  emailArrivalTemplate: "{{partnerName}} 견적서가 도착했습니다.",
  emailTemporaryAccountNotice:
    "견적 요청 이메일로 임시회원 계정이 준비되었습니다.",
  emailAccountIdLabel: "아이디",
  emailActivationLinkLabel: "비밀번호 설정 후 견적서 확인",
  emailSecurityNotice:
    "보안을 위해 임시비밀번호를 이메일로 보내지 않습니다. 위 일회용 링크에서 직접 비밀번호를 설정해 주세요.",
  emailExistingAccountPrefix: "이미 비밀번호를 설정했다면",
  emailDownloadLinkLabel: "로그인 후 견적서 다운로드",
  emailDownloadTextLabel: "다운로드",
};

export async function buildCustomerQuoteEmail(input: {
  db: Firestore;
  quote: QuoteRecord;
  copy?: CustomerQuoteEmailCopy;
}) {
  const copy = input.copy ?? DEFAULT_COPY;
  const baseUrl = getAppBaseUrl();
  const quoteUrl = `${baseUrl}/mypage/quotes/${encodeURIComponent(input.quote.id)}`;
  const quoteRequestSnapshot = await input.db
    .collection("quoteRequests")
    .doc(input.quote.quoteRequestId)
    .get();
  const quoteRequest = quoteRequestSnapshot.exists
    ? (quoteRequestSnapshot.data() as QuoteRequestRecord)
    : null;
  const activationUrl = quoteRequest?.customerUid
    ? await createTemporaryMemberActivationLink({
        db: input.db,
        uid: quoteRequest.customerUid,
        email: input.quote.customerEmail,
        quoteId: input.quote.id,
        baseUrl,
      })
    : null;
  const subject = applyQuoteTemplate(copy.emailSubjectTemplate, {
    partnerName: input.quote.partnerName,
  });
  const arrivalText = applyQuoteTemplate(copy.emailArrivalTemplate, {
    partnerName: input.quote.partnerName,
  });
  const arrivalHtml = escapeEmailHtml(arrivalText);

  if (activationUrl) {
    return {
      subject,
      html: [
        `<p>${arrivalHtml}</p>`,
        `<p>${escapeEmailHtml(copy.emailTemporaryAccountNotice)}</p>`,
        `<p>${escapeEmailHtml(copy.emailAccountIdLabel)}: <strong>${escapeEmailHtml(input.quote.customerEmail)}</strong></p>`,
        `<p><a href="${escapeEmailHtml(activationUrl)}">${escapeEmailHtml(copy.emailActivationLinkLabel)}</a></p>`,
        `<p>${escapeEmailHtml(copy.emailSecurityNotice)}</p>`,
        `<p>${escapeEmailHtml(copy.emailExistingAccountPrefix)} <a href="${escapeEmailHtml(quoteUrl)}">${escapeEmailHtml(copy.emailDownloadLinkLabel)}</a></p>`,
      ].join(""),
      text: [
        arrivalText,
        copy.emailTemporaryAccountNotice,
        `${copy.emailAccountIdLabel}: ${input.quote.customerEmail}`,
        `${copy.emailActivationLinkLabel}: ${activationUrl}`,
        copy.emailSecurityNotice,
        `${copy.emailExistingAccountPrefix} ${copy.emailDownloadLinkLabel}: ${quoteUrl}`,
      ].join("\n"),
    };
  }

  return {
    subject,
    html: `<p>${arrivalHtml}</p><p><a href="${escapeEmailHtml(quoteUrl)}">${escapeEmailHtml(copy.emailDownloadLinkLabel)}</a></p>`,
    text: `${arrivalText}\n${copy.emailDownloadTextLabel}: ${quoteUrl}`,
  };
}
