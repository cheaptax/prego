import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDunggiCooperativeMaster,
  DUNGGI_COOPERATIVE_ID,
} from "@/lib/cooperatives/demo-cooperative";
import {
  PurgeApplyError,
  PurgeApplyService,
} from "@/lib/test-data/purge-apply-service";
import { createPurgeApplyHandlers } from "@/lib/test-data/purge-apply-api";
import { PurgeStoreError } from "@/lib/test-data/purge-firestore-executor";
import type {
  PurgeAuditRecord,
  PurgeControlStore,
  PurgeDocumentDeleteResult,
  PurgeExternalExecutor,
  PurgeExternalOperationResult,
  PurgeFirestoreExecutor,
  PurgeJobRecord,
  PurgeOrphanVerificationReport,
  PurgeOrphanVerifier,
  PurgeResetResult,
  RegisteredPurgeManifest,
} from "@/lib/test-data/purge-job-types";
import { buildPurgeManifest } from "@/lib/test-data/purge-manifest";
import { isActivePurgeLock } from "@/lib/test-data/purge-lock";
import { PurgeScanService } from "@/lib/test-data/purge-scan-service";
import type {
  PurgeManifest,
  PurgeManifestItem,
  ScanDocument,
  ScanSnapshot,
} from "@/lib/test-data/purge-types";

const NOW = "2026-07-22T15:00:00.000Z";
const PROJECT_ID = "demo-step5-purge";

test("purge lock lease 만료 후 신규 write를 영구 차단하지 않는다", () => {
  assert.equal(
    isActivePurgeLock(
      {
        status: "ACTIVE",
        leaseExpiresAt: "2026-07-22T15:05:00.000Z",
      },
      Date.parse("2026-07-22T15:04:59.000Z"),
    ),
    true,
  );
  assert.equal(
    isActivePurgeLock(
      {
        status: "ACTIVE",
        leaseExpiresAt: "2026-07-22T15:05:00.000Z",
      },
      Date.parse("2026-07-22T15:05:00.000Z"),
    ),
    false,
  );
});

function document(
  collection: string,
  id: string,
  data: Record<string, unknown>,
  changeToken = `${collection}-${id}-v1`,
): ScanDocument {
  return {
    collection,
    id,
    path: `${collection}/${id}`,
    data,
    changeToken,
    relationships: [`fixture:${id}`],
    crossInstitutionIds: [],
  };
}

