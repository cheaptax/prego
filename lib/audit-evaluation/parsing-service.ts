import "server-only";

import {
  DisabledQuoteAiExtractionAdapter,
  DisabledQuoteOcrAdapter,
  type QuoteAiExtractionAdapter,
  type QuoteOcrAdapter,
} from "@/lib/audit-evaluation/quote-extraction-adapters";
import {
  QUOTE_SOURCE_PRIORITY,
  runQuoteExtractionPipeline,
} from "@/lib/audit-evaluation/quote-extraction-pipeline";
import {
  FirestoreAuditEvaluationParsingRepository,
  type AuditEvaluationParsingContext,
  type AuditEvaluationParsingRepository,
} from "@/lib/audit-evaluation/parsing-repository";
import {
  getServerFeatureFlags,
  type AuditEvaluationFeatureFlags,
} from "@/lib/audit-evaluation/feature-flags";
import type {
  QuoteExtractionRunRecord,
  QuoteFieldSource,
} from "@/lib/audit-evaluation/types";
import {
  FirebaseAuditEvaluationUploadStorage,
  type AuditEvaluationUploadStorage,
} from "@/lib/audit-evaluation/upload-storage";

export class AuditEvaluationParsingService {
  private readonly repository: AuditEvaluationParsingRepository;
  private readonly storage: AuditEvaluationUploadStorage;
  private readonly ocrAdapter: QuoteOcrAdapter;
  private readonly aiAdapter: QuoteAiExtractionAdapter;
  private readonly flags: AuditEvaluationFeatureFlags;

  constructor(
    repository: AuditEvaluationParsingRepository =
      new FirestoreAuditEvaluationParsingRepository(),
    options: {
      storage?: AuditEvaluationUploadStorage;
      ocrAdapter?: QuoteOcrAdapter;
      aiAdapter?: QuoteAiExtractionAdapter;
      flags?: AuditEvaluationFeatureFlags;
    } = {},
  ) {
    this.repository = repository;
    this.storage =
      options.storage ?? new FirebaseAuditEvaluationUploadStorage();
    this.ocrAdapter = options.ocrAdapter ?? new DisabledQuoteOcrAdapter();
    this.aiAdapter =
      options.aiAdapter ?? new DisabledQuoteAiExtractionAdapter();
    this.flags =
      options.flags ?? getServerFeatureFlags().auditEvaluation;
  }

  async processDocument(input: {
    caseId: string;
    documentId: string;
    now: string;
  }) {
    if (!this.flags.enabled) return { processed: false as const };
    const context = await this.repository.loadContext(
      input.caseId,
      input.documentId,
    );
    if (!context) return { processed: false as const };
    if (context.document.scanStatus !== "CLEAN") {
      return { processed: false as const };
    }
    const claimed = await this.repository.claimDocument(
      input.caseId,
      input.documentId,
      input.now,
    );
    if (!claimed) return { processed: false as const };

    try {
      const stored = await this.storage.read(
        context.document.storagePath,
        context.config.maximumFileSize,
      );
      if (
        !stored.exists ||
        stored.bytes.byteLength === 0 ||
        stored.size !== context.document.size ||
        stored.mimeType !== context.document.mimeType
      ) {
        throw new Error("source_document_unavailable");
      }
      const policy = context.config.quoteExtractionPolicy;
      const trustedRecord = canUseTrustedRecord(context)
        ? context.trustedRecord
        : null;
      const result = await runQuoteExtractionPipeline(
        {
          quoteId:
            trustedRecord?.quoteDocumentId ??
            `nq_${context.document.id}`,
          caseId: context.evaluationCase.id,
          documentId: context.document.id,
          documentBytes: stored.bytes,
          embeddedMetadataText: new TextDecoder("latin1").decode(stored.bytes),
          embeddedPayloadChecksum:
            trustedRecord?.payloadChecksum ?? null,
          trustedServerRecord: trustedRecord,
          otherQuotes: context.otherQuotes,
          requiredProposalItemIds: requiredProposalItemIds(context),
        },
        {
          requiredFields: context.config.requiredFields,
          deterministicParserEnabled:
            policy?.deterministicParserEnabled ?? true,
          ocrEnabled: policy?.ocrEnabled === true,
          ocrAdapter: this.ocrAdapter,
          aiEnabled:
            this.flags.aiNarrativeEnabled &&
            policy?.aiExtractionEnabled === true,
          aiAdapter: this.aiAdapter,
          aiPromptVersion: policy?.aiPromptVersion,
        },
      );
      if (result.status === "FAILED") {
        await this.saveFailure(
          context,
          input.now,
          result.failure.code,
          result.aiMetadata,
        );
        return { processed: true as const, status: "FAILED" as const };
      }

      const runStatus = result.status === "SUCCESS"
        ? "COMPLETED"
        : "NEEDS_REVIEW";
      const run = createRun({
        context,
        now: input.now,
        status: runStatus,
        quoteSources: Object.values(result.quote.source),
        aiMetadata: result.aiMetadata,
        warningCodes: result.quote.warnings.map(({ code }) => code),
        failureCode: null,
      });
      await this.repository.saveResult({
        context,
        quote: result.quote,
        run,
        parsingStatus:
          result.status === "SUCCESS" ? "PARSED" : "NEEDS_REVIEW",
        queueStatus:
          result.status === "SUCCESS" ? "COMPLETED" : "PENDING_REVIEW",
        errorCode:
          result.status === "SUCCESS" ? null : "extraction_review_required",
        now: input.now,
      });
      return { processed: true as const, status: result.status };
    } catch {
      await this.saveFailure(
        context,
        input.now,
        "QUOTE_EXTRACTION_FAILED",
        null,
      );
      return { processed: true as const, status: "FAILED" as const };
    }
  }

