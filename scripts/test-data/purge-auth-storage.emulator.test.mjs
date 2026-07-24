import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { deleteApp } from "firebase-admin/app";
import {
  adminAuth,
  adminDb,
  adminStorage,
  getFirebaseAdminApp,
} from "../../lib/firebase/admin.ts";
import {
  createDunggiCooperativeMaster,
  DUNGGI_COOPERATIVE_ID,
} from "../../lib/cooperatives/demo-cooperative.ts";
import { nonghyupMaster } from "../../lib/platform.ts";
import {
  PurgeApplyError,
  PurgeApplyService,
} from "../../lib/test-data/purge-apply-service.ts";
import { expectedPurgeConfirmation } from "../../lib/test-data/purge-apply-policy.ts";
import { getTestDataExecutionBlockers } from "../../lib/test-data/purge-admin-ui-policy.ts";
import { FirebasePurgeExternalExecutor } from "../../lib/test-data/purge-external-executor.ts";
import {
  FirestorePurgeControlStore,
  FirestorePurgeExecutor,
} from "../../lib/test-data/purge-firestore-executor.ts";
import { FirestorePurgeScanDataSource } from "../../lib/test-data/purge-firestore-source.ts";
import { FirebasePurgeOrphanVerifier } from "../../lib/test-data/purge-orphan-verifier.ts";
import { PurgeScanService } from "../../lib/test-data/purge-scan-service.ts";

const PROJECT_ID = "demo-step6-external-purge";
const BUCKET = `${PROJECT_ID}.appspot.com`;
const EMAIL_UID = "step6-email-user";
const PHONE_UID = "step6-phone-user";
const STORAGE_PATH = `business-cards/${EMAIL_UID}/card.png`;
const REQUEST_ID = "step6-request";
const QUOTE_REQUEST_ID = "step6-quote-request";
const QUOTE_ID = "step6-quote";
const CASE_ID = "step6-evaluation-case";
const QUOTE_STORAGE_PATH = `quotes/${QUOTE_ID}/v1/quote.pdf`;
const REPORT_STORAGE_PATH =
  `audit-evaluation/reports/${CASE_ID}/v1/attempt-1/report.pdf`;
const REAL_INSTITUTION_ID = "coop-001";
const REAL_TEST_UID = "step6-real-test-user";
const REAL_STORAGE_PATH = `business-cards/${REAL_TEST_UID}/card.png`;

let app;
let db;
let auth;
let storage;

function requireEmulators() {
  for (const name of [
    "FIRESTORE_EMULATOR_HOST",
    "FIREBASE_AUTH_EMULATOR_HOST",
    "FIREBASE_STORAGE_EMULATOR_HOST",
  ]) {
    if (!process.env[name]) throw new Error(`${name} is required`);
  }
}

