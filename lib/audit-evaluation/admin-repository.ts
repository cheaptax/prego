import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import {
  type AdminAuditEvaluationCaseFilters,
  type AdminAuditEvaluationDetail,
  type AdminAuditEvaluationErrorItem,
  type AdminAuditEvaluationListItem,
  type AdminAuditLogFilters,
  type AdminAuditLogItem,
} from "@/lib/audit-evaluation/admin-types";
import { AUDIT_EVALUATION_COLLECTIONS } from "@/lib/audit-evaluation/collections";
import { AuditEvaluationCustomerAccessService } from "@/lib/audit-evaluation/customer-access-service";
import { normalizedAuditQuoteSchema } from "@/lib/audit-evaluation/quote-extraction-schemas";
import { isQuoteFieldPresent } from "@/lib/audit-evaluation/review-readiness";
import {
  auditEvaluationCaseRecordSchema,
  auditQuoteCorrectionRecordSchema,
  createAuditEvaluationReportRunId,
  evaluationReportRunRecordSchema,
} from "@/lib/audit-evaluation/review-repository";
import { evaluationConfigSchema } from "@/lib/audit-evaluation/schemas";
import {
  quoteParsingQueueRecordSchema,
  quoteUploadIntentSchema,
  uploadedQuoteDocumentSchema,
} from "@/lib/audit-evaluation/upload-schemas";
import type {
  AuditEvaluationAuditLog,
  AuditEvaluationCase,
  AuditEvaluationConfirmationRecord,
  AuditQuoteCorrectionRecord,
  EvaluationReportRun,
  NormalizedAuditQuote,
  NormalizedAuditQuoteField,
  QuoteEvidenceValue,
  QuoteExtractionRunRecord,
  QuoteParsingQueueRecord,
  UploadedQuoteDocument,
} from "@/lib/audit-evaluation/types";
import {
  NORMALIZED_AUDIT_QUOTE_FIELDS,
  QUOTE_FIELD_SOURCES,
} from "@/lib/audit-evaluation/types";
import { AUDIT_QUOTE_REQUESTS } from "@/lib/audit-quote/collections";
import type { AuditQuoteRequestRecord } from "@/lib/audit-quote/types";
import { adminDb } from "@/lib/firebase/admin";

const MAX_CASES = 250;
const MAX_RELATED_RECORDS = 5_000;
const MAX_DETAIL_RECORDS = 1_000;
const MAX_AUDIT_LOGS = 1_000;

const instantSchema = z.string().datetime({ offset: true });
const actorSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ADMIN"),
    uid: z.string().trim().min(1).max(128),
  }).strict(),
  z.object({
    type: z.literal("CUSTOMER"),
    subjectId: z.string().trim().min(1).max(128),
  }).strict(),
  z.object({
    type: z.literal("SYSTEM"),
    service: z.string().trim().min(1).max(128),
  }).strict(),
]);
const customerActorSchema = z.object({
  type: z.literal("CUSTOMER"),
  subjectId: z.string().trim().min(1).max(128),
}).strict();
const extractionRunSchema: z.ZodType<QuoteExtractionRunRecord> = z.object({
  id: z.string().trim().min(1).max(128),
  caseId: z.string().trim().min(1).max(128),
  documentId: z.string().trim().min(1).max(128),
  status: z.enum(["PROCESSING", "COMPLETED", "NEEDS_REVIEW", "FAILED"]),
  sourceOrder: z.array(z.enum(QUOTE_FIELD_SOURCES)).max(20),
  aiMetadata: z.object({
    model: z.string().max(200),
    promptVersion: z.string().max(200),
    timestamp: instantSchema,
  }).strict().nullable(),
  warningCodes: z.array(z.string().max(100)).max(200),
  failureCode: z.string().max(100).nullable(),
  startedAt: instantSchema,
  completedAt: instantSchema.nullable(),
}).strict();
const confirmationSchema: z.ZodType<AuditEvaluationConfirmationRecord> =
  z.object({
    id: z.string().trim().min(1).max(128),
    caseId: z.string().trim().min(1).max(128),
    version: z.number().int().positive(),
    evaluationConfigSnapshot: evaluationConfigSchema,
    quoteDataSnapshots: z.array(normalizedAuditQuoteSchema).min(1).max(500),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/),
    finalAcknowledged: z.literal(true),
    confirmedBy: customerActorSchema,
    confirmedAt: instantSchema,
  }).strict();
const auditLogSchema: z.ZodType<AuditEvaluationAuditLog> = z.object({
  id: z.string().trim().min(1).max(200),
  caseId: z.string().trim().min(1).max(128).nullable(),
  reportVersion: z.number().int().positive().nullable(),
  documentId: z.string().trim().min(1).max(128).nullable().optional(),
  action: z.string().trim().min(1).max(100),
  actor: actorSchema,
  occurredAt: instantSchema,
  detail: z.string().max(2_000),
  errorCode: z.string().max(100).nullable().optional(),
  retryCount: z.number().int().nonnegative().nullable().optional(),
}).strict();

export class AdminAuditEvaluationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "AdminAuditEvaluationError";
    this.code = code;
  }
}

export function adminAuditEvaluationErrorStatus(error: unknown) {
  const code = adminAuditEvaluationErrorCode(error);
  if (
    code === "case_not_found" ||
    code === "quote_not_found" ||
    code === "document_not_found" ||
    code === "report_not_found"
  ) {
    return 404;
  }
  if (
    code === "version_conflict" ||
    code === "case_not_editable" ||
    code === "reprocess_conflict" ||
    code === "source_version_conflict" ||
    code === "access_version_conflict" ||
    code === "customer_reconfirmation_required" ||
    code === "report_status_conflict" ||
    code === "evidence_limit_reached"
  ) {
    return 409;
  }
  if (code === "payload_too_large") return 413;
  if (code === "data_integrity_error") return 500;
  return 400;
}

export function adminAuditEvaluationErrorCode(error: unknown) {
  if (error instanceof AdminAuditEvaluationError) return error.code;
  return "internal_error";
}

export type SaveAdminCorrectionInput = {
  caseId: string;
  quoteId: string;
  field: NormalizedAuditQuoteField;
  correctedValue: QuoteEvidenceValue;
  reason: string;
  expectedRevision: number;
  actorUid: string;
  now: string;
};

export type ReprocessAdminDocumentInput = {
  caseId: string;
  documentId: string;
  actorUid: string;
  now: string;
};

export type RegenerateAdminReportInput = {
  caseId: string;
  sourceReportVersion: number;
  expectedSourceVersion: number;
  actorUid: string;
  now: string;
};

export type ReissueAdminAccessInput = {
  caseId: string;
  extendDays: number;
  expectedExpiresAt: string;
  actorUid: string;
  now: string;
};

