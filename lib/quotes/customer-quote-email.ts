import type { Firestore } from "firebase-admin/firestore";
import { AUDIT_QUOTE_REQUESTS } from "@/lib/audit-quote/collections";
import type { AuditQuoteRequestRecord } from "@/lib/audit-quote/types";
import {
  escapeEmailHtml,
  getCustomerFacingAppBaseUrl,
} from "@/lib/email/resend";
import {
  buildTemporaryMemberAccountNotice,
  resolveTemporaryAccountPassword,
} from "@/lib/email/temporary-account-notice";
import type { QuoteRecord, QuoteRequestRecord, UserRecord } from "@/lib/firebase/schema";
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

async function resolveQuoteCustomerPhone(input: {
  db: Firestore;
  quoteRequest: QuoteRequestRecord | null;
}) {
  if (input.quoteRequest?.customerPhone?.trim()) {
    return input.quoteRequest.customerPhone;
  }
  if (
    input.quoteRequest?.sourceType === "audit_quote" &&
    input.quoteRequest.sourceId
  ) {
    const source = await input.db
      .collection(AUDIT_QUOTE_REQUESTS)
      .doc(input.quoteRequest.sourceId)
      .get();
    const phone = (source.data() as AuditQuoteRequestRecord | undefined)?.phone;
    if (phone?.trim()) return phone;
  }
  if (input.quoteRequest?.customerUid) {
    const profile = await input.db
      .collection("users")
      .doc(input.quoteRequest.customerUid)
      .get();
    const phone = (profile.data() as UserRecord | undefined)?.phone;
    if (phone?.trim()) return phone;
  }
  return "";
}

export function composeCustomerQuoteEmailBodies(input: {
  arrivalText: string;
  quoteUrl: string;
  loginUrl: string;
  accountEmail: string;
  initialPassword?: string | null;
  downloadLinkLabel: string;
  downloadTextLabel: string;
}) {
  const arrivalHtml = escapeEmailHtml(input.arrivalText);
  const notice = buildTemporaryMemberAccountNotice({
    loginUrl: input.loginUrl,
    accountEmail: input.accountEmail,
    initialPassword: input.initialPassword,
  });
  return {
    html: [
      `<p>${arrivalHtml}</p>`,
      `<p><a href="${escapeEmailHtml(input.quoteUrl)}">${escapeEmailHtml(input.downloadLinkLabel)}</a></p>`,
      notice.html,
    ]
      .filter(Boolean)
      .join(""),
    text: [
      input.arrivalText,
      `${input.downloadTextLabel}: ${input.quoteUrl}`,
      ...(notice.textLines.length > 0 ? ["", ...notice.textLines] : []),
    ].join("\n"),
  };
}

export async function buildCustomerQuoteEmail(input: {
  db: Firestore;
  quote: QuoteRecord;
  copy?: CustomerQuoteEmailCopy;
}) {
  const copy = input.copy ?? DEFAULT_COPY;
  const baseUrl = getCustomerFacingAppBaseUrl();
  const quoteUrl = `${baseUrl}/mypage/quotes/${encodeURIComponent(input.quote.id)}`;
  const quoteRequestSnapshot = await input.db
    .collection("quoteRequests")
    .doc(input.quote.quoteRequestId)
    .get();
  const quoteRequest = quoteRequestSnapshot.exists
    ? (quoteRequestSnapshot.data() as QuoteRequestRecord)
    : null;
  const phone = await resolveQuoteCustomerPhone({
    db: input.db,
    quoteRequest,
  });
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
  const bodies = composeCustomerQuoteEmailBodies({
    arrivalText,
    quoteUrl,
    loginUrl: `${baseUrl}/login`,
    accountEmail: input.quote.customerEmail,
    initialPassword: resolveTemporaryAccountPassword(phone),
    downloadLinkLabel: copy.emailDownloadLinkLabel,
    downloadTextLabel: copy.emailDownloadTextLabel,
  });
  return {
    subject,
    html: bodies.html,
    text: bodies.text,
  };
}
