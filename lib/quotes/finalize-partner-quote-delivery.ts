import { createHash, randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { AUDIT_QUOTE_REQUESTS } from "@/lib/audit-quote/collections";
import { isAuditEvaluationCapabilityEnabled } from "@/lib/audit-evaluation/feature-flags";
import { FirestoreStandardQuoteDocumentRepository } from "@/lib/audit-evaluation/standard-quote-repository";
import { StandardQuoteDocumentService } from "@/lib/audit-evaluation/standard-quote-service";
import {
  createQuoteDocumentIdentity,
  getQuoteDocumentSigningSecret,
  serializeEmbeddedQuoteDocumentIdentity,
} from "@/lib/audit-evaluation/standard-quote-identity";
import { getTransactionalEmailConfigurationError } from "@/lib/email/resend";
import { withoutUndefined } from "@/lib/firebase/clean";
import type {
  PartnerRecord,
  QuoteAssignmentRecord,
  QuoteEmailDeliveryRecord,
  QuoteRecord,
  QuoteRequestRecord,
} from "@/lib/firebase/schema";
import { writeAuditLog } from "@/lib/firebase/server";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";
import { extractNhAuditEvaluationDefaults } from "@/lib/quotes/nh-audit-evaluation-defaults";
import { valuesFromNhAuditSubmission } from "@/lib/quotes/nh-audit-quote-form";
import { canPartnerFinalizeQuoteAssignment } from "@/lib/quotes/nh-audit-quote-server";
import { embedAuditQuoteIdentityMarker } from "@/lib/quotes/audit-quote-document";
import { buildCustomerQuoteEmail } from "@/lib/quotes/customer-quote-email";
import { sendCustomerQuoteTransactionalEmail } from "@/lib/quotes/partner-quote-cc";
import { getPublishedQuoteDocumentContentForPartner } from "@/lib/quotes/quote-screen-profile";
import { quotePdfFileNameFromRecords } from "@/lib/quotes/quote-pdf-filename";
import { quoteDocumentForPersistence } from "@/lib/quotes/quote-persistence";
import { renderQuotePdf } from "@/lib/quotes/quote-pdf";
import {
  deleteQuotePdf,
  readQuotePdfBuffer,
  readStorageFileAsDataUri,
  saveQuotePdf,
} from "@/lib/quotes/quote-storage";

type BuiltQuote = {
  quote: QuoteRecord;
  quoteRequest: QuoteRequestRecord;
  assignment: QuoteAssignmentRecord;
  partner: PartnerRecord;
};

export type FinalizeQuoteDeliveryActor = {
  uid: string;
  email?: string;
  mode: "partner" | "admin_proxy";
};

export async function finalizePartnerQuoteDelivery(input: {
  db: Firestore;
  assignmentId: string;
  built: BuiltQuote;
  previousVersions: readonly QuoteRecord[];
  actor: FinalizeQuoteDeliveryActor;
}) {
  const { db, assignmentId, built, actor } = input;
  const logoDataUri = await readStorageFileAsDataUri(built.partner.logoPath);
  const sealDataUri = await readStorageFileAsDataUri(built.partner.sealPath);
  const quoteDocumentContent = await getPublishedQuoteDocumentContentForPartner(
    {
      db,
      partnerId: built.partner.id,
      cmsContent: (await loadPublishedCmsPage("partner.portal")).content,
      partner: built.partner,
    },
  );
  let pdfBuffer = await renderQuotePdf({
    quote: built.quote,
    quoteRequest: built.quoteRequest,
    logoDataUri,
    sealDataUri,
    documentContent: quoteDocumentContent,
  });

  let quoteWithStandardDocument = built.quote;
  if (
    built.quoteRequest.sourceType === "audit_quote" &&
    built.quote.auditEvaluation?.trustedPayload &&
    built.quote.auditEvaluation.configSource === "published" &&
    isAuditEvaluationCapabilityEnabled("enabled")
  ) {
    try {
      const signingSecret = getQuoteDocumentSigningSecret();
      const quoteDocumentId = `qd_${createHash("sha256")
        .update(built.quote.id, "utf8")
        .digest("base64url")
        .slice(0, 24)}`;
      const identity = createQuoteDocumentIdentity(
        {
          quoteDocumentId,
          quoteRequestId: built.quoteRequest.sourceId,
          fiscalYear: built.quote.auditEvaluation.fiscalYear,
          templateVersion: {
            id: "partner.audit-quote",
            version: 1,
          },
          normalizedPayload: built.quote.auditEvaluation.trustedPayload,
        },
        signingSecret,
      );
      const marker = serializeEmbeddedQuoteDocumentIdentity(identity);
      pdfBuffer = embedAuditQuoteIdentityMarker(pdfBuffer, marker);
      const repository = new FirestoreStandardQuoteDocumentRepository();
      const existing = await repository.get(identity.quoteDocumentId);
      if (
        existing &&
        (existing.status !== "ACTIVE" ||
          existing.quoteRequestId !== built.quoteRequest.sourceId ||
          existing.payloadChecksum !== identity.payloadChecksum ||
          existing.integrityToken !== identity.integrityToken)
      ) {
        throw new Error("standard_quote_identity_conflict");
      }
      const registered = existing
        ? { record: existing }
        : await new StandardQuoteDocumentService(
            repository,
            signingSecret,
          ).registerStandardQuoteDocument({
            quoteDocumentId: identity.quoteDocumentId,
            quoteRequestId: built.quoteRequest.sourceId,
            fiscalYear: built.quote.auditEvaluation.fiscalYear,
            templateVersion: identity.templateVersion,
            documentFormat: "PDF",
            normalizedPayload: built.quote.auditEvaluation.trustedPayload,
            originalDocumentBytes: pdfBuffer,
            registeredAt: new Date().toISOString(),
            registeredBy: {
              type: "SYSTEM",
              service:
                actor.mode === "admin_proxy"
                  ? "admin-proxy-quote-finalization"
                  : "partner-quote-finalization",
            },
          });
      quoteWithStandardDocument = {
        ...built.quote,
        auditEvaluation: {
          ...built.quote.auditEvaluation,
          standardQuoteDocumentId: registered.record.quoteDocumentId,
        },
      };
    } catch {
      return {
        ok: false as const,
        error: "audit_evaluation_registration_failed",
        status: 503,
      };
    }
  }

  const pdfPath = await saveQuotePdf({
    quoteId: quoteWithStandardDocument.id,
    version: quoteWithStandardDocument.version,
    buffer: pdfBuffer,
    storageKey: randomUUID(),
  });
  const now = new Date().toISOString();
  const pdfFileName = quotePdfFileNameFromRecords(
    quoteWithStandardDocument,
    built.quoteRequest,
  );
  const previousSentQuotes = input.previousVersions
    .filter((quote) => ["finalized", "delivered"].includes(quote.status))
    .sort((left, right) => Number(right.version) - Number(left.version));
  const supersededQuote = previousSentQuotes[0] ?? null;
  const finalizedQuote = quoteDocumentForPersistence({
    quote: quoteWithStandardDocument,
    pdfPath,
    pdfFileName,
    supersededQuoteId: supersededQuote?.id,
    updatedAt: now,
  });
  const deliveryId = `${finalizedQuote.id}_customer`;
  let delivery: QuoteEmailDeliveryRecord = {
    id: deliveryId,
    quoteId: finalizedQuote.id,
    quoteRequestId: finalizedQuote.quoteRequestId,
    auditQuoteRequestId:
      built.quoteRequest.sourceType === "audit_quote"
        ? built.quoteRequest.sourceId
        : undefined,
    purpose: "quote",
    accountEmail: finalizedQuote.customerEmail,
    recipientEmail: finalizedQuote.customerEmail,
    status: "pending",
    provider: "local",
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  let deliveryResult: {
    status: "sent" | "failed";
    error?: "email_not_configured" | "email_send_failed";
  } = { status: "failed", error: "email_send_failed" };

  let commitResult: "committed" | "duplicate" | "permission_denied";
  try {
    commitResult = await db.runTransaction(async (transaction) => {
      const quoteRef = db.collection("quotes").doc(finalizedQuote.id);
      const assignmentRef = db.collection("quoteAssignments").doc(assignmentId);
      const quoteRequestRef = db
        .collection("quoteRequests")
        .doc(finalizedQuote.quoteRequestId);
      const [existingQuote, currentAssignment, currentQuoteRequest] =
        await Promise.all([
          transaction.get(quoteRef),
          transaction.get(assignmentRef),
          transaction.get(quoteRequestRef),
        ]);
      if (existingQuote.exists) return "duplicate" as const;
      if (!currentAssignment.exists || !currentQuoteRequest.exists) {
        return "permission_denied" as const;
      }
      if (
        !canPartnerFinalizeQuoteAssignment({
          authenticatedPartnerId: finalizedQuote.partnerId,
          assignment: currentAssignment.data() as QuoteAssignmentRecord,
          quoteRequest: currentQuoteRequest.data() as QuoteRequestRecord,
        })
      ) {
        return "permission_denied" as const;
      }

      transaction.set(quoteRef, withoutUndefined(finalizedQuote));
      for (const prior of previousSentQuotes) {
        transaction.set(
          db.collection("quotes").doc(prior.id),
          {
            status: "void",
            voidedAt: now,
            voidReason: "superseded_by_revision",
            updatedAt: now,
          } satisfies Partial<QuoteRecord>,
          { merge: true },
        );
      }
      const currentRequest =
        currentQuoteRequest.data() as QuoteRequestRecord;
      const currentSubmittedCount = Number(
        currentRequest.submittedQuoteCount ?? 0,
      );
      transaction.set(
        assignmentRef,
        { status: "finalized", updatedAt: now } satisfies Partial<QuoteAssignmentRecord>,
        { merge: true },
      );
      transaction.set(
        quoteRequestRef,
        {
          status: "quoted",
          submittedQuoteCount:
            previousSentQuotes.length > 0
              ? Math.max(currentSubmittedCount, 1)
              : currentSubmittedCount + 1,
          updatedAt: now,
        } satisfies Partial<QuoteRequestRecord>,
        { merge: true },
      );
      transaction.set(
        db.collection("quoteEmailDeliveries").doc(deliveryId),
        withoutUndefined(delivery),
      );
      const evaluationDefaults = finalizedQuote.nhAuditV2?.submission
        ? extractNhAuditEvaluationDefaults(
            valuesFromNhAuditSubmission(finalizedQuote.nhAuditV2.submission),
          )
        : null;
      if (evaluationDefaults) {
        transaction.set(
          db.collection("partners").doc(finalizedQuote.partnerId),
          withoutUndefined({
            nhAuditEvaluationDefaults: evaluationDefaults,
            updatedAt: now,
          } satisfies Partial<PartnerRecord>),
          { merge: true },
        );
      }
      writeAuditLog(transaction, db, {
        actorUid: actor.uid,
        actorEmail: actor.email,
        action: "quote.finalized",
        targetType: "quote",
        targetId: finalizedQuote.id,
        metadata: {
          quoteRequestId: finalizedQuote.quoteRequestId,
          totalAmount: finalizedQuote.totalAmount,
          sendMode: actor.mode,
          ...(actor.mode === "admin_proxy" ? { sentByAdminUid: actor.uid } : {}),
        },
        createdAt: now,
      });
      return "committed" as const;
    });
  } catch (error) {
    console.error("quote_persistence_failed", error);
    await deleteQuotePdf(pdfPath).catch(() => undefined);
    return { ok: false as const, error: "quote_persistence_failed", status: 500 };
  }
  if (commitResult !== "committed") {
    await deleteQuotePdf(pdfPath).catch(() => undefined);
    return {
      ok: false as const,
      error:
        commitResult === "duplicate"
          ? "duplicate_quote_submission"
          : "permission_denied",
      status: commitResult === "duplicate" ? 409 : 403,
    };
  }

  try {
    const emailContent = await buildCustomerQuoteEmail({
      db,
      quote: finalizedQuote,
      copy: quoteDocumentContent.copy,
    });
    const sent = await sendCustomerQuoteTransactionalEmail({
      db,
      quote: finalizedQuote,
      ...emailContent,
      attachments: [{ filename: pdfFileName, content: pdfBuffer }],
      idempotencyKey: `quote/${finalizedQuote.id}/customer`,
    });
    if (sent.provider === "local") {
      throw new Error("resend_not_configured");
    }
    delivery = {
      ...delivery,
      status: "sent",
      provider: sent.provider,
      providerMessageId: sent.id,
      recipientEmail: sent.recipientEmail,
      ccEmails: sent.ccEmails,
      attemptCount: 1,
      sentAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db
      .collection("quoteEmailDeliveries")
      .doc(deliveryId)
      .set(delivery, { merge: true });
    await db.collection("quotes").doc(finalizedQuote.id).set(
      {
        status: "delivered",
        deliveredAt: delivery.sentAt,
        updatedAt: delivery.updatedAt,
      } satisfies Partial<QuoteRecord>,
      { merge: true },
    );
    if (built.quoteRequest.sourceType === "audit_quote") {
      await db
        .collection(AUDIT_QUOTE_REQUESTS)
        .doc(built.quoteRequest.sourceId)
        .set(
          {
            status: "delivered",
            quoteCount: Math.max(
              Number(built.quoteRequest.expectedQuoteCount ?? 0),
              Number(built.quoteRequest.submittedQuoteCount ?? 0) + 1,
              1,
            ),
            updatedAt: delivery.updatedAt,
          },
          { merge: true },
        );
    }
    deliveryResult = { status: "sent" };
  } catch (error) {
    const rawMessage =
      error instanceof Error ? error.message : "send_failed";
    const message = [
      "resend_not_configured",
      "production_email_from_not_configured",
    ].includes(rawMessage)
      ? rawMessage
      : "email_send_failed";
    await db.collection("quoteEmailDeliveries").doc(deliveryId).set(
      {
        status: "failed",
        attemptCount: 1,
        lastError: message,
        updatedAt: new Date().toISOString(),
      } satisfies Partial<QuoteEmailDeliveryRecord>,
      { merge: true },
    );
    deliveryResult = {
      status: "failed",
      error: [
        "resend_not_configured",
        "production_email_from_not_configured",
      ].includes(message)
        ? "email_not_configured"
        : "email_send_failed",
    };
  }

  return {
    ok: true as const,
    quote: finalizedQuote,
    delivery: deliveryResult,
  };
}

export async function deliverExistingQuoteToCustomer(input: {
  db: Firestore;
  quote: QuoteRecord;
  quoteRequest: QuoteRequestRecord;
}) {
  const pdfBuffer = await readQuotePdfBuffer(input.quote.pdfPath);
  if (!pdfBuffer) {
    return {
      ok: false as const,
      error: "quote_pdf_missing",
    };
  }
  const quoteDocumentContent = await getPublishedQuoteDocumentContentForPartner(
    {
      db: input.db,
      partnerId: input.quote.partnerId,
      cmsContent: (await loadPublishedCmsPage("partner.portal")).content,
    },
  );
  const pdfFileName =
    input.quote.pdfFileName ||
    quotePdfFileNameFromRecords(input.quote, input.quoteRequest);
  const deliveryId = `${input.quote.id}_customer`;
  const existingDelivery = await input.db
    .collection("quoteEmailDeliveries")
    .doc(deliveryId)
    .get();
  const previous = existingDelivery.exists
    ? (existingDelivery.data() as QuoteEmailDeliveryRecord)
    : null;
  const attemptCount = Number(previous?.attemptCount ?? 0) + 1;
  try {
    const emailContent = await buildCustomerQuoteEmail({
      db: input.db,
      quote: input.quote,
      copy: quoteDocumentContent.copy,
    });
    const sent = await sendCustomerQuoteTransactionalEmail({
      db: input.db,
      quote: input.quote,
      ...emailContent,
      attachments: [{ filename: pdfFileName, content: pdfBuffer }],
      idempotencyKey: `quote/${input.quote.id}/customer/retry/${randomUUID()}`,
    });
    if (sent.provider === "local") {
      throw new Error("resend_not_configured");
    }
    const now = new Date().toISOString();
    await input.db.collection("quoteEmailDeliveries").doc(deliveryId).set(
      {
        id: deliveryId,
        quoteId: input.quote.id,
        quoteRequestId: input.quote.quoteRequestId,
        auditQuoteRequestId:
          input.quoteRequest.sourceType === "audit_quote"
            ? input.quoteRequest.sourceId
            : undefined,
        purpose: "quote",
        accountEmail: input.quote.customerEmail,
        recipientEmail: sent.recipientEmail,
        ccEmails: sent.ccEmails,
        status: "sent",
        provider: sent.provider,
        providerMessageId: sent.id,
        attemptCount,
        sentAt: now,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        lastError: "",
      } satisfies QuoteEmailDeliveryRecord,
      { merge: true },
    );
    await input.db.collection("quotes").doc(input.quote.id).set(
      {
        status: "delivered",
        deliveredAt: now,
        updatedAt: now,
      } satisfies Partial<QuoteRecord>,
      { merge: true },
    );
    if (input.quoteRequest.sourceType === "audit_quote") {
      await input.db
        .collection(AUDIT_QUOTE_REQUESTS)
        .doc(input.quoteRequest.sourceId)
        .set(
          {
            status: "delivered",
            updatedAt: now,
          },
          { merge: true },
        );
    }
    return { ok: true as const, delivery: { status: "sent" as const } };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "send_failed";
    const message = [
      "resend_not_configured",
      "production_email_from_not_configured",
    ].includes(rawMessage)
      ? rawMessage
      : "email_send_failed";
    await input.db.collection("quoteEmailDeliveries").doc(deliveryId).set(
      {
        status: "failed",
        attemptCount,
        lastError: message,
        updatedAt: new Date().toISOString(),
      } satisfies Partial<QuoteEmailDeliveryRecord>,
      { merge: true },
    );
    return {
      ok: false as const,
      error: [
        "resend_not_configured",
        "production_email_from_not_configured",
      ].includes(message)
        ? "email_not_configured"
        : "email_send_failed",
    };
  }
}

export function isQuoteEmailReady() {
  return getTransactionalEmailConfigurationError() ? false : true;
}
