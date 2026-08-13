import { createHash, randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { AUDIT_EVALUATION_COLLECTIONS } from "@/lib/audit-evaluation/collections";
import {
  resolveAuditQuoteCustomerStatus,
  type AuditQuoteCustomerStatus,
} from "@/lib/audit-evaluation/document-customer-status";
import {
  evaluationScoreResultSchema,
  feeAnalysisResultSchema,
} from "@/lib/audit-evaluation/evaluation-result-schemas";
import { runDeterministicFeeAnalysis } from "@/lib/audit-evaluation/fee-analysis";
import { normalizedAuditQuoteSchema } from "@/lib/audit-evaluation/quote-extraction-schemas";
import {
  evaluateAuditEvaluationReadiness,
  isQuoteFieldPresent,
  type AuditEvaluationReadinessIssue,
  type AuditEvaluationReadinessResult,
} from "@/lib/audit-evaluation/review-readiness";
import { standardQuoteDocumentRecordSchema } from "@/lib/audit-evaluation/quote-document-schemas";
import { runDeterministicQualityScoring } from "@/lib/audit-evaluation/scoring-engine";
import { evaluationConfigSchema } from "@/lib/audit-evaluation/schemas";
import {
  createEvaluationConfigSnapshot,
  createQuoteDataSnapshots,
} from "@/lib/audit-evaluation/snapshots";
import { canTransitionAuditEvaluationStatus } from "@/lib/audit-evaluation/status";
import {
  AUDIT_EVALUATION_CASE_STATUSES,
  EVALUATION_REPORT_RUN_STATUSES,
  NORMALIZED_AUDIT_QUOTE_FIELDS,
  type AuditEvaluationActor,
  type AuditEvaluationCase,
  type AuditEvaluationConfirmationRecord,
  type AuditQuoteCorrectionRecord,
  type EvaluationConfigSnapshot,
  type EvaluationScoreResult,
  type FeeAnalysisResult,
  type EvaluationReportRun,
  type NormalizedAuditQuote,
  type NormalizedAuditQuoteField,
  type QuoteDataSnapshot,
  type QuoteEvidenceValue,
  type StandardQuoteDocumentRecord,
  type UploadedQuoteDocument,
} from "@/lib/audit-evaluation/types";
import {
  nhAuditReportEvaluationSnapshotSchema,
  nhAuditSnapshotNeedsRegeneration,
} from "@/lib/audit-evaluation/nh-audit-report-snapshot";
import { uploadedQuoteDocumentSchema } from "@/lib/audit-evaluation/upload-schemas";
import { adminDb } from "@/lib/firebase/admin";

const instantSchema = z.string().datetime({ offset: true });
const resourceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const coreFields = [
  "accountingFirmName",
  "auditFee",
  "vatIncluded",
  "accountingFirmRevenue",
] as const satisfies readonly NormalizedAuditQuoteField[];

const customerActorSchema = z
  .object({
    type: z.literal("CUSTOMER"),
    subjectId: z.string().trim().min(1).max(128),
  })
  .strict();

const actorSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("ADMIN"),
      uid: z.string().trim().min(1).max(128),
    })
    .strict(),
  customerActorSchema,
  z
    .object({
      type: z.literal("SYSTEM"),
      service: z.string().trim().min(1).max(128),
    })
    .strict(),
]);

const ownerSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("FIREBASE_UID"),
      uid: z.string().trim().min(1).max(128),
    })
    .strict(),
  z
    .object({
      type: z.literal("CAPABILITY_SUBJECT"),
      subjectId: z.string().trim().min(1).max(128),
    })
    .strict(),
]);

const versionReferenceSchema = z
  .object({
    id: resourceIdSchema,
    version: z.number().int().positive(),
  })
  .strict();

const evaluationCaseSchema: z.ZodType<AuditEvaluationCase> = z
  .object({
    id: resourceIdSchema,
    quoteRequestId: resourceIdSchema,
    cooperativeId: resourceIdSchema.nullable(),
    cooperativeNameSnapshot: z.string().trim().max(500),
    fiscalYear: z.number().int().min(2_000).max(9_999),
    customerAccessOwner: ownerSchema,
    status: z.enum(AUDIT_EVALUATION_CASE_STATUSES),
    quoteTemplateVersion: versionReferenceSchema.nullable(),
    evaluationConfigVersion: versionReferenceSchema,
    latestReportVersion: z.number().int().positive().nullable(),
    expectedQuoteCount: z.number().int().nonnegative(),
    confirmedQuoteCount: z.number().int().nonnegative(),
    latestConfirmationVersion: z.number().int().positive().optional(),
    confirmationVersion: z.number().int().positive().nullable().optional(),
    reportRequestedConfirmationVersion:
      z.number().int().positive().nullable().optional(),
    reportRegenerationRequired: z.boolean().optional(),
    expiresAt: instantSchema,
    createdAt: instantSchema,
    updatedAt: instantSchema,
    completedAt: instantSchema.nullable(),
  })
  .strict();

const evidenceValueSchema: z.ZodType<QuoteEvidenceValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.string().max(10_000),
    z.number().finite(),
    z.boolean(),
    z.array(evidenceValueSchema).max(100),
    z.record(z.string().max(128), evidenceValueSchema),
  ]),
);

const correctionRecordSchema: z.ZodType<AuditQuoteCorrectionRecord> = z
  .object({
    id: resourceIdSchema,
    caseId: resourceIdSchema,
    quoteId: resourceIdSchema,
    documentId: resourceIdSchema,
    field: z.enum(NORMALIZED_AUDIT_QUOTE_FIELDS),
    originalExtractedValue: evidenceValueSchema,
    previousValue: evidenceValueSchema,
    correctedValue: evidenceValueSchema,
    reason: z.string().trim().min(2).max(1_000),
    source: z.enum(["CUSTOMER_CORRECTION", "ADMIN_CORRECTION"]),
    correctedBy: z.discriminatedUnion("type", [
      customerActorSchema,
      z
        .object({
          type: z.literal("ADMIN"),
          uid: z.string().trim().min(1).max(128),
        })
        .strict(),
    ]),
    correctedAt: instantSchema,
    quoteRevision: z.number().int().positive(),
    requiresAdminReview: z.boolean(),
    reviewStatus: z.enum([
      "NOT_REQUIRED",
      "PENDING",
      "APPROVED",
      "REJECTED",
    ]),
  })
  .strict();

const confirmationRecordSchema: z.ZodType<AuditEvaluationConfirmationRecord> =
  z
    .object({
      id: resourceIdSchema,
      caseId: resourceIdSchema,
      version: z.number().int().positive(),
      evaluationConfigSnapshot: evaluationConfigSchema,
      quoteDataSnapshots: z.array(normalizedAuditQuoteSchema).min(1).max(500),
      inputHash: sha256Schema,
      finalAcknowledged: z.literal(true),
      confirmedBy: customerActorSchema,
      confirmedAt: instantSchema,
    })
    .strict();