  private async saveFailure(
    context: AuditEvaluationParsingContext,
    now: string,
    failureCode: string,
    aiMetadata: QuoteExtractionRunRecord["aiMetadata"],
  ) {
    await this.repository.saveResult({
      context,
      quote: null,
      run: createRun({
        context,
        now,
        status: "FAILED",
        quoteSources: [],
        aiMetadata,
        warningCodes: [],
        failureCode,
      }),
      parsingStatus: "FAILED",
      queueStatus: "FAILED",
      errorCode: failureCode,
      now,
    });
  }
}

function canUseTrustedRecord(context: AuditEvaluationParsingContext) {
  return (
    context.trustedRecord?.status === "ACTIVE" &&
    (
      context.document.matchStatus === "VERIFIED" ||
      context.document.matchStatus === "VERIFIED_WITH_FILE_DIFFERENCE"
    ) &&
    context.document.integrityStatus !== "FAILED"
  );
}

function requiredProposalItemIds(context: AuditEvaluationParsingContext) {
  return context.config.criteria.flatMap((criterion) => {
    if (
      criterion.rule.type === "checklist" &&
      criterion.rule.field === "requiredProposalItems"
    ) {
      return criterion.rule.items
        .filter(({ required }) => required)
        .map(({ id }) => id);
    }
    if (criterion.rule.type !== "weighted-subcriteria") return [];
    return criterion.rule.subcriteria.flatMap(({ rule }) =>
      rule.type === "checklist" &&
      rule.field === "requiredProposalItems"
        ? rule.items
            .filter(({ required }) => required)
            .map(({ id }) => id)
        : []
    );
  });
}

function createRun(input: {
  context: AuditEvaluationParsingContext;
  now: string;
  status: QuoteExtractionRunRecord["status"];
  quoteSources: Array<QuoteFieldSource | undefined>;
  aiMetadata: QuoteExtractionRunRecord["aiMetadata"];
  warningCodes: string[];
  failureCode: string | null;
}): QuoteExtractionRunRecord {
  const sourceOrder = [...new Set(
    input.quoteSources.filter(
      (source): source is QuoteFieldSource => source !== undefined,
    ),
  )].sort(
    (left, right) =>
      QUOTE_SOURCE_PRIORITY[right] - QUOTE_SOURCE_PRIORITY[left],
  );
  return {
    id: `aer_${input.context.document.id}`,
    caseId: input.context.evaluationCase.id,
    documentId: input.context.document.id,
    status: input.status,
    sourceOrder,
    aiMetadata: input.aiMetadata,
    warningCodes: [...new Set(input.warningCodes)].slice(0, 200),
    failureCode: input.failureCode,
    startedAt: input.now,
    completedAt: input.now,
  };
}
