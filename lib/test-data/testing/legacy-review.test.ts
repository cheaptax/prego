import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLegacyInstitutionReport,
} from "@/lib/test-data/legacy-candidate-report";
import { createLegacyReviewHandlers } from "@/lib/test-data/legacy-review-api";
import {
  LegacyReviewError,
  LegacyReviewService,
} from "@/lib/test-data/legacy-review-service";
import type {
  LegacyReviewCandidate,
  LegacyReviewDataSource,
  LegacyReviewManifest,
  LegacyReviewRecord,
  LegacyReviewStore,
  LegacyTagDocumentSnapshot,
  LegacyTagMigrationPlan,
  LegacyTagMigrationRepository,
} from "@/lib/test-data/legacy-review-types";
import {
  LegacyTagMigrationService,
} from "@/lib/test-data/legacy-tag-migration";
import { buildPurgeManifest } from "@/lib/test-data/purge-manifest";
import type { ScanDocument, ScanSnapshot } from "@/lib/test-data/purge-types";

function document(
  collection: string,
  id: string,
  data: Record<string, unknown>,
  options: Partial<ScanDocument> = {},
): ScanDocument {
  return {
    collection,
    id,
    path: `${collection}/${id}`,
    data,
    changeToken: options.changeToken ?? `${collection}-${id}-v1`,
    relationships: options.relationships ?? ["institution:coop-001"],
    crossInstitutionIds: options.crossInstitutionIds ?? [],
    brokenReference: options.brokenReference,
  };
}

function snapshot(
  documents: ScanDocument[],
  seedManifestDocumentPaths: string[] = [],
): ScanSnapshot {
  return {
    institution: {
      id: "coop-001",
      name: "가상 검토 대상 농협",
      type: "지역농협",
      isDemoInstitution: false,
      masterSource: "REAL_STATIC_MASTER",
      masterPath: "static:nonghyupMaster/coop-001",
      masterData: {
        cooperative_id: "coop-001",
        cooperative_name: "가상 검토 대상 농협",
        cooperative_type: "지역농협",
        status: "active",
      },
      masterChangeToken: "master-v1",
    },
    documents,
    approvedTestScenarioIds: [],
    seedManifestDocumentPaths,
    approvedLegacyDocumentPaths: [],
    legacyReviewDecisionsByPath: {},
    authUserMetadata: Object.fromEntries(
      documents
        .filter((value) => value.collection === "users")
        .map((value) => [
          value.id,
          {
            exists: false,
            providerIds: [],
            changeToken: "AUTH_NOT_FOUND",
          },
        ]),
    ),
    storageObjectMetadata: {},
    warnings: [],
  };
}

test("고정 seed 문서 ID는 강한 근거지만 승인 전 REVIEW_REQUIRED다", () => {
  const report = buildLegacyInstitutionReport({
    snapshot: snapshot(
      [
        document("users", "seed-user", {
          uid: "seed-user",
          cooperativeId: "coop-001",
        }),
      ],
      ["users/seed-user"],
    ),
  });
  const candidate = report.candidates.find(
    (value) => value.resourceKey === "users/seed-user",
  );
  assert.equal(candidate?.initialClassification, "REVIEW_REQUIRED");
  assert.equal(candidate?.evidenceStrength, "STRONG");
  assert.deepEqual(candidate?.sourceEvidence, ["SEED_MANIFEST_ENTRY"]);
  assert.equal(report.cleanupReadiness.status, "BLOCKED");
});

test("이메일 패턴만 있는 후보는 REVIEW_REQUIRED다", () => {
  const report = buildLegacyInstitutionReport({
    snapshot: snapshot([
      document("users", "pattern-user", {
        uid: "pattern-user",
        cooperativeId: "coop-001",
        email: "mvp-a1-123@example.com",
      }),
    ]),
  });
  const candidate = report.candidates[0];
  assert.equal(candidate.initialClassification, "REVIEW_REQUIRED");
  assert.equal(candidate.evidenceStrength, "SUPPORTING");
  assert.equal(candidate.sourceEvidence.includes("TEST_EMAIL_PATTERN"), true);
});

test("테스트 근거가 없는 실제 데이터는 PRESERVE다", () => {
  const report = buildLegacyInstitutionReport({
    snapshot: snapshot([
      document("consultRequests", "customer-request", {
        cooperativeId: "coop-001",
        uid: "customer-user",
      }),
    ]),
  });
  assert.equal(report.candidates[0].initialClassification, "PRESERVE");
  assert.equal(report.preserveCount, 1);
});