const reportRunSchema: z.ZodType<EvaluationReportRun> = z
  .object({
    id: resourceIdSchema,
    caseId: resourceIdSchema,
    reportVersion: z.number().int().positive(),
    confirmationVersion: z.number().int().positive(),
    inputHash: sha256Schema,
    status: z.enum(EVALUATION_REPORT_RUN_STATUSES),
    requestedAt: instantSchema.optional(),
    generationAttempt: z.number().int().nonnegative().optional(),
    generationStartedAt: instantSchema.nullable().optional(),
    generationLeaseExpiresAt: instantSchema.nullable().optional(),
    evaluationConfigSnapshot: evaluationConfigSchema,
    quoteDataSnapshots: z.array(normalizedAuditQuoteSchema).min(1).max(500),
    scoreResult: evaluationScoreResultSchema.nullable(),
    feeAnalysis: feeAnalysisResultSchema.nullable(),
    nhAuditEvaluationSnapshot:
      nhAuditReportEvaluationSnapshotSchema.optional(),
    narrativeData: z
      .object({
        mode: z.enum(["RULE_BASED", "AI_ASSISTED"]),
        ruleBasedSections: z
          .array(
            z
              .object({
                sectionId: resourceIdSchema,
                facts: z.array(z.string().max(8_000)).max(500),
              })
              .strict(),
          )
          .max(100),
        aiStatus: z.enum([
          "NOT_REQUESTED",
          "PENDING",
          "COMPLETED",
          "FAILED",
        ]),
        aiText: z.string().max(100_000).nullable(),
      })
      .strict(),
    htmlStoragePath: z.string().max(1_000).nullable(),
    renderingReference: z
      .object({
        rendererId: resourceIdSchema,
        rendererVersion: z.number().int().positive(),
        payloadStoragePath: z.string().max(1_000).nullable(),
      })
      .strict()
      .nullable(),
    pdfStoragePath: z.string().max(1_000).nullable(),
    generatedAt: instantSchema.nullable(),
    generatedBy: actorSchema,
    failureCode: z.string().trim().min(1).max(100).nullable(),
    failureMessage: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict();

export {
  correctionRecordSchema as auditQuoteCorrectionRecordSchema,
  evaluationCaseSchema as auditEvaluationCaseRecordSchema,
  reportRunSchema as evaluationReportRunRecordSchema,
};

export type ReviewWorkspaceDocument = Pick<
  UploadedQuoteDocument,
  | "id"
  | "safeDisplayName"
  | "scanStatus"
  | "parsingStatus"
  | "matchStatus"
  | "integrityStatus"
> & {
  customerStatus: AuditQuoteCustomerStatus;
};

export type ReviewWorkspaceQuote = Pick<
  NormalizedAuditQuote,
  | "quoteId"
  | "accountingFirmName"
  | "auditFee"
  | "vatIncluded"
  | "accountingFirmRevenue"
  | "recentNonghyupAuditCount"
  | "auditedNonghyupTypes"
  | "taxAgencyExperience"
  | "subsidySettlementExperience"
  | "engagementPartner"
  | "engagementTeam"
  | "totalPlannedHours"
  | "auditSchedule"
  | "qualityControlPlan"
  | "requiredProposalItems"
  | "confirmedByCustomer"
  | "pendingAdminReviewFields"
> & {
  revision: number;
  trustedMismatchFields: NormalizedAuditQuoteField[];
};

export type AuditEvaluationReviewWorkspace = {
  evaluationCase: Pick<
    AuditEvaluationCase,
    | "id"
    | "fiscalYear"
    | "status"
    | "confirmationVersion"
    | "reportRequestedConfirmationVersion"
  >;
  documents: ReviewWorkspaceDocument[];
  quotes: ReviewWorkspaceQuote[];
  readiness: AuditEvaluationReadinessResult;
  finalConfirmed: boolean;
  canRequestReport: boolean;
};

export type SaveCustomerCorrectionRepositoryInput = {
  caseId: string;
  quoteId: string;
  field: NormalizedAuditQuoteField;
  correctedValue: QuoteEvidenceValue;
  reason: string;
  expectedRevision: number;
  actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }>;
  now: string;
};

export type SaveCustomerCorrectionResult = {
  quote: NormalizedAuditQuote;
  correction: AuditQuoteCorrectionRecord;
  evaluationCase: AuditEvaluationCase;
};

export type ConfirmCaseRepositoryInput = {
  caseId: string;
  expectedQuoteRevisions: Readonly<Record<string, number>>;
  finalAcknowledged: true;
  actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }>;
  now: string;
};

export type ConfirmCaseResult = {
  evaluationCase: AuditEvaluationCase;
  confirmation: AuditEvaluationConfirmationRecord;
};

export type ConfirmPartnerInboxQuotesRepositoryInput = {
  caseId: string;
  quotes: readonly NormalizedAuditQuote[];
  finalAcknowledged: true;
  actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }>;
  now: string;
  cooperativeNameSnapshot?: string;
  fiscalYear?: number;
};

export type RequestReportRepositoryInput = {
  caseId: string;
  confirmationVersion: number;
  nhAuditEvaluationSnapshot?:
    EvaluationReportRun["nhAuditEvaluationSnapshot"];
  actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }>;
  now: string;
};

export type RequestReportResult = {
  evaluationCase: AuditEvaluationCase;
  report: EvaluationReportRun;
  replayed: boolean;
};

export interface AuditEvaluationReviewRepository {
  getWorkspace(
    caseId: string,
    now: string,
  ): Promise<AuditEvaluationReviewWorkspace | null>;
  saveCustomerCorrection(
    input: SaveCustomerCorrectionRepositoryInput,
  ): Promise<SaveCustomerCorrectionResult>;
  confirmCase(input: ConfirmCaseRepositoryInput): Promise<ConfirmCaseResult>;
  confirmPartnerInboxQuotes(
    input: ConfirmPartnerInboxQuotesRepositoryInput,
  ): Promise<ConfirmCaseResult>;
  requestReport(
    input: RequestReportRepositoryInput,
  ): Promise<RequestReportResult>;
}

export class ReviewServiceError extends Error {
  readonly code: string;
  readonly issues: readonly AuditEvaluationReadinessIssue[];

  constructor(
    code: string,
    issues: readonly AuditEvaluationReadinessIssue[] = [],
  ) {
    super(code);
    this.name = "ReviewServiceError";
    this.code = code;
    this.issues = issues;
  }
}

