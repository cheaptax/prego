import { isValidIdempotencyKey } from "@/lib/audit-quote/idempotency";
import {
  getAuditEvaluationAccessSecret,
  addMinutes,
} from "@/lib/audit-evaluation/customer-access-token";
import {
  assertAuditEvaluationCapabilityEnabled,
  getServerFeatureFlags,
  type AuditEvaluationFeatureFlags,
} from "@/lib/audit-evaluation/feature-flags";
import {
  resolveAuditQuoteCustomerStatus,
  type AuditQuoteCustomerStatus,
} from "@/lib/audit-evaluation/document-customer-status";
import { scanAuditEvaluationPdf } from "@/lib/audit-evaluation/document-security-scan";
import { StandardQuoteDocumentService } from "@/lib/audit-evaluation/standard-quote-service";
import { sha256Bytes } from "@/lib/audit-evaluation/standard-quote-identity";
import type {
  AuditEvaluationActor,
  AuditEvaluationCase,
  QuoteDocumentMatchResult,
  QuoteParsingQueueRecord,
  QuoteUploadIntent,
  UploadedQuoteDocument,
} from "@/lib/audit-evaluation/types";
import {
  createUploadedQuoteDocumentId,
  createUploadIntentId,
  hashUploadIdempotencyKey,
  originalUploadPath,
  quarantineUploadPath,
} from "@/lib/audit-evaluation/upload-identity";
import {
  createAuditQuoteUploadPolicy,
  inspectAuditQuotePdf,
  safeAuditQuoteDisplayName,
  validateAuditQuoteUploadDescriptor,
} from "@/lib/audit-evaluation/upload-policy";
import {
  FirestoreAuditEvaluationUploadRepository,
  type AuditEvaluationUploadRepository,
} from "@/lib/audit-evaluation/upload-repository";
import {
  FirebaseAuditEvaluationUploadStorage,
  type AuditEvaluationUploadStorage,
} from "@/lib/audit-evaluation/upload-storage";

export type AuditEvaluationUploadPublicDocument = {
  id: string;
  displayName: string;
  mimeType: string;
  size: number;
  uploadStatus: UploadedQuoteDocument["uploadStatus"];
  scanStatus: UploadedQuoteDocument["scanStatus"];
  parsingStatus: UploadedQuoteDocument["parsingStatus"];
  matchStatus: UploadedQuoteDocument["matchStatus"];
  customerStatus: AuditQuoteCustomerStatus;
  uploadedAt: string;
};

type StandardQuoteMatcher = {
  matchUploadedQuoteDocument(input: {
    evaluationCase: Pick<
      AuditEvaluationCase,
      "id" | "quoteRequestId" | "fiscalYear"
    >;
    uploadedDocumentId: string;
    uploadedSha256: string;
    embeddedIdentity: unknown | null;
    observedPayloadChecksum?: string | null;
    legacyCandidate: boolean;
  }): Promise<QuoteDocumentMatchResult>;
};

export class AuditEvaluationUploadError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "AuditEvaluationUploadError";
    this.code = code;
  }
}

export class AuditEvaluationUploadService {
  private readonly repository: AuditEvaluationUploadRepository;
  private readonly storage: AuditEvaluationUploadStorage;
  private readonly matcher: StandardQuoteMatcher | null;
  private readonly accessSecret: string;
  private readonly flags: AuditEvaluationFeatureFlags;

  constructor(
    repository: AuditEvaluationUploadRepository =
      new FirestoreAuditEvaluationUploadRepository(),
    options: {
      storage?: AuditEvaluationUploadStorage;
      matcher?: StandardQuoteMatcher | null;
      accessSecret?: string;
      flags?: AuditEvaluationFeatureFlags;
    } = {},
  ) {
    this.repository = repository;
    this.storage =
      options.storage ?? new FirebaseAuditEvaluationUploadStorage();
    this.flags =
      options.flags ?? getServerFeatureFlags().auditEvaluation;
    this.accessSecret =
      options.accessSecret ?? getAuditEvaluationAccessSecret();
    this.matcher =
      options.matcher === undefined
        ? createDefaultMatcher(this.flags)
        : options.matcher;
  }

