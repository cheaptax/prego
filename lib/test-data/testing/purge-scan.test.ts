import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  createDunggiCooperativeMaster,
  DUNGGI_COOPERATIVE_ID,
} from "@/lib/cooperatives/demo-cooperative";
import { createPurgeScanPostHandler } from "@/lib/test-data/purge-api";
import {
  buildPurgeManifest,
  verifyPurgeManifestFreshness,
} from "@/lib/test-data/purge-manifest";
import { PurgeScanService } from "@/lib/test-data/purge-scan-service";
import type {
  PurgeScanDataSource,
  ScanDocument,
  ScanSnapshot,
} from "@/lib/test-data/purge-types";

const NOW = "2026-07-22T15:00:00.000Z";

function document(
  collection: string,
  id: string,
  data: Record<string, unknown>,
  overrides: Partial<ScanDocument> = {},
): ScanDocument {
  return {
    collection,
    id,
    path: `${collection}/${id}`,
    data,
    changeToken: "2026-07-22T14:59:00.000Z",
    relationships: [`fixture:${id}`],
    crossInstitutionIds: [],
    ...overrides,
  };
}

function demoSnapshot(documents: ScanDocument[] = []): ScanSnapshot {
  const master = createDunggiCooperativeMaster(NOW);
  master.signupStatus = "REGISTERED";
  return {
    institution: {
      id: DUNGGI_COOPERATIVE_ID,
      name: "둥기농협",
      type: "지역농협",
      isDemoInstitution: true,
      masterSource: "DEMO_FIRESTORE",
      masterPath: `demoCooperativeMaster/${DUNGGI_COOPERATIVE_ID}`,
      masterData: master,
      masterChangeToken: "master-v1",
    },
    documents,
    approvedTestScenarioIds: [],
    seedManifestDocumentPaths: [],
    approvedLegacyDocumentPaths: [],
    authUserMetadata: {},
    storageObjectMetadata: {},
    warnings: [],
  };
}

function realSnapshot(documents: ScanDocument[] = []): ScanSnapshot {
  return {
    institution: {
      id: "coop-001",
      name: "서울축산농협",
      type: "축협",
      isDemoInstitution: false,
      masterSource: "REAL_STATIC_MASTER",
      masterPath: "static:nonghyupMaster/coop-001",
      masterData: {
        cooperative_id: "coop-001",
        cooperative_name: "서울축산농협",
        cooperative_type: "축협",
        sido: "전국",
        sigungu: "",
        address: "전국",
        status: "active",
        source: "전국 농협 마스터",
        updated_at: "2026.05.01",
      },
      masterChangeToken: "real-master-v1",
    },
    documents,
    approvedTestScenarioIds: [],
    seedManifestDocumentPaths: [],
    approvedLegacyDocumentPaths: [],
    authUserMetadata: {},
    storageObjectMetadata: {},
    warnings: [],
  };
}

function manifest(snapshot: ScanSnapshot, mode: "SCAN" | "DRY_RUN" = "SCAN") {
  return buildPurgeManifest(
    {
      institutionId: snapshot.institution.id,
      mode,
      generatedBy: "test:super-admin",
      environment: "test",
      projectId: "demo-purge-scan",
      now: NOW,
    },
    snapshot,
  );
}

test("둥기농협 graph를 CONFIRMED_TEST로 분류하고 master는 보존한다", () => {
  const result = manifest(
    demoSnapshot([
      document("users", "uid-demo", {
        uid: "uid-demo",
        cooperativeId: DUNGGI_COOPERATIVE_ID,
        dataClassification: "DEMO",
        businessCardPath: "business-cards/uid-demo/card.png",
      }),
      document("organizations", DUNGGI_COOPERATIVE_ID, {
        cooperativeId: DUNGGI_COOPERATIVE_ID,
        users: ["uid-demo"],
        dataClassification: "DEMO",
        walletBalance: 110_000,
      }),
      document("consultRequests", "request-1", {
        uid: "uid-demo",
        cooperativeId: DUNGGI_COOPERATIVE_ID,
        userEmail: "private-customer@example.com",
        subject: "민감한 질문 제목",
        message: "민감한 질문 본문",
        attachments: [
          { path: "consult-attachments/uid-demo/request-1/input.pdf" },
        ],
      }),
      document("answers", "request-1", { requestId: "request-1" }),
      document("pointLedger", "ledger-1", {
        userId: "uid-demo",
        cooperativeId: DUNGGI_COOPERATIVE_ID,
      }),
      document("testAuthSubjects", "phone-uid", {
        authUid: "phone-uid",
        primaryUserUid: "uid-demo",
        providerIds: ["phone"],
        dataClassification: "DEMO",
      }),
    ]),
    "DRY_RUN",
  );

  assert.equal(result.executionStatus, "DRY_RUN_READY");
  assert.equal(result.targetsByCollection.users.length, 1);
  assert.equal(result.targetsByCollection.answers.length, 1);
  assert.equal(result.authUsers.length, 2);
  assert.equal(result.storageObjects.length, 2);
  assert.equal(
    Object.values(result.targetsByCollection).flat().some(
      (item) => item.resourcePath.startsWith("demoCooperativeMaster/"),
    ),
    false,
  );
  assert.equal(
    result.preservedItems.some(
      (item) =>
        item.resourcePath ===
        `demoCooperativeMaster/${DUNGGI_COOPERATIVE_ID}`,
    ),
    true,
  );
  assert.deepEqual(result.resetFields, [
    {
      field: "signupStatus",
      currentValue: "REGISTERED",
      expectedValue: "AVAILABLE",
    },
  ]);
  assert.equal(result.preservedFields.includes("cooperativeName"), true);
  assert.equal(result.preservedFields.includes("internalCode"), true);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /private-customer@example\.com/);
  assert.doesNotMatch(serialized, /민감한 질문 (?:제목|본문)/);
});