export function reviewServiceErrorStatus(code: string) {
  if (
    code === "case_not_found" ||
    code === "quote_not_found" ||
    code === "confirmation_not_found"
  ) {
    return 404;
  }
  if (
    code === "version_conflict" ||
    code === "confirmation_version_conflict" ||
    code === "case_not_editable" ||
    code === "case_not_ready" ||
    code === "readiness_failed" ||
    code === "invalid_status_transition" ||
    code === "document_not_active" ||
    code === "confirmation_not_final" ||
    code === "config_not_published" ||
    code === "config_not_effective" ||
    code === "report_conflict" ||
    code === "correction_evidence_limit_reached"
  ) {
    return 409;
  }
  if (
    code === "data_integrity_error" ||
    code === "config_not_found" ||
    code === "evaluation_calculation_failed"
  ) {
    return 500;
  }
  return 400;
}

export class FirestoreAuditEvaluationReviewRepository
implements AuditEvaluationReviewRepository {
  private readonly db: Firestore;

  constructor(db: Firestore = adminDb()) {
    this.db = db;
  }

  async getWorkspace(caseId: string, now: string) {
    const caseSnapshot = await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.cases)
      .doc(caseId)
      .get();
    if (!caseSnapshot.exists) return null;
    const evaluationCase = parseCase(caseSnapshot.data());
    if (evaluationCase.id !== caseId || evaluationCase.status === "DELETED") {
      return null;
    }

    const configQuery = this.configQuery(evaluationCase);
    const [documentSnapshot, quoteSnapshot, configSnapshot] =
      await Promise.all([
        this.db
          .collection(AUDIT_EVALUATION_COLLECTIONS.documents)
          .where("caseId", "==", caseId)
          .get(),
        this.db
          .collection(AUDIT_EVALUATION_COLLECTIONS.normalizedQuotes)
          .where("caseId", "==", caseId)
          .get(),
        configQuery.get(),
      ]);
    const config = parsePinnedConfig(configSnapshot.docs.map((item) =>
      item.data()
    ), evaluationCase);
    const documents = parseActiveDocuments(documentSnapshot.docs.map((item) =>
      item.data()
    ));
    const documentIds = new Set(documents.map(({ id }) => id));
    const quotes = parseConnectedQuotes(
      quoteSnapshot.docs.map((item) => item.data()),
      caseId,
      documentIds,
    );
    const trustedRecords = await this.loadTrustedRecords(documents);
    const workspaceQuotes = quotes.map((quote) =>
      projectWorkspaceQuote(
        quote,
        trustedRecords.get(quote.documentId) ?? null,
      )
    );
    const readiness = evaluateAuditEvaluationReadiness({
      evaluationCase,
      config,
      quotes,
      documents,
      now,
      requireCustomerConfirmation: false,
    });
    const finalConfirmed =
      workspaceQuotes.length > 0 &&
      evaluationCase.confirmationVersion !== null &&
      evaluationCase.confirmationVersion !== undefined &&
      evaluationCase.confirmedQuoteCount === workspaceQuotes.length &&
      workspaceQuotes.every(({ confirmedByCustomer }) =>
        confirmedByCustomer
      );

    return {
      evaluationCase: {
        id: evaluationCase.id,
        fiscalYear: evaluationCase.fiscalYear,
        status: evaluationCase.status,
        confirmationVersion: evaluationCase.confirmationVersion,
        reportRequestedConfirmationVersion:
          evaluationCase.reportRequestedConfirmationVersion,
      },
      documents: documents.map((document) => ({
        id: document.id,
        safeDisplayName: document.safeDisplayName,
        scanStatus: document.scanStatus,
        parsingStatus: document.parsingStatus,
        matchStatus: document.matchStatus,
        integrityStatus: document.integrityStatus,
        customerStatus: resolveAuditQuoteCustomerStatus(document),
      })),
      quotes: workspaceQuotes,
      readiness,
      finalConfirmed,
      canRequestReport: evaluationCase.status === "READY" && finalConfirmed,
    };
  }

  async saveCustomerCorrection(input: SaveCustomerCorrectionRepositoryInput) {
    const correctionId = `aqc_${randomUUID().replaceAll("-", "")}`;
    return this.db.runTransaction(async (transaction) => {
      const caseRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.cases)
        .doc(input.caseId);
      const quoteRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.normalizedQuotes)
        .doc(input.quoteId);
      const [caseSnapshot, quoteSnapshot] = await Promise.all([
        transaction.get(caseRef),
        transaction.get(quoteRef),
      ]);
      if (!caseSnapshot.exists) throw new ReviewServiceError("case_not_found");
      if (!quoteSnapshot.exists) {
        throw new ReviewServiceError("quote_not_found");
      }
      const evaluationCase = parseCase(caseSnapshot.data());
      const quote = parseQuote(quoteSnapshot.data());
      if (
        evaluationCase.id !== input.caseId ||
        quote.caseId !== input.caseId ||
        quote.quoteId !== input.quoteId
      ) {
        throw new ReviewServiceError("quote_not_found");
      }
      if (
        ["GENERATING", "COMPLETED", "EXPIRED", "DELETED"].includes(
          evaluationCase.status,
        )
      ) {
        throw new ReviewServiceError("case_not_editable");
      }
      const currentRevision = quote.revision ?? 0;
      assertExpectedQuoteRevision(currentRevision, input.expectedRevision);

      const documentRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.documents)
        .doc(quote.documentId);
      const correctionsQuery = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.corrections)
        .where("quoteId", "==", quote.quoteId);
      const [documentSnapshot, configSnapshot, correctionSnapshot] =
        await Promise.all([
          transaction.get(documentRef),
          transaction.get(this.configQuery(evaluationCase)),
          transaction.get(correctionsQuery),
        ]);
      if (!documentSnapshot.exists) {
        throw new ReviewServiceError("document_not_active");
      }
      const document = parseDocument(documentSnapshot.data());
      if (
        document.caseId !== input.caseId ||
        document.uploadStatus === "DELETED"
      ) {
        throw new ReviewServiceError("document_not_active");
      }
      const config = parsePinnedConfig(
        configSnapshot.docs.map((item) => item.data()),
        evaluationCase,
      );
      const previousCorrections = correctionSnapshot.docs
        .flatMap((snapshot) => {
          const parsed = correctionRecordSchema.safeParse(snapshot.data());
          return parsed.success &&
            parsed.data.caseId === input.caseId &&
            parsed.data.quoteId === input.quoteId
            ? [parsed.data]
            : [];
        })
        .sort((left, right) =>
          left.correctedAt.localeCompare(right.correctedAt)
        );
      const trustedRecord = document.matchedQuoteDocumentId
        ? parseOptionalTrustedRecord(
            (await transaction.get(
              this.db
                .collection(
                  AUDIT_EVALUATION_COLLECTIONS.standardQuoteDocuments,
                )
                .doc(document.matchedQuoteDocumentId),
            )).data(),
          )
        : null;

      const previousValue = toEvidenceValue(quote[input.field]);
      const correctedValue = input.correctedValue;
      const trustedValue = trustedValueForField(
        quote,
        input.field,
        trustedRecord,
      );
      const correctionBaseline =
        trustedValue ?? originalNonCorrectionValue(quote, input.field);
      const requiresAdminReview = requiresAdminReviewForCorrection(
        config.customerCorrectionPolicy
          ?.coreFieldChangesRequireAdminReview === true,
        input.field,
        correctedValue,
        correctionBaseline,
      );
      const pending = new Set(quote.pendingAdminReviewFields ?? []);
      if (requiresAdminReview) pending.add(input.field);
      else pending.delete(input.field);
      const evidence = quote.evidenceByField[input.field] ?? [];
      if (evidence.length >= 20) {
        throw new ReviewServiceError("correction_evidence_limit_reached");
      }
      const newRevision = currentRevision + 1;
      const updatedCandidate: NormalizedAuditQuote = {
        ...quote,
        source: {
          ...quote.source,
          [input.field]: "CUSTOMER_CORRECTION",
        },
        confidenceByField: {
          ...quote.confidenceByField,
          [input.field]: 100,
        },
        evidenceByField: {
          ...quote.evidenceByField,
          [input.field]: [
            ...evidence,
            {
              documentId: quote.documentId,
              extractedValue: correctedValue,
              normalizedValue: correctedValue,
              source: "CUSTOMER_CORRECTION",
              confidence: 100,
              pageNumber: null,
              excerpt: "CUSTOMER_CORRECTION",
              coordinates: null,
              cellAddress: null,
              validationWarnings: [],
            },
          ],
        },
        confirmedByCustomer: false,
        confirmedAt: null,
        revision: newRevision,
        updatedAt: input.now,
        pendingAdminReviewFields: sortFields([...pending]),
      };
      setQuoteField(updatedCandidate, input.field, correctedValue);
      updatedCandidate.missingFields = NORMALIZED_AUDIT_QUOTE_FIELDS.filter(
        (field) => !isQuoteFieldPresent(updatedCandidate, field),
      );
      updatedCandidate.warnings = updateTrustedMismatchWarning(
        updatedCandidate,
        input.field,
        trustedValue,
      );
      const updatedQuote = parseCorrectedQuote(updatedCandidate);
      const originalExtractedValue =
        previousCorrections[0]?.originalExtractedValue ??
        originalNonCorrectionValue(quote, input.field);
      const correction = correctionRecordSchema.parse({
        id: correctionId,
        caseId: input.caseId,
        quoteId: input.quoteId,
        documentId: quote.documentId,
        field: input.field,
        originalExtractedValue,
        previousValue,
        correctedValue,
        reason: input.reason,
        source: "CUSTOMER_CORRECTION",
        correctedBy: input.actor,
        correctedAt: input.now,
        quoteRevision: newRevision,
        requiresAdminReview,
        reviewStatus: requiresAdminReview ? "PENDING" : "NOT_REQUIRED",
      });
      const nextStatus =
        evaluationCase.status === "READY"
          ? "NEEDS_REVIEW"
          : evaluationCase.status;
      if (
        nextStatus !== evaluationCase.status &&
        !canTransitionAuditEvaluationStatus(
          evaluationCase.status,
          nextStatus,
        )
      ) {
        throw new ReviewServiceError("invalid_status_transition");
      }
      const updatedCase = parseCase({
        ...evaluationCase,
        status: nextStatus,
        confirmationVersion: null,
        confirmedQuoteCount: 0,
        reportRequestedConfirmationVersion: null,
        reportRegenerationRequired:
          evaluationCase.latestReportVersion !== null,
        updatedAt: input.now,
      });

      transaction.set(quoteRef, updatedQuote);
      transaction.create(
        this.db
          .collection(AUDIT_EVALUATION_COLLECTIONS.corrections)
          .doc(correction.id),
        correction,
      );
      transaction.set(caseRef, updatedCase);
      createReviewAuditLog(transaction, this.db, {
        caseId: input.caseId,
        documentId: correction.documentId,
        reportVersion: null,
        action: "CUSTOMER_QUOTE_CORRECTED",
        actor: input.actor,
        occurredAt: input.now,
        detail: `field:${input.field};revision:${newRevision}`,
      });
      return { quote: updatedQuote, correction, evaluationCase: updatedCase };
    });
  }

  async confirmCase(input: ConfirmCaseRepositoryInput) {
    return this.db.runTransaction(async (transaction) => {
      const caseRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.cases)
        .doc(input.caseId);
      const caseSnapshot = await transaction.get(caseRef);
      if (!caseSnapshot.exists) throw new ReviewServiceError("case_not_found");
      const evaluationCase = parseCase(caseSnapshot.data());
      if (
        evaluationCase.id !== input.caseId ||
        evaluationCase.status === "DELETED"
      ) {
        throw new ReviewServiceError("case_not_found");
      }

      const documentsQuery = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.documents)
        .where("caseId", "==", input.caseId);
      const quotesQuery = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.normalizedQuotes)
        .where("caseId", "==", input.caseId);
      const [documentSnapshot, quoteSnapshot, configSnapshot] =
        await Promise.all([
          transaction.get(documentsQuery),
          transaction.get(quotesQuery),
          transaction.get(this.configQuery(evaluationCase)),
        ]);
      const documents = parseActiveDocuments(
        documentSnapshot.docs.map((item) => item.data()),
      );
      const documentIds = new Set(documents.map(({ id }) => id));
      const quotes = parseConnectedQuotes(
        quoteSnapshot.docs.map((item) => item.data()),
        input.caseId,
        documentIds,
      );
      const config = parsePinnedConfig(
        configSnapshot.docs.map((item) => item.data()),
        evaluationCase,
      );
      const readiness = evaluateAuditEvaluationReadiness({
        evaluationCase,
        config,
        quotes,
        documents,
        now: input.now,
        requireCustomerConfirmation: false,
        expectedQuoteRevisions: input.expectedQuoteRevisions,
      });
      const issues = addRevisionMapIssues(
        readiness.issues,
        quotes,
        input.expectedQuoteRevisions,
      );
      if (issues.length > 0) {
        throw new ReviewServiceError(readinessErrorCode(issues), issues);
      }
      if (
        !canTransitionAuditEvaluationStatus(evaluationCase.status, "READY")
      ) {
        throw new ReviewServiceError("invalid_status_transition");
      }

      const confirmedQuotes = quotes
        .map((quote) =>
          parseQuote({
            ...quote,
            confirmedByCustomer: true,
            confirmedAt: input.now,
            revision: (quote.revision ?? 0) + 1,
            updatedAt: input.now,
          })
        )
        .sort((left, right) => left.quoteId.localeCompare(right.quoteId));
      const version = (evaluationCase.latestConfirmationVersion ?? 0) + 1;
      const evaluationConfigSnapshot =
        createEvaluationConfigSnapshot(config);
      const quoteDataSnapshots = createQuoteDataSnapshots(confirmedQuotes);
      const inputHash = hashConfirmationInput(
        evaluationConfigSnapshot,
        quoteDataSnapshots,
      );
      const confirmation = confirmationRecordSchema.parse({
        id: confirmationId(input.caseId, version),
        caseId: input.caseId,
        version,
        evaluationConfigSnapshot,
        quoteDataSnapshots,
        inputHash,
        finalAcknowledged: input.finalAcknowledged,
        confirmedBy: input.actor,
        confirmedAt: input.now,
      });
      const updatedCase = parseCase({
        ...evaluationCase,
        status: "READY",
        latestConfirmationVersion: version,
        confirmationVersion: version,
        confirmedQuoteCount: confirmedQuotes.length,
        reportRequestedConfirmationVersion: null,
        reportRegenerationRequired:
          evaluationCase.reportRegenerationRequired ?? false,
        updatedAt: input.now,
      });

      for (const quote of confirmedQuotes) {
        transaction.set(
          this.db
            .collection(AUDIT_EVALUATION_COLLECTIONS.normalizedQuotes)
            .doc(quote.quoteId),
          quote,
        );
      }
      transaction.create(
        this.db
          .collection(AUDIT_EVALUATION_COLLECTIONS.confirmations)
          .doc(confirmation.id),
        confirmation,
      );
      transaction.set(caseRef, updatedCase);
      createReviewAuditLog(transaction, this.db, {
        caseId: input.caseId,
        documentId: null,
        reportVersion: null,
        action: "CUSTOMER_FINAL_CONFIRMED",
        actor: input.actor,
        occurredAt: input.now,
        detail: `confirmationVersion:${version}`,
      });
      return { evaluationCase: updatedCase, confirmation };
    });
  }

  async confirmPartnerInboxQuotes(
    input: ConfirmPartnerInboxQuotesRepositoryInput,
  ) {
    if (input.quotes.length < 2) {
      throw new ReviewServiceError("readiness_failed");
    }
    if (!input.quotes.every((quote) => quote.confirmedByCustomer)) {
      throw new ReviewServiceError("confirmation_not_final");
    }
    return this.db.runTransaction(async (transaction) => {
      const caseRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.cases)
        .doc(input.caseId);
      const caseSnapshot = await transaction.get(caseRef);
      if (!caseSnapshot.exists) throw new ReviewServiceError("case_not_found");
      const evaluationCase = parseCase(caseSnapshot.data());
      if (
        evaluationCase.id !== input.caseId ||
        evaluationCase.status === "DELETED"
      ) {
        throw new ReviewServiceError("case_not_found");
      }
      if (
        evaluationCase.status === "READY" &&
        Number.isInteger(evaluationCase.confirmationVersion) &&
        (evaluationCase.confirmationVersion ?? 0) > 0
      ) {
        const existingVersion = evaluationCase.confirmationVersion!;
        const existingConfirmation = await transaction.get(
          this.db
            .collection(AUDIT_EVALUATION_COLLECTIONS.confirmations)
            .doc(confirmationId(input.caseId, existingVersion)),
        );
        if (existingConfirmation.exists) {
          return {
            evaluationCase,
            confirmation: parseConfirmation(existingConfirmation.data()),
          };
        }
      }
      if (
        !canTransitionAuditEvaluationStatus(evaluationCase.status, "READY")
      ) {
        throw new ReviewServiceError("invalid_status_transition");
      }
      const configSnapshot = await transaction.get(
        this.configQuery(evaluationCase),
      );
      const config = parsePinnedConfig(
        configSnapshot.docs.map((item) => item.data()),
        evaluationCase,
      );
      assertPublishedEffective(config, input.now);
      const confirmedQuotes = [...input.quotes]
        .map((quote) =>
          parseQuote({
            ...quote,
            caseId: input.caseId,
            confirmedByCustomer: true,
            confirmedAt: input.now,
            updatedAt: input.now,
          })
        )
        .sort((left, right) => left.quoteId.localeCompare(right.quoteId));
      const version = (evaluationCase.latestConfirmationVersion ?? 0) + 1;
      const evaluationConfigSnapshot =
        createEvaluationConfigSnapshot(config);
      const quoteDataSnapshots = createQuoteDataSnapshots(confirmedQuotes);
      const inputHash = hashConfirmationInput(
        evaluationConfigSnapshot,
        quoteDataSnapshots,
      );
      const confirmation = confirmationRecordSchema.parse({
        id: confirmationId(input.caseId, version),
        caseId: input.caseId,
        version,
        evaluationConfigSnapshot,
        quoteDataSnapshots,
        inputHash,
        finalAcknowledged: input.finalAcknowledged,
        confirmedBy: input.actor,
        confirmedAt: input.now,
      });
      const cooperativeNameSnapshot =
        input.cooperativeNameSnapshot?.trim() ||
        evaluationCase.cooperativeNameSnapshot;
      const fiscalYear =
        Number.isInteger(input.fiscalYear) &&
        input.fiscalYear !== undefined &&
        input.fiscalYear >= 2_000 &&
        input.fiscalYear <= 9_999
          ? input.fiscalYear
          : evaluationCase.fiscalYear;
      const updatedCase = parseCase({
        ...evaluationCase,
        status: "READY",
        latestConfirmationVersion: version,
        confirmationVersion: version,
        confirmedQuoteCount: confirmedQuotes.length,
        cooperativeNameSnapshot,
        fiscalYear,
        reportRequestedConfirmationVersion: null,
        reportRegenerationRequired:
          evaluationCase.reportRegenerationRequired ?? false,
        updatedAt: input.now,
      });

      for (const quote of confirmedQuotes) {
        transaction.set(
          this.db
            .collection(AUDIT_EVALUATION_COLLECTIONS.normalizedQuotes)
            .doc(quote.quoteId),
          quote,
        );
      }
      transaction.create(
        this.db
          .collection(AUDIT_EVALUATION_COLLECTIONS.confirmations)
          .doc(confirmation.id),
        confirmation,
      );
      transaction.set(caseRef, updatedCase);
      createReviewAuditLog(transaction, this.db, {
        caseId: input.caseId,
        documentId: null,
        reportVersion: null,
        action: "CUSTOMER_FINAL_CONFIRMED",
        actor: input.actor,
        occurredAt: input.now,
        detail: `inbox_partner_quotes:confirmationVersion:${version}`,
      });
      return { evaluationCase: updatedCase, confirmation };
    });
  }

  async requestReport(input: RequestReportRepositoryInput) {
    return this.db.runTransaction(async (transaction) => {
      const caseRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.cases)
        .doc(input.caseId);
      const confirmationRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.confirmations)
        .doc(confirmationId(input.caseId, input.confirmationVersion));
      const reportRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.reportRuns)
        .doc(createAuditEvaluationReportRunId(
          input.caseId,
          input.confirmationVersion,
        ));
      const [caseSnapshot, confirmationSnapshot, existingReportSnapshot] =
        await Promise.all([
          transaction.get(caseRef),
          transaction.get(confirmationRef),
          transaction.get(reportRef),
        ]);
      if (!caseSnapshot.exists) throw new ReviewServiceError("case_not_found");
      const evaluationCase = parseCase(caseSnapshot.data());
      if (
        evaluationCase.id !== input.caseId ||
        evaluationCase.status === "DELETED"
      ) {
        throw new ReviewServiceError("case_not_found");
      }
      if (!confirmationSnapshot.exists) {
        throw new ReviewServiceError("confirmation_not_found");
      }
      const confirmation = parseConfirmation(confirmationSnapshot.data());
      if (
        confirmation.caseId !== input.caseId ||
        confirmation.version !== input.confirmationVersion ||
        evaluationCase.confirmationVersion !== input.confirmationVersion
      ) {
        throw new ReviewServiceError("confirmation_version_conflict");
      }
      if (
        confirmation.quoteDataSnapshots.length === 0 ||
        confirmation.quoteDataSnapshots.some(
          ({ confirmedByCustomer }) => !confirmedByCustomer,
        )
      ) {
        throw new ReviewServiceError("confirmation_not_final");
      }
      assertPublishedEffective(
        confirmation.evaluationConfigSnapshot,
        confirmation.confirmedAt,
      );

      if (existingReportSnapshot.exists) {
        const existing = parseReport(existingReportSnapshot.data());
        if (
          existing.caseId !== input.caseId ||
          existing.confirmationVersion !== input.confirmationVersion ||
          existing.inputHash !== confirmation.inputHash
        ) {
          throw new ReviewServiceError("report_conflict");
        }
        const nextSnapshot = input.nhAuditEvaluationSnapshot;
        if (
          nextSnapshot &&
          nhAuditSnapshotNeedsRegeneration(
            existing.nhAuditEvaluationSnapshot,
            nextSnapshot,
          )
        ) {
          if (
            !canTransitionAuditEvaluationStatus(
              evaluationCase.status,
              "GENERATING",
            )
          ) {
            throw new ReviewServiceError("invalid_status_transition");
          }
          const reportId = createAuditEvaluationReportRunId(
            input.caseId,
            input.confirmationVersion,
          );
          if (
            nextSnapshot.reportId !== reportId ||
            nextSnapshot.evaluationId !== input.caseId ||
            nextSnapshot.quoteRequestId !== evaluationCase.quoteRequestId ||
            nextSnapshot.customerId !== input.actor.subjectId
          ) {
            throw new ReviewServiceError("report_conflict");
          }
          const regenerated = parseReport({
            ...existing,
            status: "PENDING",
            requestedAt: input.now,
            generationAttempt: 0,
            generationStartedAt: null,
            generationLeaseExpiresAt: null,
            nhAuditEvaluationSnapshot: nextSnapshot,
            htmlStoragePath: null,
            renderingReference: null,
            pdfStoragePath: null,
            generatedAt: null,
            generatedBy: input.actor,
            failureCode: null,
            failureMessage: null,
          });
          const updatedCase = parseCase({
            ...evaluationCase,
            status: "GENERATING",
            latestReportVersion: regenerated.reportVersion,
            reportRequestedConfirmationVersion: input.confirmationVersion,
            updatedAt: input.now,
            completedAt: null,
          });
          transaction.set(reportRef, regenerated, { merge: false });
          transaction.set(caseRef, updatedCase, { merge: false });
          createReviewAuditLog(transaction, this.db, {
            caseId: input.caseId,
            documentId: null,
            reportVersion: regenerated.reportVersion,
            action: "REPORT_GENERATION_REQUESTED",
            actor: input.actor,
            occurredAt: input.now,
            detail: "nh_audit_snapshot_regenerated",
          });
          return {
            evaluationCase: updatedCase,
            report: regenerated,
            replayed: false,
          };
        }
        return {
          evaluationCase,
          report: existing,
          replayed: true,
        };
      }
      if (evaluationCase.status !== "READY") {
        throw new ReviewServiceError("case_not_ready");
      }
      if (
        !canTransitionAuditEvaluationStatus(
          evaluationCase.status,
          "GENERATING",
        )
      ) {
        throw new ReviewServiceError("invalid_status_transition");
      }

      const reportVersion = input.confirmationVersion;
      const reportId = createAuditEvaluationReportRunId(
        input.caseId,
        reportVersion,
      );
      if (
        input.nhAuditEvaluationSnapshot &&
        (
          input.nhAuditEvaluationSnapshot.reportId !== reportId ||
          input.nhAuditEvaluationSnapshot.evaluationId !== input.caseId ||
          input.nhAuditEvaluationSnapshot.quoteRequestId !==
            evaluationCase.quoteRequestId ||
          input.nhAuditEvaluationSnapshot.customerId !==
            input.actor.subjectId
        )
      ) {
        throw new ReviewServiceError("report_conflict");
      }
      let scoreResult: EvaluationScoreResult;
      let feeAnalysis: FeeAnalysisResult;
      try {
        scoreResult = runDeterministicQualityScoring(
          confirmation.evaluationConfigSnapshot,
          confirmation.quoteDataSnapshots,
        );
        feeAnalysis = runDeterministicFeeAnalysis(
          confirmation.evaluationConfigSnapshot.feeAnalysisPolicy,
          confirmation.quoteDataSnapshots.map((quote) => ({
            quoteId: quote.quoteId,
            auditFee: quote.auditFee,
            vatIncluded: quote.vatIncluded,
            totalPlannedHours: quote.totalPlannedHours,
            partnerHours: quote.partnerHours,
          })),
        );
      } catch {
        throw new ReviewServiceError("evaluation_calculation_failed");
      }
      const report = reportRunSchema.parse({
        id: reportId,
        caseId: input.caseId,
        reportVersion,
        confirmationVersion: input.confirmationVersion,
        inputHash: confirmation.inputHash,
        status: "PENDING",
        requestedAt: input.now,
        generationAttempt: 0,
        generationStartedAt: null,
        generationLeaseExpiresAt: null,
        evaluationConfigSnapshot:
          confirmation.evaluationConfigSnapshot,
        quoteDataSnapshots: confirmation.quoteDataSnapshots,
        scoreResult,
        feeAnalysis,
        ...(input.nhAuditEvaluationSnapshot
          ? {
              nhAuditEvaluationSnapshot:
                input.nhAuditEvaluationSnapshot,
            }
          : {}),
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
        generatedBy: input.actor,
        failureCode: null,
        failureMessage: null,
      });
      const updatedCase = parseCase({
        ...evaluationCase,
        status: "GENERATING",
        latestReportVersion: reportVersion,
        reportRequestedConfirmationVersion: input.confirmationVersion,
        updatedAt: input.now,
      });

      transaction.create(reportRef, report);
      transaction.set(caseRef, updatedCase);
      createReviewAuditLog(transaction, this.db, {
        caseId: input.caseId,
        documentId: null,
        reportVersion,
        action: "EVALUATION_EXECUTED",
        actor: input.actor,
        occurredAt: input.now,
        detail: `confirmationVersion:${input.confirmationVersion}`,
      });
      createReviewAuditLog(transaction, this.db, {
        caseId: input.caseId,
        documentId: null,
        reportVersion,
        action: "REPORT_GENERATION_REQUESTED",
        actor: input.actor,
        occurredAt: input.now,
        detail: "new_report_version",
      });
      return { evaluationCase: updatedCase, report, replayed: false };
    });
  }

  private configQuery(evaluationCase: AuditEvaluationCase) {
    return this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.configVersions)
      .where("id", "==", evaluationCase.evaluationConfigVersion.id)
      .where(
        "version",
        "==",
        evaluationCase.evaluationConfigVersion.version,
      )
      .limit(2);
  }

  private async loadTrustedRecords(
    documents: readonly UploadedQuoteDocument[],
  ) {
    const entries = await Promise.all(
      documents.flatMap((document) =>
        document.matchedQuoteDocumentId
          ? [this.db
              .collection(
                AUDIT_EVALUATION_COLLECTIONS.standardQuoteDocuments,
              )
              .doc(document.matchedQuoteDocumentId)
              .get()
              .then((snapshot) => [
                document.id,
                parseOptionalTrustedRecord(snapshot.data()),
              ] as const)]
          : []
      ),
    );
    return new Map(entries);
  }
}

