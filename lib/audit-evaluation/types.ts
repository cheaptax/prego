import type { NhAuditReportEvaluationSnapshot } from "@/lib/audit-evaluation/nh-audit-report-snapshot";

export type AuditEvaluationInstant = string;
export type WonAmount = string & { readonly __brand: "WonAmount" };

export const AUDIT_EVALUATION_CASE_STATUSES = [
  "DRAFT",
  "ACCESS_PENDING",
  "UPLOADING",
  "PARSING",
  "NEEDS_REVIEW",
  "READY",
  "GENERATING",
  "COMPLETED",
  "FAILED",
  "EXPIRED",
  "DELETED",
] as const;

export type AuditEvaluationCaseStatus =
  (typeof AUDIT_EVALUATION_CASE_STATUSES)[number];

export const EVALUATION_CONFIG_STATUSES = [
  "DRAFT",
  "PUBLISHED",
  "ARCHIVED",
] as const;

export type EvaluationConfigStatus =
  (typeof EVALUATION_CONFIG_STATUSES)[number];

export const QUOTE_FIELD_SOURCES = [
  "TRUSTED_SERVER_RECORD",
  "EMBEDDED_METADATA",
  "DETERMINISTIC_PARSE",
  "OCR",
  "AI_EXTRACTION",
  "CUSTOMER_CORRECTION",
  "ADMIN_CORRECTION",
] as const;

export type QuoteFieldSource = (typeof QUOTE_FIELD_SOURCES)[number];

export type VersionReference = {
  id: string;
  version: number;
};

export type CustomerAccessOwner =
  | { type: "FIREBASE_UID"; uid: string }
  | { type: "CAPABILITY_SUBJECT"; subjectId: string };

export type AuditEvaluationActor =
  | { type: "ADMIN"; uid: string }
  | { type: "CUSTOMER"; subjectId: string }
  | { type: "SYSTEM"; service: string };

export type AuditEvaluationCase = {
  id: string;
  quoteRequestId: string;
  cooperativeId: string | null;
  cooperativeNameSnapshot: string;
  fiscalYear: number;
  customerAccessOwner: CustomerAccessOwner;
  status: AuditEvaluationCaseStatus;
  quoteTemplateVersion: VersionReference | null;
  evaluationConfigVersion: VersionReference;
  latestReportVersion: number | null;
  expectedQuoteCount: number;
  confirmedQuoteCount: number;
  latestConfirmationVersion?: number;
  confirmationVersion?: number | null;
  reportRequestedConfirmationVersion?: number | null;
  reportRegenerationRequired?: boolean;
  expiresAt: AuditEvaluationInstant;
  createdAt: AuditEvaluationInstant;
  updatedAt: AuditEvaluationInstant;
  completedAt: AuditEvaluationInstant | null;
};

export const QUOTE_UPLOAD_STATUSES = [
  "PENDING",
  "UPLOADING",
  "UPLOADED",
  "FAILED",
  "DELETED",
] as const;

export const QUOTE_SCAN_STATUSES = [
  "PENDING",
  "SCANNING",
  "CLEAN",
  "REJECTED",
  "QUARANTINED",
  "UNAVAILABLE",
  "FAILED",
] as const;

export const QUOTE_PARSING_STATUSES = [
  "PENDING",
  "PARSING",
  "PARSED",
  "NEEDS_REVIEW",
  "FAILED",
] as const;

export const QUOTE_INTEGRITY_STATUSES = [
  "PENDING",
  "VERIFIED",
  "MISMATCH",
  "DUPLICATE",
  "FAILED",
] as const;

export type QuoteUploadStatus = (typeof QUOTE_UPLOAD_STATUSES)[number];
export type QuoteScanStatus = (typeof QUOTE_SCAN_STATUSES)[number];
export type QuoteParsingStatus = (typeof QUOTE_PARSING_STATUSES)[number];
export type QuoteIntegrityStatus =
  (typeof QUOTE_INTEGRITY_STATUSES)[number];

