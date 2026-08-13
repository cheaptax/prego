import type { Firestore } from "firebase-admin/firestore";
import {
  escapeEmailHtml,
  getAppBaseUrl,
  getTransactionalEmailConfigurationError,
  sendTransactionalEmail,
} from "@/lib/email/resend";
import type {
  PartnerRecord,
  QuoteRequestRecord,
  UserRecord,
} from "@/lib/firebase/schema";
import { loadPartnerAccounts } from "@/lib/partner-management-server";

export type PartnerAssignmentEmailInput = {
  db: Firestore;
  partner: Pick<PartnerRecord, "id" | "displayName" | "contactEmail">;
  quoteRequest: Pick<
    QuoteRequestRecord,
    | "id"
    | "subject"
    | "sourceReference"
    | "customerName"
    | "customerEmail"
    | "cooperativeName"
    | "fiscalYear"
    | "sourceType"
  > & {
    targetCooperativeName?: string | null;
  };
  assignmentId: string;
};

function collectRecipientEmails(
  partner: Pick<PartnerRecord, "contactEmail">,
  accounts: UserRecord[],
) {
  const emails = new Set<string>();
  const contact = partner.contactEmail?.trim().toLowerCase() ?? "";
  if (contact) emails.add(contact);
  for (const account of accounts) {
    const email = account.email?.trim().toLowerCase() ?? "";
    if (!email) continue;
    if (
      account.accountStatus === "active" ||
      account.status === "active" ||
      !account.accountStatus
    ) {
      emails.add(email);
    }
  }
  return [...emails];
}

export function buildPartnerAssignmentEmail(input: {
  partnerName: string;
  subject: string;
  publicReference: string;
  cooperativeName?: string | null;
  fiscalYear?: number | null;
  customerName?: string | null;
  portalUrl: string;
}) {
  const title = "[농협지원센터] 새로운 견적 요청이 배정되었습니다";
  const lines = [
    `${input.partnerName} 담당자님, 새로운 견적 요청이 배정되었습니다.`,
    `접수번호: ${input.publicReference}`,
    `요청 제목: ${input.subject}`,
  ];
  if (input.cooperativeName) {
    lines.push(`대상 농협: ${input.cooperativeName}`);
  }
  if (input.fiscalYear) {
    lines.push(`사업연도: ${input.fiscalYear}`);
  }
  if (input.customerName) {
    lines.push(`고객: ${input.customerName}`);
  }
  lines.push(
    "제휴사 포털에 로그인하여 견적서를 작성·확정해 주세요.",
    `포털 바로가기: ${input.portalUrl}`,
  );

  const htmlLines = [
    `<p>${escapeEmailHtml(`${input.partnerName} 담당자님, 새로운 견적 요청이 배정되었습니다.`)}</p>`,
    `<p>접수번호: <strong>${escapeEmailHtml(input.publicReference)}</strong></p>`,
    `<p>요청 제목: ${escapeEmailHtml(input.subject)}</p>`,
  ];
  if (input.cooperativeName) {
    htmlLines.push(
      `<p>대상 농협: ${escapeEmailHtml(input.cooperativeName)}</p>`,
    );
  }
  if (input.fiscalYear) {
    htmlLines.push(`<p>사업연도: ${input.fiscalYear}</p>`);
  }
  if (input.customerName) {
    htmlLines.push(
      `<p>고객: ${escapeEmailHtml(input.customerName)}</p>`,
    );
  }
  htmlLines.push(
    "<p>제휴사 포털에 로그인하여 견적서를 작성·확정해 주세요.</p>",
    `<p><a href="${escapeEmailHtml(input.portalUrl)}">제휴사 포털 바로가기</a></p>`,
  );

  return {
    subject: title,
    html: htmlLines.join(""),
    text: lines.join("\n"),
  };
}

/**
 * Fire-and-forget safe: failures are logged, never thrown to the assign API.
 */
export async function notifyPartnerQuoteAssignment(
  input: PartnerAssignmentEmailInput,
): Promise<{ sent: number; skipped: boolean; error?: string }> {
  const configError = getTransactionalEmailConfigurationError();
  if (configError) {
    console.info("[quote-assignment] email_skipped", {
      partnerId: input.partner.id,
      assignmentId: input.assignmentId,
      error: configError,
    });
    return { sent: 0, skipped: true, error: configError };
  }

  const accounts = await loadPartnerAccounts(input.db, input.partner.id);
  const recipients = collectRecipientEmails(input.partner, accounts);
  if (recipients.length === 0) {
    console.info("[quote-assignment] email_skipped", {
      partnerId: input.partner.id,
      assignmentId: input.assignmentId,
      error: "no_recipients",
    });
    return { sent: 0, skipped: true, error: "no_recipients" };
  }

  const portalUrl = `${getAppBaseUrl()}/partner`;
  const publicReference =
    input.quoteRequest.sourceReference?.trim() ||
    input.quoteRequest.id;
  const cooperativeName =
    input.quoteRequest.targetCooperativeName ||
    input.quoteRequest.cooperativeName;
  const email = buildPartnerAssignmentEmail({
    partnerName: input.partner.displayName,
    subject: input.quoteRequest.subject || "견적 요청",
    publicReference,
    cooperativeName,
    fiscalYear: input.quoteRequest.fiscalYear,
    customerName: input.quoteRequest.customerName,
    portalUrl,
  });

  let sent = 0;
  for (const to of recipients) {
    try {
      await sendTransactionalEmail({
        to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        idempotencyKey: `quote-assignment/${input.assignmentId}/${to}`,
      });
      sent += 1;
    } catch (error) {
      console.error("[quote-assignment] email_failed", {
        partnerId: input.partner.id,
        assignmentId: input.assignmentId,
        to,
        error: error instanceof Error ? error.message : "send_failed",
      });
    }
  }

  return { sent, skipped: false };
}
