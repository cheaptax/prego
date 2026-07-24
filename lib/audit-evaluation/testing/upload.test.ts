import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type {
  AuditEvaluationUploadRepository,
  FinalizeUploadRepositoryResult,
} from "@/lib/audit-evaluation/upload-repository";
import type {
  AuditEvaluationStoredUpload,
  AuditEvaluationUploadStorage,
} from "@/lib/audit-evaluation/upload-storage";
import {
  AuditEvaluationUploadError,
  AuditEvaluationUploadService,
} from "@/lib/audit-evaluation/upload-service";
import {
  createAuditQuoteUploadPolicy,
  inspectAuditQuotePdf,
  validateAuditQuoteUploadDescriptor,
} from "@/lib/audit-evaluation/upload-policy";
import {
  uploadWithNetworkRetry,
  type AuditEvaluationUploadTransport,
} from "@/lib/audit-evaluation/upload-client";
import type {
  AuditEvaluationActor,
  AuditEvaluationCase,
  EvaluationConfig,
  NormalizedAuditQuote,
  QuoteDocumentMatchResult,
  QuoteParsingQueueRecord,
  QuoteUploadIntent,
  UploadedQuoteDocument,
  VersionReference,
} from "@/lib/audit-evaluation/types";
import {
  createQuoteDocumentIdentity,
  serializeEmbeddedQuoteDocumentIdentity,
} from "@/lib/audit-evaluation/standard-quote-identity";
import {
  createTrustedStandardQuotePayload,
  createValidEvaluationConfig,
} from "@/lib/audit-evaluation/testing/fixtures";

const NOW = "2026-07-21T00:00:00.000Z";
const SECRET = "upload-access-secret-that-is-at-least-32-bytes";
const FLAGS = {
  enabled: true,
  customerEntryEnabled: true,
  reportDownloadEnabled: false,
  adminEnabled: false,
  aiNarrativeEnabled: false,
};
const ACTOR: AuditEvaluationActor = {
  type: "CUSTOMER",
  subjectId: "customer-1",
};
const CASE: AuditEvaluationCase = {
  id: "aec_case123456789",
  quoteRequestId: "request-1",
  cooperativeId: null,
  cooperativeNameSnapshot: "",
  fiscalYear: 2027,
  customerAccessOwner: {
    type: "CAPABILITY_SUBJECT",
    subjectId: "customer-1",
  },
  status: "UPLOADING",
  quoteTemplateVersion: null,
  evaluationConfigVersion: { id: "fy27.default", version: 1 },
  latestReportVersion: null,
  expectedQuoteCount: 2,
  confirmedQuoteCount: 0,
  expiresAt: "2026-08-21T00:00:00.000Z",
  createdAt: NOW,
  updatedAt: NOW,
  completedAt: null,
};