function parseCase(value: unknown) {
  const parsed = evaluationCaseSchema.safeParse(value);
  if (!parsed.success) throw new ReviewServiceError("data_integrity_error");
  return parsed.data;
}

function createReviewAuditLog(
  transaction: Transaction,
  db: Firestore,
  input: {
    caseId: string;
    documentId: string | null;
    reportVersion: number | null;
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
    reportVersion: input.reportVersion,
    documentId: input.documentId,
    action: input.action,
    actor: input.actor,
    occurredAt: input.occurredAt,
    detail: input.detail.slice(0, 500),
    errorCode: null,
    retryCount: null,
  });
}

export function assertExpectedQuoteRevision(
  currentRevision: number,
  expectedRevision: number,
) {
  if (currentRevision !== expectedRevision) {
    throw new ReviewServiceError("version_conflict");
  }
}

export function requiresAdminReviewForCorrection(
  policyEnabled: boolean,
  field: NormalizedAuditQuoteField,
  correctedValue: QuoteEvidenceValue,
  trustedOrOriginalValue: QuoteEvidenceValue,
) {
  return (
    policyEnabled &&
    isCoreField(field) &&
    !sameValue(correctedValue, trustedOrOriginalValue)
  );
}

function parseDocument(value: unknown) {
  const parsed = uploadedQuoteDocumentSchema.safeParse(value);
  if (!parsed.success) throw new ReviewServiceError("data_integrity_error");
  return parsed.data;
}

