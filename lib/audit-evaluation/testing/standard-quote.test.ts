import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuditEvaluationFeatureFlags } from "@/lib/audit-evaluation/feature-flags";
import type { StandardQuoteDocumentRepository } from "@/lib/audit-evaluation/standard-quote-repository";
import {
  createQuoteDocumentIdentity,
  parseEmbeddedQuoteDocumentIdentity,
  serializeEmbeddedQuoteDocumentIdentity,
  sha256Bytes,
  verifyQuoteDocumentIdentity,
} from "@/lib/audit-evaluation/standard-quote-identity";
import {
  StandardQuoteDocumentService,
  type MatchUploadedQuoteDocumentInput,
} from "@/lib/audit-evaluation/standard-quote-service";
import { createTrustedStandardQuotePayload } from "@/lib/audit-evaluation/testing/fixtures";
import type {
  QuoteDocumentIdentity,
  StandardQuoteDocumentRecord,
} from "@/lib/audit-evaluation/types";

const SIGNING_SECRET = "test-only-signing-secret-with-at-least-32-bytes";
const FLAGS: AuditEvaluationFeatureFlags = {
  enabled: true,
  customerEntryEnabled: false,
  reportDownloadEnabled: false,
  adminEnabled: false,
  aiNarrativeEnabled: false,
};

class MemoryStandardQuoteDocumentRepository
  implements StandardQuoteDocumentRepository
{
  private readonly records = new Map<string, StandardQuoteDocumentRecord>();
  private readonly matchedUploads = new Map<string, string>();

  async create(value: StandardQuoteDocumentRecord) {
    if (this.records.has(value.quoteDocumentId)) {
      throw new Error("already_exists");
    }
    this.records.set(value.quoteDocumentId, structuredClone(value));
    return structuredClone(value);
  }

  async get(quoteDocumentId: string) {
    const value = this.records.get(quoteDocumentId);
    return value ? structuredClone(value) : null;
  }

  async findExistingMatchedUpload(
    caseId: string,
    quoteDocumentId: string,
    excludingUploadDocumentId: string,
  ) {
    const value = this.matchedUploads.get(`${caseId}:${quoteDocumentId}`);
    return value && value !== excludingUploadDocumentId ? value : null;
  }

  markMatched(caseId: string, quoteDocumentId: string, uploadId: string) {
    this.matchedUploads.set(`${caseId}:${quoteDocumentId}`, uploadId);
  }
}

async function setup() {
  const repository = new MemoryStandardQuoteDocumentRepository();
  const service = new StandardQuoteDocumentService(
    repository,
    SIGNING_SECRET,
    FLAGS,
  );
  const originalBytes = Buffer.from("standard quote pdf bytes");
  const registered = await service.registerStandardQuoteDocument({
    quoteRequestId: "request-001",
    fiscalYear: 2027,
    templateVersion: { id: "standard-audit-quote", version: 1 },
    documentFormat: "PDF",
    normalizedPayload: createTrustedStandardQuotePayload(),
    originalDocumentBytes: originalBytes,
    registeredAt: "2026-07-21T00:00:00.000Z",
    registeredBy: { type: "SYSTEM", service: "quote-registry-test" },
  });
  return { repository, service, registered };
}

function identityOf(record: StandardQuoteDocumentRecord): QuoteDocumentIdentity {
  return {
    signatureVersion: record.signatureVersion,
    quoteDocumentId: record.quoteDocumentId,
    quoteRequestId: record.quoteRequestId,
    fiscalYear: record.fiscalYear,
    templateVersion: record.templateVersion,
    payloadChecksum: record.payloadChecksum,
    integrityToken: record.integrityToken,
  };
}

function matchInput(
  record: StandardQuoteDocumentRecord,
  overrides: Partial<MatchUploadedQuoteDocumentInput> = {},
): MatchUploadedQuoteDocumentInput {
  return {
    evaluationCase: {
      id: "case-001",
      quoteRequestId: "request-001",
      fiscalYear: 2027,
    },
    uploadedDocumentId: "upload-001",
    uploadedSha256: record.originalDocumentSha256,
    embeddedIdentity: identityOf(record),
    observedPayloadChecksum: record.payloadChecksum,
    legacyCandidate: false,
    ...overrides,
  };
}

