import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { AuditEvaluationCustomerAccessService } from "@/lib/audit-evaluation/customer-access-service";
import { FirestoreAuditEvaluationCustomerAccessRepository } from "@/lib/audit-evaluation/customer-access-repository";
import type { AuditEvaluationAccessEmailAdapter } from "@/lib/audit-evaluation/access-email-adapter";
import { StandardQuoteDocumentService } from "@/lib/audit-evaluation/standard-quote-service";
import { FirestoreStandardQuoteDocumentRepository } from "@/lib/audit-evaluation/standard-quote-repository";
import {
  createQuoteDocumentIdentity,
  serializeEmbeddedQuoteDocumentIdentity,
  sha256Bytes,
} from "@/lib/audit-evaluation/standard-quote-identity";
import { inspectAuditQuotePdf } from "@/lib/audit-evaluation/upload-policy";
import { AuditEvaluationUploadService } from "@/lib/audit-evaluation/upload-service";
import { FirestoreAuditEvaluationUploadRepository } from "@/lib/audit-evaluation/upload-repository";
import type {
  AuditEvaluationStoredUpload,
  AuditEvaluationUploadStorage,
} from "@/lib/audit-evaluation/upload-storage";
import { AuditEvaluationReviewService } from "@/lib/audit-evaluation/review-service";
import { FirestoreAuditEvaluationReviewRepository } from "@/lib/audit-evaluation/review-repository";
import { AuditEvaluationReportGenerationService } from "@/lib/audit-evaluation/report-generation-service";
import { AuditEvaluationReportService } from "@/lib/audit-evaluation/report-service";
import { FirestoreAuditEvaluationReportRepository } from "@/lib/audit-evaluation/report-repository";
import type { AuditEvaluationReportStorage } from "@/lib/audit-evaluation/report-storage";
import { FirestoreAuditEvaluationAdminRepository } from "@/lib/audit-evaluation/admin-repository";
import { AUDIT_EVALUATION_COLLECTIONS } from "@/lib/audit-evaluation/collections";
import type { AuditEvaluationFeatureFlags } from "@/lib/audit-evaluation/feature-flags";
import { createValidEvaluationConfig, createTrustedStandardQuotePayload } from "@/lib/audit-evaluation/testing/fixtures";
import { normalizeWonAmount } from "@/lib/audit-evaluation/money";
import { AUDIT_QUOTE_REQUESTS } from "@/lib/audit-quote/collections";
import type {
  AuditEvaluationActor,
  TrustedStandardQuotePayload,
} from "@/lib/audit-evaluation/types";
import { adminDb } from "@/lib/firebase/admin";

const NOW = "2026-07-21T02:00:00.000Z";
const ACCESS_SECRET = "stage11-access-secret-that-is-at-least-32-bytes";
const SIGNING_SECRET = "stage11-signing-secret-that-is-at-least-32-bytes";
const HASH_PEPPER = "stage11-email-pepper-that-is-at-least-32-bytes";
const FLAGS: AuditEvaluationFeatureFlags = {
  enabled: true,
  customerEntryEnabled: true,
  reportDownloadEnabled: true,
  adminEnabled: true,
  aiNarrativeEnabled: false,
};

class CapturingEmailAdapter implements AuditEvaluationAccessEmailAdapter {
  readonly available = true;
  readonly messages: Array<{ magicLink: string; expiresAt: string }> = [];

  async sendAccessLink(message: {
    recipientEmail: string;
    magicLink: string;
    expiresAt: string;
  }) {
    this.messages.push({
      magicLink: message.magicLink,
      expiresAt: message.expiresAt,
    });
  }
}

class MemoryUploadStorage implements AuditEvaluationUploadStorage {
  readonly objects = new Map<
    string,
    { bytes: Uint8Array; mimeType: string }
  >();
  latestUploadPath = "";

  async createUploadUrl(input: {
    storagePath: string;
    mimeType: string;
    expiresAt: string;
  }) {
    this.latestUploadPath = input.storagePath;
    return `memory://upload/${encodeURIComponent(input.storagePath)}`;
  }

  putLatest(bytes: Uint8Array, mimeType = "application/pdf") {
    assert.ok(this.latestUploadPath);
    this.objects.set(this.latestUploadPath, { bytes, mimeType });
  }

