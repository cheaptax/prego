import { createHash } from "node:crypto";
import {
  getTestCooperativeDefinition,
} from "@/lib/cooperatives/demo-cooperative";
import type {
  PurgeAuthUserCandidate,
  PurgeBlockedReason,
  PurgeClassificationMethod,
  PurgeManifest,
  PurgeManifestFreshness,
  PurgeManifestItem,
  PurgeResetFieldPreview,
  PurgeRiskLevel,
  PurgeScanRequest,
  PurgeStorageObjectCandidate,
  ScanDocument,
  ScanSnapshot,
  TestDataClassification,
} from "@/lib/test-data/purge-types";

const MANIFEST_TTL_MS = 15 * 60 * 1_000;
const MAX_TARGET_COUNT = 2_000;
const TEST_EMAIL_PATTERN =
  /(?:^|[.@+_-])(mvp|integrated|test|demo|dummy|fixture|seed|e2e)(?:[.@+_-]|$)/i;
const ADMIN_ACTOR_PATTERN = /^(?:seed|test|demo|dev)(?::|[-_])/i;

const RESET_EXPECTATIONS: Record<string, unknown> = {
  isRegistered: false,
  signupStatus: "AVAILABLE",
  claimedBy: null,
  ownerUid: null,
  customerId: null,
  tenantId: null,
  membershipId: null,
  registeredAt: null,
  activatedAt: null,
  registrationEmail: null,
};

const REAL_MASTER_FIELDS = [
  "cooperative_id",
  "cooperative_name",
  "cooperative_type",
  "sido",
  "sigungu",
  "address",
  "status",
  "source",
  "updated_at",
];

const DEMO_MASTER_FIELDS = [
  "schemaVersion",
  "cooperativeId",
  "cooperativeName",
  "internalCode",
  "cooperativeType",
  "sido",
  "sigungu",
  "address",
  "status",
  "source",
  "isDemoInstitution",
  "dataClassification",
  "resettable",
  "seedVersion",
  "createdAt",
  "createdBy",
];