before(async () => {
  requireEmulators();
  process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  process.env.FIREBASE_STORAGE_BUCKET = BUCKET;
  app = getFirebaseAdminApp();
  db = adminDb();
  auth = adminAuth();
  storage = adminStorage();

  const now = new Date().toISOString();
  const master = createDunggiCooperativeMaster(now);
  master.signupStatus = "REGISTERED";
  const marker = {
    dataClassification: "DEMO",
    sourceInstitutionId: DUNGGI_COOPERATIVE_ID,
    testScenarioId: "dunggi-signup-v1",
  };

  await Promise.all([
    auth.createUser({
      uid: EMAIL_UID,
      email: "step6-customer@example.com",
      password: "Emulator-Only-Password-1!",
    }),
    auth.createUser({
      uid: PHONE_UID,
      phoneNumber: "+16505550101",
    }),
    db.collection("demoCooperativeMaster")
      .doc(DUNGGI_COOPERATIVE_ID)
      .set(master),
    db.collection("users").doc(EMAIL_UID).set({
      uid: EMAIL_UID,
      role: "member",
      cooperativeId: DUNGGI_COOPERATIVE_ID,
      businessCardPath: STORAGE_PATH,
      ...marker,
    }),
    db.collection("organizations").doc(DUNGGI_COOPERATIVE_ID).set({
      cooperativeId: DUNGGI_COOPERATIVE_ID,
      users: [EMAIL_UID],
      walletBalance: 110_000,
      ...marker,
    }),
    db.collection("testAuthSubjects").doc(EMAIL_UID).set({
      authUid: EMAIL_UID,
      primaryUserUid: EMAIL_UID,
      providerIds: ["password"],
      ...marker,
    }),
    db.collection("testAuthSubjects").doc(PHONE_UID).set({
      authUid: PHONE_UID,
      primaryUserUid: EMAIL_UID,
      providerIds: ["phone"],
      ...marker,
    }),
    db.collection("memberships").doc("step6-membership").set({
      uid: EMAIL_UID,
      institutionId: DUNGGI_COOPERATIVE_ID,
      ...marker,
    }),
    db.collection("tenants").doc("step6-tenant").set({
      ownerUid: EMAIL_UID,
      institutionId: DUNGGI_COOPERATIVE_ID,
      status: "active",
      ...marker,
    }),
    db.collection("pointLedger").doc("step6-ledger").set({
      userId: EMAIL_UID,
      cooperativeId: DUNGGI_COOPERATIVE_ID,
      requestId: REQUEST_ID,
      points: 110_000,
      ...marker,
    }),
    db.collection("point_transactions").doc("step6-transaction").set({
      user_id: EMAIL_UID,
      cooperativeId: DUNGGI_COOPERATIVE_ID,
      requestId: REQUEST_ID,
      amount: -10_000,
      ...marker,
    }),
    db.collection("consultRequests").doc(REQUEST_ID).set({
      uid: EMAIL_UID,
      cooperativeId: DUNGGI_COOPERATIVE_ID,
      ...marker,
    }),
    db.collection("answers").doc(REQUEST_ID).set({
      requestId: REQUEST_ID,
      ...marker,
    }),
    db.collection("answerViews").doc(`${REQUEST_ID}_${EMAIL_UID}`).set({
      uid: EMAIL_UID,
      requestId: REQUEST_ID,
      cooperativeId: DUNGGI_COOPERATIVE_ID,
      ...marker,
    }),
    db.collection("answerRatings").doc(`${REQUEST_ID}_${EMAIL_UID}`).set({
      uid: EMAIL_UID,
      requestId: REQUEST_ID,
      comment: "emulator-only comment",
      ...marker,
    }),
    db.collection("quoteRequests").doc(QUOTE_REQUEST_ID).set({
      customerUid: EMAIL_UID,
      cooperativeId: DUNGGI_COOPERATIVE_ID,
      sourceId: REQUEST_ID,
      ...marker,
    }),
    db.collection("quoteAssignments").doc("step6-quote-assignment").set({
      quoteRequestId: QUOTE_REQUEST_ID,
      ...marker,
    }),
    db.collection("quotes").doc(QUOTE_ID).set({
      quoteRequestId: QUOTE_REQUEST_ID,
      pdfPath: QUOTE_STORAGE_PATH,
      ...marker,
    }),
    db.collection("quoteEmailDeliveries").doc("step6-quote-delivery").set({
      quoteId: QUOTE_ID,
      quoteRequestId: QUOTE_REQUEST_ID,
      ...marker,
    }),
    db.collection("auditEvaluationCases").doc(CASE_ID).set({
      quoteRequestId: QUOTE_REQUEST_ID,
      cooperativeId: DUNGGI_COOPERATIVE_ID,
      ...marker,
    }),
    db.collection("auditEvaluationReportRuns").doc("step6-report-run").set({
      caseId: CASE_ID,
      reportStoragePath: REPORT_STORAGE_PATH,
      ...marker,
    }),
    db.collection("users").doc("other-coop-user").set({
      uid: "other-coop-user",
      cooperativeId: "coop-002",
      dataClassification: "PRODUCTION",
    }),
  ]);

  await storage.bucket(BUCKET).file(STORAGE_PATH).save(
    Buffer.from("emulator-card"),
    {
      contentType: "image/png",
      metadata: {
        metadata: {
          dataClassification: "DEMO",
          sourceInstitutionId: DUNGGI_COOPERATIVE_ID,
          ownerUid: EMAIL_UID,
        },
      },
    },
  );
  await storage.bucket(BUCKET).file(QUOTE_STORAGE_PATH).save(
    Buffer.from("emulator-quote"),
    {
      contentType: "application/pdf",
      metadata: {
        metadata: {
          dataClassification: "DEMO",
          sourceInstitutionId: DUNGGI_COOPERATIVE_ID,
          ownerUid: EMAIL_UID,
        },
      },
    },
  );
  await storage.bucket(BUCKET).file(REPORT_STORAGE_PATH).save(
    Buffer.from("emulator-report"),
    {
      contentType: "application/pdf",
      metadata: {
        metadata: {
          dataClassification: "DEMO",
          sourceInstitutionId: DUNGGI_COOPERATIVE_ID,
          ownerUid: EMAIL_UID,
        },
      },
    },
  );
  await storage.bucket(BUCKET)
    .file("business-cards/other-coop-user/preserve.png")
    .save(Buffer.from("preserve"), { contentType: "image/png" });
});