  async read(
    storagePath: string,
    maximumBytes: number,
  ): Promise<AuditEvaluationStoredUpload> {
    const object = this.objects.get(storagePath);
    if (!object) {
      return {
        exists: false,
        size: 0,
        mimeType: "",
        bytes: new Uint8Array(),
      };
    }
    return {
      exists: true,
      size: object.bytes.byteLength,
      mimeType: object.mimeType,
      bytes:
        object.bytes.byteLength <= maximumBytes
          ? object.bytes
          : new Uint8Array(),
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
    return `memory://download/${encodeURIComponent(storagePath)}`;
  }
}

class MemoryReportStorage implements AuditEvaluationReportStorage {
  readonly objects = new Map<string, Uint8Array>();
  saveCalls = 0;
  failNextSave = false;

  async save(input: { storagePath: string; bytes: Uint8Array }) {
    this.saveCalls += 1;
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("synthetic_storage_failure");
    }
    this.objects.set(input.storagePath, input.bytes);
  }

  async read(storagePath: string, maximumBytes: number) {
    const bytes = this.objects.get(storagePath) ?? null;
    return bytes && bytes.byteLength <= maximumBytes ? bytes : null;
  }

  async createDownloadUrl(input: {
    storagePath: string;
    expiresAt: string;
    fileName: string;
  }) {
    return `memory://report/${encodeURIComponent(input.storagePath)}?filename=${encodeURIComponent(input.fileName)}`;
  }
}