test("관리자 승인 후 CONFIRMED_TEST가 되고 검토 완료 시 READY다", async () => {
  const state = createReviewState(
    snapshot(
      [
        document("users", "seed-user", {
          uid: "seed-user",
          cooperativeId: "coop-001",
        }),
      ],
      ["users/seed-user"],
    ),
  );
  const service = new LegacyReviewService({
    source: state.source,
    store: state.store,
    now: () => "2026-07-23T00:00:00.000Z",
  });
  const scanned = await service.scan({
    institutionId: "coop-001",
    generatedBy: "super-admin",
    environment: "test",
    projectId: "demo-step8",
  });
  const candidate = scanned.report.candidates[0];
  const reviewed = await service.review({
    reviewManifestId: scanned.manifest.reviewManifestId,
    candidateId: candidate.candidateId,
    decision: "CONFIRMED_TEST",
    reason: "고정 seed manifest ID와 코드 이력을 대조하여 확인함",
    sourceEvidence: ["SEED_MANIFEST_ENTRY"],
    reviewVersion: 1,
    reviewedBy: "super-admin",
    isSuperAdmin: true,
  });
  assert.equal(reviewed.review.decision, "CONFIRMED_TEST");
  assert.equal(reviewed.review.reviewedBy, "super-admin");
  assert.equal(reviewed.report.confirmedTestCount, 1);
  assert.equal(reviewed.report.reviewRequiredCount, 0);
  assert.equal(reviewed.report.cleanupReadiness.status, "READY");
  assert.equal(reviewed.manifest.status, "READY");
});

test("SUPER_ADMIN이 아니면 CONFIRMED_TEST 승인을 차단한다", async () => {
  const state = createReviewState(
    snapshot(
      [
        document("users", "seed-user", {
          uid: "seed-user",
          cooperativeId: "coop-001",
        }),
      ],
      ["users/seed-user"],
    ),
  );
  const service = new LegacyReviewService({
    source: state.source,
    store: state.store,
    now: () => "2026-07-23T00:00:00.000Z",
  });
  const scanned = await service.scan({
    institutionId: "coop-001",
    generatedBy: "reviewer",
    environment: "test",
    projectId: "demo-step8",
  });
  await assert.rejects(
    () =>
      service.review({
        reviewManifestId: scanned.manifest.reviewManifestId,
        candidateId: scanned.report.candidates[0].candidateId,
        decision: "CONFIRMED_TEST",
        reason: "권한 없는 사용자의 확정 승인 시도입니다",
        sourceEvidence: ["SEED_MANIFEST_ENTRY"],
        reviewVersion: 1,
        reviewedBy: "reviewer",
        isSuperAdmin: false,
      }),
    (error: unknown) =>
      error instanceof LegacyReviewError &&
      error.code === "super_admin_required",
  );
});

test("legacy tagging은 기본 dry-run이며 전후 필드만 표시한다", async () => {
  const fixture = migrationFixture();
  const plan = await new LegacyTagMigrationService(fixture.repository).run({
    reviewManifestId: fixture.manifest.reviewManifestId,
    institutionId: "coop-001",
    documentPaths: ["users/seed-user"],
    projectId: "demo-step8",
    environment: "test",
  });
  assert.equal(plan.mode, "DRY_RUN");
  assert.equal(plan.updateCount, 1);
  assert.equal(fixture.applied.length, 0);
  assert.deepEqual(plan.items[0].after, {
    dataClassification: "LEGACY_TEST",
    testData: true,
    legacyReviewId: "legacy-review-1",
    reviewedAt: "2026-07-23T00:00:00.000Z",
    reviewedBy: "super-admin",
  });
});

test("승인되지 않은 문서는 tagging 대상이 될 수 없다", async () => {
  const fixture = migrationFixture();
  fixture.reviews = [];
  const plan = await new LegacyTagMigrationService(fixture.repository).run({
    reviewManifestId: fixture.manifest.reviewManifestId,
    institutionId: "coop-001",
    documentPaths: ["users/seed-user"],
    projectId: "demo-step8",
    environment: "test",
  });
  assert.equal(plan.blockedCount, 1);
  assert.equal(
    plan.items[0].blockedReason,
    "approved_exact_review_required",
  );
});

test("다른 농협을 참조하는 문서는 tagging을 차단한다", async () => {
  const fixture = migrationFixture();
  fixture.documents[0].data.cooperativeId = "coop-002";
  const plan = await new LegacyTagMigrationService(fixture.repository).run({
    reviewManifestId: fixture.manifest.reviewManifestId,
    institutionId: "coop-001",
    documentPaths: ["users/seed-user"],
    projectId: "demo-step8",
    environment: "test",
  });
  assert.equal(plan.blockedCount, 1);
  assert.equal(plan.items[0].blockedReason, "cross_institution_document");
});

test("REVIEW_REQUIRED가 남으면 purge manifest도 BLOCKED다", () => {
  const manifest = buildPurgeManifest(
    {
      institutionId: "coop-001",
      mode: "DRY_RUN",
      generatedBy: "super-admin",
      environment: "test",
      projectId: "demo-step8",
      now: "2026-07-23T00:00:00.000Z",
    },
    snapshot([
      document("users", "pattern-user", {
        uid: "pattern-user",
        cooperativeId: "coop-001",
        email: "demo-user@example.com",
      }),
    ]),
  );
  assert.equal(manifest.executionStatus, "BLOCKED");
  assert.equal(
    manifest.blockedReasons.includes("LEGACY_REVIEW_INCOMPLETE"),
    true,
  );
});

