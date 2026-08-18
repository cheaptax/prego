import "server-only";

import { randomUUID } from "node:crypto";
import { calculateNhAuditExpectedCostV2 } from "@/lib/audit-evaluation/nh-audit-v2-engine";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";
import { getTransactionalEmailConfigurationError } from "@/lib/email/resend";
import { withoutUndefined } from "@/lib/firebase/clean";
import { adminDb } from "@/lib/firebase/admin";
import type {
  PartnerRecord,
  QuoteEmailDeliveryRecord,
  QuoteRecord,
  QuoteRequestRecord,
} from "@/lib/firebase/schema";
import { buildCustomerQuoteEmail } from "@/lib/quotes/customer-quote-email";
import { withStandardQuoteConditions } from "@/lib/quotes/quote-presentation";
import { sendCustomerQuoteTransactionalEmail } from "@/lib/quotes/partner-quote-cc";
import { createNhAuditEvaluationSnapshotV2 } from "@/lib/quotes/nh-audit-quote-server";
import { getPublishedQuoteDocumentContentForPartner } from "@/lib/quotes/quote-screen-profile";
import { quotePdfFileNameFromRecords } from "@/lib/quotes/quote-pdf-filename";
import { renderQuotePdf } from "@/lib/quotes/quote-pdf";
import {
  deleteQuotePdf,
  readStorageFileAsDataUri,
  saveQuotePdf,
} from "@/lib/quotes/quote-storage";
import {
  nextImmutableQuoteVersion,
} from "@/lib/quotes/nh-audit-quote-server";
import type {
  SafePriceAdjustmentEvent,
} from "@/lib/quotes/quote-automation-types";
import {
  quoteRequestIdsForSafePriceRewrite,
  recipientEmailForQuoteRewrite,
} from "@/lib/quotes/safe-price-rewrite-helpers";

export class SafePriceQuoteRewriteError extends Error {
  readonly code = "safe_price_quote_rewrite_failed";

  constructor(message: string) {
    super(message);
    this.name = "SafePriceQuoteRewriteError";
  }
}

export async function persistSafePriceQuoteRewrites(input: {
  quoteRequestId: string;
  adjustedQuotes: readonly QuoteRecord[];
  events: readonly SafePriceAdjustmentEvent[];
  now: string;
}) {
  if (input.events.length === 0) {
    return { quotes: [...input.adjustedQuotes], events: [] as SafePriceAdjustmentEvent[] };
  }
  const rewrittenQuotes: QuoteRecord[] = [];
  const rewrittenEvents: SafePriceAdjustmentEvent[] = [];
  for (const event of input.events) {
    const adjusted = input.adjustedQuotes.find(
      (quote) => quote.id === event.partnerQuoteId,
    );
    if (!adjusted?.nhAuditV2?.submission) {
      throw new SafePriceQuoteRewriteError(
        `adjusted_quote_missing:${event.partnerQuoteId}`,
      );
    }
    const result = await rewriteOneQuote({
      adjusted,
      event,
      quoteRequestId: input.quoteRequestId,
      now: input.now,
    });
    rewrittenQuotes.push(result.quote);
    rewrittenEvents.push(result.event);
  }
  const rewrittenBySuperseded = new Map(
    rewrittenQuotes.map((quote) => [quote.supersedesQuoteId, quote]),
  );
  return {
    quotes: input.adjustedQuotes.map((quote) => rewrittenBySuperseded.get(quote.id) ?? quote),
    events: rewrittenEvents,
  };
}