test("이메일 패턴만 일치하면 REVIEW_REQUIRED이며 target이 아니다", () => {
  const result = manifest(
    realSnapshot([
      document("users", "legacy-uid", {
        uid: "legacy-uid",
        cooperativeId: "coop-001",
        email: "mvp-a1-123@example.com",
      }),
    ]),
  );
  assert.equal(result.reviewByCollection.users.length, 1);
  assert.equal(result.targetsByCollection.users, undefined);
  assert.equal(
    result.reviewByCollection.users[0].classificationMethod,
    "LEGACY_PATTERN_ONLY",
  );
});

test("테스트 표식이 없는 실제 데이터는 PRESERVE한다", () => {
  const result = manifest(
    realSnapshot([
      document("users", "real-uid", {
        uid: "real-uid",
        cooperativeId: "coop-001",
        email: "customer@example.org",
      }),
    ]),
  );
  assert.equal(result.totalTargetCount, 0);
  assert.equal(
    result.preservedItems.some(
      (item) => item.resourcePath === "users/real-uid",
    ),
    true,
  );
});

test("같은 organization의 테스트·실제 사용자가 혼재하면 BLOCKED한다", () => {
  const result = manifest(
    realSnapshot([
      document("users", "test-uid", {
        uid: "test-uid",
        cooperativeId: "coop-001",
        dataClassification: "TEST",
      }),
      document("users", "real-uid", {
        uid: "real-uid",
        cooperativeId: "coop-001",
      }),
      document("organizations", "coop-001", {
        cooperativeId: "coop-001",
        users: ["test-uid", "real-uid"],
      }),
    ]),
    "DRY_RUN",
  );
  assert.equal(result.executionStatus, "BLOCKED");
  assert.equal(
    result.blockedReasons.includes("MIXED_ORGANIZATION_USERS"),
    true,
  );
});

test("다른 농협 참조는 삭제 target에서 제외하고 BLOCKED한다", () => {
  const result = manifest(
    realSnapshot([
      document(
        "consultRequests",
        "shared-request",
        {
          cooperativeId: "coop-002",
          dataClassification: "TEST",
        },
        { crossInstitutionIds: ["coop-002"] },
      ),
    ]),
  );
  assert.equal(result.executionStatus, "BLOCKED");
  assert.equal(result.targetsByCollection.consultRequests, undefined);
  assert.equal(result.blockedItems.length, 1);
  assert.equal(
    result.blockedReasons.includes("CROSS_INSTITUTION_REFERENCE"),
    true,
  );
});

test("승인된 legacy exact path만 CONFIRMED_TEST로 승격한다", () => {
  const snapshot = realSnapshot([
    document("users", "legacy-reviewed", {
      uid: "legacy-reviewed",
      cooperativeId: "coop-001",
    }),
  ]);
  snapshot.approvedLegacyDocumentPaths = ["users/legacy-reviewed"];
  const result = manifest(snapshot);
  assert.equal(result.targetsByCollection.users.length, 1);
  assert.equal(
    result.targetsByCollection.users[0].classificationMethod,
    "LEGACY_APPROVAL",
  );
});

test("PRODUCTION marker와 테스트 marker 충돌은 보존 우선으로 BLOCKED한다", () => {
  const result = manifest(
    realSnapshot([
      document("users", "conflicted-uid", {
        uid: "conflicted-uid",
        cooperativeId: "coop-001",
        dataClassification: "PRODUCTION",
        testData: true,
      }),
    ]),
  );
  assert.equal(result.executionStatus, "BLOCKED");
  assert.equal(result.targetsByCollection.users, undefined);
  assert.equal(result.blockedItems.length, 1);
});