function parseQuote(value: unknown) {
  const parsed = normalizedAuditQuoteSchema.safeParse(value);
  if (!parsed.success) throw new ReviewServiceError("data_integrity_error");
  return parsed.data;
}

function parseCorrectedQuote(value: unknown) {
  const parsed = normalizedAuditQuoteSchema.safeParse(value);
  if (!parsed.success) {
    throw new ReviewServiceError("invalid_correction_value");
  }
  return parsed.data;
}

function parseConfirmation(value: unknown) {
  const parsed = confirmationRecordSchema.safeParse(value);
  if (!parsed.success) throw new ReviewServiceError("data_integrity_error");
  return parsed.data;
}

function parseReport(value: unknown) {
  const parsed = reportRunSchema.safeParse(value);
  if (!parsed.success) throw new ReviewServiceError("data_integrity_error");
  return parsed.data;
}

function parsePinnedConfig(
  values: readonly unknown[],
  evaluationCase: AuditEvaluationCase,
) {
  const matches = values.flatMap((value) => {
    const parsed = evaluationConfigSchema.safeParse(value);
    return parsed.success &&
      parsed.data.id === evaluationCase.evaluationConfigVersion.id &&
      parsed.data.version === evaluationCase.evaluationConfigVersion.version
      ? [parsed.data]
      : [];
  });
  if (matches.length !== 1) {
    throw new ReviewServiceError(
      matches.length === 0 ? "config_not_found" : "data_integrity_error",
    );
  }
  return matches[0];
}