describe("standard quote identity and matching", () => {
  it("verifies a normally signed standard quote and uses server data", async () => {
    const { service, registered } = await setup();
    const result = await service.matchUploadedQuoteDocument(
      matchInput(registered.record),
    );

    assert.equal(
      verifyQuoteDocumentIdentity(
        identityOf(registered.record),
        SIGNING_SECRET,
      ),
      true,
    );
    assert.equal(result.status, "VERIFIED");
    assert.equal(result.canUseTrustedServerData, true);
    assert.equal(result.normalizedQuote?.auditFee, "55000000");
    assert.equal(
      result.normalizedQuote?.source.auditFee,
      "TRUSTED_SERVER_RECORD",
    );
  });

  it("registers a preallocated identity that is embedded in the final PDF bytes", async () => {
    const repository = new MemoryStandardQuoteDocumentRepository();
    const service = new StandardQuoteDocumentService(
      repository,
      SIGNING_SECRET,
      FLAGS,
    );
    const payload = createTrustedStandardQuotePayload();
    const identity = createQuoteDocumentIdentity(
      {
        quoteRequestId: "request-001",
        fiscalYear: 2027,
        templateVersion: { id: "standard-audit-quote", version: 1 },
        normalizedPayload: payload,
      },
      SIGNING_SECRET,
    );
    const finalPdfBytes = Buffer.from(
      `%PDF-1.4\n${serializeEmbeddedQuoteDocumentIdentity(identity)}\n%%EOF`,
    );
    const registered = await service.registerStandardQuoteDocument({
      quoteDocumentId: identity.quoteDocumentId,
      quoteRequestId: "request-001",
      fiscalYear: 2027,
      templateVersion: identity.templateVersion,
      documentFormat: "PDF",
      normalizedPayload: payload,
      originalDocumentBytes: finalPdfBytes,
      registeredAt: "2026-07-21T00:00:00.000Z",
      registeredBy: { type: "SYSTEM", service: "quote-registry-test" },
    });
    assert.equal(registered.record.quoteDocumentId, identity.quoteDocumentId);
    assert.equal(
      registered.record.originalDocumentSha256,
      sha256Bytes(finalPdfBytes),
    );
    const matched = await service.matchUploadedQuoteDocument(
      matchInput(registered.record, {
        uploadedSha256: sha256Bytes(finalPdfBytes),
        embeddedIdentity: identity,
      }),
    );
    assert.equal(matched.status, "VERIFIED");
  });

  it("rejects a tampered signature", async () => {
    const { service, registered } = await setup();
    const identity = identityOf(registered.record);
    identity.integrityToken = `${identity.integrityToken.slice(0, -1)}${
      identity.integrityToken.endsWith("A") ? "B" : "A"
    }`;
    const result = await service.matchUploadedQuoteDocument(
      matchInput(registered.record, { embeddedIdentity: identity }),
    );
    assert.equal(result.status, "INVALID_SIGNATURE");
    assert.equal(result.canUseTrustedServerData, false);
    assert.equal(result.normalizedQuote, null);
  });

  it("rejects a quote belonging to another request", async () => {
    const { service, registered } = await setup();
    const result = await service.matchUploadedQuoteDocument(
      matchInput(registered.record, {
        evaluationCase: {
          id: "case-other",
          quoteRequestId: "request-other",
          fiscalYear: 2027,
        },
      }),
    );
    assert.equal(result.status, "WRONG_CASE");
    assert.equal(result.canUseTrustedServerData, false);
  });

  it("rejects a quote from another fiscal year", async () => {
    const { service, registered } = await setup();
    const result = await service.matchUploadedQuoteDocument(
      matchInput(registered.record, {
        evaluationCase: {
          id: "case-001",
          quoteRequestId: "request-001",
          fiscalYear: 2028,
        },
      }),
    );
    assert.equal(result.status, "WRONG_CASE");
    assert.equal(result.canUseTrustedServerData, false);
  });

  it("detects the same standard quote uploaded twice", async () => {
    const { repository, service, registered } = await setup();
    repository.markMatched(
      "case-001",
      registered.record.quoteDocumentId,
      "upload-existing",
    );
    const result = await service.matchUploadedQuoteDocument(
      matchInput(registered.record, {
        uploadedDocumentId: "upload-second",
      }),
    );
    assert.equal(result.status, "DUPLICATE");
    assert.equal(result.canUseTrustedServerData, false);
  });

  it("uses trusted server values but flags a changed file", async () => {
    const { service, registered } = await setup();
    const result = await service.matchUploadedQuoteDocument(
      matchInput(registered.record, {
        uploadedSha256:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    );
    assert.equal(result.status, "VERIFIED_WITH_FILE_DIFFERENCE");
    assert.deepEqual(result.fileDifferences, ["FILE_HASH_MISMATCH"]);
    assert.equal(result.canUseTrustedServerData, true);
    assert.equal(result.normalizedQuote?.auditFee, "55000000");
  });

  it("flags changed major displayed values without trusting them", async () => {
    const { service, registered } = await setup();
    const result = await service.matchUploadedQuoteDocument(
      matchInput(registered.record, {
        observedPayloadChecksum:
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }),
    );
    assert.equal(result.status, "VERIFIED_WITH_FILE_DIFFERENCE");
    assert.deepEqual(result.fileDifferences, [
      "PAYLOAD_CHECKSUM_MISMATCH",
    ]);
    assert.equal(result.normalizedQuote?.auditFee, "55000000");
  });

  it("rejects malformed opaque identifiers before lookup", async () => {
    const { service, registered } = await setup();
    const identity = {
      ...identityOf(registered.record),
      quoteDocumentId: "predictable-id",
    };
    const result = await service.matchUploadedQuoteDocument(
      matchInput(registered.record, { embeddedIdentity: identity }),
    );
    assert.equal(result.status, "UNRECOGNIZED");
    assert.equal(result.trustedRecord, null);
  });

  it("classifies an identifier-free previous document as legacy", async () => {
    const { service, registered } = await setup();
    const result = await service.matchUploadedQuoteDocument(
      matchInput(registered.record, {
        embeddedIdentity: null,
        legacyCandidate: true,
      }),
    );
    assert.equal(result.status, "LEGACY_DOCUMENT");
    assert.equal(result.canUseTrustedServerData, false);
  });

  it("keeps PII and quote amounts out of the QR payload", async () => {
    const { registered } = await setup();
    const qr = registered.display.qrPayload;
    assert.match(qr, /^nhsc:quote:v1:qd_/);
    assert.equal(qr.includes("request-001"), false);
    assert.equal(qr.includes("55000000"), false);
    assert.equal(qr.includes("테스트 회계법인"), false);

    const parsed = parseEmbeddedQuoteDocumentIdentity(
      registered.display.embeddedIdentityMarker,
    );
    assert.deepEqual(parsed, identityOf(registered.record));
  });
});