class MemoryUploadRepository
  implements AuditEvaluationUploadRepository
{
  config: EvaluationConfig = {
    ...createValidEvaluationConfig(),
    status: "PUBLISHED",
    publishedBy: "admin",
    publishedAt: NOW,
    permittedMimeTypes: ["application/pdf"],
  };
  readonly intents = new Map<string, QuoteUploadIntent>();
  readonly documents = new Map<string, UploadedQuoteDocument>();
  readonly queues = new Map<string, QuoteParsingQueueRecord>();

  async getConfig(reference: VersionReference) {
    return this.config.id === reference.id &&
      this.config.version === reference.version
      ? this.config
      : null;
  }

  async createOrGetIntent(
    value: QuoteUploadIntent,
    maximumQuoteCount: number,
  ) {
    const existing = this.intents.get(value.id);
    if (existing) return { intent: existing, replayed: true };
    const activeDocuments = [...this.documents.values()].filter(
      (document) =>
        document.caseId === value.caseId &&
        document.uploadStatus !== "DELETED",
    ).length;
    const activeIntents = [...this.intents.values()].filter(
      (intent) =>
        intent.caseId === value.caseId &&
        ["PENDING", "UPLOADED", "FINALIZING"].includes(intent.status),
    ).length;
    if (activeDocuments + activeIntents >= maximumQuoteCount) {
      throw new Error("too_many_files");
    }
    this.intents.set(value.id, value);
    return { intent: value, replayed: false };
  }

  async getIntent(caseId: string, intentId: string) {
    const intent = this.intents.get(intentId);
    return intent?.caseId === caseId ? intent : null;
  }

  async markIntentFinalizing(caseId: string, intentId: string) {
    const intent = await this.getIntent(caseId, intentId);
    if (!intent) throw new Error("upload_intent_not_found");
    if (intent.status === "COMPLETED") return intent;
    const updated = { ...intent, status: "FINALIZING" as const };
    this.intents.set(intentId, updated);
    return updated;
  }

  async markIntentFailed(
    caseId: string,
    intentId: string,
    failureCode: string,
    now: string,
  ) {
    const intent = await this.getIntent(caseId, intentId);
    if (!intent) return;
    this.intents.set(intentId, {
      ...intent,
      status: "FAILED",
      scanStatus: "REJECTED",
      failureCode,
      completedAt: now,
    });
  }

  async findDuplicate(
    caseId: string,
    sha256: string,
    matchedQuoteDocumentId: string | null,
  ) {
    return (
      [...this.documents.values()].find(
        (document) =>
          document.caseId === caseId &&
          document.uploadStatus !== "DELETED" &&
          (document.sha256 === sha256 ||
            (matchedQuoteDocumentId &&
              document.matchedQuoteDocumentId ===
                matchedQuoteDocumentId)),
      ) ?? null
    );
  }

  async finalizeDocument(input: {
    intent: QuoteUploadIntent;
    document: UploadedQuoteDocument;
    queue: QuoteParsingQueueRecord;
    normalizedQuote: NormalizedAuditQuote | null;
    now: string;
  }): Promise<FinalizeUploadRepositoryResult> {
    const duplicate = await this.findDuplicate(
      input.document.caseId,
      input.document.sha256,
      input.document.matchedQuoteDocumentId,
    );
    if (duplicate) {
      return { kind: "duplicate", existingDocumentId: duplicate.id };
    }
    this.documents.set(input.document.id, input.document);
    this.queues.set(input.queue.id, input.queue);
    this.intents.set(input.intent.id, {
      ...input.intent,
      status: "COMPLETED",
      scanStatus: input.document.scanStatus,
      completedAt: input.now,
    });
    return { kind: "completed", document: input.document };
  }

  async listDocuments(caseId: string) {
    return [...this.documents.values()].filter(
      (document) =>
        document.caseId === caseId &&
        document.uploadStatus !== "DELETED",
    );
  }

  async getDocument(caseId: string, documentId: string) {
    const document = this.documents.get(documentId);
    return document?.caseId === caseId &&
      document.uploadStatus !== "DELETED"
      ? document
      : null;
  }

  async deleteDocument(input: {
    caseId: string;
    documentId: string;
    deletedAt: string;
    deletedBy: AuditEvaluationActor;
  }) {
    const document = await this.getDocument(
      input.caseId,
      input.documentId,
    );
    if (!document) return null;
    const deleted: UploadedQuoteDocument = {
      ...document,
      uploadStatus: "DELETED",
      deletedAt: input.deletedAt,
      deletedBy: input.deletedBy,
    };
    this.documents.set(document.id, deleted);
    return deleted;
  }
}

class MemoryUploadStorage implements AuditEvaluationUploadStorage {
  readonly objects = new Map<
    string,
    { bytes: Uint8Array; mimeType: string }
  >();
  uploadPath = "";

  async createUploadUrl(input: {
    storagePath: string;
    mimeType: string;
    expiresAt: string;
  }) {
    this.uploadPath = input.storagePath;
    return `https://upload.example.test/${encodeURIComponent(input.storagePath)}`;
  }

  setUploaded(bytes: Uint8Array, mimeType = "application/pdf") {
    this.objects.set(this.uploadPath, { bytes, mimeType });
  }