after(async () => {
  if (app) await deleteApp(app);
});

test("Auth·Storage emulator에서 exact target만 정리하고 재가입 가능 상태로 완료한다", async () => {
  const now = new Date().toISOString();
  const masterBefore = (await db.collection("demoCooperativeMaster")
    .doc(DUNGGI_COOPERATIVE_ID).get()).data();
  const scanner = new PurgeScanService(
    new FirestorePurgeScanDataSource(db, auth, storage),
  );
  const manifest = await scanner.scan({
    institutionId: DUNGGI_COOPERATIVE_ID,
    mode: "DRY_RUN",
    generatedBy: "emulator-super-admin",
    environment: "emulator",
    projectId: PROJECT_ID,
    now,
  });
  assert.equal(manifest.executionStatus, "DRY_RUN_READY");
  assert.deepEqual(
    manifest.authUsers
      .filter((item) => item.classification === "CONFIRMED_TEST")
      .map((item) => item.uid)
      .sort(),
    [EMAIL_UID, PHONE_UID],
  );
  assert.deepEqual(
    manifest.storageObjects.map((item) => item.path),
    [REPORT_STORAGE_PATH, STORAGE_PATH, QUOTE_STORAGE_PATH].sort(),
  );
  assert.equal(manifest.targetsByCollection.pointLedger.length, 1);
  assert.equal(manifest.targetsByCollection.point_transactions.length, 1);
  assert.equal(manifest.targetsByCollection.answers.length, 1);
  assert.equal(manifest.targetsByCollection.answerRatings.length, 1);
  assert.equal(manifest.targetsByCollection.quoteRequests.length, 1);
  assert.equal(manifest.targetsByCollection.auditEvaluationReportRuns.length, 1);

  const service = new PurgeApplyService({
    store: new FirestorePurgeControlStore(db),
    executor: new FirestorePurgeExecutor(db),
    externalExecutor: new FirebasePurgeExternalExecutor(db, auth, storage),
    orphanVerifier: new FirebasePurgeOrphanVerifier(db, auth, storage),
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
    environment: "emulator",
    projectId: PROJECT_ID,
    now,
  });
  const result = await service.apply({
    manifestId: manifest.manifestId,
    confirmation: "DELETE TEST DATA: 둥기농협",
    requestedBy: "emulator-super-admin",
    requestId: "step6-emulator-request",
    environment: "emulator",
    projectId: PROJECT_ID,
    now,
  });

  assert.equal(result.job.status, "COMPLETED");
  assert.equal(result.job.orphanVerification?.passed, true);
  await assert.rejects(
    () => auth.getUser(EMAIL_UID),
    (error) => error.code === "auth/user-not-found",
  );
  for (const path of [QUOTE_STORAGE_PATH, REPORT_STORAGE_PATH]) {
    await assert.rejects(
      () => storage.bucket(BUCKET).file(path).getMetadata(),
      (error) =>
        error?.code === 404 ||
        /no such object|not found|404/i.test(String(error?.message ?? error)),
    );
  }
  await assert.rejects(
    () => auth.getUser(PHONE_UID),
    (error) => error.code === "auth/user-not-found",
  );
  await assert.rejects(
    () => storage.bucket(BUCKET).file(STORAGE_PATH).getMetadata(),
    (error) =>
      error?.code === 404 ||
      /no such object|not found|404/i.test(String(error?.message ?? error)),
  );
  assert.equal(
    (await storage.bucket(BUCKET)
      .file("business-cards/other-coop-user/preserve.png")
      .getMetadata())[0].name,
    "business-cards/other-coop-user/preserve.png",
  );
  const masterAfter = (await db.collection("demoCooperativeMaster")
    .doc(DUNGGI_COOPERATIVE_ID).get()).data();
  assert.equal(masterAfter.signupStatus, "AVAILABLE");
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(masterAfter).filter(([key]) =>
        !["signupStatus", "registeredAt", "registeredBy"].includes(key)
      ),
    ),
    Object.fromEntries(
      Object.entries(masterBefore).filter(([key]) =>
        !["signupStatus", "registeredAt", "registeredBy"].includes(key)
      ),
    ),
  );
  assert.equal(
    (await db.collection("users").doc(EMAIL_UID).get()).exists,
    false,
  );
  assert.equal(
    (await db.collection("users").doc("other-coop-user").get()).exists,
    true,
  );
  for (const [collection, id] of [
    ["memberships", "step6-membership"],
    ["tenants", "step6-tenant"],
    ["pointLedger", "step6-ledger"],
    ["point_transactions", "step6-transaction"],
    ["answers", REQUEST_ID],
    ["answerRatings", `${REQUEST_ID}_${EMAIL_UID}`],
    ["quoteRequests", QUOTE_REQUEST_ID],
    ["quotes", QUOTE_ID],
    ["auditEvaluationCases", CASE_ID],
    ["auditEvaluationReportRuns", "step6-report-run"],
  ]) {
    assert.equal((await db.collection(collection).doc(id).get()).exists, false);
  }

  const recreated = await auth.createUser({
    uid: EMAIL_UID,
    email: "step6-customer@example.com",
    password: "Emulator-Only-Password-2!",
  });
  assert.equal(recreated.uid, EMAIL_UID);
  await auth.deleteUser(EMAIL_UID);
});

