import {
  assertAuditEvaluationCapabilityEnabled,
  getServerFeatureFlags,
  type AuditEvaluationFeatureFlags,
} from "@/lib/audit-evaluation/feature-flags";
import {
  QUOTE_DOCUMENT_ID_PATTERN,
  quoteDocumentIdentitySchema,
  SHA256_PATTERN,
  standardQuoteDocumentRecordSchema,
} from "@/lib/audit-evaluation/quote-document-schemas";
import {
  FirestoreStandardQuoteDocumentRepository,
  type StandardQuoteDocumentRepository,
} from "@/lib/audit-evaluation/standard-quote-repository";
import {
  buildQuoteDocumentVerificationDisplay,
  createQuoteDocumentIdentity,
  createQuoteVerificationCode,
  getQuoteDocumentSigningSecret,
  sha256Bytes,
  verifyQuoteDocumentIdentity,
} from "@/lib/audit-evaluation/standard-quote-identity";
import {
  NORMALIZED_AUDIT_QUOTE_FIELDS,
  type AuditEvaluationActor,
  type AuditEvaluationCase,
  type NormalizedAuditQuote,
  type QuoteDocumentFileDifference,
  type QuoteDocumentIdentity,
  type QuoteDocumentMatchResult,
  type StandardQuoteDocumentFormat,
  type StandardQuoteDocumentRecord,
  type TrustedStandardQuotePayload,
  type VersionReference,
} from "@/lib/audit-evaluation/types";

export type RegisterStandardQuoteDocumentInput = {
  quoteDocumentId?: string;
  quoteRequestId: string;
  fiscalYear: number;
  templateVersion: VersionReference;
  documentFormat: StandardQuoteDocumentFormat;
  normalizedPayload: TrustedStandardQuotePayload;
  originalDocumentBytes: Uint8Array;
  registeredAt: string;
  registeredBy: AuditEvaluationActor;
};

export type MatchUploadedQuoteDocumentInput = {
  evaluationCase: Pick<
    AuditEvaluationCase,
    "id" | "quoteRequestId" | "fiscalYear"
  >;
  uploadedDocumentId: string;
  uploadedSha256: string;
  embeddedIdentity: unknown | null;
  observedPayloadChecksum?: string | null;
  legacyCandidate: boolean;
};

export class StandardQuoteDocumentService {
  private readonly repository: StandardQuoteDocumentRepository;
  private readonly signingSecret: string;
  private readonly flags: AuditEvaluationFeatureFlags;

  constructor(
    repository: StandardQuoteDocumentRepository =
      new FirestoreStandardQuoteDocumentRepository(),
    signingSecret: string = getQuoteDocumentSigningSecret(),
    flags: AuditEvaluationFeatureFlags =
      getServerFeatureFlags().auditEvaluation,
  ) {
    this.repository = repository;
    this.signingSecret = signingSecret;
    this.flags = flags;
  }

  async registerStandardQuoteDocument(
    input: RegisterStandardQuoteDocumentInput,
  ) {
    assertAuditEvaluationCapabilityEnabled("enabled", this.flags);
    const identity = createQuoteDocumentIdentity(
      {
        quoteDocumentId: input.quoteDocumentId,
        quoteRequestId: input.quoteRequestId,
        fiscalYear: input.fiscalYear,
        templateVersion: input.templateVersion,
        normalizedPayload: input.normalizedPayload,
      },
      this.signingSecret,
    );
    const verificationCode = createQuoteVerificationCode(
      identity.quoteDocumentId,
      this.signingSecret,
    );
    const record = standardQuoteDocumentRecordSchema.parse({
      ...identity,
      documentFormat: input.documentFormat,
      normalizedPayload: input.normalizedPayload,
      originalDocumentSha256: sha256Bytes(input.originalDocumentBytes),
      verificationCode,
      status: "ACTIVE",
      registeredAt: input.registeredAt,
      registeredBy: input.registeredBy,
    });
    const stored = await this.repository.create(record);
    return {
      record: stored,
      display: buildQuoteDocumentVerificationDisplay(
        identity,
        verificationCode,
      ),
    };
  }

