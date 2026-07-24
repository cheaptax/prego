import type { Firestore, Transaction } from "firebase-admin/firestore";
import { AUDIT_EVALUATION_COLLECTIONS } from "@/lib/audit-evaluation/collections";
import { evaluationConfigSchema } from "@/lib/audit-evaluation/schemas";
import { assertAuditEvaluationStatusTransition } from "@/lib/audit-evaluation/status";
import type {
  AuditEvaluationActor,
  AuditEvaluationCase,
  EvaluationConfig,
  NormalizedAuditQuote,
  QuoteParsingQueueRecord,
  QuoteUploadIntent,
  UploadedQuoteDocument,
  VersionReference,
} from "@/lib/audit-evaluation/types";
import {
  quoteParsingQueueRecordSchema,
  quoteUploadIntentSchema,
  uploadedQuoteDocumentSchema,
} from "@/lib/audit-evaluation/upload-schemas";
import { adminDb } from "@/lib/firebase/admin";

export type FinalizeUploadRepositoryResult =
  | { kind: "completed"; document: UploadedQuoteDocument }
  | { kind: "duplicate"; existingDocumentId: string };

export interface AuditEvaluationUploadRepository {
  getConfig(reference: VersionReference): Promise<EvaluationConfig | null>;
  createOrGetIntent(
    value: QuoteUploadIntent,
    maximumQuoteCount: number,
    now: string,
  ): Promise<{ intent: QuoteUploadIntent; replayed: boolean }>;
  getIntent(
    caseId: string,
    intentId: string,
  ): Promise<QuoteUploadIntent | null>;
  markIntentFinalizing(
    caseId: string,
    intentId: string,
    now: string,
  ): Promise<QuoteUploadIntent>;
  markIntentFailed(
    caseId: string,
    intentId: string,
    failureCode: string,
    now: string,
  ): Promise<void>;
  findDuplicate(
    caseId: string,
    sha256: string,
    matchedQuoteDocumentId: string | null,
  ): Promise<UploadedQuoteDocument | null>;
  finalizeDocument(input: {
    intent: QuoteUploadIntent;
    document: UploadedQuoteDocument;
    queue: QuoteParsingQueueRecord;
    normalizedQuote: NormalizedAuditQuote | null;
    now: string;
  }): Promise<FinalizeUploadRepositoryResult>;
  listDocuments(caseId: string): Promise<UploadedQuoteDocument[]>;
  getDocument(
    caseId: string,
    documentId: string,
  ): Promise<UploadedQuoteDocument | null>;
  deleteDocument(input: {
    caseId: string;
    documentId: string;
    deletedAt: string;
    deletedBy: AuditEvaluationActor;
  }): Promise<UploadedQuoteDocument | null>;
}