export class FirestoreAuditEvaluationAdminRepository {
  private readonly db: Firestore;
  private readonly accessService?: AuditEvaluationCustomerAccessService;

  constructor(
    db: Firestore = adminDb(),
    accessService?: AuditEvaluationCustomerAccessService,
  ) {
    this.db = db;
    this.accessService = accessService;
  }

  async listCases(filters: AdminAuditEvaluationCaseFilters) {
    const [caseSnapshot, documentSnapshot, quoteSnapshot, reportSnapshot] =
      await Promise.all([
        this.db.collection(AUDIT_EVALUATION_COLLECTIONS.cases)
          .orderBy("updatedAt", "desc").limit(MAX_CASES + 1).get(),
        this.db.collection(AUDIT_EVALUATION_COLLECTIONS.documents)
          .limit(MAX_RELATED_RECORDS).get(),
        this.db.collection(AUDIT_EVALUATION_COLLECTIONS.normalizedQuotes)
          .limit(MAX_RELATED_RECORDS).get(),
        this.db.collection(AUDIT_EVALUATION_COLLECTIONS.reportRuns)
          .limit(MAX_RELATED_RECORDS).get(),
      ]);
    const cases = caseSnapshot.docs.slice(0, MAX_CASES).flatMap((document) => {
      const parsed = auditEvaluationCaseRecordSchema.safeParse(document.data());
      return parsed.success && parsed.data.id === document.id &&
          parsed.data.status !== "DELETED"
        ? [parsed.data]
        : [];
    });
    const caseIds = new Set(cases.map(({ id }) => id));
    const documents = documentSnapshot.docs.flatMap((document) => {
      const parsed = uploadedQuoteDocumentSchema.safeParse(document.data());
      return parsed.success && caseIds.has(parsed.data.caseId)
        ? [parsed.data]
        : [];
    });
    const quotes = quoteSnapshot.docs.flatMap((document) => {
      const parsed = normalizedAuditQuoteSchema.safeParse(document.data());
      return parsed.success && caseIds.has(parsed.data.caseId)
        ? [parsed.data]
        : [];
    });
    const reports = reportSnapshot.docs.flatMap((document) => {
      const parsed = evaluationReportRunRecordSchema.safeParse(document.data());
      return parsed.success && caseIds.has(parsed.data.caseId)
        ? [parsed.data]
        : [];
    });
    return {
      items: filterAdminCaseItems(
        aggregateAdminCaseItems(cases, documents, quotes, reports),
        filters,
      ),
      truncated: caseSnapshot.docs.length > MAX_CASES,
    };
  }

  async getDetail(caseId: string): Promise<AdminAuditEvaluationDetail | null> {
    const caseRef = this.db.collection(AUDIT_EVALUATION_COLLECTIONS.cases)
      .doc(caseId);
    const caseSnapshot = await caseRef.get();
    if (!caseSnapshot.exists) return null;
    const evaluationCase = parseCase(caseSnapshot.data());
    if (evaluationCase.id !== caseId || evaluationCase.status === "DELETED") {
      return null;
    }
    const [
      documentSnapshot,
      quoteSnapshot,
      correctionSnapshot,
      reportSnapshot,
      confirmationSnapshot,
      queueSnapshot,
      extractionSnapshot,
      logSnapshot,
    ] = await Promise.all([
      this.caseQuery(AUDIT_EVALUATION_COLLECTIONS.documents, caseId).get(),
      this.caseQuery(AUDIT_EVALUATION_COLLECTIONS.normalizedQuotes, caseId).get(),
      this.caseQuery(AUDIT_EVALUATION_COLLECTIONS.corrections, caseId).get(),
      this.caseQuery(AUDIT_EVALUATION_COLLECTIONS.reportRuns, caseId).get(),
      this.caseQuery(AUDIT_EVALUATION_COLLECTIONS.confirmations, caseId).get(),
      this.caseQuery(AUDIT_EVALUATION_COLLECTIONS.parsingQueue, caseId).get(),
      this.caseQuery(AUDIT_EVALUATION_COLLECTIONS.extractionRuns, caseId).get(),
      this.caseQuery(AUDIT_EVALUATION_COLLECTIONS.auditLogs, caseId).get(),
    ]);
    const documents = documentSnapshot.docs.map((document) =>
      parseDocumentForCase(document.data(), caseId)
    ).filter(({ uploadStatus }) => uploadStatus !== "DELETED");
    const documentIds = new Set(documents.map(({ id }) => id));
    const quotes = quoteSnapshot.docs.map((document) =>
      parseQuoteForCase(document.data(), caseId)
    ).filter(({ documentId }) => documentIds.has(documentId));
    const quoteIds = new Set(quotes.map(({ quoteId }) => quoteId));
    const corrections = correctionSnapshot.docs.map((document) =>
      parseCorrectionForCase(document.data(), caseId)
    ).filter(({ quoteId }) => quoteIds.has(quoteId))
      .sort((left, right) => left.correctedAt.localeCompare(right.correctedAt));
    const reports = reportSnapshot.docs.map((document) =>
      parseReportForCase(document.data(), caseId)
    ).sort((left, right) => right.reportVersion - left.reportVersion);
    const confirmations = confirmationSnapshot.docs.map((document) =>
      parseConfirmationForCase(document.data(), caseId)
    ).sort((left, right) => right.version - left.version);
    const queues = queueSnapshot.docs.map((document) =>
      parseQueueForCase(document.data(), caseId)
    );
    const extractions = extractionSnapshot.docs.map((document) =>
      parseExtractionForCase(document.data(), caseId)
    );
    const logs = logSnapshot.docs.flatMap((document) => {
      const parsed = auditLogSchema.safeParse(document.data());
      return parsed.success && parsed.data.caseId === caseId
        ? [parsed.data]
        : [];
    });
    const latest = reports.find(
      ({ reportVersion }) =>
        reportVersion === evaluationCase.latestReportVersion,
    ) ?? reports[0] ?? null;
    return {
      case: evaluationCase,
      documents: documents.map((document) => ({
        id: document.id,
        safeDisplayName: document.safeDisplayName,
        uploadStatus: document.uploadStatus,
        scanStatus: document.scanStatus,
        parsingStatus: document.parsingStatus,
        integrityStatus: document.integrityStatus,
        matchStatus: document.matchStatus,
        matchedQuoteDocumentId: document.matchedQuoteDocumentId,
        uploadedAt: document.uploadedAt,
      })),
      normalizedQuotes: quotes.sort((left, right) =>
        left.quoteId.localeCompare(right.quoteId)
      ),
      corrections: {
        customer: corrections.filter(
          ({ source }) => source === "CUSTOMER_CORRECTION",
        ),
        admin: corrections.filter(
          ({ source }) => source === "ADMIN_CORRECTION",
        ),
      },
      latestEvaluation: latest
        ? {
            reportVersion: latest.reportVersion,
            scoreBreakdown: latest.scoreResult,
            feeAnalysis: latest.feeAnalysis,
          }
        : null,
      reportVersions: reports.map((report) => ({
        reportVersion: report.reportVersion,
        confirmationVersion: report.confirmationVersion,
        status: report.status,
        requestedAt: report.requestedAt ?? null,
        generatedAt: report.generatedAt,
        failureCode: report.failureCode,
      })),
      confirmations: confirmations.map((confirmation) => ({
        id: confirmation.id,
        version: confirmation.version,
        quoteCount: confirmation.quoteDataSnapshots.length,
        inputHash: confirmation.inputHash,
        confirmedBy: confirmation.confirmedBy,
        confirmedAt: confirmation.confirmedAt,
      })),
      processingTimeline: buildProcessingTimeline({
        documents,
        queues,
        extractions,
        reports,
        logs,
      }),
      accessExpiry: evaluationCase.expiresAt,
      reportRegenerationRequired:
        evaluationCase.reportRegenerationRequired ?? false,
    };
  }