type ClassificationResult = {
  classification: TestDataClassification;
  method: PurgeClassificationMethod;
  warningCodes: string[];
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function containsLegacyTestPattern(data: Record<string, unknown>) {
  return [
    data.email,
    data.userEmail,
    data.customerEmail,
    data.createdByEmail,
    data.actorEmail,
  ].some((value) => TEST_EMAIL_PATTERN.test(stringValue(value)));
}

function hasAdminOrDeveloperActor(data: Record<string, unknown>) {
  return (
    data.role === "admin" ||
    [data.createdBy, data.updatedBy, data.seededBy, data.actorUid].some(
      (value) => ADMIN_ACTOR_PATTERN.test(stringValue(value)),
    )
  );
}

export function classifyScanDocument(
  document: ScanDocument,
  snapshot: Pick<
    ScanSnapshot,
    | "institution"
    | "approvedTestScenarioIds"
    | "seedManifestDocumentPaths"
    | "approvedLegacyDocumentPaths"
    | "legacyReviewDecisionsByPath"
  >,
): ClassificationResult {
  const data = document.data;
  if (document.crossInstitutionIds.length > 0) {
    return {
      classification: "BLOCKED",
      method: "SHARED_OR_AMBIGUOUS_REFERENCE",
      warningCodes: ["cross_institution_reference"],
    };
  }
  if (document.brokenReference) {
    return {
      classification: "BLOCKED",
      method: "SHARED_OR_AMBIGUOUS_REFERENCE",
      warningCodes: ["broken_reference"],
    };
  }
  if (
    data.dataClassification === "PRODUCTION" &&
    (data.testData === true ||
      Boolean(data.testScenarioId) ||
      snapshot.seedManifestDocumentPaths.includes(document.path) ||
      snapshot.approvedLegacyDocumentPaths.includes(document.path))
  ) {
    return {
      classification: "BLOCKED",
      method: "SHARED_OR_AMBIGUOUS_REFERENCE",
      warningCodes: ["production_test_marker_conflict"],
    };
  }
  if (data.dataClassification === "PRODUCTION") {
    return {
      classification: "PRESERVE",
      method: "NO_TEST_EVIDENCE",
      warningCodes: ["explicit_production_marker"],
    };
  }
  const legacyReview = snapshot.legacyReviewDecisionsByPath?.[document.path];
  if (
    legacyReview?.reviewedChangeToken &&
    legacyReview.reviewedChangeToken !== document.changeToken
  ) {
    return {
      classification: "BLOCKED",
      method: "SHARED_OR_AMBIGUOUS_REFERENCE",
      warningCodes: ["stale_legacy_review"],
    };
  }
  if (legacyReview?.decision === "CONFIRMED_TEST") {
    return {
      classification: "CONFIRMED_TEST",
      method: "LEGACY_APPROVAL",
      warningCodes: [],
    };
  }
  if (legacyReview?.decision === "PRESERVE") {
    return {
      classification: "PRESERVE",
      method: "LEGACY_REVIEW_PRESERVE",
      warningCodes: ["preserved_by_legacy_review"],
    };
  }
  if (legacyReview?.decision === "UNRESOLVED") {
    return {
      classification: "REVIEW_REQUIRED",
      method: "LEGACY_REVIEW_UNRESOLVED",
      warningCodes: ["legacy_review_unresolved"],
    };
  }
  if (data.testData === true) {
    return {
      classification: "CONFIRMED_TEST",
      method: "EXPLICIT_TEST_FLAG",
      warningCodes: [],
    };
  }
  if (
    data.dataClassification === "DEMO" ||
    data.dataClassification === "TEST" ||
    data.dataClassification === "LEGACY_TEST"
  ) {
    return {
      classification: "CONFIRMED_TEST",
      method: "EXPLICIT_DATA_CLASSIFICATION",
      warningCodes: [],
    };
  }
  const scenarioId = stringValue(data.testScenarioId) ||
    stringValue(
      data.testMetadata &&
        typeof data.testMetadata === "object" &&
        (data.testMetadata as Record<string, unknown>).scenarioId,
    );
  if (
    scenarioId &&
    (snapshot.approvedTestScenarioIds.includes(scenarioId) ||
      getTestCooperativeDefinition(snapshot.institution.id)?.testScenarioId ===
        scenarioId)
  ) {
    return {
      classification: "CONFIRMED_TEST",
      method: "APPROVED_TEST_SCENARIO",
      warningCodes: [],
    };
  }
  if (snapshot.seedManifestDocumentPaths.includes(document.path)) {
    return {
      classification: "CONFIRMED_TEST",
      method: "SEED_MANIFEST_ID",
      warningCodes: [],
    };
  }
  if (snapshot.approvedLegacyDocumentPaths.includes(document.path)) {
    return {
      classification: "CONFIRMED_TEST",
      method: "LEGACY_APPROVAL",
      warningCodes: [],
    };
  }
  if (
    snapshot.institution.isDemoInstitution &&
    document.relationships.length > 0
  ) {
    return {
      classification: "CONFIRMED_TEST",
      method: "DEMO_INSTITUTION_LINEAGE",
      warningCodes: [],
    };
  }
  if (containsLegacyTestPattern(data)) {
    return {
      classification: "REVIEW_REQUIRED",
      method: "LEGACY_PATTERN_ONLY",
      warningCodes: ["pattern_is_not_delete_evidence"],
    };
  }
  if (hasAdminOrDeveloperActor(data)) {
    return {
      classification: "REVIEW_REQUIRED",
      method: "ADMIN_OR_DEVELOPER_ACTOR",
      warningCodes: ["actor_is_not_delete_evidence"],
    };
  }
  return {
    classification: "PRESERVE",
    method: "NO_TEST_EVIDENCE",
    warningCodes: ["no_confirmed_test_marker"],
  };
}

function riskFor(
  classification: TestDataClassification,
  collection: string,
): PurgeRiskLevel {
  if (classification === "BLOCKED") return "CRITICAL";
  if (classification === "PRESERVE") return "HIGH";
  if (classification === "REVIEW_REQUIRED") return "HIGH";
  if (
    /quotes|report|auditEvaluation|pointLedger|point_transactions/i.test(
      collection,
    )
  ) {
    return "MEDIUM";
  }
  return "LOW";
}

function toManifestItem(
  document: ScanDocument,
  result: ClassificationResult,
): PurgeManifestItem {
  return {
    targetType: "FIRESTORE_DOCUMENT",
    collection: document.collection,
    resourceId: document.id,
    resourcePath: document.path,
    classification: result.classification,
    classificationMethod: result.method,
    riskLevel: riskFor(result.classification, document.collection),
    relationship: [...document.relationships].sort(),
    rootEntityId: stringValue(document.data.testMetadata &&
      typeof document.data.testMetadata === "object" &&
      (document.data.testMetadata as Record<string, unknown>).rootEntityId) ||
      undefined,
    changeToken: document.changeToken,
    warningCodes: result.warningCodes,
  };
}

function groupByCollection(items: PurgeManifestItem[]) {
  const grouped: Record<string, PurgeManifestItem[]> = {};
  for (const item of items) {
    (grouped[item.collection] ??= []).push(item);
  }
  for (const values of Object.values(grouped)) {
    values.sort((left, right) =>
      left.resourcePath.localeCompare(right.resourcePath),
    );
  }
  return Object.fromEntries(
    Object.entries(grouped).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

function redactedResetValue(field: string, value: unknown) {
  return /email/i.test(field) && value ? "[REDACTED]" : value;
}

function resetPreview(snapshot: ScanSnapshot): PurgeResetFieldPreview[] {
  return Object.entries(RESET_EXPECTATIONS).flatMap(
    ([field, expectedValue]) =>
      Object.hasOwn(snapshot.institution.masterData, field)
        ? [{
            field,
            currentValue: redactedResetValue(
              field,
              snapshot.institution.masterData[field],
            ),
            expectedValue,
          }]
        : [],
  );
}

function masterPreserveItem(snapshot: ScanSnapshot): PurgeManifestItem {
  return {
    targetType: "FIRESTORE_DOCUMENT",
    collection:
      snapshot.institution.masterSource === "DEMO_FIRESTORE"
        ? "demoCooperativeMaster"
        : "static:nonghyupMaster",
    resourceId: snapshot.institution.id,
    resourcePath: snapshot.institution.masterPath,
    classification: "PRESERVE",
    classificationMethod: "MASTER_ALWAYS_PRESERVED",
    riskLevel: "CRITICAL",
    relationship: ["institution-master"],
    changeToken: snapshot.institution.masterChangeToken,
    warningCodes: ["master_delete_forbidden"],
  };
}

function extractStorageCandidates(
  documents: ScanDocument[],
  classificationByPath: Map<string, ClassificationResult>,
  metadataByPath: ScanSnapshot["storageObjectMetadata"],
): PurgeStorageObjectCandidate[] {
  const candidates = new Map<string, PurgeStorageObjectCandidate>();
  const add = (path: unknown, document: ScanDocument) => {
    if (typeof path !== "string" || !path.trim()) return;
    const result = classificationByPath.get(document.path);
    if (!result) return;
    const metadata = metadataByPath[path];
    const existing = candidates.get(path);
    const referenceDocumentPaths = Array.from(
      new Set([
        ...(existing?.referenceDocumentPaths ?? []),
        document.path,
      ]),
    ).sort();
    const sourceInstitutionId =
      stringValue(document.data.sourceInstitutionId) ||
      stringValue(document.data.cooperativeId) ||
      stringValue(document.data.nh_org_id) ||
      metadata?.customMetadata?.sourceInstitutionId ||
      existing?.sourceInstitutionId;
    const ownerUid =
      stringValue(document.data.uid) ||
      stringValue(document.data.userId) ||
      stringValue(document.data.user_id) ||
      stringValue(document.data.customerUid) ||
      metadata?.customMetadata?.ownerUid ||
      existing?.ownerUid;
    candidates.set(path, {
      bucket: metadata?.bucket,
      path,
      generation: metadata?.generation,
      exists: metadata?.exists,
      size: metadata?.size,
      contentType: metadata?.contentType,
      sourceDocumentPath: document.path,
      referenceDocumentPaths,
      sourceInstitutionId: sourceInstitutionId || undefined,
      ownerUid: ownerUid || undefined,
      customMetadata: metadata?.customMetadata,
      sharedReferenceCount: referenceDocumentPaths.length,
      classification: result.classification,
      classificationMethod: result.method,
    });
  };
  for (const document of documents) {
    const data = document.data;
    add(data.businessCardPath, document);
    add(data.pdfPath, document);
    add(data.storagePath, document);
    add(data.quarantineStoragePath, document);
    add(data.reportStoragePath, document);
    add(data.viewModelStoragePath, document);
    if (Array.isArray(data.attachments)) {
      for (const attachment of data.attachments) {
        if (attachment && typeof attachment === "object") {
          add((attachment as Record<string, unknown>).path, document);
        }
      }
    }
  }
  return Array.from(candidates.values()).sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function extractAuthCandidates(
  documents: ScanDocument[],
  classificationByPath: Map<string, ClassificationResult>,
  metadataByUid: ScanSnapshot["authUserMetadata"],
): PurgeAuthUserCandidate[] {
  const profiles = new Map(
    documents
      .filter((document) => document.collection === "users")
      .map((document) => [document.id, document]),
  );
  const registries = documents.filter(
    (document) => document.collection === "testAuthSubjects",
  );
  const registryByUid = new Map(
    registries.map((document) => [
      stringValue(document.data.authUid) || document.id,
      document,
    ]),
  );
  const candidateUids = new Set([
    ...profiles.keys(),
    ...registryByUid.keys(),
  ]);
  const candidates = new Map<string, PurgeAuthUserCandidate>();
  const linkedInstitutionsByUid = new Map<string, Set<string>>();
  for (const document of documents) {
    if (document.collection !== "organizations" ||
        !Array.isArray(document.data.users)) {
      continue;
    }
    const institutionId =
      stringValue(document.data.cooperativeId) ||
      stringValue(document.data.nh_org_id) ||
      document.id;
    for (const uid of document.data.users) {
      if (typeof uid !== "string") continue;
      const values = linkedInstitutionsByUid.get(uid) ?? new Set<string>();
      values.add(institutionId);
      linkedInstitutionsByUid.set(uid, values);
    }
  }
  for (const uid of candidateUids) {
    const registry = registryByUid.get(uid);
    const primaryUserUid =
      stringValue(registry?.data.primaryUserUid) || uid;
    const profile = profiles.get(primaryUserUid) ?? profiles.get(uid);
    const evidenceDocument = registry ?? profile;
    if (!evidenceDocument) continue;
    const result = classificationByPath.get(evidenceDocument.path);
    if (!result) continue;
    const profileResult = profile
      ? classificationByPath.get(profile.path)
      : undefined;
    const providerIds = Array.isArray(registry?.data.providerIds)
      ? registry.data.providerIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    const metadata = metadataByUid[uid];
    const linkedInstitutionIds = new Set(
      linkedInstitutionsByUid.get(primaryUserUid) ?? [],
    );
    for (const field of [
      profile?.data.cooperativeId,
      profile?.data.nh_org_id,
      registry?.data.sourceInstitutionId,
    ]) {
      if (typeof field === "string" && field) linkedInstitutionIds.add(field);
    }
    const sourceInstitutionId =
      stringValue(registry?.data.sourceInstitutionId) ||
      stringValue(profile?.data.sourceInstitutionId) ||
      stringValue(profile?.data.cooperativeId) ||
      stringValue(profile?.data.nh_org_id);
    const profileRole =
      stringValue(profile?.data.adminRole) ||
      stringValue(profile?.data.role) ||
      (profile?.data.partnerId ? "partner" : "");
    candidates.set(uid, {
      uid,
      providerIds: Array.from(
        new Set([...providerIds, ...(metadata?.providerIds ?? [])]),
      ).sort(),
      primaryUserUid,
      exists: metadata?.exists,
      disabled: metadata?.disabled,
      sourceInstitutionId: sourceInstitutionId || undefined,
      profileDocumentPath: profile?.path,
      registryDocumentPath: registry?.path,
      profileClassification: profileResult?.classification,
      profileRole: profileRole || undefined,
      linkedInstitutionIds: Array.from(linkedInstitutionIds).sort(),
      customClaimKeys: metadata?.customClaimKeys ?? [],
      reviewStatus:
        result.classification === "CONFIRMED_TEST" &&
          (!profileResult ||
            profileResult.classification === "CONFIRMED_TEST")
          ? "APPROVED"
          : "REVIEW_REQUIRED",
      classification: result.classification,
      classificationMethod: result.method,
      changeToken: metadata?.changeToken ?? evidenceDocument.changeToken,
    });
  }
  return Array.from(candidates.values()).sort((left, right) =>
    left.uid.localeCompare(right.uid),
  );
}

function documentUid(document: ScanDocument) {
  return (
    stringValue(document.data.uid) ||
    stringValue(document.data.user_id) ||
    stringValue(document.data.userId) ||
    stringValue(document.data.customerUid)
  );
}

function mixedDataReasons(
  snapshot: ScanSnapshot,
  items: PurgeManifestItem[],
): PurgeBlockedReason[] {
  const reasons = new Set<PurgeBlockedReason>();
  if (snapshot.warnings.some((warning) => warning.startsWith("scan_incomplete:"))) {
    reasons.add("BROKEN_REFERENCE");
  }
  if (
    snapshot.warnings.some((warning) =>
      warning.startsWith("scan_limit_exceeded:")
    )
  ) {
    reasons.add("MAX_TARGET_COUNT_EXCEEDED");
  }
  const classificationByPath = new Map(
    items.map((item) => [item.resourcePath, item.classification]),
  );
  const userClassifications = new Map(
    snapshot.documents
      .filter((document) => document.collection === "users")
      .map((document) => [
        document.id,
        classificationByPath.get(document.path) ?? "PRESERVE",
      ]),
  );
  const organization = snapshot.documents.find(
    (document) =>
      document.collection === "organizations" &&
      document.id === snapshot.institution.id,
  );
  if (organization && Array.isArray(organization.data.users)) {
    const memberClassifications = organization.data.users
      .filter((uid): uid is string => typeof uid === "string")
      .map((uid) => userClassifications.get(uid) ?? "PRESERVE");
    if (
      memberClassifications.includes("CONFIRMED_TEST") &&
      memberClassifications.some(
        (classification) => classification !== "CONFIRMED_TEST",
      )
    ) {
      reasons.add("MIXED_ORGANIZATION_USERS");
    }
  }

  const activityByUid = new Map<string, Set<TestDataClassification>>();
  for (const document of snapshot.documents) {
    if (document.collection === "users") continue;
    const uid = documentUid(document);
    if (!uid) continue;
    const classifications = activityByUid.get(uid) ?? new Set();
    classifications.add(
      classificationByPath.get(document.path) ?? "PRESERVE",
    );
    activityByUid.set(uid, classifications);
  }
  if (
    Array.from(activityByUid.values()).some(
      (classifications) =>
        classifications.has("CONFIRMED_TEST") &&
        Array.from(classifications).some(
          (classification) => classification !== "CONFIRMED_TEST",
        ),
    )
  ) {
    reasons.add("MIXED_USER_ACTIVITY");
  }

  const confirmedUsers = new Set(
    Array.from(userClassifications)
      .filter(([, classification]) => classification === "CONFIRMED_TEST")
      .map(([uid]) => uid),
  );
  if (confirmedUsers.size > 0) {
    const ambiguousPointRows = snapshot.documents.some((document) => {
      if (
        document.collection !== "pointLedger" &&
        document.collection !== "point_transactions"
      ) {
        return false;
      }
      return classificationByPath.get(document.path) !== "CONFIRMED_TEST";
    });
    if (ambiguousPointRows) reasons.add("AMBIGUOUS_POINT_BALANCE");
  }

  if (snapshot.documents.some((document) => document.brokenReference)) {
    reasons.add("BROKEN_REFERENCE");
  }
  if (
    snapshot.documents.some(
      (document) => document.crossInstitutionIds.length > 0,
    )
  ) {
    reasons.add("CROSS_INSTITUTION_REFERENCE");
  }
  const hasConfirmed = items.some(
    (item) => item.classification === "CONFIRMED_TEST",
  );
  const uncertainContractOrReport = items.some(
    (item) =>
      item.classification !== "CONFIRMED_TEST" &&
      /quotes|report|auditEvaluation/i.test(item.collection),
  );
  if (hasConfirmed && uncertainContractOrReport) {
    reasons.add("CONTRACT_OR_REPORT_UNCLEAR");
  }
  return Array.from(reasons).sort();
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function sha256(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

export function computeScanChecksum(
  snapshot: ScanSnapshot,
  items: PurgeManifestItem[],
  authUsers: PurgeAuthUserCandidate[],
  storageObjects: PurgeStorageObjectCandidate[],
  resetFields: PurgeResetFieldPreview[],
) {
  return sha256({
    institution: {
      id: snapshot.institution.id,
      masterChangeToken: snapshot.institution.masterChangeToken,
    },
    items: items.map((item) => ({
      path: item.resourcePath,
      classification: item.classification,
      changeToken: item.changeToken,
    })),
    authUsers,
    storageObjects,
    resetFields,
  });
}

export function buildPurgeManifest(
  request: PurgeScanRequest,
  snapshot: ScanSnapshot,
): PurgeManifest {
  const generatedAt = request.now ?? new Date().toISOString();
  const expiresAt = new Date(
    Date.parse(generatedAt) + MANIFEST_TTL_MS,
  ).toISOString();
  const classificationByPath = new Map<string, ClassificationResult>();
  const items = snapshot.documents
    .map((document) => {
      const result = classifyScanDocument(document, snapshot);
      classificationByPath.set(document.path, result);
      return toManifestItem(document, result);
    })
    .sort((left, right) => left.resourcePath.localeCompare(right.resourcePath));
  const authUsers = extractAuthCandidates(
    snapshot.documents,
    classificationByPath,
    snapshot.authUserMetadata,
  );
  const storageObjects = extractStorageCandidates(
    snapshot.documents,
    classificationByPath,
    snapshot.storageObjectMetadata,
  );
  const resetFields = resetPreview(snapshot);
  const preservedFields = (
    snapshot.institution.isDemoInstitution
      ? DEMO_MASTER_FIELDS
      : REAL_MASTER_FIELDS
  ).filter((field) => Object.hasOwn(snapshot.institution.masterData, field));
  const blockedReasons = new Set(mixedDataReasons(snapshot, items));
  const forbiddenRoles = new Set([
    "admin",
    "operator",
    "partner",
    "super_admin",
    "operations_manager",
    "content_manager",
    "partner_manager",
  ]);
  for (const candidate of authUsers) {
    if (candidate.classification !== "CONFIRMED_TEST") continue;
    if (
      candidate.reviewStatus !== "APPROVED" ||
      (candidate.profileRole && forbiddenRoles.has(candidate.profileRole)) ||
      (candidate.customClaimKeys ?? []).some((claim) =>
        /admin|operator|partner/i.test(claim)
      ) ||
      !candidate.sourceInstitutionId
    ) {
      blockedReasons.add("AUTH_IDENTITY_CONFLICT");
    }
    if (
      (candidate.sourceInstitutionId &&
        candidate.sourceInstitutionId !== snapshot.institution.id) ||
      (candidate.linkedInstitutionIds ?? []).some(
        (institutionId) => institutionId !== snapshot.institution.id,
      )
    ) {
      blockedReasons.add("MULTI_INSTITUTION_AUTH_USER");
    }
  }
  for (const candidate of storageObjects) {
    if (candidate.classification !== "CONFIRMED_TEST") continue;
    if ((candidate.sharedReferenceCount ?? 0) > 1) {
      blockedReasons.add("SHARED_STORAGE_OBJECT");
    }
    const metadataInstitutionId =
      candidate.customMetadata?.sourceInstitutionId;
    if (
      (candidate.sourceInstitutionId &&
        candidate.sourceInstitutionId !== snapshot.institution.id) ||
      (metadataInstitutionId &&
        metadataInstitutionId !== snapshot.institution.id)
    ) {
      blockedReasons.add("STORAGE_METADATA_MISMATCH");
    }
  }
  const targetItems = items.filter(
    (item) => item.classification === "CONFIRMED_TEST",
  );
  const reviewItems = items.filter(
    (item) => item.classification === "REVIEW_REQUIRED",
  );
  if (reviewItems.length > 0) {
    blockedReasons.add("LEGACY_REVIEW_INCOMPLETE");
  }
  const preservedItems = [
    masterPreserveItem(snapshot),
    ...items.filter((item) => item.classification === "PRESERVE"),
  ];
  const blockedItems = items.filter(
    (item) => item.classification === "BLOCKED",
  );
  const confirmedAuthCount = authUsers.filter(
    (candidate) => candidate.classification === "CONFIRMED_TEST",
  ).length;
  const confirmedStorageCount = storageObjects.filter(
    (candidate) => candidate.classification === "CONFIRMED_TEST",
  ).length;
  const totalTargetCount =
    targetItems.length + confirmedAuthCount + confirmedStorageCount;
  if (totalTargetCount > MAX_TARGET_COUNT) {
    blockedReasons.add("MAX_TARGET_COUNT_EXCEEDED");
  }
  for (const item of blockedItems) {
    if (item.warningCodes.includes("cross_institution_reference")) {
      blockedReasons.add("CROSS_INSTITUTION_REFERENCE");
    }
    if (item.warningCodes.includes("broken_reference")) {
      blockedReasons.add("BROKEN_REFERENCE");
    }
    if (item.warningCodes.includes("production_test_marker_conflict")) {
      blockedReasons.add("CLASSIFICATION_CONFLICT");
    }
    if (item.warningCodes.includes("stale_legacy_review")) {
      blockedReasons.add("STALE_MANIFEST");
    }
  }
  const checksum = computeScanChecksum(
    snapshot,
    items,
    authUsers,
    storageObjects,
    resetFields,
  );
  const timeBucket = Math.floor(
    Date.parse(generatedAt) / MANIFEST_TTL_MS,
  ).toString(36);
  const manifestId =
    `purge_${snapshot.institution.id}_${timeBucket}_${checksum.slice(0, 20)}`;
  const executionStatus =
    blockedReasons.size > 0
      ? "BLOCKED"
      : request.mode === "DRY_RUN"
        ? "DRY_RUN_READY"
        : "SCANNED";
  const methods = Array.from(
    new Set([
      "MASTER_ALWAYS_PRESERVED" as const,
      ...items.map((item) => item.classificationMethod),
    ]),
  ).sort();

  return {
    schemaVersion: 1,
    manifestId,
    institutionId: snapshot.institution.id,
    institutionName: snapshot.institution.name,
    institutionType: snapshot.institution.type,
    isDemoInstitution: snapshot.institution.isDemoInstitution,
    generatedAt,
    generatedBy: request.generatedBy,
    environment: request.environment,
    projectId: request.projectId,
    mode: request.mode,
    executionStatus,
    classificationMethod: methods,
    targetsByCollection: groupByCollection(targetItems),
    reviewByCollection: groupByCollection(reviewItems),
    preservedItems,
    blockedItems,
    authUsers,
    storageObjects,
    resetFields,
    preservedFields,
    totalTargetCount,
    warnings: Array.from(
      new Set([
        ...snapshot.warnings,
        ...items.flatMap((item) => item.warningCodes),
      ]),
    ).sort(),
    blockedReasons: Array.from(blockedReasons).sort(),
    checksum,
    expiresAt,
  };
}

export function verifyPurgeManifestFreshness(
  manifest: PurgeManifest,
  current: Pick<PurgeManifest, "checksum">,
  now = new Date().toISOString(),
): PurgeManifestFreshness {
  if (Date.parse(now) >= Date.parse(manifest.expiresAt)) {
    return {
      valid: false,
      status: "EXPIRED",
      expectedChecksum: manifest.checksum,
      actualChecksum: current.checksum,
    };
  }
  if (manifest.checksum !== current.checksum) {
    return {
      valid: false,
      status: "CHECKSUM_MISMATCH",
      expectedChecksum: manifest.checksum,
      actualChecksum: current.checksum,
    };
  }
  return {
    valid: true,
    status: "CURRENT",
    expectedChecksum: manifest.checksum,
    actualChecksum: current.checksum,
  };
}
