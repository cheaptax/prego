import { createHash } from "node:crypto";
import { buildPurgeManifest } from "@/lib/test-data/purge-manifest";
import type {
  LegacyCleanupBlockReason,
  LegacyEvidenceCatalog,
  LegacyEvidenceCode,
  LegacyEvidenceStrength,
  LegacyInstitutionCandidateReport,
  LegacyReviewCandidate,
  LegacyReviewDecision,
  LegacyReviewManifest,
  LegacyReviewRecord,
} from "@/lib/test-data/legacy-review-types";
import {
  LEGACY_REVIEW_MAX_CANDIDATES,
  LEGACY_REVIEW_VERSION,
} from "@/lib/test-data/legacy-review-types";
import type {
  ScanDocument,
  ScanSnapshot,
  TestDataClassification,
} from "@/lib/test-data/purge-types";

const TEST_PATTERN =
  /(?:^|[.@+_\s-])(mvp|integrated|test|demo|dummy|fixture|seed|e2e)(?:[.@+_\s-]|$)/i;
const FIXTURE_QUESTION_PATTERN =
  /(?:mvp|통합|테스트\s*(?:문의|질문)|fixture|dummy|demo)/i;
const DEV_ACTOR_PATTERN = /^(?:seed|test|demo|dev)(?::|[-_])/i;
const POINT_COLLECTIONS = new Set(["pointLedger", "point_transactions"]);
const QUESTION_COLLECTIONS = new Set([
  "consultRequests",
  "answers",
  "answerViews",
  "answerRatings",
  "partnerAssignments",
  "partnerAnswerDrafts",
]);
const QUOTE_REPORT_PATTERN =
  /quote|auditEvaluation|report/i;

export const EMPTY_LEGACY_EVIDENCE_CATALOG: LegacyEvidenceCatalog = {
  documentPaths: {},
  authUids: {},
  storagePaths: {},
};

type CandidateDecision = {
  classification: TestDataClassification;
  suggestedDecision: LegacyReviewDecision;
  evidenceStrength: LegacyEvidenceStrength;
  sourceEvidence: LegacyEvidenceCode[];
  warningCodes: string[];
  review?: LegacyReviewRecord;
};