  async saveAdminCorrection(input: SaveAdminCorrectionInput) {
    const correctionId = `aqc_${randomUUID().replaceAll("-", "")}`;
    return this.db.runTransaction(async (transaction) => {
      const caseRef = this.db.collection(AUDIT_EVALUATION_COLLECTIONS.cases)
        .doc(input.caseId);
      const quoteRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.normalizedQuotes)
        .doc(input.quoteId);
      const [caseSnapshot, quoteSnapshot] = await Promise.all([
        transaction.get(caseRef),
        transaction.get(quoteRef),
      ]);
      if (!caseSnapshot.exists) {
        throw new AdminAuditEvaluationError("case_not_found");
      }
      if (!quoteSnapshot.exists) {
        throw new AdminAuditEvaluationError("quote_not_found");
      }
      const evaluationCase = parseCase(caseSnapshot.data());
      const quote = parseQuote(quoteSnapshot.data());
      if (
        evaluationCase.id !== input.caseId ||
        quote.caseId !== input.caseId ||
        quote.quoteId !== input.quoteId
      ) {
        throw new AdminAuditEvaluationError("quote_not_found");
      }
      const documentRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.documents)
        .doc(quote.documentId);
      const correctionsQuery = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.corrections)
        .where("quoteId", "==", input.quoteId)
        .limit(MAX_DETAIL_RECORDS);
      const [documentSnapshot, correctionSnapshot] = await Promise.all([
        transaction.get(documentRef),
        transaction.get(correctionsQuery),
      ]);
      if (!documentSnapshot.exists) {
        throw new AdminAuditEvaluationError("quote_not_found");
      }
      const document = parseDocument(documentSnapshot.data());
      if (document.caseId !== input.caseId || document.id !== quote.documentId) {
        throw new AdminAuditEvaluationError("quote_not_found");
      }
      const previousCorrections = correctionSnapshot.docs.flatMap((snapshot) => {
        const parsed = auditQuoteCorrectionRecordSchema.safeParse(
          snapshot.data(),
        );
        return parsed.success &&
            parsed.data.caseId === input.caseId &&
            parsed.data.quoteId === input.quoteId
          ? [parsed.data]
          : [];
      });
      const mutation = createAdminCorrectionMutation({
        evaluationCase,
        quote,
        previousCorrections,
        correctionId,
        field: input.field,
        correctedValue: input.correctedValue,
        reason: input.reason,
        expectedRevision: input.expectedRevision,
        actorUid: input.actorUid,
        now: input.now,
      });
      const log = createAdminAuditLog({
        caseId: input.caseId,
        documentId: quote.documentId,
        reportVersion: evaluationCase.latestReportVersion,
        action: "ADMIN_QUOTE_CORRECTED",
        actorUid: input.actorUid,
        occurredAt: input.now,
        detail: `quote:${input.quoteId};field:${input.field};revision:${mutation.correction.quoteRevision}`,
      });
      transaction.set(quoteRef, mutation.quote);
      transaction.create(
        this.db.collection(AUDIT_EVALUATION_COLLECTIONS.corrections)
          .doc(correctionId),
        mutation.correction,
      );
      transaction.set(caseRef, mutation.evaluationCase);
      transaction.create(
        this.db.collection(AUDIT_EVALUATION_COLLECTIONS.auditLogs).doc(log.id),
        log,
      );
      return mutation;
    });
  }

  async reprocessDocument(input: ReprocessAdminDocumentInput) {
    return this.db.runTransaction(async (transaction) => {
      const caseRef = this.db.collection(AUDIT_EVALUATION_COLLECTIONS.cases)
        .doc(input.caseId);
      const documentRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.documents)
        .doc(input.documentId);
      const queueRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.parsingQueue)
        .doc(`apq_${input.documentId}`);
      const [caseSnapshot, documentSnapshot, queueSnapshot] = await Promise.all([
        transaction.get(caseRef),
        transaction.get(documentRef),
        transaction.get(queueRef),
      ]);
      if (!caseSnapshot.exists) {
        throw new AdminAuditEvaluationError("case_not_found");
      }
      if (!documentSnapshot.exists || !queueSnapshot.exists) {
        throw new AdminAuditEvaluationError("document_not_found");
      }
      const evaluationCase = parseCase(caseSnapshot.data());
      const document = parseDocument(documentSnapshot.data());
      const queue = parseQueue(queueSnapshot.data());
      if (
        evaluationCase.id !== input.caseId ||
        document.caseId !== input.caseId ||
        document.id !== input.documentId ||
        queue.caseId !== input.caseId ||
        queue.documentId !== input.documentId ||
        queue.id !== `apq_${input.documentId}`
      ) {
        throw new AdminAuditEvaluationError("document_not_found");
      }
      if (
        evaluationCase.status === "GENERATING" ||
        evaluationCase.status === "EXPIRED" ||
        evaluationCase.status === "DELETED" ||
        document.uploadStatus === "DELETED"
      ) {
        throw new AdminAuditEvaluationError("case_not_editable");
      }
      if (
        ["PENDING", "PARSING"].includes(document.parsingStatus) ||
        ["PENDING", "PROCESSING"].includes(queue.status)
      ) {
        throw new AdminAuditEvaluationError("reprocess_conflict");
      }
      transaction.set(documentRef, { parsingStatus: "PENDING" }, { merge: true });
      transaction.set(queueRef, {
        status: "PENDING",
        availableAt: input.now,
        updatedAt: input.now,
        lastErrorCode: null,
      }, { merge: true });
      transaction.set(caseRef, {
        status: "NEEDS_REVIEW",
        confirmationVersion: null,
        confirmedQuoteCount: 0,
        reportRequestedConfirmationVersion: null,
        reportRegenerationRequired:
          evaluationCase.latestReportVersion !== null,
        updatedAt: input.now,
        completedAt: null,
      }, { merge: true });
      const log = createAdminAuditLog({
        caseId: input.caseId,
        documentId: input.documentId,
        reportVersion: evaluationCase.latestReportVersion,
        action: "ADMIN_DOCUMENT_REPROCESS_REQUESTED",
        actorUid: input.actorUid,
        occurredAt: input.now,
        detail: `document:${input.documentId};attempts:${queue.attempts}`,
      });
      transaction.create(
        this.db.collection(AUDIT_EVALUATION_COLLECTIONS.auditLogs).doc(log.id),
        log,
      );
      return { documentId: input.documentId, status: "PENDING" as const };
    });
  }

  async regenerateReport(input: RegenerateAdminReportInput) {
    return this.db.runTransaction(async (transaction) => {
      const caseRef = this.db.collection(AUDIT_EVALUATION_COLLECTIONS.cases)
        .doc(input.caseId);
      const sourceRef = this.db.collection(AUDIT_EVALUATION_COLLECTIONS.reportRuns)
        .doc(createAuditEvaluationReportRunId(
          input.caseId,
          input.sourceReportVersion,
        ));
      const reportsQuery = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.reportRuns)
        .where("caseId", "==", input.caseId)
        .limit(MAX_DETAIL_RECORDS);
      const [caseSnapshot, sourceSnapshot, reportSnapshot] = await Promise.all([
        transaction.get(caseRef),
        transaction.get(sourceRef),
        transaction.get(reportsQuery),
      ]);
      if (!caseSnapshot.exists) {
        throw new AdminAuditEvaluationError("case_not_found");
      }
      if (!sourceSnapshot.exists) {
        throw new AdminAuditEvaluationError("report_not_found");
      }
      const evaluationCase = parseCase(caseSnapshot.data());
      const source = parseReport(sourceSnapshot.data());
      const reports = reportSnapshot.docs.map((snapshot) =>
        parseReportForCase(snapshot.data(), input.caseId)
      );
      const mutation = createAdminReportRegeneration({
        evaluationCase,
        source,
        existingReports: reports,
        expectedSourceVersion: input.expectedSourceVersion,
        actorUid: input.actorUid,
        now: input.now,
      });
      const reportRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.reportRuns)
        .doc(mutation.report.id);
      transaction.create(reportRef, mutation.report);
      transaction.set(caseRef, mutation.evaluationCase);
      const log = createAdminAuditLog({
        caseId: input.caseId,
        documentId: null,
        reportVersion: mutation.report.reportVersion,
        action: "ADMIN_REPORT_REGENERATION_REQUESTED",
        actorUid: input.actorUid,
        occurredAt: input.now,
        detail: `source:${source.reportVersion};new:${mutation.report.reportVersion}`,
      });
      transaction.create(
        this.db.collection(AUDIT_EVALUATION_COLLECTIONS.auditLogs).doc(log.id),
        log,
      );
      return mutation;
    });
  }

  async reissueAccess(input: ReissueAdminAccessInput) {
    const accessService =
      this.accessService ?? new AuditEvaluationCustomerAccessService();
    const access = await this.db.runTransaction(async (transaction) => {
      const caseRef = this.db.collection(AUDIT_EVALUATION_COLLECTIONS.cases)
        .doc(input.caseId);
      const caseSnapshot = await transaction.get(caseRef);
      if (!caseSnapshot.exists) {
        throw new AdminAuditEvaluationError("case_not_found");
      }
      const evaluationCase = parseCase(caseSnapshot.data());
      if (
        evaluationCase.id !== input.caseId ||
        evaluationCase.status === "DELETED"
      ) {
        throw new AdminAuditEvaluationError("case_not_found");
      }
      if (
        evaluationCase.expiresAt !== input.expectedExpiresAt
      ) {
        throw new AdminAuditEvaluationError("access_version_conflict");
      }
      const quoteRequestRef = this.db.collection(AUDIT_QUOTE_REQUESTS)
        .doc(evaluationCase.quoteRequestId);
      const reportsQuery = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.reportRuns)
        .where("caseId", "==", input.caseId)
        .limit(MAX_DETAIL_RECORDS);
      const [quoteRequestSnapshot, reportSnapshot] = await Promise.all([
        transaction.get(quoteRequestRef),
        transaction.get(reportsQuery),
      ]);
      if (!quoteRequestSnapshot.exists) {
        throw new AdminAuditEvaluationError("data_integrity_error");
      }
      const quoteRequest = quoteRequestSnapshot.data() as AuditQuoteRequestRecord;
      if (
        quoteRequest.requestId !== evaluationCase.quoteRequestId ||
        typeof quoteRequest.email !== "string" ||
        typeof quoteRequest.publicReference !== "string"
      ) {
        throw new AdminAuditEvaluationError("data_integrity_error");
      }
      const reports = reportSnapshot.docs.flatMap((snapshot) => {
        const parsed = evaluationReportRunRecordSchema.safeParse(snapshot.data());
        return parsed.success && parsed.data.caseId === input.caseId
          ? [parsed.data]
          : [];
      });
      const latestCompleted = reports
        .filter(({ status }) => status === "COMPLETED")
        .sort((left, right) => right.reportVersion - left.reportVersion)[0] ??
        null;
      const baseMs = Math.max(
        Date.parse(input.now),
        Date.parse(evaluationCase.expiresAt),
      );
      const expiresAt = new Date(
        baseMs + input.extendDays * 24 * 60 * 60 * 1_000,
      ).toISOString();
      const status = evaluationCase.status === "EXPIRED"
        ? latestCompleted
          ? "COMPLETED"
          : "NEEDS_REVIEW"
        : evaluationCase.status;
      const updatedCase = parseCase({
        ...evaluationCase,
        status,
        latestReportVersion:
          latestCompleted?.reportVersion ?? evaluationCase.latestReportVersion,
        expiresAt,
        updatedAt: input.now,
        completedAt: status === "COMPLETED"
          ? latestCompleted?.generatedAt ?? evaluationCase.completedAt
          : evaluationCase.completedAt,
      });
      transaction.set(caseRef, updatedCase);
      const log = createAdminAuditLog({
        caseId: input.caseId,
        documentId: null,
        reportVersion: updatedCase.latestReportVersion,
        action: "ADMIN_ACCESS_REISSUED",
        actorUid: input.actorUid,
        occurredAt: input.now,
        detail: `extendDays:${input.extendDays};status:${status}`,
      });
      transaction.create(
        this.db.collection(AUDIT_EVALUATION_COLLECTIONS.auditLogs).doc(log.id),
        log,
      );
      return {
        evaluationCase: updatedCase,
        email: quoteRequest.email,
        publicReference: quoteRequest.publicReference,
      };
    });
    const delivery = await accessService.requestEmailAccess({
      email: access.email,
      publicReference: access.publicReference,
      now: input.now,
    });
    return {
      expiresAt: access.evaluationCase.expiresAt,
      status: access.evaluationCase.status,
      deliveryAttempted: delivery.deliveryAttempted,
    };
  }

  async listErrors(): Promise<AdminAuditEvaluationErrorItem[]> {
    const [
      uploadSnapshot,
      documentSnapshot,
      queueSnapshot,
      extractionSnapshot,
      reportSnapshot,
      logSnapshot,
    ] = await Promise.all([
      this.db.collection(AUDIT_EVALUATION_COLLECTIONS.uploadIntents)
        .limit(MAX_RELATED_RECORDS).get(),
      this.db.collection(AUDIT_EVALUATION_COLLECTIONS.documents)
        .limit(MAX_RELATED_RECORDS).get(),
      this.db.collection(AUDIT_EVALUATION_COLLECTIONS.parsingQueue)
        .limit(MAX_RELATED_RECORDS).get(),
      this.db.collection(AUDIT_EVALUATION_COLLECTIONS.extractionRuns)
        .limit(MAX_RELATED_RECORDS).get(),
      this.db.collection(AUDIT_EVALUATION_COLLECTIONS.reportRuns)
        .limit(MAX_RELATED_RECORDS).get(),
      this.db.collection(AUDIT_EVALUATION_COLLECTIONS.auditLogs)
        .orderBy("occurredAt", "desc").limit(MAX_AUDIT_LOGS).get(),
    ]);
    const errors: AdminAuditEvaluationErrorItem[] = [];
    for (const snapshot of uploadSnapshot.docs) {
      const parsed = quoteUploadIntentSchema.safeParse(snapshot.data());
      if (!parsed.success || parsed.data.status !== "FAILED") continue;
      errors.push(errorItem({
        id: `upload:${parsed.data.id}`,
        type: "UPLOAD",
        caseId: parsed.data.caseId,
        documentId: parsed.data.documentId,
        reportVersion: null,
        occurredAt: parsed.data.completedAt ?? parsed.data.createdAt,
        retryCount: 0,
        code: parsed.data.failureCode ?? "UPLOAD_FAILED",
        impact: "견적서 업로드를 완료할 수 없습니다.",
        resolution: "업로드 상태를 확인하고 새 업로드를 요청하세요.",
      }));
    }
    for (const snapshot of documentSnapshot.docs) {
      const parsed = uploadedQuoteDocumentSchema.safeParse(snapshot.data());
      if (!parsed.success) continue;
      const document = parsed.data;
      if (
        document.integrityStatus === "MISMATCH" ||
        document.integrityStatus === "FAILED" ||
        document.matchStatus === "INVALID_SIGNATURE" ||
        document.matchStatus === "WRONG_CASE"
      ) {
        errors.push(errorItem({
          id: `mismatch:${document.id}`,
          type: "DOCUMENT_MISMATCH",
          caseId: document.caseId,
          documentId: document.id,
          reportVersion: null,
          occurredAt: document.uploadedAt,
          retryCount: 0,
          code: document.matchStatus ?? document.integrityStatus,
          impact: "문서 무결성 또는 소유 케이스 확인이 필요합니다.",
          resolution: "원본 문서와 견적 요청 연결을 확인하세요.",
        }));
      }
      if (
        document.scanStatus === "FAILED" ||
        document.scanStatus === "REJECTED" ||
        document.parsingStatus === "FAILED"
      ) {
        errors.push(errorItem({
          id: `document:${document.id}`,
          type: document.parsingStatus === "FAILED" ? "PARSING" : "UPLOAD",
          caseId: document.caseId,
          documentId: document.id,
          reportVersion: null,
          occurredAt: document.uploadedAt,
          retryCount: 0,
          code: document.parsingStatus === "FAILED"
            ? "DOCUMENT_PARSING_FAILED"
            : `DOCUMENT_SCAN_${document.scanStatus}`,
          impact: "문서 처리 결과를 고객이 확인할 수 없습니다.",
          resolution: "문서를 점검한 뒤 재처리를 요청하세요.",
        }));
      }
    }
    for (const snapshot of queueSnapshot.docs) {
      const parsed = quoteParsingQueueRecordSchema.safeParse(snapshot.data());
      if (!parsed.success || parsed.data.status !== "FAILED") continue;
      errors.push(errorItem({
        id: `queue:${parsed.data.id}`,
        type: "PARSING",
        caseId: parsed.data.caseId,
        documentId: parsed.data.documentId,
        reportVersion: null,
        occurredAt: parsed.data.updatedAt,
        retryCount: parsed.data.attempts,
        code: parsed.data.lastErrorCode ?? "PARSING_QUEUE_FAILED",
        impact: "견적서 분석이 중단되었습니다.",
        resolution: "실패 코드를 확인하고 문서 재처리를 요청하세요.",
      }));
    }
    for (const snapshot of extractionSnapshot.docs) {
      const parsed = extractionRunSchema.safeParse(snapshot.data());
      if (!parsed.success || parsed.data.status !== "FAILED") continue;
      errors.push(errorItem({
        id: `extraction:${parsed.data.id}`,
        type: "PARSING",
        caseId: parsed.data.caseId,
        documentId: parsed.data.documentId,
        reportVersion: null,
        occurredAt: parsed.data.completedAt ?? parsed.data.startedAt,
        retryCount: 0,
        code: parsed.data.failureCode ?? "QUOTE_EXTRACTION_FAILED",
        impact: "견적 값 추출을 완료하지 못했습니다.",
        resolution: "문서 품질을 확인하고 재처리를 요청하세요.",
      }));
    }
    for (const snapshot of reportSnapshot.docs) {
      const parsed = evaluationReportRunRecordSchema.safeParse(snapshot.data());
      if (!parsed.success || parsed.data.status !== "FAILED") continue;
      const code = parsed.data.failureCode ?? "REPORT_GENERATION_FAILED";
      errors.push(errorItem({
        id: `report:${parsed.data.id}`,
        type: /PDF|RENDER/i.test(code)
          ? "PDF_GENERATION"
          : "REPORT_GENERATION",
        caseId: parsed.data.caseId,
        documentId: null,
        reportVersion: parsed.data.reportVersion,
        occurredAt: parsed.data.generationStartedAt ??
          parsed.data.requestedAt ??
          parsed.data.generatedAt ??
          new Date(0).toISOString(),
        retryCount: parsed.data.generationAttempt ?? 0,
        code,
        failureMessage: parsed.data.failureMessage,
        impact: "평가 보고서를 제공할 수 없습니다.",
        resolution: "입력 스냅샷을 확인하고 보고서를 재생성하세요.",
      }));
    }
    for (const snapshot of logSnapshot.docs) {
      const parsed = auditLogSchema.safeParse(snapshot.data());
      if (
        !parsed.success ||
        parsed.data.action !== "ACCESS_EMAIL_FAILED" ||
        !parsed.data.caseId
      ) {
        continue;
      }
      errors.push(errorItem({
        id: `email:${parsed.data.id}`,
        type: "EMAIL_LINK",
        caseId: parsed.data.caseId,
        documentId: parsed.data.documentId ?? null,
        reportVersion: parsed.data.reportVersion,
        occurredAt: parsed.data.occurredAt,
        retryCount: parsed.data.retryCount ?? 0,
        code: parsed.data.errorCode ?? "ACCESS_EMAIL_FAILED",
        impact: "고객이 접근 링크를 받지 못했을 수 있습니다.",
        resolution: "수신 자격을 확인하고 접근 링크를 재발급하세요.",
      }));
    }
    return errors.sort((left, right) =>
      right.occurredAt.localeCompare(left.occurredAt)
    ).slice(0, MAX_AUDIT_LOGS);
  }

  async listAuditLogs(filters: AdminAuditLogFilters): Promise<AdminAuditLogItem[]> {
    const snapshot = await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.auditLogs)
      .orderBy("occurredAt", "desc")
      .limit(MAX_AUDIT_LOGS)
      .get();
    return snapshot.docs.flatMap((document) => {
      const parsed = auditLogSchema.safeParse(document.data());
      if (!parsed.success) return [];
      const log = parsed.data;
      if (filters.action && log.action !== filters.action) return [];
      if (filters.caseId && log.caseId !== filters.caseId) return [];
      if (filters.from && log.occurredAt < filters.from) return [];
      if (filters.to && log.occurredAt > filters.to) return [];
      return [{
        id: log.id,
        action: log.action,
        actor: log.actor,
        target: {
          caseId: log.caseId,
          documentId: log.documentId ?? null,
          reportVersion: log.reportVersion,
        },
        detail: safeDetail(log.detail),
        occurredAt: log.occurredAt,
        errorCode: log.errorCode ?? null,
        retryCount: log.retryCount ?? null,
      }];
    }).sort((left, right) =>
      right.occurredAt.localeCompare(left.occurredAt)
    );
  }

  private caseQuery(collection: string, caseId: string) {
    return this.db.collection(collection).where("caseId", "==", caseId)
      .limit(MAX_DETAIL_RECORDS);
  }
}