export type UploadedQuoteDocument = {
  id: string;
  caseId: string;
  originalFileName: string;
  safeDisplayName: string;
  storagePath: string;
  mimeType: string;
  size: number;
  sha256: string;
  uploadStatus: QuoteUploadStatus;
  scanStatus: QuoteScanStatus;
  parsingStatus: QuoteParsingStatus;
  matchedQuoteDocumentId: string | null;
  matchStatus: QuoteDocumentMatchStatus | null;
  integrityStatus: QuoteIntegrityStatus;
  uploadedAt: AuditEvaluationInstant;
  uploadedBy: AuditEvaluationActor;
  deletedAt: AuditEvaluationInstant | null;
  deletedBy: AuditEvaluationActor | null;
};

export const QUOTE_UPLOAD_INTENT_STATUSES = [
  "PENDING",
  "UPLOADED",
  "FINALIZING",
  "COMPLETED",
  "FAILED",
  "EXPIRED",
] as const;

export type QuoteUploadIntentStatus =
  (typeof QUOTE_UPLOAD_INTENT_STATUSES)[number];

export type QuoteUploadIntent = {
  id: string;
  caseId: string;
  documentId: string;
  idempotencyKeyHash: string;
  originalFileName: string;
  safeDisplayName: string;
  extension: string;
  mimeType: string;
  declaredSize: number;
  quarantineStoragePath: string;
  status: QuoteUploadIntentStatus;
  scanStatus: QuoteScanStatus;
  failureCode: string | null;
  expiresAt: AuditEvaluationInstant;
  createdAt: AuditEvaluationInstant;
  completedAt: AuditEvaluationInstant | null;
};