export function buildLegacyInstitutionReport(input: {
  snapshot: ScanSnapshot;
  reviews?: LegacyReviewRecord[];
  evidenceCatalog?: LegacyEvidenceCatalog;
  now?: string;
}): LegacyInstitutionCandidateReport {
  const reviews = input.reviews ?? [];
  const catalog = input.evidenceCatalog ?? EMPTY_LEGACY_EVIDENCE_CATALOG;
  const reviewByResource = new Map(
    reviews.map((review) => [review.resourceKey, review]),
  );
  const documentCandidates = input.snapshot.documents.map((document) =>
    documentCandidate(
      input.snapshot,
      document,
      catalog,
      reviewByResource.get(document.path),
    )
  );
  const documentByPath = new Map(
    documentCandidates.map((candidate) => [
      candidate.documentPath as string,
      candidate,
    ]),
  );
  const authCandidates = buildAuthCandidates(
    input.snapshot,
    documentByPath,
    catalog,
    reviewByResource,
  );
  const storageCandidates = buildStorageCandidates(
    input.snapshot,
    documentByPath,
    catalog,
    reviewByResource,
  );
  const candidates = [
    ...documentCandidates,
    ...authCandidates,
    ...storageCandidates,
  ].sort((left, right) => left.resourceKey.localeCompare(right.resourceKey));
  const purgePreview = buildPurgeManifest(
    {
      institutionId: input.snapshot.institution.id,
      mode: "SCAN",
      generatedBy: "legacy-review-report",
      environment: "review",
      projectId: "review",
      now: input.now ?? "2026-01-01T00:00:00.000Z",
    },
    input.snapshot,
  );
  const readiness = evaluateLegacyCleanupReadiness(
    input.snapshot,
    candidates,
    purgePreview.preservedFields,
    purgePreview.resetFields,
  );
  const effective = candidates.map(effectiveClassification);
  const connectedAccountCount = input.snapshot.documents.filter(
    (document) => document.collection === "users",
  ).length;
  return {
    schemaVersion: 1,
    institutionId: input.snapshot.institution.id,
    institutionName: input.snapshot.institution.name,
    institutionType: input.snapshot.institution.type,
    signupStatus:
      typeof input.snapshot.institution.masterData.signupStatus === "string"
        ? input.snapshot.institution.masterData.signupStatus
        : connectedAccountCount > 0
          ? "CONNECTED"
          : "AVAILABLE",
    connectedAccountCount,
    confirmedTestCount: effective.filter(
      (classification) => classification === "CONFIRMED_TEST",
    ).length,
    reviewRequiredCount: effective.filter(
      (classification) => classification === "REVIEW_REQUIRED",
    ).length,
    preserveCount: effective.filter(
      (classification) => classification === "PRESERVE",
    ).length,
    unresolvedCount: candidates.filter(
      (candidate) => candidate.decision === "UNRESOLVED",
    ).length,
    pointDataCount: documentCandidates.filter((candidate) =>
      candidate.collection && POINT_COLLECTIONS.has(candidate.collection)
    ).length,
    questionAnswerDataCount: documentCandidates.filter((candidate) =>
      candidate.collection && QUESTION_COLLECTIONS.has(candidate.collection)
    ).length,
    quoteReportDataCount: documentCandidates.filter((candidate) =>
      QUOTE_REPORT_PATTERN.test(candidate.collection ?? "")
    ).length,
    authUserCount: authCandidates.length,
    storageObjectCount: storageCandidates.length,
    mixedData: readiness.reasons.includes("MIXED_REAL_AND_TEST_DATA"),
    cleanupReadiness: readiness,
    preservedMasterFields: purgePreview.preservedFields,
    resetFields: purgePreview.resetFields,
    candidates,
    warnings: Array.from(
      new Set([
        ...input.snapshot.warnings,
        ...candidates.flatMap((candidate) => candidate.warningCodes),
      ]),
    ).sort(),
  };
}

export function buildLegacyReviewManifest(input: {
  report: LegacyInstitutionCandidateReport;
  generatedAt: string;
  generatedBy: string;
  environment: string;
  projectId: string;
}): LegacyReviewManifest {
  const { candidates, ...reportSummary } = input.report;
  const checksum = sha256({
    institutionId: input.report.institutionId,
    candidates: candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      resourceKey: candidate.resourceKey,
      changeToken: candidate.changeToken,
      generation: candidate.generation,
      initialClassification: candidate.initialClassification,
      decision: candidate.decision,
      sourceEvidence: candidate.sourceEvidence,
    })),
  });
  const reviewedCount = candidates.filter((candidate) =>
    Boolean(candidate.decision) ||
    candidate.initialClassification === "CONFIRMED_TEST" ||
    candidate.initialClassification === "PRESERVE"
  ).length;
  const status =
    input.report.cleanupReadiness.status === "READY"
      ? "READY"
      : input.report.reviewRequiredCount > 0 ||
          input.report.unresolvedCount > 0
        ? "REVIEW_REQUIRED"
        : "BLOCKED";
  return {
    schemaVersion: 1,
    reviewManifestId:
      `legacy_${input.report.institutionId}_${checksum.slice(0, 24)}`,
    institutionId: input.report.institutionId,
    institutionName: input.report.institutionName,
    generatedAt: input.generatedAt,
    generatedBy: input.generatedBy,
    environment: input.environment,
    projectId: input.projectId,
    reviewVersion: LEGACY_REVIEW_VERSION,
    checksum,
    status,
    candidateCount: candidates.length,
    reviewedCount,
    report: reportSummary,
  };
}