function parseActiveDocuments(values: readonly unknown[]) {
  return values
    .flatMap((value) => {
      const parsed = uploadedQuoteDocumentSchema.safeParse(value);
      if (!parsed.success) {
        throw new ReviewServiceError("data_integrity_error");
      }
      return parsed.data.uploadStatus === "DELETED" ? [] : [parsed.data];
    })
    .sort((left, right) => left.uploadedAt.localeCompare(right.uploadedAt));
}

function parseConnectedQuotes(
  values: readonly unknown[],
  caseId: string,
  activeDocumentIds: ReadonlySet<string>,
) {
  return values
    .flatMap((value) => {
      const parsed = normalizedAuditQuoteSchema.safeParse(value);
      if (!parsed.success) {
        throw new ReviewServiceError("data_integrity_error");
      }
      return parsed.data.caseId === caseId &&
        activeDocumentIds.has(parsed.data.documentId)
        ? [parsed.data]
        : [];
    })
    .sort((left, right) => left.quoteId.localeCompare(right.quoteId));
}

function parseOptionalTrustedRecord(value: unknown) {
  if (value === undefined) return null;
  const parsed = standardQuoteDocumentRecordSchema.safeParse(value);
  if (!parsed.success) throw new ReviewServiceError("data_integrity_error");
  return parsed.data.status === "ACTIVE" ? parsed.data : null;
}