  async getUploadWorkspace(evaluationCase: AuditEvaluationCase) {
    this.assertEnabled();
    const policy = await this.getPolicy(evaluationCase);
    const documents = await this.repository.listDocuments(
      evaluationCase.id,
    );
    return {
      policy,
      documents: documents.map(toPublicDocument),
    };
  }

  async createUploadIntent(input: {
    evaluationCase: AuditEvaluationCase;
    fileName: string;
    mimeType: string;
    size: number;
    idempotencyKey: string;
    now: string;
  }) {
    this.assertEnabled();
    if (!isValidIdempotencyKey(input.idempotencyKey)) {
      throw new AuditEvaluationUploadError("invalid_idempotency_key");
    }
    const policy = await this.getPolicy(input.evaluationCase);
    const descriptorError = validateAuditQuoteUploadDescriptor(
      input,
      policy,
    );
    if (descriptorError) {
      throw new AuditEvaluationUploadError(descriptorError);
    }
    const intentId = createUploadIntentId(
      input.evaluationCase.id,
      input.idempotencyKey,
      this.accessSecret,
    );
    const safeDisplayName = safeAuditQuoteDisplayName(input.fileName);
    const expiresAt = addMinutes(input.now, 15);
    const proposed: QuoteUploadIntent = {
      id: intentId,
      caseId: input.evaluationCase.id,
      documentId: createUploadedQuoteDocumentId(),
      idempotencyKeyHash: hashUploadIdempotencyKey(
        input.evaluationCase.id,
        input.idempotencyKey,
        this.accessSecret,
      ),
      originalFileName: safeDisplayName,
      safeDisplayName,
      extension: ".pdf",
      mimeType: "application/pdf",
      declaredSize: input.size,
      quarantineStoragePath: quarantineUploadPath(
        input.evaluationCase.id,
        intentId,
      ),
      status: "PENDING",
      scanStatus: "PENDING",
      failureCode: null,
      expiresAt,
      createdAt: input.now,
      completedAt: null,
    };
    let stored;
    try {
      stored = await this.repository.createOrGetIntent(
        proposed,
        policy.maximumQuoteCount,
        input.now,
      );
    } catch (error) {
      throw uploadError(error);
    }
    if (stored.intent.status === "COMPLETED") {
      return {
        completed: true,
        intentId: stored.intent.id,
        documentId: stored.intent.documentId,
        uploadUrl: null,
        expiresAt: stored.intent.expiresAt,
      };
    }
    if (
      stored.intent.status === "FAILED" ||
      stored.intent.status === "EXPIRED"
    ) {
      throw new AuditEvaluationUploadError(
        stored.intent.failureCode ?? "upload_intent_failed",
      );
    }
    const uploadUrl = await this.storage.createUploadUrl({
      storagePath: stored.intent.quarantineStoragePath,
      mimeType: stored.intent.mimeType,
      expiresAt: stored.intent.expiresAt,
    });
    return {
      completed: false,
      intentId: stored.intent.id,
      documentId: stored.intent.documentId,
      uploadUrl,
      expiresAt: stored.intent.expiresAt,
      requiredHeaders: {
        "content-type": stored.intent.mimeType,
      },
    };
  }