export function evaluateLegacyCleanupReadiness(
  snapshot: ScanSnapshot,
  candidates: LegacyReviewCandidate[],
  preservedMasterFields: string[],
  resetFields: LegacyInstitutionCandidateReport["resetFields"],
) {
  const reasons = new Set<LegacyCleanupBlockReason>();
  const byResource = new Map(
    candidates.map((candidate) => [candidate.resourceKey, candidate]),
  );
  const effective = candidates.map((candidate) => ({
    candidate,
    classification: effectiveClassification(candidate),
  }));
  if (
    effective.some(
      ({ classification }) => classification === "REVIEW_REQUIRED",
    )
  ) {
    reasons.add("REVIEW_REQUIRED_REMAINS");
  }
  if (
    candidates.some((candidate) => candidate.decision === "UNRESOLVED")
  ) {
    reasons.add("UNRESOLVED_REMAINS");
  }
  const preservedCustomerLinkedData = effective.some(
    ({ candidate, classification }) => {
      if (
        candidate.targetType !== "FIRESTORE_DOCUMENT" ||
        classification !== "PRESERVE"
      ) {
        return false;
      }
      if (candidate.collection === "users") return true;
      const document = snapshot.documents.find(
        (value) => value.path === candidate.documentPath,
      );
      if (!document) return false;
      const linkedUid = [
        document.data.uid,
        document.data.userId,
        document.data.user_id,
        document.data.customerUid,
      ].find((value): value is string => typeof value === "string");
      if (linkedUid) return true;
      return (
        Array.isArray(document.data.users) &&
        document.data.users.some((value) => typeof value === "string")
      );
    },
  );
  if (preservedCustomerLinkedData) {
    reasons.add("PRESERVED_CUSTOMER_ACCOUNT");
  }
  if (
    candidates.some((candidate) =>
      candidate.warningCodes.includes("cross_institution_reference")
    )
  ) {
    reasons.add("CROSS_INSTITUTION_REFERENCE");
  }
  if (
    candidates.some((candidate) =>
      candidate.warningCodes.includes("broken_reference")
    ) ||
    snapshot.warnings.some((warning) => warning.startsWith("scan_incomplete:"))
  ) {
    reasons.add("BROKEN_REFERENCE");
  }
  if (candidates.length > LEGACY_REVIEW_MAX_CANDIDATES) {
    reasons.add("MAX_CANDIDATE_COUNT_EXCEEDED");
  }
  const organization = snapshot.documents.find(
    (document) =>
      document.collection === "organizations" &&
      document.id === snapshot.institution.id,
  );
  if (organization && Array.isArray(organization.data.users)) {
    const classes = organization.data.users
      .filter((uid): uid is string => typeof uid === "string")
      .map((uid) =>
        effectiveClassification(byResource.get(`users/${uid}`))
      );
    if (
      classes.includes("CONFIRMED_TEST") &&
      classes.some((classification) => classification !== "CONFIRMED_TEST")
    ) {
      reasons.add("MIXED_REAL_AND_TEST_DATA");
    }
  }
  for (const { candidate, classification } of effective) {
    if (
      candidate.targetType === "FIRESTORE_DOCUMENT" &&
      candidate.collection === "users" &&
      classification === "CONFIRMED_TEST"
    ) {
      const authCandidate = candidates.find(
        (value) =>
          value.targetType === "AUTH_USER" &&
          value.authUid === candidate.resourceKey.split("/").at(-1),
      );
      if (
        authCandidate &&
        effectiveClassification(authCandidate) !== "CONFIRMED_TEST"
      ) {
        reasons.add("AUTH_TARGET_UNCONFIRMED");
      }
    }
    if (
      candidate.targetType === "STORAGE_OBJECT" &&
      classification !== "PRESERVE" &&
      classification !== "CONFIRMED_TEST"
    ) {
      reasons.add("STORAGE_TARGET_UNCONFIRMED");
    }
  }
  if (preservedMasterFields.length === 0) {
    reasons.add("MASTER_PRESERVATION_UNCONFIRMED");
  }
  if (snapshot.institution.isDemoInstitution && resetFields.length === 0) {
    reasons.add("RESET_PLAN_UNCONFIRMED");
  }
  return {
    status: reasons.size === 0 ? "READY" as const : "BLOCKED" as const,
    reasons: Array.from(reasons).sort(),
  };
}