test(
  "stage 11 full customer flow persists through report re-entry and admin review",
  {
    skip: !process.env.FIRESTORE_EMULATOR_HOST
      ? "Firestore emulator is required"
      : false,
  },
  async () => {
    const db = adminDb();
    const stamp = crypto.randomUUID().replaceAll("-", "");
    const requestId = `stage11-request-${stamp}`;
    const publicReference = `AQ-20260721-${stamp.slice(0, 8)}`;
    const email = `stage11-${stamp.slice(0, 8)}@nonghyup.com`;
    const emailHash = createHmac("sha256", HASH_PEPPER)
      .update(email)
      .digest("hex");
    const config = {
      ...createValidEvaluationConfig(),
      id: `stage11.config.${stamp}`,
      status: "PUBLISHED" as const,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2027-12-31T23:59:59.999Z",
      permittedMimeTypes: ["application/pdf"],
      publishedBy: "stage11-admin",
      publishedAt: NOW,
    };
    await Promise.all([
      db.collection(AUDIT_EVALUATION_COLLECTIONS.configVersions)
        .doc(`${config.id}.v1`)
        .set(config),
      db.collection(AUDIT_QUOTE_REQUESTS).doc(requestId).set({
        schemaVersion: 2,
        requestId,
        publicReference,
        email,
        emailHash,
        contactName: "가상 담당자",
        phone: "010-0000-0000",
        status: "delivered",
        quoteCount: 2,
        privacyPolicyVersion: "stage11-fixture",
        agreedAt: Timestamp.fromDate(new Date(NOW)),
        marketingConsent: false,
        campaign: "stage11-e2e",
        channel: "automated-test",
        pagePath: "/events/audit-quote",
        idempotencyKeyHash: stamp,
        createdAt: Timestamp.fromDate(new Date(NOW)),
        updatedAt: Timestamp.fromDate(new Date(NOW)),
        assignedTo: null,
      }),
    ]);

    const standardService = new StandardQuoteDocumentService(
      new FirestoreStandardQuoteDocumentRepository(db),
      SIGNING_SECRET,
      FLAGS,
    );
    const payloads = [
      quotePayload("가상 한빛회계법인", "firm-stage11-a", "55000000", 8),
      quotePayload("가상 새봄회계법인", "firm-stage11-b", "72000000", 3),
    ];
    const pdfs: Uint8Array[] = [];
    for (const payload of payloads) {
      const identity = createQuoteDocumentIdentity(
        {
          quoteRequestId: requestId,
          fiscalYear: 2027,
          templateVersion: { id: "standard.quote", version: 1 },
          normalizedPayload: payload,
        },
        SIGNING_SECRET,
      );
      const bytes = validPdf(
        serializeEmbeddedQuoteDocumentIdentity(identity),
      );
      assert.equal(
        inspectAuditQuotePdf(bytes).embeddedIdentity?.quoteDocumentId,
        identity.quoteDocumentId,
      );
      pdfs.push(bytes);
      const registered =
        await standardService.registerStandardQuoteDocument({
        quoteDocumentId: identity.quoteDocumentId,
        quoteRequestId: requestId,
        fiscalYear: 2027,
        templateVersion: { id: "standard.quote", version: 1 },
        documentFormat: "PDF",
        normalizedPayload: payload,
        originalDocumentBytes: bytes,
        registeredAt: NOW,
        registeredBy: {
          type: "SYSTEM",
          service: "stage11-e2e",
        },
      });
      assert.equal(registered.record.quoteDocumentId, identity.quoteDocumentId);
      const directMatch = await standardService.matchUploadedQuoteDocument({
        evaluationCase: {
          id: `preflight-${stamp}`,
          quoteRequestId: requestId,
          fiscalYear: 2027,
        },
        uploadedDocumentId: `preflight-document-${pdfs.length}`,
        uploadedSha256: sha256Bytes(bytes),
        embeddedIdentity: inspectAuditQuotePdf(bytes).embeddedIdentity,
        legacyCandidate: false,
      });
      assert.equal(directMatch.status, "VERIFIED");
    }

    const emailAdapter = new CapturingEmailAdapter();
    const accessRepository =
      new FirestoreAuditEvaluationCustomerAccessRepository(db);
    const accessService = new AuditEvaluationCustomerAccessService(
      accessRepository,
      {
        emailAdapter,
        accessSecret: ACCESS_SECRET,
        auditQuoteHashPepper: HASH_PEPPER,
        baseUrl: "http://stage11.local",
        flags: FLAGS,
      },
    );
    const requested = await accessService.requestEmailAccess({
      email,
      publicReference,
      now: NOW,
    });
    assert.equal(requested.deliveryAttempted, true);
    assert.equal(emailAdapter.messages.length, 1);
    const token = new URL(emailAdapter.messages[0].magicLink)
      .hash.replace("#access_token=", "");
    const grant = await accessService.exchangeAccessToken(token, NOW);
    assert.ok(grant);
    assert.equal(
      await accessService.exchangeAccessToken(token, NOW),
      null,
      "one-time access token must reject replay",
    );
    const evaluationCase = grant.evaluationCase;
    const actor: AuditEvaluationActor = {
      type: "CUSTOMER",
      subjectId: grant.session.owner.type === "CAPABILITY_SUBJECT"
        ? grant.session.owner.subjectId
        : "unexpected-owner",
    };

    const uploadStorage = new MemoryUploadStorage();
    const uploadService = new AuditEvaluationUploadService(
      new FirestoreAuditEvaluationUploadRepository(db),
      {
        storage: uploadStorage,
        matcher: standardService,
        accessSecret: ACCESS_SECRET,
        flags: FLAGS,
      },
    );
    const documentIds: string[] = [];
    for (const [index, bytes] of pdfs.entries()) {
      const idempotencyKey = crypto.randomUUID();
      const intent = await uploadService.createUploadIntent({
        evaluationCase,
        fileName: `가상-견적서-${index + 1}.pdf`,
        mimeType: "application/pdf",
        size: bytes.byteLength,
        idempotencyKey,
        now: NOW,
      });
      assert.equal(intent.completed, false);
      uploadStorage.putLatest(bytes);
      const document = await uploadService.finalizeUpload({
        evaluationCase,
        actor,
        intentId: intent.intentId,
        idempotencyKey,
        now: NOW,
      });
      assert.equal(document.matchStatus, "VERIFIED");
      documentIds.push(document.id);
    }

    const [
      { AuditEvaluationParsingService },
      { FirestoreAuditEvaluationParsingRepository },
    ] = await Promise.all([
      import("@/lib/audit-evaluation/parsing-service"),
      import("@/lib/audit-evaluation/parsing-repository"),
    ]);
    const parsingService = new AuditEvaluationParsingService(
      new FirestoreAuditEvaluationParsingRepository(db),
      { storage: uploadStorage, flags: FLAGS },
    );
    for (const documentId of documentIds) {
      const result = await parsingService.processDocument({
        caseId: evaluationCase.id,
        documentId,
        now: NOW,
      });
      assert.notEqual(result.status, "FAILED");
    }

    const reviewRepository =
      new FirestoreAuditEvaluationReviewRepository(db);
    const reviewService = new AuditEvaluationReviewService(
      reviewRepository,
      FLAGS,
    );
    const workspace = await reviewService.getWorkspace({
      caseId: evaluationCase.id,
      now: NOW,
    });
    assert.equal(workspace.quotes.length, 2);
    assert.equal(workspace.readiness.ready, true);
    const expectedQuoteRevisions = Object.fromEntries(
      workspace.quotes.map((quote) => [
        quote.quoteId,
        quote.revision,
      ]),
    );
    const confirmation = await reviewService.confirmCase({
      caseId: evaluationCase.id,
      expectedQuoteRevisions,
      finalAcknowledged: true,
      actor,
      now: NOW,
    });
    const requestedReport = await reviewService.requestReport({
      caseId: evaluationCase.id,
      confirmationVersion: confirmation.confirmation.version,
      actor,
      now: NOW,
    });
    assert.equal(requestedReport.replayed, false);
    assert.equal(requestedReport.report.scoreResult?.quotes.length, 2);
    assert.equal(requestedReport.report.feeAnalysis?.validQuoteCount, 2);

    const reportRepository =
      new FirestoreAuditEvaluationReportRepository(db);
    const reportStorage = new MemoryReportStorage();
    const generationService = new AuditEvaluationReportGenerationService({
      repository: reportRepository,
      storage: reportStorage,
      flags: FLAGS,
      logoResolver: async () => null,
      pdfRenderer: async () =>
        new TextEncoder().encode("%PDF-1.4\n% stage11-e2e\n%%EOF\n"),
    });
    const generated = await generationService.generate({
      caseId: evaluationCase.id,
      reportVersion: requestedReport.report.reportVersion,
      now: NOW,
    });
    assert.equal(
      generated.status,
      "COMPLETED",
      JSON.stringify(
        await reportRepository.getReport(
          evaluationCase.id,
          requestedReport.report.reportVersion,
        ),
      ),
    );
    const reportService = new AuditEvaluationReportService({
      repository: reportRepository,
      storage: reportStorage,
      generationService,
      flags: FLAGS,
    });
    const webReport = await reportService.getLatestReport(
      evaluationCase.id,
      undefined,
      NOW,
    );
    assert.equal(webReport.status, "COMPLETED");
    assert.ok(webReport.viewModel);
    const download = await reportService.createDownload({
      caseId: evaluationCase.id,
      reportVersion: requestedReport.report.reportVersion,
      actor,
      now: NOW,
    });
    assert.match(download.url, /^memory:\/\/report\//);
    const pdfPath = generated.report?.pdfStoragePath;
    assert.ok(pdfPath);
    const pdfBytes = reportStorage.objects.get(pdfPath);
    assert.ok(pdfBytes);
    assert.equal(new TextDecoder().decode(pdfBytes.slice(0, 5)), "%PDF-");

    await accessService.requestEmailAccess({
      email,
      publicReference,
      now: "2026-07-21T02:10:00.000Z",
    });
    const secondToken = new URL(emailAdapter.messages.at(-1)!.magicLink)
      .hash.replace("#access_token=", "");
    const secondGrant = await accessService.exchangeAccessToken(
      secondToken,
      "2026-07-21T02:10:00.000Z",
    );
    assert.equal(secondGrant?.evaluationCase.id, evaluationCase.id);
    const reopened = await reportService.getLatestReport(
      secondGrant!.evaluationCase.id,
      undefined,
      "2026-07-21T02:10:00.000Z",
    );
    assert.equal(reopened.status, "COMPLETED");

    const adminDetail =
      await new FirestoreAuditEvaluationAdminRepository(db)
        .getDetail(evaluationCase.id);
    assert.ok(adminDetail);
    assert.equal(adminDetail.documents.length, 2);
    assert.equal(adminDetail.normalizedQuotes.length, 2);
    assert.equal(adminDetail.reportVersions[0]?.status, "COMPLETED");
    assert.ok(adminDetail.processingTimeline.length > 0);
  },
);

function quotePayload(
  accountingFirmName: string,
  accountingFirmId: string,
  auditFee: string,
  recentNonghyupAuditCount: number,
): TrustedStandardQuotePayload {
  return {
    ...createTrustedStandardQuotePayload(),
    accountingFirmId,
    accountingFirmName,
    auditFee: normalizeWonAmount(auditFee),
    recentNonghyupAuditCount,
  };
}

function validPdf(identityMarker: string) {
  const encoder = new TextEncoder();
  const content = "BT /F1 12 Tf 72 720 Td (Synthetic audit quote) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${encoder.encode(content).byteLength} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = `%PDF-1.4\n% ${identityMarker}\n`;
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(encoder.encode(body).byteLength);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = encoder.encode(body).byteLength;
  const entries = offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  return encoder.encode(
    `${body}xref\n0 6\n0000000000 65535 f \n${entries}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );
}
