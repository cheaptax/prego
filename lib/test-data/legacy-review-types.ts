import type {
  PurgeResetFieldPreview,
  PurgeTargetType,
  ScanSnapshot,
  TestDataClassification,
} from "@/lib/test-data/purge-types";

export const LEGACY_REVIEW_COLLECTION = "legacyTestDataClassifications";
export const LEGACY_REVIEW_AUDIT_COLLECTION = "legacyTestDataReviewEvents";
export const LEGACY_REVIEW_MANIFEST_COLLECTION =
  "legacyTestDataReviewManifests";
export const LEGACY_REVIEW_VERSION = 1;
export const LEGACY_REVIEW_MAX_CANDIDATES = 500;
export const LEGACY_TAG_MIGRATION_MAX_DOCUMENTS = 100;

export type LegacyReviewDecision =
  | "CONFIRMED_TEST"
  | "PRESERVE"
  | "UNRESOLVED";

export type LegacyEvidenceStrength = "STRONG" | "SUPPORTING" | "NONE";

export const LEGACY_EVIDENCE_CODES = [
  "FIXED_SEED_DOCUMENT_ID",
  "GIT_FIXTURE_DOCUMENT_ID",
  "EXACT_SEED_UID",
  "SEED_MANIFEST_ENTRY",
  "DEVELOPER_DECLARED_EXACT_ID",
  "EXPLICIT_TEST_MARKER",
  "APPROVED_LEGACY_REVIEW",
  "TEST_EMAIL_PATTERN",
  "TEST_NAME_PATTERN",
  "DEVELOPMENT_TIMESTAMP",
  "ABNORMAL_POINT_AMOUNT",
  "FIXTURE_QUESTION_PATTERN",
  "LOCALHOST_OR_EMULATOR_METADATA",
  "DEVELOPER_ACTOR_PATTERN",
  "BROKEN_REFERENCE",
  "CROSS_INSTITUTION_REFERENCE",
  "NO_TEST_EVIDENCE",
] as const;

export type LegacyEvidenceCode = (typeof LEGACY_EVIDENCE_CODES)[number];

export type LegacyEvidenceCatalog = {
  documentPaths: Record<string, LegacyEvidenceCode>;
  authUids: Record<string, LegacyEvidenceCode>;
  storagePaths: Record<string, LegacyEvidenceCode>;
  developmentWindows?: Array<{ start: string; end: string }>;
};

export type LegacyReviewCandidate = {
  candidateId: string;
  institutionId: string;
  targetType: PurgeTargetType;
  resourceKey: string;
  collection?: string;
  documentPath?: string;
  authUid?: string;
  storagePath?: string;
  sourceDocumentPath?: string;
  changeToken?: string;
  generation?: string;
  initialClassification: TestDataClassification;
  suggestedDecision: LegacyReviewDecision;
  evidenceStrength: LegacyEvidenceStrength;
  sourceEvidence: LegacyEvidenceCode[];
  warningCodes: string[];
  createdAt?: string;
  decision?: LegacyReviewDecision;
  reviewId?: string;
};

export type LegacyReviewRecord = {
  schemaVersion: 1;
  reviewId: string;
  reviewManifestId: string;
  candidateId: string;
  institutionId: string;
  targetType: PurgeTargetType;
  resourceKey: string;
  documentPath?: string;
  authUid?: string;
  storagePath?: string;
  sourceDocumentPath?: string;
  reviewedChangeToken?: string;
  reviewedGeneration?: string;
  decision: LegacyReviewDecision;
  reason: string;
  sourceEvidence: LegacyEvidenceCode[];
  reviewedBy: string;
  reviewedAt: string;
  reviewVersion: number;
  status: "APPROVED" | "PRESERVED" | "UNRESOLVED";
};

export type LegacyCleanupBlockReason =
  | "REVIEW_REQUIRED_REMAINS"
  | "UNRESOLVED_REMAINS"
  | "PRESERVED_CUSTOMER_ACCOUNT"
  | "MIXED_REAL_AND_TEST_DATA"
  | "AUTH_TARGET_UNCONFIRMED"
  | "STORAGE_TARGET_UNCONFIRMED"
  | "MASTER_PRESERVATION_UNCONFIRMED"
  | "RESET_PLAN_UNCONFIRMED"
  | "CROSS_INSTITUTION_REFERENCE"
  | "BROKEN_REFERENCE"
  | "MAX_CANDIDATE_COUNT_EXCEEDED";

