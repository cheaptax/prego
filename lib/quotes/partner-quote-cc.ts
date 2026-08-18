import type { Firestore } from "firebase-admin/firestore";
import {
  sendTransactionalEmail,
  uniqueCcRecipients,
} from "@/lib/email/resend";
import type { PartnerRecord, QuoteRecord } from "@/lib/firebase/schema";

export const QUOTE_OPS_CC_EMAIL = "prego.ceo@gmail.com";

export function quotePartnerCcEmails(input: {
  customerEmail: string;
  partnerContactEmail?: string | null;
  supplierContactEmail?: string | null;
}) {
  return uniqueCcRecipients(input.customerEmail, [
    input.partnerContactEmail || input.supplierContactEmail || "",
    QUOTE_OPS_CC_EMAIL,
  ]);
}

export async function loadQuotePartnerCcEmails(
  db: Firestore,
  quote: Pick<
    QuoteRecord,
    "partnerId" | "customerEmail" | "supplierContactEmail"
  >,
) {
  let partnerContactEmail = "";
  if (quote.partnerId) {
    const snapshot = await db.collection("partners").doc(quote.partnerId).get();
    partnerContactEmail = snapshot.exists
      ? String((snapshot.data() as PartnerRecord | undefined)?.contactEmail ?? "")
      : "";
  }
  return quotePartnerCcEmails({
    customerEmail: quote.customerEmail,
    partnerContactEmail,
    supplierContactEmail: quote.supplierContactEmail,
  });
}

export async function sendCustomerQuoteTransactionalEmail(input: {
  db: Firestore;
  quote: Pick<
    QuoteRecord,
    "partnerId" | "customerEmail" | "supplierContactEmail"
  >;
  to?: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
  }>;
}) {
  const to = input.to?.trim() || input.quote.customerEmail;
  const cc = await loadQuotePartnerCcEmails(input.db, input.quote);
  return sendTransactionalEmail({
    to,
    cc,
    subject: input.subject,
    html: input.html,
    text: input.text,
    idempotencyKey: input.idempotencyKey,
    attachments: input.attachments,
  });
}