export class FirestoreAuditEvaluationUploadRepository
  implements AuditEvaluationUploadRepository
{
  private readonly db: Firestore;

  constructor(db: Firestore = adminDb()) {
    this.db = db;
  }

  async getConfig(reference: VersionReference) {
    const snapshot = await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.configVersions)
      .get();
    for (const document of snapshot.docs) {
      const parsed = evaluationConfigSchema.safeParse(document.data());
      if (
        parsed.success &&
        parsed.data.id === reference.id &&
        parsed.data.version === reference.version
      ) {
        return parsed.data;
      }
    }
    return null;
  }

  async createOrGetIntent(
    value: QuoteUploadIntent,
    maximumQuoteCount: number,
    now: string,
  ) {
    const parsed = quoteUploadIntentSchema.parse(value);
    return this.db.runTransaction(async (transaction) => {
      const caseRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.cases)
        .doc(parsed.caseId);
      const intentRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.uploadIntents)
        .doc(parsed.id);
      const [caseSnapshot, existingIntent, documentSnapshot, intentSnapshot] =
        await Promise.all([
          transaction.get(caseRef),
          transaction.get(intentRef),
          transaction.get(
            this.db
              .collection(AUDIT_EVALUATION_COLLECTIONS.documents)
              .where("caseId", "==", parsed.caseId),
          ),
          transaction.get(
            this.db
              .collection(AUDIT_EVALUATION_COLLECTIONS.uploadIntents)
              .where("caseId", "==", parsed.caseId),
          ),
        ]);
      if (!caseSnapshot.exists) throw new Error("case_not_found");
      const evaluationCase =
        caseSnapshot.data() as AuditEvaluationCase;
      assertCaseAcceptsUploads(evaluationCase, now);

      if (existingIntent.exists) {
        const current = quoteUploadIntentSchema.parse(
          existingIntent.data(),
        );
        if (
          current.idempotencyKeyHash !== parsed.idempotencyKeyHash ||
          current.safeDisplayName !== parsed.safeDisplayName ||
          current.mimeType !== parsed.mimeType ||
          current.declaredSize !== parsed.declaredSize
        ) {
          throw new Error("idempotency_conflict");
        }
        return { intent: current, replayed: true };
      }

      const activeDocuments = documentSnapshot.docs.filter((document) => {
        const candidate = uploadedQuoteDocumentSchema.safeParse(
          document.data(),
        );
        return (
          candidate.success &&
          candidate.data.uploadStatus !== "DELETED"
        );
      }).length;
      const activeIntents = intentSnapshot.docs.filter((document) => {
        const candidate = quoteUploadIntentSchema.safeParse(
          document.data(),
        );
        return (
          candidate.success &&
          ["PENDING", "UPLOADED", "FINALIZING"].includes(
            candidate.data.status,
          ) &&
          Date.parse(candidate.data.expiresAt) > Date.parse(now)
        );
      }).length;
      if (activeDocuments + activeIntents >= maximumQuoteCount) {
        throw new Error("too_many_files");
      }

      transaction.create(intentRef, parsed);
      if (evaluationCase.status === "ACCESS_PENDING") {
        assertAuditEvaluationStatusTransition(
          evaluationCase.status,
          "UPLOADING",
        );
        transaction.set(
          caseRef,
          { status: "UPLOADING", updatedAt: now },
          { merge: true },
        );
      }
      return { intent: parsed, replayed: false };
    });
  }

  async getIntent(caseId: string, intentId: string) {
    const snapshot = await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.uploadIntents)
      .doc(intentId)
      .get();
    if (!snapshot.exists) return null;
    const parsed = quoteUploadIntentSchema.safeParse(snapshot.data());
    return parsed.success && parsed.data.caseId === caseId
      ? parsed.data
      : null;
  }

  async markIntentFinalizing(
    caseId: string,
    intentId: string,
    now: string,
  ) {
    const ref = this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.uploadIntents)
      .doc(intentId);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error("upload_intent_not_found");
      const intent = quoteUploadIntentSchema.parse(snapshot.data());
      if (intent.caseId !== caseId) throw new Error("wrong_case");
      if (intent.status === "COMPLETED") return intent;
      if (Date.parse(intent.expiresAt) <= Date.parse(now)) {
        const expired = quoteUploadIntentSchema.parse({
          ...intent,
          status: "EXPIRED",
          scanStatus: "REJECTED",
          failureCode: "upload_intent_expired",
          completedAt: now,
        });
        transaction.set(
          ref,
          expired,
        );
        return expired;
      }
      if (!["PENDING", "UPLOADED", "FINALIZING"].includes(intent.status)) {
        throw new Error(intent.failureCode ?? "upload_intent_failed");
      }
      const finalizing = quoteUploadIntentSchema.parse({
        ...intent,
        status: "FINALIZING",
        failureCode: null,
      });
      transaction.set(ref, finalizing);
      return finalizing;
    });
  }

  async markIntentFailed(
    caseId: string,
    intentId: string,
    failureCode: string,
    now: string,
  ) {
    const ref = this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.uploadIntents)
      .doc(intentId);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return;
      const intent = quoteUploadIntentSchema.safeParse(snapshot.data());
      if (!intent.success || intent.data.caseId !== caseId) return;
      transaction.set(
        ref,
        {
          status: "FAILED",
          scanStatus: "REJECTED",
          failureCode: failureCode.slice(0, 100),
          completedAt: now,
        },
        { merge: true },
      );
    });
  }

  async findDuplicate(
    caseId: string,
    sha256: string,
    matchedQuoteDocumentId: string | null,
  ) {
    const snapshot = await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.documents)
      .where("caseId", "==", caseId)
      .get();
    for (const document of snapshot.docs) {
      const parsed = uploadedQuoteDocumentSchema.safeParse(
        document.data(),
      );
      if (
        parsed.success &&
        parsed.data.uploadStatus !== "DELETED" &&
        (parsed.data.sha256 === sha256 ||
          (matchedQuoteDocumentId &&
            parsed.data.matchedQuoteDocumentId ===
              matchedQuoteDocumentId))
      ) {
        return parsed.data;
      }
    }
    return null;
  }

  async finalizeDocument(input: {
    intent: QuoteUploadIntent;
    document: UploadedQuoteDocument;
    queue: QuoteParsingQueueRecord;
    normalizedQuote: NormalizedAuditQuote | null;
    now: string;
  }): Promise<FinalizeUploadRepositoryResult> {
    const intent = quoteUploadIntentSchema.parse(input.intent);
    const document = uploadedQuoteDocumentSchema.parse(input.document);
    const queue = quoteParsingQueueRecordSchema.parse(input.queue);
    return this.db.runTransaction(async (transaction) => {
      const intentRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.uploadIntents)
        .doc(intent.id);
      const documentRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.documents)
        .doc(document.id);
      const queueRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.parsingQueue)
        .doc(queue.id);
      const normalizedQuoteRef = input.normalizedQuote
        ? this.db
            .collection(
              AUDIT_EVALUATION_COLLECTIONS.normalizedQuotes,
            )
            .doc(input.normalizedQuote.quoteId)
        : null;
      const [intentSnapshot, existingDocument, documentSnapshot] =
        await Promise.all([
          transaction.get(intentRef),
          transaction.get(documentRef),
          transaction.get(
            this.db
              .collection(AUDIT_EVALUATION_COLLECTIONS.documents)
              .where("caseId", "==", intent.caseId),
          ),
        ]);
      if (!intentSnapshot.exists) {
        throw new Error("upload_intent_not_found");
      }
      const storedIntent = quoteUploadIntentSchema.parse(
        intentSnapshot.data(),
      );
      if (storedIntent.status === "COMPLETED" && existingDocument.exists) {
        return {
          kind: "completed",
          document: uploadedQuoteDocumentSchema.parse(
            existingDocument.data(),
          ),
        };
      }

      const duplicate = documentSnapshot.docs
        .flatMap((candidate) => {
          const parsed = uploadedQuoteDocumentSchema.safeParse(
            candidate.data(),
          );
          return parsed.success ? [parsed.data] : [];
        })
        .find(
          (candidate) =>
            candidate.id !== document.id &&
            candidate.uploadStatus !== "DELETED" &&
            (candidate.sha256 === document.sha256 ||
              (document.matchedQuoteDocumentId &&
                candidate.matchedQuoteDocumentId ===
                  document.matchedQuoteDocumentId)),
        );
      if (duplicate) {
        transaction.set(
          intentRef,
          {
            status: "FAILED",
            scanStatus: "REJECTED",
            failureCode: "duplicate_document",
            completedAt: input.now,
          },
          { merge: true },
        );
        return {
          kind: "duplicate",
          existingDocumentId: duplicate.id,
        };
      }
      transaction.create(documentRef, document);
      transaction.create(queueRef, queue);
      if (normalizedQuoteRef && input.normalizedQuote) {
        transaction.set(normalizedQuoteRef, input.normalizedQuote);
      }
      transaction.set(
        intentRef,
        {
          status: "COMPLETED",
          scanStatus: document.scanStatus,
          failureCode: null,
          completedAt: input.now,
        },
        { merge: true },
      );
      createUploadAuditLog(transaction, this.db, {
        caseId: document.caseId,
        documentId: document.id,
        action: "QUOTE_DOCUMENT_UPLOADED",
        actor: document.uploadedBy,
        occurredAt: input.now,
        detail: "upload_completed",
      });
      return { kind: "completed", document };
    });
  }

  async listDocuments(caseId: string) {
    const snapshot = await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.documents)
      .where("caseId", "==", caseId)
      .get();
    return snapshot.docs
      .flatMap((document) => {
        const parsed = uploadedQuoteDocumentSchema.safeParse(
          document.data(),
        );
        return parsed.success &&
          parsed.data.uploadStatus !== "DELETED"
          ? [parsed.data]
          : [];
      })
      .sort((left, right) =>
        left.uploadedAt.localeCompare(right.uploadedAt),
      );
  }

  async getDocument(caseId: string, documentId: string) {
    const snapshot = await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.documents)
      .doc(documentId)
      .get();
    if (!snapshot.exists) return null;
    const parsed = uploadedQuoteDocumentSchema.safeParse(
      snapshot.data(),
    );
    return parsed.success &&
      parsed.data.caseId === caseId &&
      parsed.data.uploadStatus !== "DELETED"
      ? parsed.data
      : null;
  }

  async deleteDocument(input: {
    caseId: string;
    documentId: string;
    deletedAt: string;
    deletedBy: AuditEvaluationActor;
  }) {
    const documentRef = this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.documents)
      .doc(input.documentId);
    const queueRef = this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.parsingQueue)
      .doc(`apq_${input.documentId}`);
    return this.db.runTransaction(async (transaction) => {
      const [snapshot, queueSnapshot] = await Promise.all([
        transaction.get(documentRef),
        transaction.get(queueRef),
      ]);
      if (!snapshot.exists) return null;
      const document = uploadedQuoteDocumentSchema.safeParse(
        snapshot.data(),
      );
      if (
        !document.success ||
        document.data.caseId !== input.caseId
      ) {
        return null;
      }
      if (document.data.uploadStatus === "DELETED") {
        return document.data;
      }
      const updated = uploadedQuoteDocumentSchema.parse({
        ...document.data,
        uploadStatus: "DELETED",
        deletedAt: input.deletedAt,
        deletedBy: input.deletedBy,
      });
      transaction.set(documentRef, updated);
      if (queueSnapshot.exists) {
        transaction.set(
          queueRef,
          {
            status: "CANCELLED",
            updatedAt: input.deletedAt,
          },
          { merge: true },
        );
      }
      createUploadAuditLog(transaction, this.db, {
        caseId: input.caseId,
        documentId: input.documentId,
        action: "QUOTE_DOCUMENT_DELETED",
        actor: input.deletedBy,
        occurredAt: input.deletedAt,
        detail: "document_deleted",
      });
      return updated;
    });
  }
}

function createUploadAuditLog(
  transaction: Transaction,
  db: Firestore,
  input: {
    caseId: string;
    documentId: string;
    action: string;
    actor: AuditEvaluationActor;
    occurredAt: string;
    detail: string;
  },
) {
  const reference = db
    .collection(AUDIT_EVALUATION_COLLECTIONS.auditLogs)
    .doc();
  transaction.create(reference, {
    id: reference.id,
    caseId: input.caseId,
    reportVersion: null,
    documentId: input.documentId,
    action: input.action,
    actor: input.actor,
    occurredAt: input.occurredAt,
    detail: input.detail,
    errorCode: null,
    retryCount: null,
  });
}

function assertCaseAcceptsUploads(
  evaluationCase: AuditEvaluationCase,
  now: string,
) {
  if (
    !["ACCESS_PENDING", "UPLOADING", "NEEDS_REVIEW"].includes(
      evaluationCase.status,
    ) ||
    Date.parse(evaluationCase.expiresAt) <= Date.parse(now)
  ) {
    throw new Error("case_not_uploadable");
  }
}
