import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { AUDIT_EVALUATION_COLLECTIONS } from "@/lib/audit-evaluation/collections";
import { normalizedAuditQuoteSchema } from "@/lib/audit-evaluation/quote-extraction-schemas";
import { standardQuoteDocumentRecordSchema } from "@/lib/audit-evaluation/quote-document-schemas";
import { evaluationConfigSchema } from "@/lib/audit-evaluation/schemas";
import { canTransitionAuditEvaluationStatus } from "@/lib/audit-evaluation/status";
import type {
  AuditEvaluationCase,
  EvaluationConfig,
  NormalizedAuditQuote,
  QuoteExtractionRunRecord,
  StandardQuoteDocumentRecord,
  UploadedQuoteDocument,
} from "@/lib/audit-evaluation/types";
import {
  quoteParsingQueueRecordSchema,
  uploadedQuoteDocumentSchema,
} from "@/lib/audit-evaluation/upload-schemas";
import { adminDb } from "@/lib/firebase/admin";

export type AuditEvaluationParsingContext = {
  evaluationCase: AuditEvaluationCase;
  document: UploadedQuoteDocument;
  config: EvaluationConfig;
  trustedRecord: StandardQuoteDocumentRecord | null;
  otherQuotes: NormalizedAuditQuote[];
};

export interface AuditEvaluationParsingRepository {
  claimDocument(
    caseId: string,
    documentId: string,
    now: string,
  ): Promise<boolean>;
  loadContext(
    caseId: string,
    documentId: string,
  ): Promise<AuditEvaluationParsingContext | null>;
  saveResult(input: {
    context: AuditEvaluationParsingContext;
    quote: NormalizedAuditQuote | null;
    run: QuoteExtractionRunRecord;
    parsingStatus: UploadedQuoteDocument["parsingStatus"];
    queueStatus: "COMPLETED" | "PENDING_REVIEW" | "FAILED";
    errorCode: string | null;
    now: string;
  }): Promise<void>;
}