  async finalizeUpload(input: {
    evaluationCase: AuditEvaluationCase;
    actor: AuditEvaluationActor;
    intentId: string;
    idempotencyKey: string;
    now: string;
  }) {
    this.assertEnabled();
    if (!isValidIdempotencyKey(input.idempotencyKey)) {
      throw new AuditEvaluationUploadError("invalid_idempotency_key");
    }
    let intent: QuoteUploadIntent;
    try {
      intent = await this.repository.markIntentFinalizing(
        input.evaluationCase.id,
        input.intentId,
        input.now,
      );
    } catch (error) {
      throw uploadError(error);
    }
    const expectedHash = hashUploadIdempotencyKey(
      input.evaluationCase.id,
      input.idempotencyKey,
      this.accessSecret,
    );
    if (intent.idempotencyKeyHash !== expectedHash) {
      throw new AuditEvaluationUploadError("idempotency_conflict");
    }
    if (intent.status === "EXPIRED") {
      await this.storage
        .delete(intent.quarantineStoragePath)
        .catch(() => undefined);
      throw new AuditEvaluationUploadError("upload_intent_expired");
    }
    if (intent.status === "COMPLETED") {
      const existing = await this.repository.getDocument(
        input.evaluationCase.id,
        intent.documentId,
      );
      if (!existing) {
        throw new AuditEvaluationUploadError("finalize_failed");
      }
      return toPublicDocument(existing);
    }

    const policy = await this.getPolicy(input.evaluationCase);
    const stored = await this.storage.read(
      intent.quarantineStoragePath,
      policy.maximumFileSize,
    );
    const metadataError = validateStoredObject(intent, stored, policy);
    if (metadataError) {
      await this.rejectIntent(intent, metadataError, input.now);
      throw new AuditEvaluationUploadError(metadataError);
    }
    const inspection = inspectAuditQuotePdf(stored.bytes);
    if (inspection.error) {
      await this.rejectIntent(intent, inspection.error, input.now);
      throw new AuditEvaluationUploadError(inspection.error);
    }
    const sha256 = sha256Bytes(stored.bytes);
    let match: QuoteDocumentMatchResult | null;
    try {
      match = await this.matchDocument(
        input.evaluationCase,
        intent.documentId,
        sha256,
        inspection.embeddedIdentity,
      );
    } catch (error) {
      const code = error instanceof AuditEvaluationUploadError
        ? error.code
        : "document_matching_failed";
      await this.rejectIntent(intent, code, input.now);
      throw new AuditEvaluationUploadError(code);
    }
    if (inspection.embeddedIdentity && !match) {
      await this.rejectIntent(intent, "document_matching_failed", input.now);
      throw new AuditEvaluationUploadError("document_matching_failed");
    }
    if (match?.status === "WRONG_CASE") {
      await this.rejectIntent(intent, "wrong_case", input.now);
      throw new AuditEvaluationUploadError("wrong_case");
    }
    if (match?.status === "DUPLICATE") {
      await this.rejectIntent(intent, "duplicate_document", input.now);
      throw new AuditEvaluationUploadError("duplicate_document");
    }
    if (
      match?.status === "INVALID_SIGNATURE" ||
      match?.status === "UNRECOGNIZED"
    ) {
      await this.rejectIntent(intent, "document_integrity_failed", input.now);
      throw new AuditEvaluationUploadError("document_integrity_failed");
    }
    const matchedQuoteDocumentId = match?.quoteDocumentId ?? null;
    const duplicate = await this.repository.findDuplicate(
      input.evaluationCase.id,
      sha256,
      matchedQuoteDocumentId,
    );
    if (duplicate) {
      await this.rejectIntent(intent, "duplicate_document", input.now);
      throw new AuditEvaluationUploadError("duplicate_document");
    }

    const scan = scanAuditEvaluationPdf(stored.bytes);
    if (scan.status !== "CLEAN") {
      await this.rejectIntent(intent, "security_scan_rejected", input.now);
      throw new AuditEvaluationUploadError("security_scan_rejected");
    }

    const destinationPath = originalUploadPath(
      input.evaluationCase.id,
      intent.documentId,
    );
    await this.storage.promote({
      sourcePath: intent.quarantineStoragePath,
      destinationPath,
      caseId: input.evaluationCase.id,
      documentId: intent.documentId,
      mimeType: intent.mimeType,
    });
    const document = createDocument({
      intent,
      actor: input.actor,
      destinationPath,
      sha256,
      match,
      scanStatus: scan.status,
      now: input.now,
    });
    const queue: QuoteParsingQueueRecord = {
      id: `apq_${intent.documentId}`,
      caseId: intent.caseId,
      documentId: intent.documentId,
      status: "PENDING_REVIEW",
      attempts: 0,
      availableAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
      lastErrorCode: null,
    };
    try {
      const finalized = await this.repository.finalizeDocument({
        intent,
        document,
        queue,
        normalizedQuote: match?.normalizedQuote ?? null,
        now: input.now,
      });
      if (finalized.kind === "duplicate") {
        await this.storage.delete(destinationPath).catch(() => undefined);
        await this.rejectIntent(
          intent,
          "duplicate_document",
          input.now,
        );
        throw new AuditEvaluationUploadError("duplicate_document");
      }
      await this.storage
        .delete(intent.quarantineStoragePath)
        .catch(() => undefined);
      return toPublicDocument(finalized.document);
    } catch (error) {
      if (
        error instanceof AuditEvaluationUploadError &&
        error.code === "duplicate_document"
      ) {
        throw error;
      }
      await this.storage.delete(destinationPath).catch(() => undefined);
      throw uploadError(error);
    }
  }