export function aggregateAdminCaseItems(
  cases: readonly AuditEvaluationCase[],
  documents: readonly UploadedQuoteDocument[],
  quotes: readonly NormalizedAuditQuote[],
  reports: readonly EvaluationReportRun[],
): AdminAuditEvaluationListItem[] {
  return cases.map((evaluationCase): AdminAuditEvaluationListItem => {
    const caseDocuments = documents.filter(
      ({ caseId, uploadStatus }) =>
        caseId === evaluationCase.id && uploadStatus !== "DELETED",
    );
    const caseQuotes = quotes.filter(
      ({ caseId }) => caseId === evaluationCase.id,
    );
    const caseReports = reports.filter(
      ({ caseId }) => caseId === evaluationCase.id,
    ).sort((left, right) => right.reportVersion - left.reportVersion);
    const completedReport = caseReports.find(
      ({ status }) => status === "COMPLETED",
    ) ?? null;
    const hasError = evaluationCase.status === "FAILED" ||
      caseDocuments.some((document) =>
      document.uploadStatus === "FAILED" ||
      document.scanStatus === "FAILED" ||
      document.scanStatus === "REJECTED" ||
      document.parsingStatus === "FAILED" ||
      document.integrityStatus === "FAILED" ||
      document.integrityStatus === "MISMATCH" ||
      document.matchStatus === "INVALID_SIGNATURE" ||
      document.matchStatus === "WRONG_CASE"
    ) || caseReports.some(({ status }) => status === "FAILED");
    const confirmed = caseQuotes.filter(
      ({ confirmedByCustomer }) => confirmedByCustomer,
    ).length;
    return {
      id: evaluationCase.id,
      cooperativeName: evaluationCase.cooperativeNameSnapshot,
      fiscalYear: evaluationCase.fiscalYear,
      quoteCount: caseQuotes.length,
      customerConfirmationStatus: caseQuotes.length === 0
        ? "NOT_STARTED"
        : confirmed === caseQuotes.length
          ? "CONFIRMED"
          : confirmed > 0
            ? "PARTIAL"
            : "PENDING",
      processingStatus: evaluationCase.status,
      reportGeneratedAt: completedReport?.generatedAt ?? null,
      reportCompleted: completedReport !== null,
      hasError,
      updatedAt: evaluationCase.updatedAt,
      createdAt: evaluationCase.createdAt,
    };
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function filterAdminCaseItems(
  items: readonly AdminAuditEvaluationListItem[],
  filters: AdminAuditEvaluationCaseFilters,
) {
  const cooperativeName = filters.cooperativeName?.toLocaleLowerCase("ko-KR");
  return items.filter((item) => {
    if (filters.status && item.processingStatus !== filters.status) return false;
    if (filters.fiscalYear && item.fiscalYear !== filters.fiscalYear) return false;
    if (
      cooperativeName &&
      !item.cooperativeName.toLocaleLowerCase("ko-KR").includes(cooperativeName)
    ) {
      return false;
    }
    if (filters.createdFrom && item.createdAt < filters.createdFrom) return false;
    if (filters.createdTo && item.createdAt > filters.createdTo) return false;
    if (filters.hasError !== undefined && item.hasError !== filters.hasError) {
      return false;
    }
    if (
      filters.reportCompleted !== undefined &&
      item.reportCompleted !== filters.reportCompleted
    ) {
      return false;
    }
    return true;
  });
}

export function createAdminCorrectionMutation(input: {
  evaluationCase: AuditEvaluationCase;
  quote: NormalizedAuditQuote;
  previousCorrections: readonly AuditQuoteCorrectionRecord[];
  correctionId: string;
  field: NormalizedAuditQuoteField;
  correctedValue: QuoteEvidenceValue;
  reason: string;
  expectedRevision: number;
  actorUid: string;
  now: string;
}) {
  if (
    input.evaluationCase.id !== input.quote.caseId ||
    input.evaluationCase.status === "DELETED"
  ) {
    throw new AdminAuditEvaluationError("quote_not_found");
  }
  if (input.evaluationCase.status === "GENERATING") {
    throw new AdminAuditEvaluationError("case_not_editable");
  }
  if (input.evaluationCase.status === "EXPIRED") {
    throw new AdminAuditEvaluationError("case_not_editable");
  }
  const currentRevision = input.quote.revision ?? 0;
  if (currentRevision !== input.expectedRevision) {
    throw new AdminAuditEvaluationError("version_conflict");
  }
  const evidence = input.quote.evidenceByField[input.field] ?? [];
  if (evidence.length >= 20) {
    throw new AdminAuditEvaluationError("evidence_limit_reached");
  }
  const previousValue = toEvidenceValue(input.quote[input.field]);
  const originalExtractedValue = [...input.previousCorrections]
    .filter(
      ({ caseId, quoteId, field }) =>
        caseId === input.evaluationCase.id &&
        quoteId === input.quote.quoteId &&
        field === input.field,
    )
    .sort((left, right) => left.correctedAt.localeCompare(right.correctedAt))[0]
    ?.originalExtractedValue ??
    originalNonCorrectionValue(input.quote, input.field);
  const revision = currentRevision + 1;
  const pending = (input.quote.pendingAdminReviewFields ?? []).filter(
    (field) => field !== input.field,
  );
  const candidate: NormalizedAuditQuote = {
    ...input.quote,
    source: { ...input.quote.source, [input.field]: "ADMIN_CORRECTION" },
    confidenceByField: {
      ...input.quote.confidenceByField,
      [input.field]: 100,
    },
    evidenceByField: {
      ...input.quote.evidenceByField,
      [input.field]: [...evidence, {
        documentId: input.quote.documentId,
        extractedValue: input.correctedValue,
        normalizedValue: input.correctedValue,
        source: "ADMIN_CORRECTION",
        confidence: 100,
        pageNumber: null,
        excerpt: "ADMIN_CORRECTION",
        coordinates: null,
        cellAddress: null,
        validationWarnings: [],
      }],
    },
    confirmedByCustomer: false,
    confirmedAt: null,
    revision,
    updatedAt: input.now,
    pendingAdminReviewFields: pending,
  };
  setQuoteField(candidate, input.field, input.correctedValue);
  candidate.missingFields = NORMALIZED_AUDIT_QUOTE_FIELDS.filter(
    (field) => !isQuoteFieldPresent(candidate, field),
  );
  const parsedQuote = normalizedAuditQuoteSchema.safeParse(candidate);
  if (!parsedQuote.success) {
    throw new AdminAuditEvaluationError("invalid_correction_value");
  }
  const correction = auditQuoteCorrectionRecordSchema.parse({
    id: input.correctionId,
    caseId: input.evaluationCase.id,
    quoteId: input.quote.quoteId,
    documentId: input.quote.documentId,
    field: input.field,
    originalExtractedValue,
    previousValue,
    correctedValue: input.correctedValue,
    reason: input.reason.trim(),
    source: "ADMIN_CORRECTION",
    correctedBy: { type: "ADMIN", uid: input.actorUid },
    correctedAt: input.now,
    quoteRevision: revision,
    requiresAdminReview: false,
    reviewStatus: "NOT_REQUIRED",
  });
  const evaluationCase = parseCase({
    ...input.evaluationCase,
    status: input.evaluationCase.status === "COMPLETED"
      ? "READY"
      : input.evaluationCase.status,
    confirmationVersion: null,
    confirmedQuoteCount: 0,
    reportRequestedConfirmationVersion: null,
    reportRegenerationRequired:
      input.evaluationCase.latestReportVersion !== null,
    updatedAt: input.now,
    completedAt: input.evaluationCase.status === "COMPLETED"
      ? null
      : input.evaluationCase.completedAt,
  });
  return { quote: parsedQuote.data, correction, evaluationCase };
}

export function createAdminReportRegeneration(input: {
  evaluationCase: AuditEvaluationCase;
  source: EvaluationReportRun;
  existingReports: readonly EvaluationReportRun[];
  expectedSourceVersion: number;
  actorUid: string;
  now: string;
}) {
  if (input.evaluationCase.id !== input.source.caseId) {
    throw new AdminAuditEvaluationError("report_not_found");
  }
  if (input.source.reportVersion !== input.expectedSourceVersion) {
    throw new AdminAuditEvaluationError("source_version_conflict");
  }
  if (
    input.evaluationCase.latestReportVersion !== input.expectedSourceVersion
  ) {
    throw new AdminAuditEvaluationError("source_version_conflict");
  }
  if (
    input.source.status !== "COMPLETED" &&
    input.source.status !== "FAILED"
  ) {
    throw new AdminAuditEvaluationError("report_status_conflict");
  }
  if (input.evaluationCase.reportRegenerationRequired === true) {
    throw new AdminAuditEvaluationError(
      "customer_reconfirmation_required",
    );
  }
  if (
    input.evaluationCase.status === "GENERATING" ||
    input.evaluationCase.status === "DELETED" ||
    input.evaluationCase.status === "EXPIRED"
  ) {
    throw new AdminAuditEvaluationError("case_not_editable");
  }
  const reportVersion = Math.max(
    0,
    ...input.existingReports
      .filter(({ caseId }) => caseId === input.evaluationCase.id)
      .map(({ reportVersion }) => reportVersion),
  ) + 1;
  const report = evaluationReportRunRecordSchema.parse({
    ...input.source,
    id: createAuditEvaluationReportRunId(
      input.evaluationCase.id,
      reportVersion,
    ),
    reportVersion,
    status: "PENDING",
    requestedAt: input.now,
    generationAttempt: 0,
    generationStartedAt: null,
    generationLeaseExpiresAt: null,
    narrativeData: {
      mode: "RULE_BASED",
      ruleBasedSections: [],
      aiStatus: "NOT_REQUESTED",
      aiText: null,
    },
    htmlStoragePath: null,
    renderingReference: null,
    pdfStoragePath: null,
    generatedAt: null,
    generatedBy: { type: "ADMIN", uid: input.actorUid },
    failureCode: null,
    failureMessage: null,
  });
  const evaluationCase = parseCase({
    ...input.evaluationCase,
    latestReportVersion: reportVersion,
    status: "GENERATING",
    updatedAt: input.now,
    completedAt: null,
  });
  return { report, evaluationCase };
}

function buildProcessingTimeline(input: {
  documents: readonly UploadedQuoteDocument[];
  queues: readonly QuoteParsingQueueRecord[];
  extractions: readonly QuoteExtractionRunRecord[];
  reports: readonly EvaluationReportRun[];
  logs: readonly AuditEvaluationAuditLog[];
}) {
  return [
    ...input.documents.map((document) => ({
      occurredAt: document.uploadedAt,
      type: "DOCUMENT",
      status: document.parsingStatus,
      targetId: document.id,
      detail: document.safeDisplayName,
      errorCode: document.parsingStatus === "FAILED"
        ? "DOCUMENT_PARSING_FAILED"
        : null,
    })),
    ...input.queues.map((queue) => ({
      occurredAt: queue.updatedAt,
      type: "PARSING_QUEUE",
      status: queue.status,
      targetId: queue.documentId,
      detail: `attempts:${queue.attempts}`,
      errorCode: queue.lastErrorCode,
    })),
    ...input.extractions.map((run) => ({
      occurredAt: run.completedAt ?? run.startedAt,
      type: "EXTRACTION",
      status: run.status,
      targetId: run.documentId,
      detail: run.warningCodes.slice(0, 20).join(",") || null,
      errorCode: run.failureCode,
    })),
    ...input.reports.map((report) => ({
      occurredAt: report.generatedAt ?? report.requestedAt ??
        report.generationStartedAt ?? new Date(0).toISOString(),
      type: "REPORT",
      status: report.status,
      targetId: String(report.reportVersion),
      detail: null,
      errorCode: report.failureCode,
    })),
    ...input.logs.map((log) => ({
      occurredAt: log.occurredAt,
      type: "AUDIT_LOG",
      status: log.action,
      targetId: log.documentId ?? (
        log.reportVersion ? String(log.reportVersion) : null
      ),
      detail: safeDetail(log.detail),
      errorCode: log.errorCode ?? null,
    })),
  ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
    .slice(-MAX_DETAIL_RECORDS);
}

function createAdminAuditLog(input: {
  caseId: string;
  documentId: string | null;
  reportVersion: number | null;
  action: string;
  actorUid: string;
  occurredAt: string;
  detail: string;
}): AuditEvaluationAuditLog {
  return auditLogSchema.parse({
    id: `ael_${randomUUID()}`,
    caseId: input.caseId,
    documentId: input.documentId,
    reportVersion: input.reportVersion,
    action: input.action,
    actor: { type: "ADMIN", uid: input.actorUid },
    occurredAt: input.occurredAt,
    detail: safeDetail(input.detail),
    errorCode: null,
    retryCount: null,
  });
}

function errorItem(input: {
  id: string;
  type: AdminAuditEvaluationErrorItem["type"];
  caseId: string;
  documentId: string | null;
  reportVersion: number | null;
  occurredAt: string;
  retryCount: number;
  code: string;
  failureMessage?: string | null;
  impact: string;
  resolution: string;
}): AdminAuditEvaluationErrorItem {
  const code = safeErrorCode(input.code);
  return {
    id: input.id,
    type: input.type,
    customerImpact: input.impact,
    occurredAt: input.occurredAt,
    retryCount: Math.max(0, Math.trunc(input.retryCount)),
    resolution: input.resolution,
    caseId: input.caseId,
    documentId: input.documentId,
    reportVersion: input.reportVersion,
    errorCode: code,
    internalDetail: {
      code,
      failureMessage: safeFailureMessage(input.failureMessage),
    },
  };
}

function parseCase(value: unknown) {
  const parsed = auditEvaluationCaseRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw new AdminAuditEvaluationError("data_integrity_error");
  }
  return parsed.data;
}

function parseQuote(value: unknown) {
  const parsed = normalizedAuditQuoteSchema.safeParse(value);
  if (!parsed.success) {
    throw new AdminAuditEvaluationError("data_integrity_error");
  }
  return parsed.data;
}

function parseDocument(value: unknown) {
  const parsed = uploadedQuoteDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw new AdminAuditEvaluationError("data_integrity_error");
  }
  return parsed.data;
}

function parseQueue(value: unknown) {
  const parsed = quoteParsingQueueRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw new AdminAuditEvaluationError("data_integrity_error");
  }
  return parsed.data;
}

function parseReport(value: unknown) {
  const parsed = evaluationReportRunRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw new AdminAuditEvaluationError("data_integrity_error");
  }
  return parsed.data;
}