test("실제 농협의 확정 테스트 데이터만 정리하고 정적 master를 보존한다", async () => {
  const realMasterBefore = structuredClone(
    nonghyupMaster.find(
      (cooperative) => cooperative.cooperative_id === REAL_INSTITUTION_ID,
    ),
  );
  assert.ok(realMasterBefore);
  const marker = {
    dataClassification: "TEST",
    testData: true,
    sourceInstitutionId: REAL_INSTITUTION_ID,
  };
  await Promise.all([
    auth.createUser({
      uid: REAL_TEST_UID,
      email: "real-coop-test@example.com",
      password: "Emulator-Only-Password-3!",
    }),
    db.collection("users").doc(REAL_TEST_UID).set({
      uid: REAL_TEST_UID,
      role: "member",
      cooperativeId: REAL_INSTITUTION_ID,
      businessCardPath: REAL_STORAGE_PATH,
      ...marker,
    }),
    db.collection("organizations").doc(REAL_INSTITUTION_ID).set({
      cooperativeId: REAL_INSTITUTION_ID,
      users: [REAL_TEST_UID],
      walletBalance: 110_000,
      ...marker,
    }),
    db.collection("pointLedger").doc("real-test-ledger").set({
      userId: REAL_TEST_UID,
      cooperativeId: REAL_INSTITUTION_ID,
      points: 110_000,
      ...marker,
    }),
    db.collection("consultRequests").doc("real-test-request").set({
      uid: REAL_TEST_UID,
      cooperativeId: REAL_INSTITUTION_ID,
      ...marker,
    }),
    db.collection("testAuthSubjects").doc(REAL_TEST_UID).set({
      authUid: REAL_TEST_UID,
      primaryUserUid: REAL_TEST_UID,
      providerIds: ["password"],
      ...marker,
    }),
  ]);
  await storage.bucket(BUCKET).file(REAL_STORAGE_PATH).save(
    Buffer.from("real-coop-emulator-card"),
    {
      contentType: "image/png",
      metadata: {
        metadata: {
          dataClassification: "TEST",
          sourceInstitutionId: REAL_INSTITUTION_ID,
          ownerUid: REAL_TEST_UID,
        },
      },
    },
  );

  const now = new Date().toISOString();
  const scanner = new PurgeScanService(
    new FirestorePurgeScanDataSource(db, auth, storage),
  );
  const manifest = await scanner.scan({
    institutionId: REAL_INSTITUTION_ID,
    mode: "DRY_RUN",
    generatedBy: "emulator-super-admin",
    environment: "emulator",
    projectId: PROJECT_ID,
    now,
  });
  assert.equal(manifest.executionStatus, "DRY_RUN_READY");
  assert.deepEqual(manifest.resetFields, []);
  assert.equal(
    manifest.preservedItems.some(
      (item) =>
        item.resourcePath ===
        `static:nonghyupMaster/${REAL_INSTITUTION_ID}`,
    ),
    true,
  );

  const service = new PurgeApplyService({
    store: new FirestorePurgeControlStore(db),
    executor: new FirestorePurgeExecutor(db),
    externalExecutor: new FirebasePurgeExternalExecutor(db, auth, storage),
    orphanVerifier: new FirebasePurgeOrphanVerifier(db, auth, storage),
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
    environment: "emulator",
    projectId: PROJECT_ID,
    now,
  });
  const result = await service.apply({
    manifestId: manifest.manifestId,
    confirmation: expectedPurgeConfirmation(manifest),
    requestedBy: "emulator-super-admin",
    requestId: "real-coop-emulator-request",
    environment: "emulator",
    projectId: PROJECT_ID,
    now,
  });
  assert.equal(result.job.status, "COMPLETED");
  assert.equal(result.job.resetResult.status, "NOT_REQUIRED");
  assert.equal(result.job.resetResult.masterPreserved, true);
  assert.deepEqual(
    nonghyupMaster.find(
      (cooperative) => cooperative.cooperative_id === REAL_INSTITUTION_ID,
    ),
    realMasterBefore,
  );
  assert.equal(
    (await db.collection("organizations")
      .doc(REAL_INSTITUTION_ID).get()).exists,
    false,
  );
  await assert.rejects(
    () => auth.getUser(REAL_TEST_UID),
    (error) => error.code === "auth/user-not-found",
  );
  await assert.rejects(
    () => storage.bucket(BUCKET).file(REAL_STORAGE_PATH).getMetadata(),
    (error) =>
      error?.code === 404 ||
      /no such object|not found|404/i.test(String(error?.message ?? error)),
  );
  const recreated = await auth.createUser({
    uid: REAL_TEST_UID,
    email: "real-coop-test@example.com",
    password: "Emulator-Only-Password-4!",
  });
  assert.equal(recreated.uid, REAL_TEST_UID);
  await auth.deleteUser(REAL_TEST_UID);
});