  async deleteDocument(input: {
    evaluationCase: AuditEvaluationCase;
    actor: AuditEvaluationActor;
    documentId: string;
    now: string;
  }) {
    this.assertEnabled();
    const document = await this.repository.deleteDocument({
      caseId: input.evaluationCase.id,
      documentId: input.documentId,
      deletedAt: input.now,
      deletedBy: input.actor,
    });
    if (!document) {
      throw new AuditEvaluationUploadError("document_not_found");
    }
    if (document.scanStatus !== "CLEAN") {
      throw new AuditEvaluationUploadError("document_scan_incomplete");
    }
    await this.storage.delete(document.storagePath).catch(() => undefined);
    return { deleted: true };
  }

  async createDownloadUrl(input: {
    evaluationCase: AuditEvaluationCase;
    documentId: string;
    now: string;
  }) {
    this.assertEnabled();
    const document = await this.repository.getDocument(
      input.evaluationCase.id,
      input.documentId,
    );
    if (!document) {
      throw new AuditEvaluationUploadError("document_not_found");
    }
    const expiresAt = addMinutes(input.now, 5);
    return {
      url: await this.storage.createDownloadUrl(
        document.storagePath,
        expiresAt,
      ),
      expiresAt,
    };
  }

  private assertEnabled() {
    assertAuditEvaluationCapabilityEnabled(
      "customerEntryEnabled",
      this.flags,
    );
  }

  private async getPolicy(evaluationCase: AuditEvaluationCase) {
    const config = await this.repository.getConfig(
      evaluationCase.evaluationConfigVersion,
    );
    if (!config) {
      throw new AuditEvaluationUploadError(
        "evaluation_config_not_found",
      );
    }
    const policy = createAuditQuoteUploadPolicy(config);
    if (policy.allowedMimeTypes.length === 0) {
      throw new AuditEvaluationUploadError("upload_not_configured");
    }
    return policy;
  }

  private async rejectIntent(
    intent: QuoteUploadIntent,
    failureCode: string,
    now: string,
  ) {
    await Promise.all([
      this.repository.markIntentFailed(
        intent.caseId,
        intent.id,
        failureCode,
        now,
      ),
      this.storage
        .delete(intent.quarantineStoragePath)
        .catch(() => undefined),
    ]);
  }

  private async matchDocument(
    evaluationCase: AuditEvaluationCase,
    documentId: string,
    sha256: string,
    embeddedIdentity: unknown | null,
  ) {
    if (!this.matcher) {
      if (embeddedIdentity) {
        throw new AuditEvaluationUploadError("document_matching_required");
      }
      return null;
    }
    try {
      return await this.matcher.matchUploadedQuoteDocument({
        evaluationCase,
        uploadedDocumentId: documentId,
        uploadedSha256: sha256,
        embeddedIdentity,
        legacyCandidate: embeddedIdentity === null,
      });
    } catch {
      throw new AuditEvaluationUploadError("document_matching_failed");
    }
  }
}