test("동일 snapshot은 같은 manifest를 재생성하고 변경은 checksum을 바꾼다", () => {
  const snapshot = demoSnapshot([
    document("users", "uid-demo", {
      uid: "uid-demo",
      dataClassification: "DEMO",
      cooperativeId: DUNGGI_COOPERATIVE_ID,
    }),
  ]);
  const first = manifest(snapshot, "DRY_RUN");
  const repeated = manifest(snapshot, "DRY_RUN");
  assert.equal(first.manifestId, repeated.manifestId);
  assert.equal(first.checksum, repeated.checksum);

  const changed = structuredClone(snapshot);
  changed.documents[0].changeToken = "user-v2";
  const next = manifest(changed, "DRY_RUN");
  const freshness = verifyPurgeManifestFreshness(first, next, NOW);
  assert.equal(freshness.valid, false);
  assert.equal(freshness.status, "CHECKSUM_MISMATCH");
});

test("Storage generation 변경도 manifest checksum을 무효화한다", () => {
  const snapshot = demoSnapshot([
    document("users", "uid-demo", {
      uid: "uid-demo",
      cooperativeId: DUNGGI_COOPERATIVE_ID,
      dataClassification: "DEMO",
      businessCardPath: "business-cards/uid-demo/card.png",
    }),
  ]);
  snapshot.storageObjectMetadata["business-cards/uid-demo/card.png"] = {
    exists: true,
    bucket: "demo-bucket",
    generation: "1",
    size: 120,
    contentType: "image/png",
  };
  const first = manifest(snapshot, "DRY_RUN");
  const changed = structuredClone(snapshot);
  changed.storageObjectMetadata["business-cards/uid-demo/card.png"].generation =
    "2";
  const next = manifest(changed, "DRY_RUN");
  assert.equal(
    verifyPurgeManifestFreshness(first, next, NOW).status,
    "CHECKSUM_MISMATCH",
  );
});

test("빈 데이터 농협 scan은 master만 보존하고 target 0건이다", () => {
  const result = manifest(realSnapshot());
  assert.equal(result.executionStatus, "SCANNED");
  assert.equal(result.totalTargetCount, 0);
  assert.deepEqual(result.targetsByCollection, {});
  assert.equal(result.preservedItems.length, 1);
  assert.deepEqual(result.resetFields, []);
});

test("PurgeScanService는 data source를 읽기만 하고 APPLY를 거부한다", async () => {
  let reads = 0;
  const dataSource: PurgeScanDataSource = {
    async loadSnapshot() {
      reads += 1;
      return demoSnapshot();
    },
  };
  const service = new PurgeScanService(dataSource);
  const result = await service.scan({
    institutionId: DUNGGI_COOPERATIVE_ID,
    mode: "SCAN",
    generatedBy: "test:admin",
    environment: "test",
    projectId: "demo-purge-scan",
    now: NOW,
  });
  assert.equal(result.totalTargetCount, 0);
  assert.equal(reads, 1);
  await assert.rejects(
    () =>
      service.scan({
        institutionId: DUNGGI_COOPERATIVE_ID,
        mode: "APPLY" as "SCAN",
        generatedBy: "test:admin",
        environment: "test",
        projectId: "demo-purge-scan",
      }),
    /apply_not_implemented/,
  );
  assert.equal(reads, 1);
});

test("SCAN API는 super admin actor를 기록하고 APPLY를 명시적으로 거부한다", async () => {
  let receivedMode = "";
  const handler = createPurgeScanPostHandler({
    authorize: async () => ({ uid: "super-admin-uid" }),
    scan: async (input) => {
      receivedMode = input.mode;
      return buildPurgeManifest(
        { ...input, now: NOW },
        demoSnapshot(),
      );
    },
    environment: () => "test",
    projectId: () => "demo-purge-scan",
  });
  const scanResponse = await handler(
    new Request("http://localhost/api/admin/test-data/scan", {
      method: "POST",
      body: JSON.stringify({ institutionId: DUNGGI_COOPERATIVE_ID }),
    }),
  );
  const scanBody = await scanResponse.json();
  assert.equal(scanResponse.status, 200);
  assert.equal(receivedMode, "SCAN");
  assert.equal(scanBody.manifest.generatedBy, "super-admin-uid");
  assert.match(
    scanResponse.headers.get("cache-control") ?? "",
    /no-store/,
  );

  const applyResponse = await handler(
    new Request("http://localhost/api/admin/test-data/scan", {
      method: "POST",
      body: JSON.stringify({
        institutionId: DUNGGI_COOPERATIVE_ID,
        mode: "APPLY",
      }),
    }),
  );
  assert.equal(applyResponse.status, 405);
  assert.equal((await applyResponse.json()).error, "apply_not_implemented");
});

test("CLI도 --apply를 Firestore 초기화 전에 거부한다", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "./scripts/audit-quote/alias-loader.mjs",
      "--experimental-strip-types",
      "scripts/test-data/scan-manifest.mjs",
      "--apply",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--apply is not implemented/);
});