function parseDocumentForCase(value: unknown, caseId: string) {
  const document = parseDocument(value);
  if (document.caseId !== caseId) {
    throw new AdminAuditEvaluationError("data_integrity_error");
  }
  return document;
}

function parseQuoteForCase(value: unknown, caseId: string) {
  const quote = parseQuote(value);
  if (quote.caseId !== caseId) {
    throw new AdminAuditEvaluationError("data_integrity_error");
  }
  return quote;
}

function parseQueueForCase(value: unknown, caseId: string) {
  const queue = parseQueue(value);
  if (queue.caseId !== caseId) {
    throw new AdminAuditEvaluationError("data_integrity_error");
  }
  return queue;
}

function parseReportForCase(value: unknown, caseId: string) {
  const report = parseReport(value);
  if (report.caseId !== caseId) {
    throw new AdminAuditEvaluationError("data_integrity_error");
  }
  return report;
}

function parseCorrectionForCase(value: unknown, caseId: string) {
  const parsed = auditQuoteCorrectionRecordSchema.safeParse(value);
  if (!parsed.success || parsed.data.caseId !== caseId) {
    throw new AdminAuditEvaluationError("data_integrity_error");
  }
  return parsed.data;
}

function parseConfirmationForCase(value: unknown, caseId: string) {
  const parsed = confirmationSchema.safeParse(value);
  if (!parsed.success || parsed.data.caseId !== caseId) {
    throw new AdminAuditEvaluationError("data_integrity_error");
  }
  return parsed.data;
}