async function rewriteOneQuote(input: {
  adjusted: QuoteRecord;
  event: SafePriceAdjustmentEvent;
  quoteRequestId: string;
  now: string;
}) {
  const db = adminDb();
  const [quoteRequest, partnerSnapshot, versionsSnapshot] = await Promise.all([
    loadQuoteRequestForRewrite(db, [
      input.quoteRequestId,
      input.adjusted.quoteRequestId,
    ]),
    db.collection("partners").doc(input.adjusted.partnerId).get(),
    db
      .collection("quotes")
      .where("quoteAssignmentId", "==", input.adjusted.quoteAssignmentId)
      .where("status", "in", ["finalized", "delivered", "void"])
      .get(),
  ]);
  if (!quoteRequest) {
    throw new SafePriceQuoteRewriteError(
      `quote_request_missing:${input.adjusted.quoteRequestId}`,
    );
  }
  if (!partnerSnapshot.exists) {
    throw new SafePriceQuoteRewriteError(
      `partner_missing:${input.adjusted.partnerId}`,
    );
  }
  const partner = partnerSnapshot.data() as PartnerRecord;
  const versions = versionsSnapshot.docs.map((document) => {
    const data = document.data() as QuoteRecord;
    return { ...data, id: data.id || document.id };
  });
  const nextVersion = nextImmutableQuoteVersion(
    versions.map((quote) => Number(quote.version)),
  );
  const quoteId = `${input.adjusted.quoteAssignmentId}_v${nextVersion}`;
  const submission = {
    ...input.adjusted.nhAuditV2!.submission,
    submissionId: quoteId,
    submittedAt: input.now,
  };
  const snapshot = createNhAuditEvaluationSnapshotV2(submission, input.now);
  const cost = calculateNhAuditExpectedCostV2(submission);
  const auditFee = Number(submission.auditFeeWon);
  const expectedExpense = Number(cost.normalizedExpectedExpenseWon);
  const lineItems: QuoteRecord["lineItems"] = [
    {
      id: "audit-fee",
      name: "회계감사 보수",
      quantity: 1,
      unitPrice: auditFee,
      supplyAmount: auditFee,
    },
    ...(expectedExpense > 0
      ? [
          {
            id: "expected-expense",
            name: "예상 제경비",
            quantity: 1,
            unitPrice: expectedExpense,
            supplyAmount: expectedExpense,
          },
        ]
      : []),
  ];
  const previousSentQuotes = versions
    .filter((quote) => ["finalized", "delivered"].includes(quote.status))
    .sort((left, right) => Number(right.version) - Number(left.version));
  const customerEmail = recipientEmailForQuoteRewrite(
    input.adjusted,
    quoteRequest,
  );
  const rewritten: QuoteRecord = withoutUndefined({
    ...withStandardQuoteConditions({
      ...input.adjusted,
      notes: appendSafePriceRewriteNote(input.adjusted.notes),
    }),
    id: quoteId,
    quoteRequestId: quoteRequest.id || input.adjusted.quoteRequestId,
    version: nextVersion,
    status: "finalized",
    customerEmail,
    lineItems,
    subtotal: Number(cost.supplyAmountWon),
    taxAmount: Number(cost.vatWon),
    totalAmount: Number(cost.expectedTotalBurdenWon),
    nhAuditV2: snapshot,
    supersedesQuoteId: input.adjusted.id,
    deliveredAt: undefined,
    finalizedAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
  } satisfies QuoteRecord);
  const quoteDocumentContent = await getPublishedQuoteDocumentContentForPartner(
    {
      db,
      partnerId: partner.id || input.adjusted.partnerId,
      cmsContent: (await loadPublishedCmsPage("partner.portal")).content,
      partner,
    },
  );
  const [logoDataUri, sealDataUri] = await Promise.all([
    readStorageFileAsDataUri(partner.logoPath),
    readStorageFileAsDataUri(partner.sealPath),
  ]);
  const pdfBuffer = await renderQuotePdf({
    quote: rewritten,
    quoteRequest,
    logoDataUri,
    sealDataUri,
    documentContent: quoteDocumentContent,
  });
  const pdfPath = await saveQuotePdf({
    quoteId: rewritten.id,
    version: rewritten.version,
    buffer: pdfBuffer,
    storageKey: randomUUID(),
  });
  const pdfFileName = quotePdfFileNameFromRecords(rewritten, quoteRequest);
  const quoteWithPdf: QuoteRecord = {
    ...rewritten,
    pdfPath,
    pdfFileName,
  };
  const deliveryId = `${quoteWithPdf.id}_customer`;
  const delivery: QuoteEmailDeliveryRecord = {
    id: deliveryId,
    quoteId: quoteWithPdf.id,
    quoteRequestId: quoteWithPdf.quoteRequestId,
    recipientEmail: customerEmail,
    status: "pending",
    provider: "local",
    attemptCount: 0,
    createdAt: input.now,
    updatedAt: input.now,
  };
  try {
    await db.runTransaction(async (transaction) => {
      transaction.set(db.collection("quotes").doc(quoteWithPdf.id), quoteWithPdf);
      for (const prior of previousSentQuotes) {
        transaction.set(
          db.collection("quotes").doc(prior.id),
          {
            status: "void",
            voidedAt: input.now,
            voidReason: "safe_price_source_rewrite",
            updatedAt: input.now,
          } satisfies Partial<QuoteRecord>,
          { merge: true },
        );
      }
      transaction.set(
        db.collection("quoteAssignments").doc(quoteWithPdf.quoteAssignmentId),
        { status: "finalized", updatedAt: input.now },
        { merge: true },
      );
      transaction.set(db.collection("quoteEmailDeliveries").doc(deliveryId), delivery);
    });
  } catch (error) {
    await deleteQuotePdf(pdfPath).catch(() => undefined);
    throw error;
  }
  await sendRewriteEmail({
    db,
    quote: quoteWithPdf,
    pdfBuffer,
    pdfFileName,
    deliveryId,
    recipientEmail: customerEmail,
    copy: quoteDocumentContent.copy,
  });
  return {
    quote: quoteWithPdf,
    event: {
      ...input.event,
      id: `${input.event.id}_${nextVersion}`,
      partnerQuoteId: quoteWithPdf.id,
      mutatedSourceQuote: true,
      beforeQuoteVersion: input.adjusted.version,
      afterQuoteVersion: nextVersion,
      rewrittenQuoteId: quoteWithPdf.id,
    } satisfies SafePriceAdjustmentEvent,
  };
}