test("실제 데이터가 혼재하면 manifest와 관리자 실행 정책이 BLOCKED다", async () => {
  const testUid = "mixed-test-user";
  const realUid = "mixed-real-user";
  await Promise.all([
    db.collection("users").doc(testUid).set({
      uid: testUid,
      cooperativeId: DUNGGI_COOPERATIVE_ID,
      dataClassification: "DEMO",
      sourceInstitutionId: DUNGGI_COOPERATIVE_ID,
    }),
    db.collection("users").doc(realUid).set({
      uid: realUid,
      cooperativeId: DUNGGI_COOPERATIVE_ID,
      dataClassification: "PRODUCTION",
    }),
    db.collection("organizations").doc(DUNGGI_COOPERATIVE_ID).set({
      cooperativeId: DUNGGI_COOPERATIVE_ID,
      users: [testUid, realUid],
      dataClassification: "DEMO",
      sourceInstitutionId: DUNGGI_COOPERATIVE_ID,
    }),
  ]);
  const scanner = new PurgeScanService(
    new FirestorePurgeScanDataSource(db, auth, storage),
  );
  const now = new Date().toISOString();
  const manifest = await scanner.scan({
    institutionId: DUNGGI_COOPERATIVE_ID,
    mode: "DRY_RUN",
    generatedBy: "emulator-super-admin",
    environment: "emulator",
    projectId: PROJECT_ID,
    now,
  });
  assert.equal(manifest.executionStatus, "BLOCKED");
  assert.equal(
    manifest.blockedReasons.includes("MIXED_ORGANIZATION_USERS"),
    true,
  );
  assert.equal(
    getTestDataExecutionBlockers(
      manifest,
      null,
      Date.parse(now),
    ).includes("MIXED_ORGANIZATION_USERS"),
    true,
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
  await assert.rejects(
    () =>
      service.registerManifest({
        manifest,
        approvedBy: "emulator-super-admin",
        environment: "emulator",
        projectId: PROJECT_ID,
        now,
      }),
    (error) =>
      error instanceof PurgeApplyError &&
      error.code === "manifest_not_ready",
  );
  await Promise.all([
    db.collection("users").doc(testUid).delete(),
    db.collection("users").doc(realUid).delete(),
    db.collection("organizations").doc(DUNGGI_COOPERATIVE_ID).delete(),
  ]);
});

test("Storage 일시 실패 후 같은 manifest와 job으로 멱등 재실행한다", async () => {
  const uid = "retry-test-user";
  const objectPath = `business-cards/${uid}/card.png`;
  const marker = {
    dataClassification: "DEMO",
    sourceInstitutionId: DUNGGI_COOPERATIVE_ID,
    testScenarioId: "dunggi-signup-v1",
  };
  await Promise.all([
    db.collection("demoCooperativeMaster")
      .doc(DUNGGI_COOPERATIVE_ID)
      .update({ signupStatus: "REGISTERED" }),
    auth.createUser({
      uid,
      email: "retry-test@example.com",
      password: "Emulator-Only-Password-5!",
    }),
    db.collection("users").doc(uid).set({
      uid,
      role: "member",
      cooperativeId: DUNGGI_COOPERATIVE_ID,
      businessCardPath: objectPath,
      ...marker,
    }),
    db.collection("organizations").doc(DUNGGI_COOPERATIVE_ID).set({
      cooperativeId: DUNGGI_COOPERATIVE_ID,
      users: [uid],
      walletBalance: 110_000,
      ...marker,
    }),
    db.collection("testAuthSubjects").doc(uid).set({
      authUid: uid,
      primaryUserUid: uid,
      providerIds: ["password"],
      ...marker,
    }),
  ]);
  await storage.bucket(BUCKET).file(objectPath).save(
    Buffer.from("retry-emulator-card"),
    {
      contentType: "image/png",
      metadata: {
        metadata: {
          dataClassification: "DEMO",
          sourceInstitutionId: DUNGGI_COOPERATIVE_ID,
          ownerUid: uid,
        },
      },
    },
  );

  const now = new Date().toISOString();
  const scanner = new PurgeScanService(
    new FirestorePurgeScanDataSource(db, auth, storage),
  );
  const manifest = await scanner.scan({
    institutionId: DUNGGI_COOPERATIVE_ID,
    mode: "DRY_RUN",
    generatedBy: "emulator-super-admin",
    environment: "emulator",
    projectId: PROJECT_ID,
    now,
  });
  const delegate = new FirebasePurgeExternalExecutor(db, auth, storage);
  let failStorageOnce = true;
  const externalExecutor = {
    validateAuthTarget: (...args) => delegate.validateAuthTarget(...args),
    disableAuthUser: (...args) => delegate.disableAuthUser(...args),
    revokeAuthSessions: (...args) => delegate.revokeAuthSessions(...args),
    deleteAuthUser: (...args) => delegate.deleteAuthUser(...args),
    validateStorageTarget: (...args) =>
      delegate.validateStorageTarget(...args),
    deleteStorageObject: (...args) => {
      if (failStorageOnce) {
        failStorageOnce = false;
        return Promise.resolve({
          status: "FAILED",
          code: "storage/unavailable",
          retryable: true,
        });
      }
      return delegate.deleteStorageObject(...args);
    },
  };
  const service = new PurgeApplyService({
    store: new FirestorePurgeControlStore(db),
    executor: new FirestorePurgeExecutor(db),
    externalExecutor,
    orphanVerifier: new FirebasePurgeOrphanVerifier(db, auth, storage),
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
    environment: "emulator",
    projectId: PROJECT_ID,
    now,
  });
  const confirmation = expectedPurgeConfirmation(manifest);
  const first = await service.apply({
    manifestId: manifest.manifestId,
    confirmation,
    requestedBy: "emulator-super-admin",
    requestId: "retry-emulator-request-1",
    environment: "emulator",
    projectId: PROJECT_ID,
    now,
  });
  assert.equal(first.job.status, "PARTIALLY_FAILED");
  assert.equal(first.job.currentPhase, "DELETE_STORAGE_OBJECTS");
  assert.equal(
    (await db.collection("demoCooperativeMaster")
      .doc(DUNGGI_COOPERATIVE_ID).get()).data().signupStatus,
    "REGISTERED",
  );
  assert.equal((await auth.getUser(uid)).disabled, true);

  const second = await service.apply({
    manifestId: manifest.manifestId,
    confirmation,
    requestedBy: "emulator-super-admin",
    requestId: "retry-emulator-request-2",
    environment: "emulator",
    projectId: PROJECT_ID,
    now: new Date(Date.parse(now) + 1_000).toISOString(),
  });
  assert.equal(second.job.status, "COMPLETED");
  assert.equal(second.job.attemptCount, 2);
  assert.equal(second.job.purgeJobId, first.job.purgeJobId);

  const replay = await service.apply({
    manifestId: manifest.manifestId,
    confirmation,
    requestedBy: "emulator-super-admin",
    requestId: "retry-emulator-request-3",
    environment: "emulator",
    projectId: PROJECT_ID,
    now: new Date(Date.parse(now) + 2_000).toISOString(),
  });
  assert.equal(replay.job.status, "COMPLETED");
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.job.purgeJobId, first.job.purgeJobId);
});