  async read(
    storagePath: string,
    maximumBytes: number,
  ): Promise<AuditEvaluationStoredUpload> {
    const object = this.objects.get(storagePath);
    if (!object) {
      return { exists: false, size: 0, mimeType: "", bytes: new Uint8Array() };
    }
    if (object.bytes.byteLength > maximumBytes) {
      return {
        exists: true,
        size: object.bytes.byteLength,
        mimeType: object.mimeType,
        bytes: new Uint8Array(),
      };
    }
    return {
      exists: true,
      size: object.bytes.byteLength,
      mimeType: object.mimeType,
      bytes: object.bytes,
    };
  }

  async promote(input: {
    sourcePath: string;
    destinationPath: string;
  }) {
    const object = this.objects.get(input.sourcePath);
    if (!object) throw new Error("upload_not_found");
    this.objects.set(input.destinationPath, object);
  }

  async delete(storagePath: string) {
    this.objects.delete(storagePath);
  }

  async createDownloadUrl(storagePath: string) {
    return `https://download.example.test/${encodeURIComponent(storagePath)}`;
  }
}

function createHarness(matcher: {
  matchUploadedQuoteDocument(input: unknown): Promise<QuoteDocumentMatchResult>;
} | null = null) {
  const repository = new MemoryUploadRepository();
  const storage = new MemoryUploadStorage();
  const service = new AuditEvaluationUploadService(repository, {
    storage,
    matcher,
    accessSecret: SECRET,
    flags: FLAGS,
  });
  return { repository, storage, service };
}

async function beginUpload(
  service: AuditEvaluationUploadService,
  bytes: Uint8Array,
  key = crypto.randomUUID(),
) {
  const intent = await service.createUploadIntent({
    evaluationCase: CASE,
    fileName: "standard-quote.pdf",
    mimeType: "application/pdf",
    size: bytes.byteLength,
    idempotencyKey: key,
    now: NOW,
  });
  assert.equal(intent.completed, false);
  return { intent, key };
}