async function loadQuoteRequestForRewrite(
  db: ReturnType<typeof adminDb>,
  ids: Array<string | null | undefined>,
) {
  for (const id of quoteRequestIdsForSafePriceRewrite(...ids)) {
    const snapshot = await db.collection("quoteRequests").doc(id).get();
    if (!snapshot.exists) continue;
    const data = snapshot.data() as QuoteRequestRecord;
    return { ...data, id: data.id || snapshot.id };
  }
  return null;
}

async function sendRewriteEmail(input: {
  db: ReturnType<typeof adminDb>;
  quote: QuoteRecord;
  pdfBuffer: Buffer;
  pdfFileName: string;
  deliveryId: string;
  recipientEmail: string;
  copy: Parameters<typeof buildCustomerQuoteEmail>[0]["copy"];
}) {
  const markFailed = async (lastError: string) => {
    await input.db.collection("quoteEmailDeliveries").doc(input.deliveryId).set(
      {
        status: "failed",
        attemptCount: 1,
        lastError,
        updatedAt: new Date().toISOString(),
      } satisfies Partial<QuoteEmailDeliveryRecord>,
      { merge: true },
    );
  };
  if (!input.recipientEmail) {
    await markFailed("missing_recipient");
    return;
  }
  const configError = getTransactionalEmailConfigurationError();
  if (configError) {
    await markFailed(configError);
    return;
  }
  try {
    const emailContent = await buildCustomerQuoteEmail({
      db: input.db,
      quote: input.quote,
      copy: input.copy,
    });
    const sent = await sendCustomerQuoteTransactionalEmail({
      db: input.db,
      quote: input.quote,
      to: input.recipientEmail,
      ...emailContent,
      attachments: [{ filename: input.pdfFileName, content: input.pdfBuffer }],
      idempotencyKey: `quote/${input.quote.id}/customer-safe-price`,
    });
    const now = new Date().toISOString();
    if (sent.provider === "local") {
      await markFailed("resend_not_configured");
      return;
    }
    await Promise.all([
      input.db.collection("quoteEmailDeliveries").doc(input.deliveryId).set(
        {
          status: "sent",
          provider: sent.provider,
          providerMessageId: sent.id,
          recipientEmail: sent.recipientEmail,
          ccEmails: sent.ccEmails,
          attemptCount: 1,
          sentAt: now,
          updatedAt: now,
        } satisfies Partial<QuoteEmailDeliveryRecord>,
        { merge: true },
      ),
      input.db.collection("quotes").doc(input.quote.id).set(
        {
          status: "delivered",
          deliveredAt: now,
          updatedAt: now,
        } satisfies Partial<QuoteRecord>,
        { merge: true },
      ),
    ]);
  } catch (error) {
    const lastError =
      error instanceof Error ? error.message : "email_send_failed";
    await markFailed(lastError);
    console.error("safe_price_rewrite_email_failed", {
      quoteId: input.quote.id,
      lastError,
    });
  }
}

function appendSafePriceRewriteNote(note: string | undefined) {
  const marker = "운영자 안전가격 규칙에 따라 자동 조정·재발행됨";
  return note?.includes(marker) ? note : [note, marker].filter(Boolean).join("\n");
}
