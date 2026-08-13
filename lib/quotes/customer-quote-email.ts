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
import { formatQuoteVersionLabel } from "@/lib/quotes/quote-revision";

type CustomerQuoteEmailCopy = Pick<
  QuoteDocumentCopy,
  | "emailSubjectTemplate"
  | "emailArrivalTemplate"
  | "emailRevisionSubjectTemplate"
  | "emailRevisionArrivalTemplate"
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
    "{{partnerName}}의 농협 {{yearShort}}년도 외부회계감사 견적서가 도착했습니다.",
  emailArrivalTemplate:
    "안녕하십니까. 농협지원센터에서 {{partnerName}} 견적서가 도착했습니다. 확인 부탁드립니다.",
  emailRevisionSubjectTemplate:
    "{{partnerName}}의 농협 {{yearShort}}년도 외부회계감사 견적서가 도착했습니다.",
  emailRevisionArrivalTemplate:
    "안녕하십니까. 농협지원센터에서 {{partnerName}} 견적서가 {{versionLabel}}으로 수정되어 도착했습니다. 이전 견적서를 대체하니 확인 부탁드립니다.",
  emailTemporaryAccountNotice:
    "견적 요청 이메일로 임시회원 계정이 준비되었습니다.",
  emailAccountIdLabel: "아이디",
  emailActivationLinkLabel: "비밀번호 설정 후 견적서 확인",
  emailSecurityNotice:
    "견적요청 완료 메일의 초기 비밀번호로 로그인할 수 있습니다. 비밀번호를 변경했거나 다시 설정해야 하면 위 일회용 링크를 사용해 주세요.",
  emailExistingAccountPrefix: "이미 비밀번호를 설정했다면",
  emailDownloadLinkLabel: "로그인 후 견적서 다운로드",
  emailDownloadTextLabel: "다운로드",
};

export function auditQuoteEmailYearShort(fiscalYear?: number | null) {
  const year = Number(fiscalYear);
  if (!Number.isInteger(year) || year < 1) return "27";
  return String(year >= 100 ? year % 100 : year);
}

export function resolveCustomerQuoteEmailTemplates(input: {
  version: number;
  partnerName: string;
  fiscalYear?: number | null;
  sourceType?: string;
  copy?: Partial<CustomerQuoteEmailCopy>;
}) {
  const copy = { ...DEFAULT_COPY, ...input.copy };
  const versionLabel = formatQuoteVersionLabel(input.version);
  const isRevision = Number(input.version) > 1;
  const yearShort = auditQuoteEmailYearShort(input.fiscalYear);
  const values = {
    partnerName: input.partnerName,
    versionLabel,
    version: versionLabel,
    yearShort,
    year: yearShort,
  };
  const isAuditQuote =
    input.sourceType === "audit_quote" || input.fiscalYear != null;
  const subject = isAuditQuote
    ? `${input.partnerName}의 농협 ${yearShort}년도 외부회계감사 견적서가 도착했습니다.`
    : applyQuoteTemplate(
        isRevision
          ? copy.emailRevisionSubjectTemplate
          : copy.emailSubjectTemplate,
        values,
      );
  return {
    versionLabel,
    isRevision,
    subject,
    arrivalText: applyQuoteTemplate(
      isRevision
        ? copy.emailRevisionArrivalTemplate
        : copy.emailArrivalTemplate,
      values,
    ),
  };
}

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
  const { subject, arrivalText } = resolveCustomerQuoteEmailTemplates({
    version: input.quote.version,
    partnerName: input.quote.partnerName,
    fiscalYear:
      quoteRequest?.fiscalYear ??
      input.quote.nhAuditV2?.submission.fiscalYear ??
      null,
    sourceType: quoteRequest?.sourceType,
    copy,
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