function validPdf(extraTrailer = "") {
  const encoder = new TextEncoder();
  const beforeXref =
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n";
  const xrefOffset = encoder.encode(beforeXref).byteLength;
  return encoder.encode(
    `${beforeXref}xref\n0 2\n0000000000 65535 f \n0000000009 00000 n \ntrailer\n<< /Size 2 ${extraTrailer}>>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );
}

test("accepts a valid PDF after static security scan", async () => {
  const { repository, storage, service } = createHarness();
  const bytes = validPdf();
  const { intent, key } = await beginUpload(service, bytes);
  storage.setUploaded(bytes);
  const document = await service.finalizeUpload({
    evaluationCase: CASE,
    actor: ACTOR,
    intentId: intent.intentId,
    idempotencyKey: key,
    now: NOW,
  });
  const replayed = await service.finalizeUpload({
    evaluationCase: CASE,
    actor: ACTOR,
    intentId: intent.intentId,
    idempotencyKey: key,
    now: NOW,
  });
  assert.equal(document.scanStatus, "CLEAN");
  assert.equal(replayed.id, document.id);
  assert.equal(document.uploadStatus, "UPLOADED");
  assert.equal(repository.documents.size, 1);
  assert.equal(
    [...repository.queues.values()][0].status,
    "PENDING_REVIEW",
  );
  assert.equal(
    [...repository.documents.values()][0].storagePath.includes(
      "standard-quote.pdf",
    ),
    false,
  );
});

test("rejects a PDF with active content before promotion", async () => {
  const { repository, storage, service } = createHarness();
  const bytes = validPdf("/OpenAction 2 0 R ");
  const { intent, key } = await beginUpload(service, bytes);
  storage.setUploaded(bytes);
  await assert.rejects(
    service.finalizeUpload({
      evaluationCase: CASE,
      actor: ACTOR,
      intentId: intent.intentId,
      idempotencyKey: key,
      now: NOW,
    }),
    (error: unknown) =>
      error instanceof AuditEvaluationUploadError &&
      error.code === "security_scan_rejected",
  );
  assert.equal(repository.documents.size, 0);
});

test("rejects empty, oversized, disguised, corrupt and encrypted files", () => {
  const config = createValidEvaluationConfig();
  const policy = createAuditQuoteUploadPolicy(config);
  assert.deepEqual(policy.allowedMimeTypes, ["application/pdf"]);
  assert.deepEqual(policy.allowedExtensions, [".pdf"]);
  assert.equal(
    validateAuditQuoteUploadDescriptor(
      { fileName: "quote.pdf", mimeType: "application/pdf", size: 0 },
      policy,
    ),
    "empty_file",
  );
  assert.equal(
    validateAuditQuoteUploadDescriptor(
      {
        fileName: "quote.pdf",
        mimeType: "application/pdf",
        size: policy.maximumFileSize + 1,
      },
      policy,
    ),
    "file_too_large",
  );
  assert.equal(
    validateAuditQuoteUploadDescriptor(
      { fileName: "quote.exe", mimeType: "application/pdf", size: 100 },
      policy,
    ),
    "unsupported_file_type",
  );
  assert.equal(
    validateAuditQuoteUploadDescriptor(
      { fileName: "quote.pdf", mimeType: "application/zip", size: 100 },
      policy,
    ),
    "unsupported_file_type",
  );
  assert.equal(
    inspectAuditQuotePdf(new TextEncoder().encode("%PDF-1.4 broken")).error,
    "corrupt_pdf",
  );
  assert.equal(
    inspectAuditQuotePdf(validPdf("/Encrypt 2 0 R ")).error,
    "encrypted_pdf",
  );
});

test("rejects duplicate content but allows reupload after deletion", async () => {
  const { storage, service } = createHarness();
  const bytes = validPdf();
  const first = await beginUpload(service, bytes);
  storage.setUploaded(bytes);
  const firstDocument = await service.finalizeUpload({
    evaluationCase: CASE,
    actor: ACTOR,
    intentId: first.intent.intentId,
    idempotencyKey: first.key,
    now: NOW,
  });

  const duplicate = await beginUpload(service, bytes);
  storage.setUploaded(bytes);
  await assert.rejects(
    service.finalizeUpload({
      evaluationCase: CASE,
      actor: ACTOR,
      intentId: duplicate.intent.intentId,
      idempotencyKey: duplicate.key,
      now: NOW,
    }),
    (error: unknown) =>
      error instanceof AuditEvaluationUploadError &&
      error.code === "duplicate_document",
  );

  await service.deleteDocument({
    evaluationCase: CASE,
    actor: ACTOR,
    documentId: firstDocument.id,
    now: NOW,
  });
  const reupload = await beginUpload(service, bytes);
  storage.setUploaded(bytes);
  const reuploaded = await service.finalizeUpload({
    evaluationCase: CASE,
    actor: ACTOR,
    intentId: reupload.intent.intentId,
    idempotencyKey: reupload.key,
    now: NOW,
  });
  assert.equal(reuploaded.uploadStatus, "UPLOADED");
});

test("rejects a trusted document belonging to another case", async () => {
  const wrongCaseResult: QuoteDocumentMatchResult = {
    status: "WRONG_CASE",
    canUseTrustedServerData: false,
    quoteDocumentId: "qd_123456789012345678901234",
    trustedRecord: null,
    normalizedQuote: null,
    fileDifferences: [],
  };
  const { storage, service } = createHarness({
    async matchUploadedQuoteDocument() {
      return wrongCaseResult;
    },
  });
  const bytes = validPdf();
  const upload = await beginUpload(service, bytes);
  storage.setUploaded(bytes);
  await assert.rejects(
    service.finalizeUpload({
      evaluationCase: CASE,
      actor: ACTOR,
      intentId: upload.intent.intentId,
      idempotencyKey: upload.key,
      now: NOW,
    }),
    (error: unknown) =>
      error instanceof AuditEvaluationUploadError &&
      error.code === "wrong_case",
  );
});

test("fails closed when an embedded identity cannot be matched", async () => {
  const { repository, storage, service } = createHarness({
    async matchUploadedQuoteDocument() {
      throw new Error("matcher_down");
    },
  });
  const marker = serializeEmbeddedQuoteDocumentIdentity(
    createQuoteDocumentIdentity(
      {
        quoteRequestId: CASE.quoteRequestId,
        fiscalYear: CASE.fiscalYear,
        templateVersion: { id: "template", version: 1 },
        normalizedPayload: createTrustedStandardQuotePayload(),
      },
      "quote-document-signing-secret-at-least-32-bytes",
    ),
  );
  const bytes = validPdf(` ${marker} `);
  const upload = await beginUpload(service, bytes);
  storage.setUploaded(bytes);
  await assert.rejects(
    service.finalizeUpload({
      evaluationCase: CASE,
      actor: ACTOR,
      intentId: upload.intent.intentId,
      idempotencyKey: upload.key,
      now: NOW,
    }),
    (error: unknown) =>
      error instanceof AuditEvaluationUploadError &&
      error.code === "document_matching_failed",
  );
  assert.equal(repository.documents.size, 0);
});

test("rejects a changed documentId when creating a download", async () => {
  const { service } = createHarness();
  await assert.rejects(
    service.createDownloadUrl({
      evaluationCase: CASE,
      documentId: "aud_changed-document-id",
      now: NOW,
    }),
    (error: unknown) =>
      error instanceof AuditEvaluationUploadError &&
      error.code === "document_not_found",
  );
});

test("replays the same upload intent idempotently", async () => {
  const { repository, service } = createHarness();
  const bytes = validPdf();
  const key = crypto.randomUUID();
  const first = await beginUpload(service, bytes, key);
  const second = await beginUpload(service, bytes, key);
  assert.equal(first.intent.intentId, second.intent.intentId);
  assert.equal(first.intent.documentId, second.intent.documentId);
  assert.equal(repository.intents.size, 1);
});

test("enforces the configured total upload count", async () => {
  const { repository, service } = createHarness();
  repository.config.maximumQuoteCount = 2;
  repository.config.uploadLimit = 2;
  const bytes = validPdf();
  await beginUpload(service, bytes);
  await beginUpload(service, bytes);
  await assert.rejects(
    beginUpload(service, bytes),
    (error: unknown) =>
      error instanceof AuditEvaluationUploadError &&
      error.code === "too_many_files",
  );
});

test("retries a network-interrupted upload exactly once", async () => {
  let attempts = 0;
  const transport: AuditEvaluationUploadTransport = {
    async put() {
      attempts += 1;
      if (attempts === 1) throw new Error("network_error");
    },
  };
  await uploadWithNetworkRetry(transport, {
    url: "https://upload.example.test",
    file: {} as File,
    headers: { "content-type": "application/pdf" },
    onProgress() {},
  });
  assert.equal(attempts, 2);
});

test("all customer upload APIs enforce the case session helper", () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  const routes = [
    "app/api/audit-evaluations/[caseId]/documents/route.ts",
    "app/api/audit-evaluations/[caseId]/documents/[documentId]/route.ts",
    "app/api/audit-evaluations/[caseId]/documents/[documentId]/download/route.ts",
    "app/api/audit-evaluations/[caseId]/upload-intents/route.ts",
    "app/api/audit-evaluations/[caseId]/upload-intents/[intentId]/finalize/route.ts",
  ];
  for (const route of routes) {
    const source = readFileSync(path.join(root, route), "utf8");
    assert.match(
      source,
      /authenticateAuditEvaluation(?:Case|Mutation)Request\(\s*request,\s*caseId/,
      `missing case access check: ${route}`,
    );
  }
});

test("upload UI keeps drag, mobile selection, progress and accessibility contracts", () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  const source = readFileSync(
    path.join(root, "components/AuditQuoteUploader.tsx"),
    "utf8",
  );
  assert.match(source, /onDrop=/);
  assert.match(source, /type="file"/);
  assert.match(source, /\bmultiple\b/);
  assert.match(source, /<progress/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /aria-label=\{overview\.text\.dropzoneTitle\}/);
  assert.match(source, /overview\.text\.uploadedLabel/);
  assert.match(source, /overview\.text\.verifyingLabel/);
  assert.match(source, /overview\.text\.needsInfoLabel/);
  assert.match(source, /overview\.text\.readyLabel/);
  assert.match(source, /overview\.text\.verificationFailedLabel/);
});
