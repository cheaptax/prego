import type {
  AuditEvaluationCase,
  AuditEvaluationCaseStatus,
  AuditEvaluationInstant,
  EvaluationConfig,
  EvaluationReportRun,
  NormalizedAuditQuote,
  QuoteDocumentMatchStatus,
  QuoteIntegrityStatus,
  UploadedQuoteDocument,
} from "@/lib/audit-evaluation/types";

export type CaseStatusTransitionInput = {
  caseId: string;
  expectedStatus: AuditEvaluationCaseStatus;
  nextStatus: AuditEvaluationCaseStatus;
  updatedAt: AuditEvaluationInstant;
  completedAt: AuditEvaluationInstant | null;
};

export type SaveDraftConfigInput = {
  config: EvaluationConfig & { status: "DRAFT" };
  expectedVersion: number | null;
};

export type PublishConfigInput = {
  configId: string;
  version: number;
  expectedStatus: "DRAFT";
  actorUid: string;
  publishedAt: AuditEvaluationInstant;
};

export type ArchiveConfigInput = {
  configId: string;
  version: number;
  expectedStatus: "PUBLISHED";
  actorUid: string;
  archivedAt: AuditEvaluationInstant;
};

export type SaveDocumentMatchInput = {
  documentId: string;
  caseId: string;
  expectedSha256: string;
  matchedQuoteDocumentId: string | null;
  matchStatus: QuoteDocumentMatchStatus;
  integrityStatus: QuoteIntegrityStatus;
};

export interface AuditEvaluationRepository {
  getCase(caseId: string): Promise<AuditEvaluationCase | null>;
  createCase(value: AuditEvaluationCase): Promise<AuditEvaluationCase>;

  /**
   * Implementations must compare expectedStatus and write nextStatus atomically.
   * No generic case update method is exposed so status writes pass this boundary.
   */
  transitionCaseStatus(
    input: CaseStatusTransitionInput,
  ): Promise<AuditEvaluationCase>;

  getDocument(documentId: string): Promise<UploadedQuoteDocument | null>;
  listDocuments(caseId: string): Promise<UploadedQuoteDocument[]>;
  createDocument(
    value: UploadedQuoteDocument,
  ): Promise<UploadedQuoteDocument>;
  saveDocumentMatch(
    input: SaveDocumentMatchInput,
  ): Promise<UploadedQuoteDocument>;

  getNormalizedQuote(quoteId: string): Promise<NormalizedAuditQuote | null>;
  listNormalizedQuotes(caseId: string): Promise<NormalizedAuditQuote[]>;
  saveNormalizedQuote(
    value: NormalizedAuditQuote,
  ): Promise<NormalizedAuditQuote>;

  getConfigVersion(
    configId: string,
    version: number,
  ): Promise<EvaluationConfig | null>;
  getPublishedConfig(
    configId: string,
    at: AuditEvaluationInstant,
  ): Promise<EvaluationConfig | null>;
  listConfigVersions(configId: string): Promise<EvaluationConfig[]>;
  saveDraftConfig(input: SaveDraftConfigInput): Promise<EvaluationConfig>;
  publishConfig(input: PublishConfigInput): Promise<EvaluationConfig>;
  archiveConfig(input: ArchiveConfigInput): Promise<EvaluationConfig>;

  getReportRun(reportRunId: string): Promise<EvaluationReportRun | null>;
  listReportRuns(caseId: string): Promise<EvaluationReportRun[]>;
  createReportRun(value: EvaluationReportRun): Promise<EvaluationReportRun>;
  saveReportRun(value: EvaluationReportRun): Promise<EvaluationReportRun>;
}