function demoSnapshot(documents: ScanDocument[]): ScanSnapshot {
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
      masterChangeToken: `master-${master.signupStatus}`,
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

function realSnapshot(documents: ScanDocument[]): ScanSnapshot {
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

class MemoryControlStore implements PurgeControlStore {
  readonly manifests = new Map<string, RegisteredPurgeManifest>();
  readonly jobs = new Map<string, PurgeJobRecord>();
  readonly audits: PurgeAuditRecord[] = [];
  released = false;
  failAuditOnce = false;

  async registerManifest(record: RegisteredPurgeManifest) {
    const existing = this.manifests.get(record.manifest.manifestId);
    if (existing) return existing;
    this.manifests.set(record.manifest.manifestId, structuredClone(record));
    return record;
  }

  async getManifest(manifestId: string) {
    return this.manifests.get(manifestId) ?? null;
  }

  async beginOrResumeJob(input: {
    manifest: PurgeManifest;
    requestedBy: string;
    requestedByEmail?: string;
    requestId: string;
    now: string;
    lockLeaseExpiresAt: string;
  }) {
    const jobId = `job-${input.manifest.manifestId}`;
    const existing = this.jobs.get(jobId);
    if (existing) {
      if (
        existing.status === "COMPLETED" ||
        (existing.status === "PARTIALLY_FAILED" &&
          existing.currentPhase === "AWAITING_AUTH_STORAGE")
      ) {
        return { job: structuredClone(existing), idempotentReplay: true };
      }
      if (existing.status === "RUNNING" || existing.status === "VALIDATING") {
        throw new PurgeStoreError("manifest_already_running", 409);
      }
      if (existing.status === "BLOCKED" || existing.status === "CANCELLED") {
        throw new PurgeStoreError("purge_job_not_resumable", 409);
      }
      const resumed = {
        ...existing,
        status: "VALIDATING" as const,
        currentPhase: "VALIDATING_MANIFEST" as const,
        attemptCount: existing.attemptCount + 1,
        requestId: input.requestId,
        updatedAt: input.now,
      };
      this.jobs.set(jobId, structuredClone(resumed));
      return { job: resumed, idempotentReplay: false };
    }
    const total = Object.values(input.manifest.targetsByCollection).flat().length;
    const job: PurgeJobRecord = {
      schemaVersion: 1,
      purgeJobId: jobId,
      manifestId: input.manifest.manifestId,
      manifestChecksum: input.manifest.checksum,
      institutionId: input.manifest.institutionId,
      institutionName: input.manifest.institutionName,
      requestedBy: input.requestedBy,
      requestedByEmail: input.requestedByEmail,
      requestId: input.requestId,
      status: "VALIDATING",
      currentPhase: "VALIDATING_MANIFEST",
      createdAt: input.now,
      startedAt: input.now,
      updatedAt: input.now,
      attemptCount: 1,
      progress: {
        totalFirestoreTargets: total,
        processedFirestoreTargets: 0,
        deferredStep6Targets: 0,
      },
      deletedCounts: {},
      itemResults: {},
      failedItems: [],
      resetResult: {
        status: "NOT_STARTED",
        resetFields: [],
        masterPreserved: true,
      },
      pendingAuthUids: input.manifest.authUsers
        .filter((item) => item.classification === "CONFIRMED_TEST")
        .map((item) => item.uid),
      pendingStoragePaths: input.manifest.storageObjects
        .filter((item) => item.classification === "CONFIRMED_TEST")
        .map((item) => item.path),
    };
    this.jobs.set(jobId, structuredClone(job));
    return { job, idempotentReplay: false };
  }

  async updateJob(job: PurgeJobRecord) {
    this.jobs.set(job.purgeJobId, structuredClone(job));
  }

  async releaseLock() {
    this.released = true;
  }

  async writeAudit(record: PurgeAuditRecord) {
    if (this.failAuditOnce) {
      this.failAuditOnce = false;
      throw new Error("audit_write_failed");
    }
    this.audits.push(structuredClone(record));
  }
}

class MemoryExecutor implements PurgeFirestoreExecutor {
  readonly documents = new Map<string, ScanDocument>();
  readonly otherInstitutionDocuments = new Set(["users/other-coop-user"]);
  readonly deleteOrder: string[] = [];
  failOncePath = "";
  master = { signupStatus: "REGISTERED", name: "둥기농협" };

  constructor(documents: ScanDocument[]) {
    documents.forEach((item) => this.documents.set(item.path, structuredClone(item)));
  }

  async deleteManifestItem(
    item: PurgeManifestItem,
  ): Promise<PurgeDocumentDeleteResult> {
    this.deleteOrder.push(item.resourcePath);
    if (this.failOncePath === item.resourcePath) {
      this.failOncePath = "";
      return { status: "FAILED", code: "unavailable", retryable: true };
    }
    const current = this.documents.get(item.resourcePath);
    if (!current) return { status: "NOT_FOUND" };
    if (current.changeToken !== item.changeToken) return { status: "STALE" };
    this.documents.delete(item.resourcePath);
    return { status: "DELETED" };
  }

  async resetInstitution(
    manifest: PurgeManifest,
    _actorId: string,
    now: string,
  ): Promise<PurgeResetResult> {
    if (manifest.isDemoInstitution) {
      this.master.signupStatus = "AVAILABLE";
      return {
        status: "APPLIED",
        resetFields: ["signupStatus"],
        masterPreserved: true,
        completedAt: now,
      };
    }
    return {
      status: "NOT_REQUIRED",
      resetFields: [],
      masterPreserved: true,
      completedAt: now,
    };
  }
}

class MemoryExternalExecutor implements PurgeExternalExecutor {
  readonly authUsers = new Set<string>();
  readonly disabledUsers = new Set<string>();
  readonly revokedUsers = new Set<string>();
  readonly storageObjects = new Set<string>();
  readonly operations: string[] = [];
  blockAuthUid = "";
  failStorageOncePath = "";
  failAuthDeleteOnceUid = "";

  validateAuthTarget(
    _manifest: PurgeManifest,
    uid: string,
  ): Promise<PurgeExternalOperationResult> {
    this.operations.push(`validate-auth:${uid}`);
    if (this.blockAuthUid === uid) {
      return Promise.resolve({
        status: "BLOCKED",
        code: "auth_uid_operator_role",
      });
    }
    return Promise.resolve({ status: "SUCCESS" });
  }

  disableAuthUser(uid: string): Promise<PurgeExternalOperationResult> {
    this.operations.push(`disable:${uid}`);
    if (!this.authUsers.has(uid)) {
      return Promise.resolve({ status: "NOT_FOUND" });
    }
    this.disabledUsers.add(uid);
    return Promise.resolve({ status: "SUCCESS" });
  }

  revokeAuthSessions(uid: string): Promise<PurgeExternalOperationResult> {
    this.operations.push(`revoke:${uid}`);
    if (!this.authUsers.has(uid)) {
      return Promise.resolve({ status: "NOT_FOUND" });
    }
    this.revokedUsers.add(uid);
    return Promise.resolve({ status: "SUCCESS" });
  }

  deleteAuthUser(uid: string): Promise<PurgeExternalOperationResult> {
    this.operations.push(`delete-auth:${uid}`);
    if (this.failAuthDeleteOnceUid === uid) {
      this.failAuthDeleteOnceUid = "";
      return Promise.resolve({
        status: "FAILED",
        code: "auth/internal-error",
        retryable: true,
      });
    }
    if (!this.authUsers.delete(uid)) {
      return Promise.resolve({ status: "NOT_FOUND" });
    }
    return Promise.resolve({ status: "SUCCESS" });
  }

  validateStorageTarget(
    _manifest: PurgeManifest,
    path: string,
  ): Promise<PurgeExternalOperationResult> {
    this.operations.push(`validate-storage:${path}`);
    return Promise.resolve(
      this.storageObjects.has(path)
        ? { status: "SUCCESS" }
        : { status: "NOT_FOUND" },
    );
  }

  deleteStorageObject(
    _manifest: PurgeManifest,
    path: string,
  ): Promise<PurgeExternalOperationResult> {
    this.operations.push(`delete-storage:${path}`);
    if (this.failStorageOncePath === path) {
      this.failStorageOncePath = "";
      return Promise.resolve({
        status: "FAILED",
        code: "storage/unavailable",
        retryable: true,
      });
    }
    if (!this.storageObjects.delete(path)) {
      return Promise.resolve({ status: "NOT_FOUND" });
    }
    return Promise.resolve({ status: "SUCCESS" });
  }
}

class MemoryOrphanVerifier implements PurgeOrphanVerifier {
  report: PurgeOrphanVerificationReport = {
    generatedAt: NOW,
    checks: { all: 1 },
    findings: [],
    blockerCount: 0,
    passed: true,
  };

  async verify() {
    return structuredClone(this.report);
  }
}

function fixture(options?: {
  real?: boolean;
  externalPending?: boolean;
  integrated?: boolean;
  maxItemsPerRun?: number;
  enabled?: boolean;
  productionEnabled?: boolean;
  allowedProjectId?: string;
}) {
  const institutionId = options?.real ? "coop-001" : DUNGGI_COOPERATIVE_ID;
  const marker = options?.real
    ? { dataClassification: "TEST" }
    : { dataClassification: "DEMO" };
  const documents = [
    document("users", "user-1", {
      uid: "user-1",
      cooperativeId: institutionId,
      ...marker,
    }),
    document("organizations", institutionId, {
      cooperativeId: institutionId,
      users: ["user-1"],
      walletBalance: 110_000,
      ...marker,
    }),
    document("pointLedger", "ledger-1", {
      cooperativeId: institutionId,
      userId: "user-1",
      ...marker,
    }),
    document("consultRequests", "request-1", {
      cooperativeId: institutionId,
      uid: "user-1",
      ...marker,
    }),
    document("answers", "request-1", {
      requestId: "request-1",
      ...marker,
    }),
  ];
  if (options?.externalPending) {
    documents.push(
      document("testAuthSubjects", "auth-1", {
        authUid: "auth-1",
        primaryUserUid: "user-1",
        providerIds: ["password"],
        ...marker,
      }),
    );
  }
  const executor = new MemoryExecutor(documents);
  const snapshot = () => {
    const currentDocuments = Array.from(executor.documents.values());
    const value = options?.real
      ? realSnapshot(currentDocuments)
      : demoSnapshot(currentDocuments);
    if (options?.externalPending) {
      value.authUserMetadata["auth-1"] = {
        exists: true,
        providerIds: ["password"],
        changeToken: "auth-v1",
      };
      value.storageObjectMetadata["business-cards/user-1/card.png"] = {
        exists: true,
        bucket: "demo-bucket",
        generation: "1",
        size: 10,
      };
      const user = value.documents.find((item) => item.path === "users/user-1");
      if (user) user.data.businessCardPath = "business-cards/user-1/card.png";
    }
    return value;
  };
  const initialSnapshot = snapshot();
  const manifest = buildPurgeManifest(
    {
      institutionId,
      mode: "DRY_RUN",
      generatedBy: "super-admin",
      environment: "test",
      projectId: PROJECT_ID,
      now: NOW,
    },
    initialSnapshot,
  );
  const store = new MemoryControlStore();
  const externalExecutor = new MemoryExternalExecutor();
  manifest.authUsers
    .filter(
      (item) =>
        item.classification === "CONFIRMED_TEST" &&
        item.exists !== false,
    )
    .forEach((item) => externalExecutor.authUsers.add(item.uid));
  manifest.storageObjects
    .filter(
      (item) =>
        item.classification === "CONFIRMED_TEST" &&
        item.exists !== false,
    )
    .forEach((item) => externalExecutor.storageObjects.add(item.path));
  const orphanVerifier = new MemoryOrphanVerifier();
  const scanner = new PurgeScanService({ loadSnapshot: async () => snapshot() });
  const service = new PurgeApplyService({
    store,
    executor,
    scanner,
    externalExecutor: options?.integrated ? externalExecutor : undefined,
    orphanVerifier: options?.integrated ? orphanVerifier : undefined,
    configuration: {
      enabled: options?.enabled ?? true,
      productionEnabled: options?.productionEnabled ?? false,
      allowedProjectId: options?.allowedProjectId ?? PROJECT_ID,
      maxItemsPerRun: options?.maxItemsPerRun ?? 250,
    },
  });
  return {
    service,
    store,
    executor,
    externalExecutor,
    orphanVerifier,
    manifest,
    snapshot,
  };
}

async function approveAndApply(
  context: ReturnType<typeof fixture>,
  manifest = context.manifest,
) {
  await context.service.registerManifest({
    manifest,
    approvedBy: "super-admin",
    approvedByEmail: "admin@example.com",
    environment: "test",
    projectId: PROJECT_ID,
    now: NOW,
  });
  return context.service.apply({
    manifestId: manifest.manifestId,
    confirmation: manifest.isDemoInstitution
      ? "DELETE TEST DATA: 둥기농협"
      : "DELETE TEST DATA: 서울축산농협 [coop-001]",
    requestedBy: "super-admin",
    requestedByEmail: "admin@example.com",
    requestId: "request-1",
    environment: "test",
    projectId: PROJECT_ID,
    now: NOW,
  });
}

test("둥기농협 Firestore graph 삭제 후 external 대기 중 master를 보존한다", async () => {
  const context = fixture();
  const result = await approveAndApply(context);
  assert.equal(result.job.status, "PARTIALLY_FAILED");
  assert.equal(result.job.currentPhase, "AWAITING_AUTH_STORAGE");
  assert.equal(context.executor.documents.size, 0);
  assert.equal(context.executor.master.name, "둥기농협");
  assert.equal(context.executor.master.signupStatus, "REGISTERED");
  assert.equal(context.executor.otherInstitutionDocuments.has("users/other-coop-user"), true);
  assert.ok(
    context.executor.deleteOrder.indexOf("answers/request-1") <
      context.executor.deleteOrder.indexOf("consultRequests/request-1"),
  );
  assert.ok(
    context.executor.deleteOrder.indexOf("users/user-1") <
      context.executor.deleteOrder.indexOf(
        `organizations/${DUNGGI_COOPERATIVE_ID}`,
      ),
  );
  assert.equal(context.store.released, false);
  assert.equal(context.store.audits.at(-1)?.resultStatus, "PARTIALLY_FAILED");
  assert.equal("actorEmail" in (context.store.audits.at(-1) ?? {}), false);
});

test("실제 정적 농협 master는 변경하지 않고 사용 데이터만 삭제한다", async () => {
  const context = fixture({ real: true });
  const result = await approveAndApply(context);
  assert.equal(result.job.status, "PARTIALLY_FAILED");
  assert.equal(result.job.currentPhase, "AWAITING_AUTH_STORAGE");
  assert.equal(result.job.resetResult.status, "NOT_STARTED");
  assert.deepEqual(result.job.resetResult.resetFields, []);
});

test("Auth·Storage 대상은 STEP 6으로 남기고 완료 처리하지 않는다", async () => {
  const context = fixture({ externalPending: true });
  const result = await approveAndApply(context);
  assert.equal(result.job.status, "PARTIALLY_FAILED");
  assert.equal(result.job.currentPhase, "AWAITING_AUTH_STORAGE");
  assert.deepEqual(result.job.pendingAuthUids, ["auth-1", "user-1"]);
  assert.deepEqual(
    result.job.pendingStoragePaths,
    ["business-cards/user-1/card.png"],
  );
  assert.equal(
    context.executor.documents.has("testAuthSubjects/auth-1"),
    true,
  );
  assert.equal(context.store.released, false);
});

test("STEP 6은 Auth 차단·세션 revoke·Storage·Auth 삭제 후 master를 복원하고 완료한다", async () => {
  const context = fixture({ externalPending: true, integrated: true });
  context.externalExecutor.storageObjects.add("business-cards/other/card.png");
  const result = await approveAndApply(context);

  assert.equal(result.job.status, "COMPLETED");
  assert.equal(result.job.currentPhase, "COMPLETE");
  assert.equal(context.executor.documents.size, 0);
  assert.equal(context.executor.master.signupStatus, "AVAILABLE");
  assert.equal(context.store.released, true);
  assert.deepEqual(result.job.pendingAuthUids, []);
  assert.deepEqual(result.job.pendingStoragePaths, []);
  assert.equal(result.job.orphanVerification?.passed, true);
  assert.equal(
    context.externalExecutor.storageObjects.has(
      "business-cards/other/card.png",
    ),
    true,
  );
  assert.ok(
    context.externalExecutor.operations.indexOf("disable:auth-1") <
      context.externalExecutor.operations.indexOf("revoke:auth-1"),
  );
  assert.ok(
    context.externalExecutor.operations.indexOf("revoke:auth-1") <
      context.externalExecutor.operations.indexOf(
        "delete-storage:business-cards/user-1/card.png",
      ),
  );
  assert.ok(
    context.externalExecutor.operations.indexOf(
      "delete-storage:business-cards/user-1/card.png",
    ) <
      context.externalExecutor.operations.indexOf("delete-auth:auth-1"),
  );
  for (const phase of [
    "DISABLE_AUTH_USERS",
    "REVOKE_SESSIONS",
    "DELETE_FIRESTORE_DATA",
    "DELETE_STORAGE_OBJECTS",
    "DELETE_AUTH_USERS",
    "RESET_INSTITUTION",
    "VERIFY_ORPHANS",
    "COMPLETE",
  ] as const) {
    assert.ok(result.job.phaseResults?.[phase]?.startedAt);
    assert.ok(result.job.phaseResults?.[phase]?.completedAt);
  }
});

test("감사 로그 저장 실패는 완료·lock 해제를 막고 같은 job 재시도를 허용한다", async () => {
  const context = fixture({ externalPending: true, integrated: true });
  context.store.failAuditOnce = true;
  await context.service.registerManifest({
    manifest: context.manifest,
    approvedBy: "admin",
    environment: "test",
    projectId: PROJECT_ID,
    now: NOW,
  });
  await assert.rejects(
    () =>
      context.service.apply({
        manifestId: context.manifest.manifestId,
        confirmation: "DELETE TEST DATA: 둥기농협",
        requestedBy: "admin",
        requestId: "audit-attempt-1",
        environment: "test",
        projectId: PROJECT_ID,
        now: NOW,
      }),
    (error) =>
      error instanceof PurgeApplyError &&
      error.code === "purge_audit_write_failed",
  );
  const failedJob = Array.from(context.store.jobs.values())[0];
  assert.equal(failedJob.status, "PARTIALLY_FAILED");
  assert.equal(failedJob.currentPhase, "FINALIZING");
  assert.equal(context.store.released, false);

  const retried = await context.service.apply({
    manifestId: context.manifest.manifestId,
    confirmation: "DELETE TEST DATA: 둥기농협",
    requestedBy: "admin",
    requestId: "audit-attempt-2",
    environment: "test",
    projectId: PROJECT_ID,
    now: "2026-07-22T15:01:00.000Z",
  });
  assert.equal(retried.job.status, "COMPLETED");
  assert.equal(retried.job.attemptCount, 2);
  assert.equal(context.store.released, true);
});

test("운영자·다중 조직 Auth와 공유 Storage 후보는 manifest 단계에서 차단한다", () => {
  const adminManifest = buildPurgeManifest(
    {
      institutionId: DUNGGI_COOPERATIVE_ID,
      mode: "DRY_RUN",
      generatedBy: "admin",
      environment: "test",
      projectId: PROJECT_ID,
      now: NOW,
    },
    demoSnapshot([
      document("users", "operator-1", {
        uid: "operator-1",
        cooperativeId: DUNGGI_COOPERATIVE_ID,
        role: "admin",
        dataClassification: "DEMO",
      }),
      document("organizations", DUNGGI_COOPERATIVE_ID, {
        cooperativeId: DUNGGI_COOPERATIVE_ID,
        users: ["operator-1"],
        dataClassification: "DEMO",
      }),
      document("organizations", "coop-999", {
        cooperativeId: "coop-999",
        users: ["operator-1"],
        dataClassification: "DEMO",
      }),
    ]),
  );
  assert.equal(adminManifest.executionStatus, "BLOCKED");
  assert.ok(adminManifest.blockedReasons.includes("AUTH_IDENTITY_CONFLICT"));
  assert.ok(
    adminManifest.blockedReasons.includes("MULTI_INSTITUTION_AUTH_USER"),
  );

  const sharedStorageSnapshot = demoSnapshot([
    document("users", "user-1", {
      uid: "user-1",
      cooperativeId: DUNGGI_COOPERATIVE_ID,
      businessCardPath: "business-cards/user-1/shared.png",
      dataClassification: "DEMO",
    }),
    document("consultRequests", "request-1", {
      uid: "user-1",
      cooperativeId: DUNGGI_COOPERATIVE_ID,
      storagePath: "business-cards/user-1/shared.png",
      dataClassification: "DEMO",
    }),
  ]);
  sharedStorageSnapshot.storageObjectMetadata[
    "business-cards/user-1/shared.png"
  ] = {
    exists: true,
    bucket: "demo-bucket",
    generation: "1",
  };
  const sharedStorageManifest = buildPurgeManifest(
    {
      institutionId: DUNGGI_COOPERATIVE_ID,
      mode: "DRY_RUN",
      generatedBy: "admin",
      environment: "test",
      projectId: PROJECT_ID,
      now: NOW,
    },
    sharedStorageSnapshot,
  );
  assert.equal(sharedStorageManifest.executionStatus, "BLOCKED");
  assert.ok(
    sharedStorageManifest.blockedReasons.includes("SHARED_STORAGE_OBJECT"),
  );
});

test("Storage 중간 실패는 Auth를 삭제하거나 master를 복원하지 않고 같은 phase부터 재시도한다", async () => {
  const context = fixture({ externalPending: true, integrated: true });
  const storagePath = "business-cards/user-1/card.png";
  context.externalExecutor.failStorageOncePath = storagePath;
  await context.service.registerManifest({
    manifest: context.manifest,
    approvedBy: "admin",
    environment: "test",
    projectId: PROJECT_ID,
    now: NOW,
  });
  const first = await context.service.apply({
    manifestId: context.manifest.manifestId,
    confirmation: "DELETE TEST DATA: 둥기농협",
    requestedBy: "admin",
    requestId: "storage-attempt-1",
    environment: "test",
    projectId: PROJECT_ID,
    now: NOW,
  });
  assert.equal(first.job.status, "PARTIALLY_FAILED");
  assert.equal(first.job.currentPhase, "DELETE_STORAGE_OBJECTS");
  assert.equal(context.executor.master.signupStatus, "REGISTERED");
  assert.equal(context.externalExecutor.authUsers.has("auth-1"), true);
  assert.equal(context.externalExecutor.disabledUsers.has("auth-1"), true);
  assert.equal(context.externalExecutor.revokedUsers.has("auth-1"), true);

  const second = await context.service.apply({
    manifestId: context.manifest.manifestId,
    confirmation: "DELETE TEST DATA: 둥기농협",
    requestedBy: "admin",
    requestId: "storage-attempt-2",
    environment: "test",
    projectId: PROJECT_ID,
    now: "2026-07-22T15:01:00.000Z",
  });
  assert.equal(second.job.status, "COMPLETED");
  assert.equal(second.job.attemptCount, 2);
  assert.equal(context.externalExecutor.authUsers.size, 0);
});

test("Storage 완료 후 Auth 삭제 실패도 멱등 재시도로 완료한다", async () => {
  const context = fixture({ externalPending: true, integrated: true });
  context.externalExecutor.failAuthDeleteOnceUid = "auth-1";
  const first = await approveAndApply(context);
  assert.equal(first.job.status, "PARTIALLY_FAILED");
  assert.equal(first.job.currentPhase, "DELETE_AUTH_USERS");
  assert.equal(context.externalExecutor.storageObjects.size, 0);
  assert.equal(context.executor.master.signupStatus, "REGISTERED");

  const second = await context.service.apply({
    manifestId: context.manifest.manifestId,
    confirmation: "DELETE TEST DATA: 둥기농협",
    requestedBy: "admin",
    requestId: "auth-attempt-2",
    environment: "test",
    projectId: PROJECT_ID,
    now: "2026-07-22T15:01:00.000Z",
  });
  assert.equal(second.job.status, "COMPLETED");
  assert.equal(context.executor.master.signupStatus, "AVAILABLE");
});

test("이미 없는 Auth·Storage는 멱등 성공으로 처리한다", async () => {
  const context = fixture({ externalPending: true, integrated: true });
  context.externalExecutor.authUsers.clear();
  context.externalExecutor.storageObjects.clear();
  const result = await approveAndApply(context);
  assert.equal(result.job.status, "COMPLETED");
  assert.equal(
    result.job.storageResults?.["business-cards/user-1/card.png"],
    "NOT_FOUND",
  );
  assert.equal(result.job.authResults?.["auth-1"]?.deleted, "NOT_FOUND");
});

test("manifest 이후 신규 파일 또는 고아 데이터가 발견되면 최종 완료와 lock 해제를 차단한다", async () => {
  const context = fixture({ externalPending: true, integrated: true });
  context.orphanVerifier.report = {
    generatedAt: NOW,
    checks: { storagePrefixes: 1 },
    findings: [
      {
        type: "NEW_UNCONFIRMED_DATA",
        resourcePath: "gs://demo-bucket/business-cards/user-1/new.png",
        severity: "BLOCKER",
        detailCode: "new_storage_object_outside_manifest",
      },
    ],
    blockerCount: 1,
    passed: false,
  };
  const result = await approveAndApply(context);
  assert.equal(result.job.status, "BLOCKED");
  assert.equal(result.job.currentPhase, "VERIFY_ORPHANS");
  assert.equal(result.job.orphanVerification?.blockerCount, 1);
  assert.equal(context.store.released, false);
});

test("실제 농협도 master 무변경·사용 데이터 0건·lock 해제로 재가입 가능 상태를 만든다", async () => {
  const context = fixture({
    real: true,
    externalPending: true,
    integrated: true,
  });
  const result = await approveAndApply(context);
  assert.equal(result.job.status, "COMPLETED");
  assert.equal(result.job.resetResult.status, "NOT_REQUIRED");
  assert.equal(context.executor.documents.size, 0);
  assert.equal(context.store.released, true);
});

test("REVIEW_REQUIRED와 BLOCKED manifest는 APPLY 전에 차단한다", async () => {
  const review = fixture();
  const reviewManifest = structuredClone(review.manifest);
  reviewManifest.reviewByCollection.users = [
    {
      ...Object.values(reviewManifest.targetsByCollection).flat()[0],
      classification: "REVIEW_REQUIRED",
    },
  ];
  review.store.manifests.set(reviewManifest.manifestId, {
    manifest: reviewManifest,
    approvedBy: "admin",
    approvedAt: NOW,
  });
  await assert.rejects(
    () => approveAndApply(review, reviewManifest),
    (error) =>
      error instanceof PurgeApplyError &&
      error.code === "manifest_review_required",
  );

  const blocked = fixture();
  const blockedManifest = structuredClone(blocked.manifest);
  blockedManifest.executionStatus = "BLOCKED";
  blockedManifest.blockedReasons = ["BROKEN_REFERENCE"];
  blocked.store.manifests.set(blockedManifest.manifestId, {
    manifest: blockedManifest,
    approvedBy: "admin",
    approvedAt: NOW,
  });
  await assert.rejects(
    () => approveAndApply(blocked, blockedManifest),
    (error) =>
      error instanceof PurgeApplyError && error.code === "manifest_not_ready",
  );
});

test("만료 manifest와 현재 checksum 불일치를 차단한다", async () => {
  const expired = fixture();
  const expiredManifest = structuredClone(expired.manifest);
  expiredManifest.expiresAt = "2026-07-22T14:59:59.000Z";
  expired.store.manifests.set(expiredManifest.manifestId, {
    manifest: expiredManifest,
    approvedBy: "admin",
    approvedAt: NOW,
  });
  await assert.rejects(
    () => approveAndApply(expired, expiredManifest),
    (error) =>
      error instanceof PurgeApplyError && error.code === "manifest_expired",
  );

  const stale = fixture();
  await stale.service.registerManifest({
    manifest: stale.manifest,
    approvedBy: "admin",
    environment: "test",
    projectId: PROJECT_ID,
    now: NOW,
  });
  stale.executor.documents.get("users/user-1")!.changeToken = "changed";
  await assert.rejects(
    () =>
      stale.service.apply({
        manifestId: stale.manifest.manifestId,
        confirmation: "DELETE TEST DATA: 둥기농협",
        requestedBy: "admin",
        requestId: "stale-request",
        environment: "test",
        projectId: PROJECT_ID,
        now: NOW,
      }),
    (error) =>
      error instanceof PurgeApplyError &&
      error.code === "manifest_checksum_mismatch",
  );
  assert.equal(stale.executor.documents.size, 5);
});

test("중간 실패 후 같은 job으로 재실행하고 이미 삭제된 문서는 성공 처리한다", async () => {
  const context = fixture();
  context.executor.failOncePath = "pointLedger/ledger-1";
  await context.service.registerManifest({
    manifest: context.manifest,
    approvedBy: "admin",
    environment: "test",
    projectId: PROJECT_ID,
    now: NOW,
  });
  const first = await context.service.apply({
    manifestId: context.manifest.manifestId,
    confirmation: "DELETE TEST DATA: 둥기농협",
    requestedBy: "admin",
    requestId: "attempt-1",
    environment: "test",
    projectId: PROJECT_ID,
    now: NOW,
  });
  assert.equal(first.job.status, "PARTIALLY_FAILED");
  assert.ok(first.job.progress.processedFirestoreTargets > 0);

  context.executor.documents.delete("pointLedger/ledger-1");
  const second = await context.service.apply({
    manifestId: context.manifest.manifestId,
    confirmation: "DELETE TEST DATA: 둥기농협",
    requestedBy: "admin",
    requestId: "attempt-2",
    environment: "test",
    projectId: PROJECT_ID,
    now: "2026-07-22T15:01:00.000Z",
  });
  assert.equal(second.job.status, "PARTIALLY_FAILED");
  assert.equal(second.job.currentPhase, "AWAITING_AUTH_STORAGE");
  assert.equal(second.job.itemResults["pointLedger/ledger-1"], "NOT_FOUND");
  assert.equal(second.job.attemptCount, 2);
});

test("요청당 처리 한도 이후 같은 job을 이어서 실행한다", async () => {
  const context = fixture({ maxItemsPerRun: 2 });
  await context.service.registerManifest({
    manifest: context.manifest,
    approvedBy: "admin",
    environment: "test",
    projectId: PROJECT_ID,
    now: NOW,
  });
  let result = await context.service.apply({
    manifestId: context.manifest.manifestId,
    confirmation: "DELETE TEST DATA: 둥기농협",
    requestedBy: "admin",
    requestId: "chunk-1",
    environment: "test",
    projectId: PROJECT_ID,
    now: NOW,
  });
  let attempt = 1;
  while (result.continuationRequired && attempt < 10) {
    attempt += 1;
    result = await context.service.apply({
      manifestId: context.manifest.manifestId,
      confirmation: "DELETE TEST DATA: 둥기농협",
      requestedBy: "admin",
      requestId: `chunk-${attempt}`,
      environment: "test",
      projectId: PROJECT_ID,
      now: `2026-07-22T15:0${attempt}:00.000Z`,
    });
  }
  assert.equal(result.job.currentPhase, "AWAITING_AUTH_STORAGE");
  assert.equal(result.job.progress.processedFirestoreTargets, 5);
  assert.ok(result.job.attemptCount > 1);
});

test("실행 중인 동일 manifest의 중복 실행을 차단한다", async () => {
  const context = fixture();
  await context.service.registerManifest({
    manifest: context.manifest,
    approvedBy: "admin",
    environment: "test",
    projectId: PROJECT_ID,
    now: NOW,
  });
  await context.store.beginOrResumeJob({
    manifest: context.manifest,
    requestedBy: "admin",
    requestId: "running-request",
    now: NOW,
    lockLeaseExpiresAt: "2026-07-22T15:05:00.000Z",
  });
  await assert.rejects(
    () =>
      context.service.apply({
        manifestId: context.manifest.manifestId,
        confirmation: "DELETE TEST DATA: 둥기농협",
        requestedBy: "admin",
        requestId: "duplicate-request",
        environment: "test",
        projectId: PROJECT_ID,
        now: NOW,
      }),
    (error) =>
      error instanceof PurgeStoreError &&
      error.code === "manifest_already_running",
  );
});

test("최대 Firestore 삭제 건수 초과 manifest를 차단한다", async () => {
  const context = fixture();
  const oversized = structuredClone(context.manifest);
  const sample = Object.values(oversized.targetsByCollection).flat()[0];
  oversized.targetsByCollection.oversized = Array.from(
    { length: 2_001 },
    (_, index) => ({
      ...sample,
      collection: "oversized",
      resourceId: `item-${index}`,
      resourcePath: `oversized/item-${index}`,
    }),
  );
  context.store.manifests.set(oversized.manifestId, {
    manifest: oversized,
    approvedBy: "admin",
    approvedAt: NOW,
  });
  await assert.rejects(
    () => approveAndApply(context, oversized),
    (error) =>
      error instanceof PurgeApplyError &&
      error.code === "purge_safety_limit_exceeded",
  );
});

test("기능 플래그·production gate·project binding·manifest ID 변조를 차단한다", async () => {
  const disabled = fixture({ enabled: false });
  await assert.rejects(
    () =>
      disabled.service.registerManifest({
        manifest: disabled.manifest,
        approvedBy: "admin",
        environment: "test",
        projectId: PROJECT_ID,
        now: NOW,
      }),
    (error) =>
      error instanceof PurgeApplyError &&
      error.code === "test_data_purge_disabled",
  );

  const production = fixture();
  await assert.rejects(
    () =>
      production.service.registerManifest({
        manifest: production.manifest,
        approvedBy: "admin",
        environment: "production",
        projectId: PROJECT_ID,
        now: NOW,
      }),
    (error) =>
      error instanceof PurgeApplyError &&
      error.code === "production_purge_disabled",
  );

  const projectBound = fixture();
  await assert.rejects(
    () =>
      projectBound.service.registerManifest({
        manifest: projectBound.manifest,
        approvedBy: "admin",
        environment: "test",
        projectId: "tampered-project",
        now: NOW,
      }),
    (error) =>
      error instanceof PurgeApplyError &&
      error.code === "purge_project_mismatch",
  );
  await assert.rejects(
    () =>
      projectBound.service.previewRegisteredManifest({
        manifestId: "purge_tampered_manifest_0001",
        environment: "test",
        projectId: PROJECT_ID,
        now: NOW,
      }),
    (error) =>
      error instanceof PurgeApplyError &&
      error.code === "manifest_not_found",
  );
});

test("API는 권한·apply 플래그·확인문구를 검증한다", async () => {
  const context = fixture();
  await context.service.registerManifest({
    manifest: context.manifest,
    approvedBy: "admin",
    environment: "test",
    projectId: PROJECT_ID,
    now: NOW,
  });
  const deniedHandlers = createPurgeApplyHandlers({
    authorize: async () => {
      throw { code: "permission_denied", status: 403 };
    },
    service: () => context.service,
    environment: () => "test",
    projectId: () => PROJECT_ID,
    requestId: () => "api-request",
  });
  const denied = await deniedHandlers.apply(
    new Request("http://localhost/api/admin/test-data/purge", {
      method: "POST",
      body: JSON.stringify({
        apply: true,
        manifestId: context.manifest.manifestId,
        confirmation: "DELETE TEST DATA: 둥기농협",
      }),
    }),
  );
  assert.equal(denied.status, 403);

  const handlers = createPurgeApplyHandlers({
    authorize: async () => ({ uid: "super-admin", email: "admin@example.com" }),
    service: () => context.service,
    environment: () => "test",
    projectId: () => PROJECT_ID,
    requestId: () => "api-request",
  });
  const missingApply = await handlers.apply(
    new Request("http://localhost/api/admin/test-data/purge", {
      method: "POST",
      body: JSON.stringify({
        manifestId: context.manifest.manifestId,
        confirmation: "DELETE TEST DATA: 둥기농협",
      }),
    }),
  );
  assert.equal(missingApply.status, 400);

  const wrongConfirmation = await handlers.apply(
    new Request("http://localhost/api/admin/test-data/purge", {
      method: "POST",
      body: JSON.stringify({
        apply: true,
        manifestId: context.manifest.manifestId,
        confirmation: "DELETE",
      }),
    }),
  );
  assert.equal(wrongConfirmation.status, 400);
  assert.equal(
    (await wrongConfirmation.json()).error,
    "confirmation_mismatch",
  );

  const institutionTamper = await handlers.apply(
    new Request("http://localhost/api/admin/test-data/purge", {
      method: "POST",
      body: JSON.stringify({
        apply: true,
        manifestId: context.manifest.manifestId,
        confirmation: "DELETE TEST DATA: 둥기농협",
        institutionId: "coop-999",
      }),
    }),
  );
  assert.equal(institutionTamper.status, 400);
  assert.equal(
    (await institutionTamper.json()).error,
    "invalid_request",
  );
});