function documentCandidate(
  snapshot: ScanSnapshot,
  document: ScanDocument,
  catalog: LegacyEvidenceCatalog,
  review?: LegacyReviewRecord,
): LegacyReviewCandidate {
  const decision = classifyDocument(snapshot, document, catalog, review);
  return candidate({
    institutionId: snapshot.institution.id,
    targetType: "FIRESTORE_DOCUMENT",
    resourceKey: document.path,
    collection: document.collection,
    documentPath: document.path,
    changeToken: document.changeToken,
    createdAt: instant(document.data.createdAt),
    ...decision,
  });
}

function classifyDocument(
  snapshot: ScanSnapshot,
  document: ScanDocument,
  catalog: LegacyEvidenceCatalog,
  review?: LegacyReviewRecord,
): CandidateDecision {
  if (document.crossInstitutionIds.length > 0) {
    return decision(
      "BLOCKED",
      "UNRESOLVED",
      "NONE",
      ["CROSS_INSTITUTION_REFERENCE"],
      ["cross_institution_reference"],
      review,
    );
  }
  if (document.brokenReference) {
    return decision(
      "BLOCKED",
      "UNRESOLVED",
      "NONE",
      ["BROKEN_REFERENCE"],
      ["broken_reference"],
      review,
    );
  }
  if (review) return reviewedDecision(review);
  if (
    document.data.testData === true ||
    ["DEMO", "TEST", "LEGACY_TEST"].includes(
      String(document.data.dataClassification ?? ""),
    )
  ) {
    return decision(
      "CONFIRMED_TEST",
      "CONFIRMED_TEST",
      "STRONG",
      ["EXPLICIT_TEST_MARKER"],
    );
  }
  if (snapshot.approvedLegacyDocumentPaths.includes(document.path)) {
    return decision(
      "CONFIRMED_TEST",
      "CONFIRMED_TEST",
      "STRONG",
      ["APPROVED_LEGACY_REVIEW"],
    );
  }
  const exactEvidence =
    catalog.documentPaths[document.path] ||
    (document.collection === "users"
      ? catalog.authUids[document.id]
      : undefined) ||
    (snapshot.seedManifestDocumentPaths.includes(document.path)
      ? "SEED_MANIFEST_ENTRY"
      : undefined);
  if (exactEvidence) {
    return decision(
      "REVIEW_REQUIRED",
      "CONFIRMED_TEST",
      "STRONG",
      [exactEvidence],
      ["strong_evidence_requires_admin_review"],
    );
  }
  const supporting = supportingEvidence(document, catalog);
  if (supporting.length > 0) {
    return decision(
      "REVIEW_REQUIRED",
      "UNRESOLVED",
      "SUPPORTING",
      supporting,
      ["supporting_evidence_is_not_delete_evidence"],
    );
  }
  return decision(
    "PRESERVE",
    "PRESERVE",
    "NONE",
    ["NO_TEST_EVIDENCE"],
    ["no_confirmed_test_evidence"],
  );
}

function buildAuthCandidates(
  snapshot: ScanSnapshot,
  documentByPath: Map<string, LegacyReviewCandidate>,
  catalog: LegacyEvidenceCatalog,
  reviewByResource: Map<string, LegacyReviewRecord>,
) {
  return snapshot.documents
    .filter((document) => document.collection === "users")
    .flatMap((document) => {
      const metadata = snapshot.authUserMetadata[document.id];
      if (!metadata?.exists) return [];
      const resourceKey = `auth:${document.id}`;
      const source = documentByPath.get(document.path);
      const review = reviewByResource.get(resourceKey);
      const exactEvidence = catalog.authUids[document.id];
      const resolved = review
        ? reviewedDecision(review)
        : exactEvidence
          ? decision(
              "REVIEW_REQUIRED",
              "CONFIRMED_TEST",
              "STRONG",
              [exactEvidence],
              ["strong_evidence_requires_admin_review"],
            )
          : inheritSourceDecision(source);
      return [
        candidate({
          institutionId: snapshot.institution.id,
          targetType: "AUTH_USER",
          resourceKey,
          authUid: document.id,
          sourceDocumentPath: document.path,
          changeToken: metadata.changeToken,
          ...resolved,
        }),
      ];
    });
}