function isCoreField(
  field: NormalizedAuditQuoteField,
): field is (typeof coreFields)[number] {
  return coreFields.includes(field as (typeof coreFields)[number]);
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

function trustedValueForField(
  quote: NormalizedAuditQuote,
  field: NormalizedAuditQuoteField,
  trustedRecord: StandardQuoteDocumentRecord | null,
) {
  const evidence = (quote.evidenceByField[field] ?? []).find(
    ({ source }) => source === "TRUSTED_SERVER_RECORD",
  );
  if (evidence) return evidence.normalizedValue;
  if (trustedRecord) {
    return toEvidenceValue(trustedRecord.normalizedPayload[field]);
  }
  return undefined;
}

function trustedMismatchFields(
  quote: NormalizedAuditQuote,
  trustedRecord: StandardQuoteDocumentRecord | null,
) {
  return coreFields.filter((field) => {
    const trusted = trustedValueForField(quote, field, trustedRecord);
    return trusted !== undefined &&
      !sameValue(toEvidenceValue(quote[field]), trusted);
  });
}

function projectWorkspaceQuote(
  quote: NormalizedAuditQuote,
  trustedRecord: StandardQuoteDocumentRecord | null,
): ReviewWorkspaceQuote {
  return {
    quoteId: quote.quoteId,
    accountingFirmName: quote.accountingFirmName,
    auditFee: quote.auditFee,
    vatIncluded: quote.vatIncluded,
    accountingFirmRevenue: quote.accountingFirmRevenue,
    recentNonghyupAuditCount: quote.recentNonghyupAuditCount,
    auditedNonghyupTypes: quote.auditedNonghyupTypes,
    taxAgencyExperience: quote.taxAgencyExperience,
    subsidySettlementExperience: quote.subsidySettlementExperience,
    engagementPartner: quote.engagementPartner,
    engagementTeam: quote.engagementTeam,
    totalPlannedHours: quote.totalPlannedHours,
    auditSchedule: quote.auditSchedule,
    qualityControlPlan: quote.qualityControlPlan,
    requiredProposalItems: quote.requiredProposalItems,
    confirmedByCustomer: quote.confirmedByCustomer,
    pendingAdminReviewFields: quote.pendingAdminReviewFields,
    revision: quote.revision ?? 0,
    trustedMismatchFields: trustedMismatchFields(quote, trustedRecord),
  };
}

function updateTrustedMismatchWarning(
  quote: NormalizedAuditQuote,
  field: NormalizedAuditQuoteField,
  trustedValue: QuoteEvidenceValue | undefined,
) {
  const warningCode = "CUSTOMER_CORRECTION_TRUSTED_VALUE_MISMATCH";
  const remaining = quote.warnings.filter(
    (warning) => !(warning.code === warningCode && warning.field === field),
  );
  if (
    !isCoreField(field) ||
    trustedValue === undefined ||
    sameValue(toEvidenceValue(quote[field]), trustedValue)
  ) {
    return remaining;
  }
  return [
    ...remaining,
    { code: warningCode, field, message: warningCode },
  ];
}

function setQuoteField(
  quote: NormalizedAuditQuote,
  field: NormalizedAuditQuoteField,
  value: QuoteEvidenceValue,
) {
  (quote as unknown as Record<NormalizedAuditQuoteField, unknown>)[field] =
    value;
}

function sortFields(fields: readonly NormalizedAuditQuoteField[]) {
  const values = new Set(fields);
  return NORMALIZED_AUDIT_QUOTE_FIELDS.filter((field) => values.has(field));
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
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        toEvidenceValue(item),
      ]),
    );
  }
  return null;
}