test("review API는 권한 실패를 서버 응답으로 반환한다", async () => {
  const handlers = createLegacyReviewHandlers({
    authorizeScan: async () => {
      throw { code: "forbidden", status: 403 };
    },
    authorizeReview: async () => {
      throw { code: "forbidden", status: 403 };
    },
    service: () => {
      throw new Error("service must not be used");
    },
    environment: () => "test",
    projectId: () => "demo-step8",
  });
  const response = await handlers.review(
    new Request("https://example.test/api/admin/test-data/legacy/reviews", {
      method: "POST",
      body: JSON.stringify({
        reviewManifestId: "legacy_coop-001_example",
        candidateId: "a".repeat(32),
        decision: "CONFIRMED_TEST",
        reason: "충분한 검토 사유를 기록한 승인 요청입니다",
        sourceEvidence: ["SEED_MANIFEST_ENTRY"],
        reviewVersion: 1,
      }),
    }),
  );
  assert.equal(response.status, 403);
});

function createReviewState(initialSnapshot: ScanSnapshot) {
  const manifests = new Map<string, LegacyReviewManifest>();
  const candidates = new Map<string, LegacyReviewCandidate[]>();
  const reviews: LegacyReviewRecord[] = [];
  const source: LegacyReviewDataSource = {
    loadSnapshot: async () => initialSnapshot,
    loadReviews: async () => [...reviews],
  };
  const store: LegacyReviewStore = {
    saveManifest: async (manifest, values) => {
      manifests.set(manifest.reviewManifestId, manifest);
      candidates.set(manifest.reviewManifestId, structuredClone(values));
    },
    getManifest: async (id) => manifests.get(id) ?? null,
    getCandidates: async (id) => structuredClone(candidates.get(id) ?? []),
    saveReview: async (review, manifest) => {
      const index = reviews.findIndex(
        (value) => value.reviewId === review.reviewId,
      );
      if (index >= 0) reviews[index] = review;
      else reviews.push(review);
      manifests.set(manifest.reviewManifestId, manifest);
    },
    loadReviews: async () => [...reviews],
  };
  return { source, store };
}

function migrationFixture() {
  const manifest: LegacyReviewManifest = {
    schemaVersion: 1,
    reviewManifestId: "legacy_coop-001_fixture",
    institutionId: "coop-001",
    institutionName: "가상 검토 대상 농협",
    generatedAt: "2026-07-23T00:00:00.000Z",
    generatedBy: "super-admin",
    environment: "test",
    projectId: "demo-step8",
    reviewVersion: 2,
    checksum: "fixture-checksum",
    status: "READY",
    candidateCount: 1,
    reviewedCount: 1,
    report: {
      schemaVersion: 1,
      institutionId: "coop-001",
      institutionName: "가상 검토 대상 농협",
      institutionType: "지역농협",
      signupStatus: "CONNECTED",
      connectedAccountCount: 1,
      confirmedTestCount: 1,
      reviewRequiredCount: 0,
      preserveCount: 0,
      unresolvedCount: 0,
      pointDataCount: 0,
      questionAnswerDataCount: 0,
      quoteReportDataCount: 0,
      authUserCount: 0,
      storageObjectCount: 0,
      mixedData: false,
      cleanupReadiness: { status: "READY", reasons: [] },
      preservedMasterFields: ["cooperative_id"],
      resetFields: [],
      warnings: [],
    },
  };
  let reviews: LegacyReviewRecord[] = [
    {
      schemaVersion: 1,
      reviewId: "legacy-review-1",
      reviewManifestId: manifest.reviewManifestId,
      candidateId: "a".repeat(32),
      institutionId: "coop-001",
      targetType: "FIRESTORE_DOCUMENT",
      resourceKey: "users/seed-user",
      documentPath: "users/seed-user",
      reviewedChangeToken: "users-seed-user-v1",
      decision: "CONFIRMED_TEST",
      reason: "고정 seed 문서 ID를 코드 이력과 대조하여 확인함",
      sourceEvidence: ["SEED_MANIFEST_ENTRY"],
      reviewedBy: "super-admin",
      reviewedAt: "2026-07-23T00:00:00.000Z",
      reviewVersion: 2,
      status: "APPROVED",
    },
  ];
  const documents: LegacyTagDocumentSnapshot[] = [
    {
      documentPath: "users/seed-user",
      exists: true,
      changeToken: "users-seed-user-v1",
      data: { cooperativeId: "coop-001" },
    },
  ];
  const applied: LegacyTagMigrationPlan[] = [];
  const repository: LegacyTagMigrationRepository = {
    getReviewManifest: async (id) =>
      id === manifest.reviewManifestId ? manifest : null,
    loadApprovedDocumentReviews: async () => reviews,
    loadDocuments: async () => documents,
    apply: async (plan) => {
      applied.push(plan);
    },
  };
  return {
    manifest,
    documents,
    applied,
    repository,
    get reviews() {
      return reviews;
    },
    set reviews(value: LegacyReviewRecord[]) {
      reviews = value;
    },
  };
}