function buildStorageCandidates(
  snapshot: ScanSnapshot,
  documentByPath: Map<string, LegacyReviewCandidate>,
  catalog: LegacyEvidenceCatalog,
  reviewByResource: Map<string, LegacyReviewRecord>,
) {
  const candidates = new Map<string, LegacyReviewCandidate>();
  for (const document of snapshot.documents) {
    const source = documentByPath.get(document.path);
    for (const path of documentStoragePaths(document)) {
      const metadata = snapshot.storageObjectMetadata[path];
      if (!metadata?.exists) continue;
      const resourceKey = `storage:${path}`;
      const review = reviewByResource.get(resourceKey);
      const exactEvidence = catalog.storagePaths[path];
      const resolved = review
        ? reviewedDecision(review)
        : exactEvidence
          ? decision(
              "REVIEW_REQUIRED",
              "CONFIRMED_TEST",
              "STRONG",
              [exactEvidence],
              ["strong_evidence_requires_admin_review"],
            )
          : inheritSourceDecision(source);
      candidates.set(
        resourceKey,
        candidate({
          institutionId: snapshot.institution.id,
          targetType: "STORAGE_OBJECT",
          resourceKey,
          storagePath: path,
          sourceDocumentPath: document.path,
          generation: metadata.generation,
          ...resolved,
        }),
      );
    }
  }
  return Array.from(candidates.values());
}

function supportingEvidence(
  document: ScanDocument,
  catalog: LegacyEvidenceCatalog,
): LegacyEvidenceCode[] {
  const evidence = new Set<LegacyEvidenceCode>();
  const data = document.data;
  for (const value of [
    data.email,
    data.userEmail,
    data.customerEmail,
    data.createdByEmail,
    data.actorEmail,
  ]) {
    if (TEST_PATTERN.test(stringValue(value))) {
      evidence.add("TEST_EMAIL_PATTERN");
    }
  }
  for (const value of [
    data.name,
    data.displayName,
    data.contactName,
    data.cooperativeName,
  ]) {
    if (TEST_PATTERN.test(stringValue(value))) {
      evidence.add("TEST_NAME_PATTERN");
    }
  }
  for (const value of [data.title, data.subject, data.questionTitle]) {
    if (FIXTURE_QUESTION_PATTERN.test(stringValue(value))) {
      evidence.add("FIXTURE_QUESTION_PATTERN");
    }
  }
  if (
    [data.createdBy, data.updatedBy, data.seededBy, data.actorUid].some(
      (value) => DEV_ACTOR_PATTERN.test(stringValue(value)),
    )
  ) {
    evidence.add("DEVELOPER_ACTOR_PATTERN");
  }
  if (
    ["localhost", "emulator", "local", "development"].includes(
      stringValue(data.environment).toLowerCase(),
    ) ||
    /localhost|127\.0\.0\.1|demo-/.test(stringValue(data.source))
  ) {
    evidence.add("LOCALHOST_OR_EMULATOR_METADATA");
  }
  const createdAt = instant(data.createdAt);
  if (
    createdAt &&
    (catalog.developmentWindows ?? []).some(
      (window) =>
        Date.parse(createdAt) >= Date.parse(window.start) &&
        Date.parse(createdAt) <= Date.parse(window.end),
    )
  ) {
    evidence.add("DEVELOPMENT_TIMESTAMP");
  }
  if (
    POINT_COLLECTIONS.has(document.collection) &&
    abnormalPointValue(data.points ?? data.amount)
  ) {
    evidence.add("ABNORMAL_POINT_AMOUNT");
  }
  return Array.from(evidence).sort();
}