function sameValue(left: QuoteEvidenceValue, right: QuoteEvidenceValue) {
  return stableSerialize(left) === stableSerialize(right);
}

function addRevisionMapIssues(
  issues: readonly AuditEvaluationReadinessIssue[],
  quotes: readonly NormalizedAuditQuote[],
  expected: Readonly<Record<string, number>>,
) {
  const result = [...issues];
  const quoteIds = new Set(quotes.map(({ quoteId }) => quoteId));
  for (const quote of quotes) {
    if (expected[quote.quoteId] === undefined) {
      result.push({
        code: "QUOTE_REVISION_CONFLICT",
        quoteId: quote.quoteId,
        field: null,
      });
    }
  }
  for (const quoteId of Object.keys(expected)) {
    if (!quoteIds.has(quoteId)) {
      result.push({
        code: "QUOTE_REVISION_CONFLICT",
        quoteId,
        field: null,
      });
    }
  }
  return [...new Map(
    result.map((issue) => [
      `${issue.code}|${issue.quoteId ?? ""}|${issue.field ?? ""}`,
      issue,
    ]),
  ).values()];
}

function readinessErrorCode(
  issues: readonly AuditEvaluationReadinessIssue[],
) {
  if (issues.some(({ code }) => code === "QUOTE_REVISION_CONFLICT")) {
    return "version_conflict";
  }
  if (issues.some(({ code }) => code === "CONFIG_NOT_PUBLISHED")) {
    return "config_not_published";
  }
  if (issues.some(({ code }) => code === "CONFIG_NOT_EFFECTIVE")) {
    return "config_not_effective";
  }
  return "readiness_failed";
}

function assertPublishedEffective(
  config: EvaluationConfigSnapshot,
  now: string,
) {
  if (config.status !== "PUBLISHED") {
    throw new ReviewServiceError("config_not_published");
  }
  const nowMs = Date.parse(now);
  if (
    !Number.isFinite(nowMs) ||
    (config.effectiveFrom &&
      Date.parse(config.effectiveFrom) > nowMs) ||
    (config.effectiveTo &&
      Date.parse(config.effectiveTo) <= nowMs)
  ) {
    throw new ReviewServiceError("config_not_effective");
  }
}

function confirmationId(caseId: string, version: number) {
  return `aec_${caseId}_${version}`;
}

export function createAuditEvaluationReportRunId(
  caseId: string,
  version: number,
) {
  return `aerr_${caseId}_${version}`;
}

function hashConfirmationInput(
  config: EvaluationConfigSnapshot,
  quotes: readonly QuoteDataSnapshot[],
) {
  return createHash("sha256")
    .update(stableSerialize({
      evaluationConfigSnapshot: config,
      quoteDataSnapshots: quotes,
    }), "utf8")
    .digest("hex");
}

function stableSerialize(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ReviewServiceError("data_integrity_error");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) =>
      `${JSON.stringify(key)}:${stableSerialize(item)}`
    ).join(",")}}`;
  }
  throw new ReviewServiceError("data_integrity_error");
}