  async matchUploadedQuoteDocument(
    input: MatchUploadedQuoteDocumentInput,
  ): Promise<QuoteDocumentMatchResult> {
    assertAuditEvaluationCapabilityEnabled("enabled", this.flags);
    if (!SHA256_PATTERN.test(input.uploadedSha256)) {
      throw new Error("invalid_uploaded_document_sha256");
    }

    if (input.embeddedIdentity === null) {
      return emptyResult(
        input.legacyCandidate ? "LEGACY_DOCUMENT" : "UNRECOGNIZED",
      );
    }

    const candidateId = readCandidateDocumentId(input.embeddedIdentity);
    if (!candidateId || !QUOTE_DOCUMENT_ID_PATTERN.test(candidateId)) {
      return emptyResult("UNRECOGNIZED");
    }

    const parsedIdentity = quoteDocumentIdentitySchema.safeParse(
      input.embeddedIdentity,
    );
    if (
      !parsedIdentity.success ||
      !verifyQuoteDocumentIdentity(
        parsedIdentity.data,
        this.signingSecret,
      )
    ) {
      return emptyResult("INVALID_SIGNATURE", candidateId);
    }

    const identity = parsedIdentity.data;
    const record = await this.repository.get(identity.quoteDocumentId);
    if (!record || record.status !== "ACTIVE") {
      return emptyResult("UNRECOGNIZED", identity.quoteDocumentId);
    }
    if (!sameIdentity(identity, record)) {
      return emptyResult("INVALID_SIGNATURE", identity.quoteDocumentId);
    }
    if (
      record.quoteRequestId !== input.evaluationCase.quoteRequestId ||
      record.fiscalYear !== input.evaluationCase.fiscalYear
    ) {
      return emptyResult("WRONG_CASE", identity.quoteDocumentId);
    }

    const fileDifferences: QuoteDocumentFileDifference[] = [];
    if (record.originalDocumentSha256 !== input.uploadedSha256) {
      fileDifferences.push("FILE_HASH_MISMATCH");
    }
    if (
      input.observedPayloadChecksum &&
      input.observedPayloadChecksum !== record.payloadChecksum
    ) {
      fileDifferences.push("PAYLOAD_CHECKSUM_MISMATCH");
    }

    const existingUpload =
      await this.repository.findExistingMatchedUpload(
        input.evaluationCase.id,
        identity.quoteDocumentId,
        input.uploadedDocumentId,
      );
    if (existingUpload) {
      return {
        ...emptyResult("DUPLICATE", identity.quoteDocumentId),
        trustedRecord: record,
        fileDifferences,
      };
    }

    const status =
      fileDifferences.length > 0
        ? "VERIFIED_WITH_FILE_DIFFERENCE"
        : "VERIFIED";
    return {
      status,
      canUseTrustedServerData: true,
      quoteDocumentId: identity.quoteDocumentId,
      trustedRecord: record,
      normalizedQuote: createTrustedNormalizedQuote(
        record,
        input.evaluationCase.id,
        input.uploadedDocumentId,
        fileDifferences,
      ),
      fileDifferences,
    };
  }
}

function readCandidateDocumentId(value: unknown) {
  if (typeof value !== "object" || value === null) return "";
  const id = (value as Record<string, unknown>).quoteDocumentId;
  return typeof id === "string" ? id : "";
}

function sameIdentity(
  candidate: QuoteDocumentIdentity,
  record: StandardQuoteDocumentRecord,
) {
  return (
    candidate.signatureVersion === record.signatureVersion &&
    candidate.quoteDocumentId === record.quoteDocumentId &&
    candidate.quoteRequestId === record.quoteRequestId &&
    candidate.fiscalYear === record.fiscalYear &&
    candidate.templateVersion.id === record.templateVersion.id &&
    candidate.templateVersion.version === record.templateVersion.version &&
    candidate.payloadChecksum === record.payloadChecksum &&
    candidate.integrityToken === record.integrityToken
  );
}

function emptyResult(
  status: QuoteDocumentMatchResult["status"],
  quoteDocumentId: string | null = null,
): QuoteDocumentMatchResult {
  return {
    status,
    canUseTrustedServerData: false,
    quoteDocumentId,
    trustedRecord: null,
    normalizedQuote: null,
    fileDifferences: [],
  };
}

function createTrustedNormalizedQuote(
  record: StandardQuoteDocumentRecord,
  caseId: string,
  uploadedDocumentId: string,
  fileDifferences: readonly QuoteDocumentFileDifference[],
): NormalizedAuditQuote {
  const payload = structuredClone(record.normalizedPayload);
  const source = Object.fromEntries(
    NORMALIZED_AUDIT_QUOTE_FIELDS.map((field) => [
      field,
      "TRUSTED_SERVER_RECORD",
    ]),
  ) as NormalizedAuditQuote["source"];
  const confidenceByField = Object.fromEntries(
    NORMALIZED_AUDIT_QUOTE_FIELDS.map((field) => [field, 100]),
  ) as NormalizedAuditQuote["confidenceByField"];

  return {
    quoteId: record.quoteDocumentId,
    caseId,
    documentId: uploadedDocumentId,
    ...payload,
    missingFields: [],
    warnings: fileDifferences.map((difference) => ({
      code: difference,
      field: null,
      message:
        difference === "FILE_HASH_MISMATCH"
          ? "업로드 파일이 서버에 등록된 원본 파일과 다릅니다."
          : "업로드 문서의 주요 표시값 체크섬이 서버 데이터와 다릅니다.",
    })),
    confidenceByField,
    evidenceByField: {},
    source,
    confirmedByCustomer: false,
    confirmedAt: null,
  };
}