function abnormalPointValue(value: unknown) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    ![10_000, 100_000, -10_000].includes(value) &&
    Math.abs(value) >= 1_000_000
  );
}

function reviewedDecision(review: LegacyReviewRecord): CandidateDecision {
  if (review.decision === "CONFIRMED_TEST") {
    return decision(
      "CONFIRMED_TEST",
      "CONFIRMED_TEST",
      "STRONG",
      review.sourceEvidence,
      [],
      review,
    );
  }
  if (review.decision === "PRESERVE") {
    return decision(
      "PRESERVE",
      "PRESERVE",
      review.sourceEvidence.length > 0 ? "SUPPORTING" : "NONE",
      review.sourceEvidence,
      ["preserved_by_admin_review"],
      review,
    );
  }
  return decision(
    "REVIEW_REQUIRED",
    "UNRESOLVED",
    review.sourceEvidence.length > 0 ? "SUPPORTING" : "NONE",
    review.sourceEvidence,
    ["unresolved_by_admin_review"],
    review,
  );
}

function inheritSourceDecision(
  source: LegacyReviewCandidate | undefined,
): CandidateDecision {
  if (!source) {
    return decision(
      "REVIEW_REQUIRED",
      "UNRESOLVED",
      "NONE",
      ["NO_TEST_EVIDENCE"],
      ["missing_source_document_review"],
    );
  }
  const classification = effectiveClassification(source);
  return decision(
    classification,
    source.suggestedDecision,
    source.evidenceStrength,
    source.sourceEvidence,
    [...source.warningCodes],
  );
}

function decision(
  classification: TestDataClassification,
  suggestedDecision: LegacyReviewDecision,
  evidenceStrength: LegacyEvidenceStrength,
  sourceEvidence: LegacyEvidenceCode[],
  warningCodes: string[] = [],
  review?: LegacyReviewRecord,
): CandidateDecision {
  return {
    classification,
    suggestedDecision,
    evidenceStrength,
    sourceEvidence: Array.from(new Set(sourceEvidence)).sort(),
    warningCodes,
    review,
  };
}

function candidate(
  input: Omit<
    LegacyReviewCandidate,
    "candidateId" | "initialClassification" | "decision" | "reviewId"
  > & {
    classification: TestDataClassification;
    review?: LegacyReviewRecord;
  },
): LegacyReviewCandidate {
  const { review, classification, ...candidateInput } = input;
  return {
    candidateId: sha256({
      institutionId: input.institutionId,
      targetType: input.targetType,
      resourceKey: input.resourceKey,
    }).slice(0, 32),
    ...candidateInput,
    initialClassification: classification,
    decision: review?.decision,
    reviewId: review?.reviewId,
  };
}

function effectiveClassification(
  candidate: LegacyReviewCandidate | undefined,
): TestDataClassification {
  if (!candidate) return "PRESERVE";
  if (candidate.decision === "CONFIRMED_TEST") return "CONFIRMED_TEST";
  if (candidate.decision === "PRESERVE") return "PRESERVE";
  if (candidate.decision === "UNRESOLVED") return "REVIEW_REQUIRED";
  return candidate.initialClassification;
}

function documentStoragePaths(document: ScanDocument) {
  const result = [
    document.data.businessCardPath,
    document.data.pdfPath,
    document.data.storagePath,
    document.data.quarantineStoragePath,
    document.data.reportStoragePath,
    document.data.viewModelStoragePath,
  ].filter((value): value is string =>
    typeof value === "string" && Boolean(value)
  );
  if (Array.isArray(document.data.attachments)) {
    for (const attachment of document.data.attachments) {
      if (
        attachment &&
        typeof attachment === "object" &&
        typeof (attachment as Record<string, unknown>).path === "string"
      ) {
        result.push(
          (attachment as Record<string, unknown>).path as string,
        );
      }
    }
  }
  return Array.from(new Set(result));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function instant(value: unknown) {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  return undefined;
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