export class FirestoreAuditEvaluationParsingRepository
implements AuditEvaluationParsingRepository {
  private readonly db: Firestore;

  constructor(db: Firestore = adminDb()) {
    this.db = db;
  }

  async claimDocument(caseId: string, documentId: string, now: string) {
    return this.db.runTransaction(async (transaction) => {
      const documentRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.documents)
        .doc(documentId);
      const queueRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.parsingQueue)
        .doc(`apq_${documentId}`);
      const runRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.extractionRuns)
        .doc(`aer_${documentId}`);
      const [documentSnapshot, queueSnapshot] = await Promise.all([
        transaction.get(documentRef),
        transaction.get(queueRef),
      ]);
      const document = uploadedQuoteDocumentSchema.safeParse(
        documentSnapshot.data(),
      );
      const queue = quoteParsingQueueRecordSchema.safeParse(
        queueSnapshot.data(),
      );
      if (
        !document.success ||
        !queue.success ||
        document.data.caseId !== caseId ||
        document.data.scanStatus !== "CLEAN" ||
        queue.data.caseId !== caseId ||
        document.data.uploadStatus === "DELETED" ||
        !["PENDING", "NEEDS_REVIEW", "FAILED"].includes(
          document.data.parsingStatus,
        ) ||
        !["PENDING", "PENDING_REVIEW", "FAILED"].includes(
          queue.data.status,
        )
      ) {
        return false;
      }
      transaction.set(
        documentRef,
        { parsingStatus: "PARSING" },
        { merge: true },
      );
      transaction.set(
        queueRef,
        {
          status: "PROCESSING",
          attempts: queue.data.attempts + 1,
          updatedAt: now,
          lastErrorCode: null,
        },
        { merge: true },
      );
      transaction.set(runRef, {
        id: `aer_${documentId}`,
        caseId,
        documentId,
        status: "PROCESSING",
        sourceOrder: [],
        aiMetadata: null,
        warningCodes: [],
        failureCode: null,
        startedAt: now,
        completedAt: null,
      } satisfies QuoteExtractionRunRecord);
      return true;
    });
  }

  async loadContext(caseId: string, documentId: string) {
    const caseRef = this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.cases)
      .doc(caseId);
    const documentRef = this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.documents)
      .doc(documentId);
    const [caseSnapshot, documentSnapshot, configSnapshot, quoteSnapshot] =
      await Promise.all([
        caseRef.get(),
        documentRef.get(),
        this.db
          .collection(AUDIT_EVALUATION_COLLECTIONS.configVersions)
          .get(),
        this.db
          .collection(AUDIT_EVALUATION_COLLECTIONS.normalizedQuotes)
          .where("caseId", "==", caseId)
          .get(),
      ]);
    if (!caseSnapshot.exists) return null;
    const evaluationCase = caseSnapshot.data() as AuditEvaluationCase;
    const document = uploadedQuoteDocumentSchema.safeParse(
      documentSnapshot.data(),
    );
    if (
      !document.success ||
      document.data.caseId !== caseId ||
      document.data.uploadStatus === "DELETED"
    ) {
      return null;
    }
    const config = configSnapshot.docs
      .map((snapshot) => evaluationConfigSchema.safeParse(snapshot.data()))
      .find(
        (candidate) =>
          candidate.success &&
          candidate.data.id === evaluationCase.evaluationConfigVersion.id &&
          candidate.data.version ===
            evaluationCase.evaluationConfigVersion.version,
      );
    if (!config?.success) return null;
    const otherQuotes = quoteSnapshot.docs.flatMap((snapshot) => {
      const parsed = normalizedAuditQuoteSchema.safeParse(snapshot.data());
      return parsed.success ? [parsed.data] : [];
    });
    const trustedRecord = document.data.matchedQuoteDocumentId
      ? await this.loadTrustedRecord(document.data.matchedQuoteDocumentId)
      : null;
    return {
      evaluationCase,
      document: document.data,
      config: config.data,
      trustedRecord,
      otherQuotes,
    };
  }

  async saveResult(input: {
    context: AuditEvaluationParsingContext;
    quote: NormalizedAuditQuote | null;
    run: QuoteExtractionRunRecord;
    parsingStatus: UploadedQuoteDocument["parsingStatus"];
    queueStatus: "COMPLETED" | "PENDING_REVIEW" | "FAILED";
    errorCode: string | null;
    now: string;
  }) {
    const quote = input.quote
      ? normalizedAuditQuoteSchema.parse(input.quote)
      : null;
    await this.db.runTransaction(async (transaction) => {
      const documentRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.documents)
        .doc(input.context.document.id);
      const queueRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.parsingQueue)
        .doc(`apq_${input.context.document.id}`);
      const runRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.extractionRuns)
        .doc(input.run.id);
      const caseRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.cases)
        .doc(input.context.evaluationCase.id);
      const [documentSnapshot, caseSnapshot] = await Promise.all([
        transaction.get(documentRef),
        transaction.get(caseRef),
      ]);
      const document = uploadedQuoteDocumentSchema.safeParse(
        documentSnapshot.data(),
      );
      if (
        !document.success ||
        document.data.caseId !== input.context.evaluationCase.id ||
        document.data.uploadStatus === "DELETED"
      ) {
        return;
      }
      transaction.set(
        documentRef,
        { parsingStatus: input.parsingStatus },
        { merge: true },
      );
      transaction.set(
        queueRef,
        {
          status: input.queueStatus,
          updatedAt: input.now,
          lastErrorCode: input.errorCode,
        },
        { merge: true },
      );
      transaction.set(runRef, input.run);
      if (quote) {
        transaction.set(
          this.db
            .collection(AUDIT_EVALUATION_COLLECTIONS.normalizedQuotes)
            .doc(quote.quoteId),
          quote,
        );
      }
      if (input.queueStatus !== "COMPLETED" && caseSnapshot.exists) {
        const current = caseSnapshot.data() as AuditEvaluationCase;
        if (
          current.status !== "NEEDS_REVIEW" &&
          canTransitionAuditEvaluationStatus(current.status, "NEEDS_REVIEW")
        ) {
          transaction.set(
            caseRef,
            { status: "NEEDS_REVIEW", updatedAt: input.now },
            { merge: true },
          );
        }
      }
      const logRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.auditLogs)
        .doc();
      transaction.create(logRef, {
        id: logRef.id,
        caseId: input.context.evaluationCase.id,
        reportVersion: null,
        documentId: input.context.document.id,
        action: input.errorCode
          ? "QUOTE_EXTRACTION_FAILED"
          : "QUOTE_EXTRACTION_COMPLETED",
        actor: {
          type: "SYSTEM",
          service: "audit-evaluation-parsing",
        },
        occurredAt: input.now,
        detail: input.queueStatus,
        errorCode: input.errorCode,
        retryCount: null,
      });
    });
  }

  private async loadTrustedRecord(quoteDocumentId: string) {
    const snapshot = await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.standardQuoteDocuments)
      .doc(quoteDocumentId)
      .get();
    const parsed = standardQuoteDocumentRecordSchema.safeParse(
      snapshot.data(),
    );
    return parsed.success ? parsed.data : null;
  }
}