export const QUOTE_PARSING_QUEUE_STATUSES = [
  "PENDING",
  "PENDING_REVIEW",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type QuoteParsingQueueStatus =
  (typeof QUOTE_PARSING_QUEUE_STATUSES)[number];

export type QuoteParsingQueueRecord = {
  id: string;
  caseId: string;
  documentId: string;
  status: QuoteParsingQueueStatus;
  attempts: number;
  availableAt: AuditEvaluationInstant;
  createdAt: AuditEvaluationInstant;
  updatedAt: AuditEvaluationInstant;
  lastErrorCode: string | null;
};

export type QuoteExtractionRunRecord = {
  id: string;
  caseId: string;
  documentId: string;
  status: "PROCESSING" | "COMPLETED" | "NEEDS_REVIEW" | "FAILED";
  sourceOrder: readonly QuoteFieldSource[];
  aiMetadata: {
    model: string;
    promptVersion: string;
    timestamp: AuditEvaluationInstant;
  } | null;
  warningCodes: string[];
  failureCode: string | null;
  startedAt: AuditEvaluationInstant;
  completedAt: AuditEvaluationInstant | null;
};

export type AuditQuoteCorrectionReviewStatus =
  | "NOT_REQUIRED"
  | "PENDING"
  | "APPROVED"
  | "REJECTED";

export type AuditQuoteCorrectionRecord = {
  id: string;
  caseId: string;
  quoteId: string;
  documentId: string;
  field: NormalizedAuditQuoteField;
  originalExtractedValue: QuoteEvidenceValue;
  previousValue: QuoteEvidenceValue;
  correctedValue: QuoteEvidenceValue;
  reason: string;
  source: "CUSTOMER_CORRECTION" | "ADMIN_CORRECTION";
  correctedBy: Extract<
    AuditEvaluationActor,
    { type: "CUSTOMER" | "ADMIN" }
  >;
  correctedAt: AuditEvaluationInstant;
  quoteRevision: number;
  requiresAdminReview: boolean;
  reviewStatus: AuditQuoteCorrectionReviewStatus;
};

export const NORMALIZED_AUDIT_QUOTE_FIELDS = [
  "accountingFirmId",
  "accountingFirmName",
  "auditFee",
  "vatIncluded",
  "accountingFirmRevenue",
  "recentNonghyupAuditCount",
  "auditedNonghyupTypes",
  "taxAgencyExperience",
  "subsidySettlementExperience",
  "engagementPartner",
  "engagementTeam",
  "totalPlannedHours",
  "partnerHours",
  "auditSchedule",
  "qualityControlPlan",
  "requiredProposalItems",
] as const;

export type NormalizedAuditQuoteField =
  (typeof NORMALIZED_AUDIT_QUOTE_FIELDS)[number];

export type ExperienceSummary = {
  hasExperience: boolean;
  descriptions: string[];
};

export type EngagementPartner = {
  name: string;
  title: string | null;
  yearsOfExperience: number | null;
};

export type EngagementTeamMember = {
  name: string;
  role: string;
  plannedHours: number | null;
};

export type AuditScheduleItem = {
  id: string;
  label: string;
  startsOn: string | null;
  endsOn: string | null;
};

export type ProposalItemValue = {
  present: boolean;
  value: string | null;
};

export type QuoteWarning = {
  code: string;
  field: NormalizedAuditQuoteField | null;
  message: string;
};

export type QuoteEvidenceValue =
  | null
  | string
  | number
  | boolean
  | QuoteEvidenceValue[]
  | { [key: string]: QuoteEvidenceValue };

export type QuoteFieldEvidence = {
  documentId: string;
  extractedValue: QuoteEvidenceValue;
  normalizedValue: QuoteEvidenceValue;
  source: QuoteFieldSource;
  confidence: number;
  pageNumber: number | null;
  excerpt: string;
  coordinates: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  cellAddress: string | null;
  validationWarnings: string[];
};

export type NormalizedAuditQuote = {
  quoteId: string;
  caseId: string;
  documentId: string;
  accountingFirmId: string | null;
  accountingFirmName: string;
  auditFee: WonAmount | null;
  vatIncluded: boolean | null;
  accountingFirmRevenue: WonAmount | null;
  recentNonghyupAuditCount: number | null;
  auditedNonghyupTypes: string[];
  taxAgencyExperience: ExperienceSummary;
  subsidySettlementExperience: ExperienceSummary;
  engagementPartner: EngagementPartner | null;
  engagementTeam: EngagementTeamMember[];
  totalPlannedHours: number | null;
  partnerHours: number | null;
  auditSchedule: AuditScheduleItem[];
  qualityControlPlan: string[];
  requiredProposalItems: Record<string, ProposalItemValue>;
  missingFields: NormalizedAuditQuoteField[];
  warnings: QuoteWarning[];
  confidenceByField: Partial<Record<NormalizedAuditQuoteField, number>>;
  evidenceByField: Partial<
    Record<NormalizedAuditQuoteField, QuoteFieldEvidence[]>
  >;
  source: Partial<Record<NormalizedAuditQuoteField, QuoteFieldSource>>;
  confirmedByCustomer: boolean;
  confirmedAt: AuditEvaluationInstant | null;
  revision?: number;
  updatedAt?: AuditEvaluationInstant;
  pendingAdminReviewFields?: NormalizedAuditQuoteField[];
};

export const STANDARD_QUOTE_DOCUMENT_FORMATS = [
  "PDF",
  "XLSX",
  "DOCX",
] as const;

export type StandardQuoteDocumentFormat =
  (typeof STANDARD_QUOTE_DOCUMENT_FORMATS)[number];

export type TrustedStandardQuotePayload = {
  accountingFirmId: string;
  accountingFirmName: string;
  auditFee: WonAmount;
  vatIncluded: boolean;
  accountingFirmRevenue: WonAmount;
  recentNonghyupAuditCount: number;
  auditedNonghyupTypes: string[];
  taxAgencyExperience: ExperienceSummary;
  subsidySettlementExperience: ExperienceSummary;
  engagementPartner: EngagementPartner;
  engagementTeam: EngagementTeamMember[];
  totalPlannedHours: number;
  partnerHours: number;
  auditSchedule: AuditScheduleItem[];
  qualityControlPlan: string[];
  requiredProposalItems: Record<string, ProposalItemValue>;
};

export type QuoteDocumentIdentity = {
  signatureVersion: 1;
  quoteDocumentId: string;
  quoteRequestId: string;
  fiscalYear: number;
  templateVersion: VersionReference;
  payloadChecksum: string;
  integrityToken: string;
};

export type StandardQuoteDocumentRecord = QuoteDocumentIdentity & {
  documentFormat: StandardQuoteDocumentFormat;
  normalizedPayload: TrustedStandardQuotePayload;
  originalDocumentSha256: string;
  verificationCode: string;
  status: "ACTIVE" | "REVOKED";
  registeredAt: AuditEvaluationInstant;
  registeredBy: AuditEvaluationActor;
};

export const QUOTE_DOCUMENT_MATCH_STATUSES = [
  "VERIFIED",
  "VERIFIED_WITH_FILE_DIFFERENCE",
  "LEGACY_DOCUMENT",
  "UNRECOGNIZED",
  "INVALID_SIGNATURE",
  "WRONG_CASE",
  "DUPLICATE",
] as const;

export type QuoteDocumentMatchStatus =
  (typeof QUOTE_DOCUMENT_MATCH_STATUSES)[number];

export type QuoteDocumentFileDifference =
  | "FILE_HASH_MISMATCH"
  | "PAYLOAD_CHECKSUM_MISMATCH";

export type QuoteDocumentMatchResult = {
  status: QuoteDocumentMatchStatus;
  canUseTrustedServerData: boolean;
  quoteDocumentId: string | null;
  trustedRecord: StandardQuoteDocumentRecord | null;
  normalizedQuote: NormalizedAuditQuote | null;
  fileDifferences: QuoteDocumentFileDifference[];
};

export type RuleComparableValue =
  | { kind: "INTEGER"; value: number }
  | { kind: "DECIMAL_STRING"; value: string }
  | { kind: "BOOLEAN"; value: boolean }
  | { kind: "TEXT"; value: string };

export type ThresholdRule = {
  type: "threshold";
  field: NormalizedAuditQuoteField;
  operator: "GT" | "GTE" | "LT" | "LTE" | "EQ";
  threshold: RuleComparableValue;
};

export type BooleanRule = {
  type: "boolean";
  field: NormalizedAuditQuoteField;
  expected: boolean;
};

export type ChecklistItemCondition =
  | {
      type: "FIELD_PRESENT";
      field: NormalizedAuditQuoteField;
    }
  | {
      type: "BOOLEAN_EQUALS";
      field: NormalizedAuditQuoteField;
      expected: boolean;
    }
  | {
      type: "MINIMUM_INTEGER";
      field: NormalizedAuditQuoteField;
      minimum: number;
    }
  | {
      type: "PROPOSAL_ITEM_PRESENT";
      itemId: string;
    };

export type ChecklistRule = {
  type: "checklist";
  field: NormalizedAuditQuoteField;
  items: Array<{
    id: string;
    label: string;
    required: boolean;
    scoreBasisPoints: number;
    condition?: ChecklistItemCondition;
  }>;
};

export type RangeRule = {
  type: "range";
  field: NormalizedAuditQuoteField;
  bands: Array<{
    id: string;
    minimumInclusive: RuleComparableValue | null;
    maximumExclusive: RuleComparableValue | null;
    scoreBasisPoints: number;
  }>;
};

export type InformationalOnlyRule = {
  type: "informational-only";
  field: NormalizedAuditQuoteField;
};

export type EvaluationLeafRule =
  | ThresholdRule
  | BooleanRule
  | ChecklistRule
  | RangeRule
  | InformationalOnlyRule;

export type WeightedSubcriteriaRule = {
  type: "weighted-subcriteria";
  subcriteria: Array<{
    id: string;
    name: string;
    relativeWeightBasisPoints: number;
    rule: EvaluationLeafRule;
  }>;
};

export type EvaluationCriterion = {
  id: string;
  name: string;
  description: string;
  weightBasisPoints: number;
  required: boolean;
  rule: EvaluationLeafRule | WeightedSubcriteriaRule;
};

export type FeeAnalysisPolicy = {
  currency: "KRW";
  vatHandling:
    | "PRESERVE_AS_SUBMITTED"
    | "NORMALIZE_TO_VAT_INCLUDED"
    | "NORMALIZE_TO_VAT_EXCLUDED";
  comparisonMethod: "LOWEST" | "MEDIAN" | "AVERAGE_RATIONAL";
  missingVatPolicy: "NEEDS_REVIEW" | "ASSUME_INCLUDED" | "ASSUME_EXCLUDED";
  roundingMode: "DOWN" | "HALF_UP" | "UP";
  twoQuoteMedianPolicy?: "MIDPOINT";
  realisticFeeRange?: {
    minimumWon: WonAmount;
    maximumWon: WonAmount;
  };
  outlierPolicy?: {
    minimumQuoteCount: number;
    lowDeviationBasisPoints: number;
    highDeviationBasisPoints: number;
  };
};

export type ReportSectionConfig = {
  id: string;
  name: string;
  order: number;
  enabled: boolean;
  type:
    | "COVER"
    | "PURPOSE_SCOPE"
    | "EXECUTIVE_SUMMARY"
    | "SUMMARY"
    | "SCORE_BREAKDOWN"
    | "FEE_ANALYSIS"
    | "QUOTE_COMPARISON"
    | "CAPABILITY_ANALYSIS"
    | "FIRM_REVIEW"
    | "OVERALL_OPINION"
    | "APPENDIX"
    | "RISKS"
    | "EVIDENCE"
    | "DISCLAIMER";
};

export type ReportPhrase = {
  id: string;
  label: string;
  text: string;
};

export type RetentionPolicy = {
  sourceDocumentDays: number;
  normalizedDataDays: number;
  reportDays: number;
  expiredAccessTokenDays?: number;
  auditLogDays?: number;
  deleteAfterExpiry: boolean;
};

export type CustomerAccessPolicy = {
  magicLinkLifetimeMinutes: number;
  sessionLifetimeMinutes: number;
  caseLifetimeDays: number;
  allowUploadWhenNoRegisteredQuotes: boolean;
};

export type QuoteExtractionPolicy = {
  deterministicParserEnabled: boolean;
  ocrEnabled: boolean;
  aiExtractionEnabled: boolean;
  aiPromptVersion: string;
};

export type CustomerCorrectionPolicy = {
  coreFieldChangesRequireAdminReview: boolean;
};

export type ReportRenderingPolicy = {
  watermarkEnabled: boolean;
  watermarkText: string;
  downloadUrlLifetimeSeconds: number;
  reportTitle?: string;
  centerContact?: string;
  logoAssetId?: string | null;
  primaryColor?: string;
  accentColor?: string;
  fileNameRule?: "FISCAL_YEAR_VERSION" | "CASE_VERSION";
  customerDownloadDays?: number;
};

export type EvaluationConfig = {
  id: string;
  name: string;
  version: number;
  status: EvaluationConfigStatus;
  effectiveFrom: AuditEvaluationInstant | null;
  effectiveTo: AuditEvaluationInstant | null;
  minimumQuoteCount: number;
  maximumQuoteCount: number;
  uploadLimit: number;
  permittedMimeTypes: string[];
  maximumFileSize: number;
  criteria: EvaluationCriterion[];
  feeAnalysisPolicy: FeeAnalysisPolicy;
  requiredFields: NormalizedAuditQuoteField[];
  reportSections: ReportSectionConfig[];
  reportPhrases: ReportPhrase[];
  retentionPolicy: RetentionPolicy;
  customerAccessPolicy: CustomerAccessPolicy;
  quoteExtractionPolicy?: QuoteExtractionPolicy;
  customerCorrectionPolicy?: CustomerCorrectionPolicy;
  reportRenderingPolicy?: ReportRenderingPolicy;
  createdBy: string;
  createdAt: AuditEvaluationInstant;
  draftRevision?: number;
  updatedBy?: string;
  updatedAt?: AuditEvaluationInstant;
  publishedBy: string | null;
  publishedAt: AuditEvaluationInstant | null;
};

export type AuditEvaluationAuditLog = {
  id: string;
  caseId: string | null;
  reportVersion: number | null;
  documentId?: string | null;
  action: string;
  actor: AuditEvaluationActor;
  occurredAt: AuditEvaluationInstant;
  detail: string;
  errorCode?: string | null;
  retryCount?: number | null;
};

export type AuditEvaluationAccessTokenRecord = {
  tokenHash: string;
  caseId: string;
  quoteRequestId: string;
  emailHash: string;
  subjectId: string;
  sessionLifetimeMinutes: number;
  expiresAt: AuditEvaluationInstant;
  issuedAt: AuditEvaluationInstant;
  usedAt: AuditEvaluationInstant | null;
  revokedAt: AuditEvaluationInstant | null;
  replacedByTokenHash: string | null;
};

export type AuditEvaluationSessionRecord = {
  sessionHash: string;
  caseId: string;
  owner: CustomerAccessOwner;
  createdAt: AuditEvaluationInstant;
  expiresAt: AuditEvaluationInstant;
  revokedAt: AuditEvaluationInstant | null;
};

export type CriterionScoreResult = {
  criterionId: string;
  rawScoreBasisPoints: number;
  scoreBasisPoints: number;
  maximumBasisPoints: number;
  passed: boolean | null;
  appliedThresholds: Array<{
    ruleType: EvaluationLeafRule["type"];
    ruleId: string;
    field: NormalizedAuditQuoteField;
    normalizedInput: string | null;
    expression: string;
  }>;
  evidence: Array<{
    field: NormalizedAuditQuoteField;
    evidenceIndexes: number[];
    sources: QuoteFieldSource[];
    confidenceBasisPoints: number | null;
  }>;
  missingFields: NormalizedAuditQuoteField[];
  dataConfidenceBasisPoints: number | null;
  reasons: string[];
};

export type QuoteScoreResult = {
  quoteId: string;
  totalScoreBasisPoints: number;
  criteria: CriterionScoreResult[];
  rank: number;
  tiedWithQuoteIds: string[];
  missingInformation: NormalizedAuditQuoteField[];
  strengths: string[];
  reviewItems: string[];
  dataConfidenceBasisPoints: number | null;
};

export type EvaluationScoreResult = {
  engineVersion: string;
  maximumScoreBasisPoints: number;
  rankingPolicy: "COMPETITION_EQUAL_SCORES_SHARE_RANK";
  quotes: QuoteScoreResult[];
  tieBreaksApplied: string[];
};

export type RationalWonAverage = {
  numeratorWon: WonAmount;
  denominator: number;
  roundedWon: WonAmount;
  roundingMode: FeeAnalysisPolicy["roundingMode"];
};

export type QuoteFeeAnalysis = {
  quoteId: string;
  status: "ANALYZED" | "ERROR";
  originalFeeWon: WonAmount | null;
  normalizedFeeWon: WonAmount | null;
  vatIncluded: boolean | null;
  vatAdjustment:
    | "NONE"
    | "NORMALIZED_TO_INCLUDED"
    | "NORMALIZED_TO_EXCLUDED"
    | "ASSUMED_INCLUDED"
    | "ASSUMED_EXCLUDED";
  deviationFromMedianBasisPoints: string | null;
  totalPlannedHours: number | null;
  hourlyRate: RationalWonAverage | null;
  partnerHours: number | null;
  partnerHoursRatioBasisPoints: number | null;
  totalFeePosition: number | null;
  flags: string[];
};

export type FeeAnalysisResult = {
  engineVersion: string;
  currency: "KRW";
  qualityScoreIncluded: false;
  validQuoteCount: number;
  normalizedFeesByQuote: Record<string, WonAmount>;
  minimumWon: WonAmount | null;
  maximumWon: WonAmount | null;
  medianWon: WonAmount | null;
  median: RationalWonAverage | null;
  medianInterpretation:
    | "NO_VALID_QUOTES"
    | "SINGLE_QUOTE"
    | "TWO_QUOTE_MIDPOINT"
    | "ODD_SET_MIDDLE"
    | "EVEN_SET_MIDPOINT";
  average: RationalWonAverage | null;
  comparisonBenchmark: {
    method: FeeAnalysisPolicy["comparisonMethod"];
    won: WonAmount | null;
  };
  quotes: QuoteFeeAnalysis[];
  comparisonWarnings: string[];
};

export type NarrativeData = {
  mode: "RULE_BASED" | "AI_ASSISTED";
  ruleBasedSections: Array<{
    sectionId: string;
    facts: string[];
  }>;
  aiStatus: "NOT_REQUESTED" | "PENDING" | "COMPLETED" | "FAILED";
  aiText: string | null;
};

export type RenderingReference = {
  rendererId: string;
  rendererVersion: number;
  payloadStoragePath: string | null;
};

export type DeepReadonly<T> =
  T extends (...args: never[]) => unknown
    ? T
    : T extends readonly (infer Item)[]
      ? readonly DeepReadonly<Item>[]
      : T extends object
        ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
        : T;

export type EvaluationConfigSnapshot = DeepReadonly<EvaluationConfig>;
export type QuoteDataSnapshot = DeepReadonly<NormalizedAuditQuote>;

export type AuditEvaluationConfirmationRecord = {
  id: string;
  caseId: string;
  version: number;
  evaluationConfigSnapshot: EvaluationConfigSnapshot;
  quoteDataSnapshots: readonly QuoteDataSnapshot[];
  inputHash: string;
  finalAcknowledged: true;
  confirmedBy: Extract<AuditEvaluationActor, { type: "CUSTOMER" }>;
  confirmedAt: AuditEvaluationInstant;
};

export const EVALUATION_REPORT_RUN_STATUSES = [
  "PENDING",
  "GENERATING",
  "COMPLETED",
  "FAILED",
] as const;

export type EvaluationReportRunStatus =
  (typeof EVALUATION_REPORT_RUN_STATUSES)[number];

export type EvaluationReportRun = {
  id: string;
  caseId: string;
  reportVersion: number;
  confirmationVersion: number;
  inputHash: string;
  status: EvaluationReportRunStatus;
  requestedAt?: AuditEvaluationInstant;
  generationAttempt?: number;
  generationStartedAt?: AuditEvaluationInstant | null;
  generationLeaseExpiresAt?: AuditEvaluationInstant | null;
  evaluationConfigSnapshot: EvaluationConfigSnapshot;
  quoteDataSnapshots: readonly QuoteDataSnapshot[];
  scoreResult: EvaluationScoreResult | null;
  feeAnalysis: FeeAnalysisResult | null;
  nhAuditEvaluationSnapshot?: NhAuditReportEvaluationSnapshot;
  narrativeData: NarrativeData;
  htmlStoragePath: string | null;
  renderingReference: RenderingReference | null;
  pdfStoragePath: string | null;
  generatedAt: AuditEvaluationInstant | null;
  generatedBy: AuditEvaluationActor;
  failureCode: string | null;
  failureMessage: string | null;
};