export type LegacyCleanupReadiness = {
  status: "READY" | "BLOCKED";
  reasons: LegacyCleanupBlockReason[];
};

export type LegacyInstitutionCandidateReport = {
  schemaVersion: 1;
  institutionId: string;
  institutionName: string;
  institutionType: string;
  signupStatus: string;
  connectedAccountCount: number;
  confirmedTestCount: number;
  reviewRequiredCount: number;
  preserveCount: number;
  unresolvedCount: number;
  pointDataCount: number;
  questionAnswerDataCount: number;
  quoteReportDataCount: number;
  authUserCount: number;
  storageObjectCount: number;
  mixedData: boolean;
  cleanupReadiness: LegacyCleanupReadiness;
  preservedMasterFields: string[];
  resetFields: PurgeResetFieldPreview[];
  candidates: LegacyReviewCandidate[];
  warnings: string[];
};

export type LegacyReviewManifest = {
  schemaVersion: 1;
  reviewManifestId: string;
  institutionId: string;
  institutionName: string;
  generatedAt: string;
  generatedBy: string;
  environment: string;
  projectId: string;
  reviewVersion: number;
  checksum: string;
  status: "REVIEW_REQUIRED" | "READY" | "BLOCKED";
  candidateCount: number;
  reviewedCount: number;
  report: Omit<LegacyInstitutionCandidateReport, "candidates">;
};

export interface LegacyReviewDataSource {
  loadSnapshot(institutionId: string): Promise<ScanSnapshot>;
  loadReviews(institutionId: string): Promise<LegacyReviewRecord[]>;
}

export interface LegacyReviewStore {
  saveManifest(
    manifest: LegacyReviewManifest,
    candidates: LegacyReviewCandidate[],
  ): Promise<void>;
  getManifest(reviewManifestId: string): Promise<LegacyReviewManifest | null>;
  getCandidates(reviewManifestId: string): Promise<LegacyReviewCandidate[]>;
  saveReview(
    review: LegacyReviewRecord,
    nextManifest: LegacyReviewManifest,
  ): Promise<void>;
  loadReviews(institutionId: string): Promise<LegacyReviewRecord[]>;
}

export type LegacyTagMigrationItem = {
  reviewId: string;
  documentPath: string;
  institutionId: string;
  reviewedBy: string;
  reviewedAt: string;
  reviewedChangeToken?: string;
};

export type LegacyTagMigrationPlanItem = {
  reviewId: string;
  documentPath: string;
  action: "UPDATE" | "NOOP" | "BLOCKED";
  before: {
    dataClassification?: unknown;
    testData?: unknown;
    legacyReviewId?: unknown;
    reviewedAt?: unknown;
    reviewedBy?: unknown;
  };
  after: {
    dataClassification: "LEGACY_TEST";
    testData: true;
    legacyReviewId: string;
    reviewedAt: string;
    reviewedBy: string;
  };
  blockedReason?: string;
};

export type LegacyTagMigrationPlan = {
  mode: "DRY_RUN" | "APPLY";
  reviewManifestId: string;
  institutionId: string;
  projectId: string;
  environment: string;
  totalCount: number;
  updateCount: number;
  noopCount: number;
  blockedCount: number;
  items: LegacyTagMigrationPlanItem[];
};

export type LegacyTagDocumentSnapshot = {
  documentPath: string;
  exists: boolean;
  changeToken?: string;
  data: Record<string, unknown>;
};

export interface LegacyTagMigrationRepository {
  getReviewManifest(
    reviewManifestId: string,
  ): Promise<LegacyReviewManifest | null>;
  loadApprovedDocumentReviews(
    reviewManifestId: string,
  ): Promise<LegacyReviewRecord[]>;
  loadDocuments(
    documentPaths: string[],
  ): Promise<LegacyTagDocumentSnapshot[]>;
  apply(plan: LegacyTagMigrationPlan): Promise<void>;
}