function createDocument(input: {
  intent: QuoteUploadIntent;
  actor: AuditEvaluationActor;
  destinationPath: string;
  sha256: string;
  match: QuoteDocumentMatchResult | null;
  scanStatus: UploadedQuoteDocument["scanStatus"];
  now: string;
}): UploadedQuoteDocument {
  const integrityStatus =
    input.match?.status === "VERIFIED"
      ? "VERIFIED"
      : input.match?.status === "VERIFIED_WITH_FILE_DIFFERENCE"
        ? "MISMATCH"
        : input.match?.status === "INVALID_SIGNATURE"
          ? "FAILED"
          : "PENDING";
  return {
    id: input.intent.documentId,
    caseId: input.intent.caseId,
    originalFileName: input.intent.originalFileName,
    safeDisplayName: input.intent.safeDisplayName,
    storagePath: input.destinationPath,
    mimeType: input.intent.mimeType,
    size: input.intent.declaredSize,
    sha256: input.sha256,
    uploadStatus: "UPLOADED",
    scanStatus: input.scanStatus,
    parsingStatus: "PENDING",
    matchedQuoteDocumentId:
      input.match?.quoteDocumentId ?? null,
    matchStatus: input.match?.status ?? null,
    integrityStatus,
    uploadedAt: input.now,
    uploadedBy: input.actor,
    deletedAt: null,
    deletedBy: null,
  };
}

function validateStoredObject(
  intent: QuoteUploadIntent,
  stored: {
    exists: boolean;
    size: number;
    mimeType: string;
    bytes: Uint8Array;
  },
  policy: {
    maximumFileSize: number;
  },
) {
  if (!stored.exists) return "upload_not_found";
  if (stored.size <= 0) return "empty_file";
  if (stored.size > policy.maximumFileSize) return "file_too_large";
  if (stored.bytes.byteLength <= 0) return "upload_mismatch";
  if (
    stored.size !== intent.declaredSize ||
    stored.bytes.byteLength !== stored.size
  ) {
    return "upload_mismatch";
  }
  if (stored.mimeType !== intent.mimeType) {
    return "unsupported_file_type";
  }
  return null;
}

function toPublicDocument(
  document: UploadedQuoteDocument,
): AuditEvaluationUploadPublicDocument {
  return {
    id: document.id,
    displayName: document.safeDisplayName,
    mimeType: document.mimeType,
    size: document.size,
    uploadStatus: document.uploadStatus,
    scanStatus: document.scanStatus,
    parsingStatus: document.parsingStatus,
    matchStatus: document.matchStatus,
    customerStatus: resolveAuditQuoteCustomerStatus(document),
    uploadedAt: document.uploadedAt,
  };
}

function createDefaultMatcher(
  flags: AuditEvaluationFeatureFlags,
): StandardQuoteMatcher | null {
  try {
    return new StandardQuoteDocumentService(undefined, undefined, flags);
  } catch {
    return null;
  }
}

function uploadError(error: unknown) {
  if (error instanceof AuditEvaluationUploadError) return error;
  const code = error instanceof Error ? error.message : "upload_failed";
  const publicCodes = new Set([
    "case_not_found",
    "case_not_uploadable",
    "too_many_files",
    "idempotency_conflict",
    "upload_intent_not_found",
    "upload_intent_expired",
    "upload_intent_failed",
    "duplicate_document",
    "document_not_found",
    "document_integrity_failed",
    "document_matching_failed",
    "document_matching_required",
    "document_scan_incomplete",
    "security_scan_rejected",
  ]);
  return new AuditEvaluationUploadError(
    publicCodes.has(code) ? code : "upload_failed",
  );
}

export function auditEvaluationUploadErrorStatus(code: string) {
  if (code === "document_not_found") return 404;
  if (code === "too_many_files") return 409;
  if (
    code === "duplicate_document" ||
    code === "idempotency_conflict"
  ) {
    return 409;
  }
  if (
    code === "case_not_found" ||
    code === "case_not_uploadable"
  ) {
    return 403;
  }
  return 400;
}
