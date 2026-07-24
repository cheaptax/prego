import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  createDunggiCooperativeMaster,
  DUNGGI_COOPERATIVE_ID,
} from "../../lib/cooperatives/demo-cooperative.ts";
import { PurgeApplyService } from "../../lib/test-data/purge-apply-service.ts";
import {
  FirestorePurgeControlStore,
  FirestorePurgeExecutor,
} from "../../lib/test-data/purge-firestore-executor.ts";
import { buildPurgeManifest } from "../../lib/test-data/purge-manifest.ts";
import { PurgeScanService } from "../../lib/test-data/purge-scan-service.ts";

const PROJECT_ID = "demo-step5-firestore-purge";
let app;
let db;

function requireEmulator() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required");
  }
}

async function readSnapshot() {
  const masterSnapshot = await db
    .collection("demoCooperativeMaster")
    .doc(DUNGGI_COOPERATIVE_ID)
    .get();
  assert.equal(masterSnapshot.exists, true);
  const collections = [
    "users",
    "organizations",
    "pointLedger",
    "point_transactions",
    "consultRequests",
    "answers",
    "answerViews",
    "answerRatings",
    "testAuthSubjects",
  ];
  const snapshots = await Promise.all(
    collections.map((collection) => db.collection(collection).get()),
  );
  const documents = snapshots.flatMap((snapshot) =>
    snapshot.docs.flatMap((document) => {
      const data = document.data();
      const belongs =
        data.sourceInstitutionId === DUNGGI_COOPERATIVE_ID ||
        data.cooperativeId === DUNGGI_COOPERATIVE_ID ||
        data.nh_org_id === DUNGGI_COOPERATIVE_ID ||
        (document.ref.parent.id === "organizations" &&
          document.id === DUNGGI_COOPERATIVE_ID);
      return belongs
        ? [{
            collection: document.ref.parent.id,
            id: document.id,
            path: document.ref.path,
            data,
            changeToken: document.updateTime.toDate().toISOString(),
            relationships: [`emulator:${document.id}`],
            crossInstitutionIds: [],
          }]
        : [];
    })
  );
  return {
    institution: {
      id: DUNGGI_COOPERATIVE_ID,
      name: "둥기농협",
      type: "지역농협",
      isDemoInstitution: true,
      masterSource: "DEMO_FIRESTORE",
      masterPath: masterSnapshot.ref.path,
      masterData: masterSnapshot.data(),
      masterChangeToken: masterSnapshot.updateTime.toDate().toISOString(),
    },
    documents,
    approvedTestScenarioIds: [],
    seedManifestDocumentPaths: [],
    approvedLegacyDocumentPaths: [],
    authUserMetadata: {
      "emulator-user": {
        exists: true,
        providerIds: ["password"],
        changeToken: "emulator-auth-v1",
      },
    },
    storageObjectMetadata: {},
    warnings: [],
  };
}

before(async () => {
  requireEmulator();
  app = initializeApp({ projectId: PROJECT_ID }, `purge-${Date.now()}`);
  db = getFirestore(app);
  const now = new Date().toISOString();
  const master = createDunggiCooperativeMaster(now);
  master.signupStatus = "REGISTERED";
  const marker = {
    dataClassification: "DEMO",
    sourceInstitutionId: DUNGGI_COOPERATIVE_ID,
    testScenarioId: "dunggi-signup-v1",
  };
  await Promise.all([
    db.collection("demoCooperativeMaster").doc(DUNGGI_COOPERATIVE_ID).set(master),
    db.collection("users").doc("emulator-user").set({
      uid: "emulator-user",
      cooperativeId: DUNGGI_COOPERATIVE_ID,
      ...marker,
    }),
    db.collection("organizations").doc(DUNGGI_COOPERATIVE_ID).set({
      cooperativeId: DUNGGI_COOPERATIVE_ID,
      users: ["emulator-user"],
      walletBalance: 110_000,
      ...marker,
    }),
    db.collection("pointLedger").doc("ledger-1").set({
      cooperativeId: DUNGGI_COOPERATIVE_ID,
      userId: "emulator-user",
      ...marker,
    }),
    db.collection("consultRequests").doc("request-1").set({
      cooperativeId: DUNGGI_COOPERATIVE_ID,
      uid: "emulator-user",
      ...marker,
    }),
    db.collection("answers").doc("request-1").set({
      requestId: "request-1",
      ...marker,
    }),
    db.collection("testAuthSubjects").doc("emulator-user").set({
      authUid: "emulator-user",
      primaryUserUid: "emulator-user",
      providerIds: ["password"],
      ...marker,
    }),
    db.collection("users").doc("other-coop-user").set({
      uid: "other-coop-user",
      cooperativeId: "coop-002",
      dataClassification: "PRODUCTION",
    }),
  ]);
});

after(async () => {
  if (app) await deleteApp(app);
  for (const existing of getApps()) {
    if (existing.name.startsWith("purge-")) await deleteApp(existing);
  }
});

test("emulator에서 exact manifest Firestore 대상만 삭제하고 master를 보존한다", async () => {
  const now = new Date().toISOString();
  const scanner = new PurgeScanService({ loadSnapshot: readSnapshot });
  const manifest = buildPurgeManifest(
    {
      institutionId: DUNGGI_COOPERATIVE_ID,
      mode: "DRY_RUN",
      generatedBy: "emulator-super-admin",
      environment: "emulator",
      projectId: PROJECT_ID,
      now,
    },
    await readSnapshot(),
  );
  const service = new PurgeApplyService({
    store: new FirestorePurgeControlStore(db),
    executor: new FirestorePurgeExecutor(db),
    scanner,
    configuration: {
      enabled: true,
      productionEnabled: false,
      allowedProjectId: PROJECT_ID,
    },
  });
  await service.registerManifest({
    manifest,
    approvedBy: "emulator-super-admin",
    approvedByEmail: "emulator-admin@example.com",
    environment: "emulator",
    projectId: PROJECT_ID,
    now,
  });
  const result = await service.apply({
    manifestId: manifest.manifestId,
    confirmation: "DELETE TEST DATA: 둥기농협",
    requestedBy: "emulator-super-admin",
    requestedByEmail: "emulator-admin@example.com",
    requestId: "emulator-request-1",
    environment: "emulator",
    projectId: PROJECT_ID,
    now,
  });

  assert.equal(result.job.status, "PARTIALLY_FAILED");
  assert.equal(result.job.currentPhase, "AWAITING_AUTH_STORAGE");
  assert.equal(
    (await db.collection("demoCooperativeMaster")
      .doc(DUNGGI_COOPERATIVE_ID).get()).data().signupStatus,
    "REGISTERED",
  );
  assert.equal(
    (await db.collection("users").doc("emulator-user").get()).exists,
    false,
  );
  assert.equal(
    (await db.collection("organizations")
      .doc(DUNGGI_COOPERATIVE_ID).get()).exists,
    false,
  );
  assert.equal(
    (await db.collection("consultRequests").doc("request-1").get()).exists,
    false,
  );
  assert.equal(
    (await db.collection("answers").doc("request-1").get()).exists,
    false,
  );
  assert.equal(
    (await db.collection("pointLedger").doc("ledger-1").get()).exists,
    false,
  );
  assert.equal(
    (await db.collection("testAuthSubjects")
      .doc("emulator-user").get()).exists,
    true,
  );
  assert.equal(
    (await db.collection("users").doc("other-coop-user").get()).exists,
    true,
  );
  assert.equal(
    (await db.collection("testDataPurgeAuditLogs").get()).size > 0,
    true,
  );
});
