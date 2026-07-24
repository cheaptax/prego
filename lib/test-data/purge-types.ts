export type TestDataClassification =
  | "CONFIRMED_TEST"
  | "REVIEW_REQUIRED"
  | "PRESERVE"
  | "BLOCKED";

export type PurgeScanMode = "SCAN" | "DRY_RUN";

export type PurgeScanRequest = {
  institutionId: string;
  mode: PurgeScanMode;
  generatedBy: string;
  environment: string;
  projectId: string;
  now?: string;
};

export type PurgeTargetType =
  | "FIRESTORE_DOCUMENT"
  | "AUTH_USER"
  | "STORAGE_OBJECT";

export type PurgeRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type PurgeBlockedReason =
  | "MIXED_ORGANIZATION_USERS"
  | "MIXED_USER_ACTIVITY"
  | "AMBIGUOUS_POINT_BALANCE"
  | "MULTI_INSTITUTION_AUTH_USER"
  | "AUTH_IDENTITY_CONFLICT"
  | "CROSS_INSTITUTION_REFERENCE"
  | "SHARED_STORAGE_OBJECT"
  | "STORAGE_METADATA_MISMATCH"
  | "CLASSIFICATION_CONFLICT"
  | "BROKEN_REFERENCE"
  | "CONTRACT_OR_REPORT_UNCLEAR"
  | "MASTER_DELETE_FORBIDDEN"
  | "MAX_TARGET_COUNT_EXCEEDED"
  | "LEGACY_REVIEW_INCOMPLETE"
  | "UNKNOWN_INSTITUTION"
  | "STALE_MANIFEST";

export type PurgeExecutionStatus =
  | "SCANNED"
  | "DRY_RUN_READY"
  | "BLOCKED"
  | "EXPIRED"
  | "STALE"
  | "APPLY_NOT_IMPLEMENTED";

export type PurgeClassificationMethod =
  | "EXPLICIT_TEST_FLAG"
  | "EXPLICIT_DATA_CLASSIFICATION"
  | "APPROVED_TEST_SCENARIO"
  | "SEED_MANIFEST_ID"
  | "LEGACY_APPROVAL"
  | "LEGACY_REVIEW_PRESERVE"
  | "LEGACY_REVIEW_UNRESOLVED"
  | "DEMO_INSTITUTION_LINEAGE"
  | "LEGACY_PATTERN_ONLY"
  | "ADMIN_OR_DEVELOPER_ACTOR"
  | "NO_TEST_EVIDENCE"
  | "SHARED_OR_AMBIGUOUS_REFERENCE"
  | "MASTER_ALWAYS_PRESERVED";

export type PurgeManifestItem = {
  targetType: PurgeTargetType;
  collection: string;
  resourceId: string;
  resourcePath: string;
  classification: TestDataClassification;
  classificationMethod: PurgeClassificationMethod;
  riskLevel: PurgeRiskLevel;
  relationship: string[];
  rootEntityId?: string;
  changeToken?: string;
  warningCodes: string[];
};

export type PurgeAuthUserCandidate = {
  uid: string;
  providerIds: string[];
  primaryUserUid?: string;
  exists?: boolean;
  disabled?: boolean;
  sourceInstitutionId?: string;
  profileDocumentPath?: string;
  registryDocumentPath?: string;
  profileClassification?: TestDataClassification;
  profileRole?: string;
  linkedInstitutionIds?: string[];
  customClaimKeys?: string[];
  reviewStatus?: "APPROVED" | "REVIEW_REQUIRED";
  classification: TestDataClassification;
  classificationMethod: PurgeClassificationMethod;
  changeToken?: string;
};

export type PurgeStorageObjectCandidate = {
  bucket?: string;
  path: string;
  generation?: string;
  exists?: boolean;
  size?: number;
  contentType?: string;
  sourceDocumentPath: string;
  referenceDocumentPaths?: string[];
  sourceInstitutionId?: string;
  ownerUid?: string;
  customMetadata?: Record<string, string>;
  sharedReferenceCount?: number;
  classification: TestDataClassification;
  classificationMethod: PurgeClassificationMethod;
};

export type PurgeResetFieldPreview = {
  field: string;
  currentValue: unknown;
  expectedValue: unknown;
};

export type PurgeManifest = {
  schemaVersion: 1;
  manifestId: string;
  institutionId: string;
  institutionName: string;
  institutionType: string;
  isDemoInstitution: boolean;
  generatedAt: string;
  generatedBy: string;
  environment: string;
  projectId: string;
  mode: PurgeScanMode;
  executionStatus: PurgeExecutionStatus;
  classificationMethod: PurgeClassificationMethod[];
  targetsByCollection: Record<string, PurgeManifestItem[]>;
  reviewByCollection: Record<string, PurgeManifestItem[]>;
  preservedItems: PurgeManifestItem[];
  blockedItems: PurgeManifestItem[];
  authUsers: PurgeAuthUserCandidate[];
  storageObjects: PurgeStorageObjectCandidate[];
  resetFields: PurgeResetFieldPreview[];
  preservedFields: string[];
  totalTargetCount: number;
  warnings: string[];
  blockedReasons: PurgeBlockedReason[];
  checksum: string;
  expiresAt: string;
};

export type PurgeManifestFreshness = {
  valid: boolean;
  status: "CURRENT" | "EXPIRED" | "CHECKSUM_MISMATCH";
  expectedChecksum: string;
  actualChecksum: string;
};

export type ScanInstitution = {
  id: string;
  name: string;
  type: string;
  isDemoInstitution: boolean;
  masterSource:
    | "REAL_STATIC_MASTER"
    | "REAL_FIRESTORE_MASTER"
    | "DEMO_FIRESTORE";
  masterPath: string;
  masterData: Record<string, unknown>;
  masterChangeToken: string;
};

export type ScanDocument = {
  collection: string;
  id: string;
  path: string;
  data: Record<string, unknown>;
  changeToken: string;
  relationships: string[];
  crossInstitutionIds: string[];
  brokenReference?: boolean;
};

export type ScanSnapshot = {
  institution: ScanInstitution;
  documents: ScanDocument[];
  approvedTestScenarioIds: string[];
  seedManifestDocumentPaths: string[];
  approvedLegacyDocumentPaths: string[];
  legacyReviewDecisionsByPath?: Record<
    string,
    {
      decision: "CONFIRMED_TEST" | "PRESERVE" | "UNRESOLVED";
      reviewId: string;
      reviewedChangeToken?: string;
    }
  >;
  authUserMetadata: Record<
    string,
    {
      exists: boolean;
      providerIds: string[];
      disabled?: boolean;
      customClaimKeys?: string[];
      changeToken: string;
    }
  >;
  storageObjectMetadata: Record<
    string,
    {
      exists: boolean;
      bucket?: string;
      generation?: string;
      size?: number;
      contentType?: string;
      customMetadata?: Record<string, string>;
    }
  >;
  warnings: string[];
};

export interface PurgeScanDataSource {
  loadSnapshot(institutionId: string): Promise<ScanSnapshot>;
}