function parseExtractionForCase(value: unknown, caseId: string) {
  const parsed = extractionRunSchema.safeParse(value);
  if (!parsed.success || parsed.data.caseId !== caseId) {
    throw new AdminAuditEvaluationError("data_integrity_error");
  }
  return parsed.data;
}

function originalNonCorrectionValue(
  quote: NormalizedAuditQuote,
  field: NormalizedAuditQuoteField,
) {
  const original = (quote.evidenceByField[field] ?? []).find(
    ({ source }) =>
      source !== "CUSTOMER_CORRECTION" && source !== "ADMIN_CORRECTION",
  );
  return original?.extractedValue ?? toEvidenceValue(quote[field]);
}

function setQuoteField(
  quote: NormalizedAuditQuote,
  field: NormalizedAuditQuoteField,
  value: QuoteEvidenceValue,
) {
  (quote as unknown as Record<NormalizedAuditQuoteField, unknown>)[field] =
    value;
}

function toEvidenceValue(value: unknown): QuoteEvidenceValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(toEvidenceValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      toEvidenceValue(item),
    ]));
  }
  return null;
}

function safeDetail(value: string) {
  return value.replace(/\r?\n/g, " ").replace(
    /\s+at\s+\S+\s+\([^)]*\)/g,
    "",
  ).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500);
}

function safeErrorCode(value: string) {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9_]/g, "_")
    .slice(0, 100);
  return /^[A-Z][A-Z0-9_]{0,99}$/.test(normalized)
    ? normalized
    : "UNKNOWN_FAILURE";
}

function safeFailureMessage(value: string | null | undefined) {
  if (!value) return null;
  const singleLine = value.replace(/\r?\n/g, " ").replace(
    /\s+at\s+\S+\s+\([^)]*\)/g,
    "",
  ).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return singleLine ? singleLine.slice(0, 500) : null;
}
