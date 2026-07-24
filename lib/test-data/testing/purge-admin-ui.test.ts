import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  getTestDataExecutionBlockers,
  getTestDataManifestCounts,
} from "@/lib/test-data/purge-admin-ui-policy";
import { CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";
import { createPurgeAdminReadHandlers } from "@/lib/test-data/purge-admin-api";
import type { PurgeAdminReadService } from "@/lib/test-data/purge-admin-read";
import { createPurgeScanPostHandler } from "@/lib/test-data/purge-api";
import type {
  PurgeManifest,
  PurgeManifestItem,
} from "@/lib/test-data/purge-types";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function item(
  classification: PurgeManifestItem["classification"],
  collection = "users",
): PurgeManifestItem {
  return {
    targetType: "FIRESTORE_DOCUMENT",
    collection,
    resourceId: "safe-id",
    resourcePath: `${collection}/safe-id`,
    classification,
    classificationMethod:
      classification === "PRESERVE"
        ? "NO_TEST_EVIDENCE"
        : "EXPLICIT_DATA_CLASSIFICATION",
    riskLevel: "LOW",
    relationship: ["fixture"],
    changeToken: "v1",
    warningCodes: [],
  };
}

function manifest(overrides: Partial<PurgeManifest> = {}): PurgeManifest {
  return {
    schemaVersion: 1,
    manifestId: "manifest-ui-test",
    institutionId: "demo-dunggi-nh",
    institutionName: "둥기농협",
    institutionType: "지역농협",
    isDemoInstitution: true,
    generatedAt: "2099-01-01T00:00:00.000Z",
    generatedBy: "super-admin",
    environment: "development",
    projectId: "demo-step7",
    mode: "DRY_RUN",
    executionStatus: "DRY_RUN_READY",
    classificationMethod: ["EXPLICIT_DATA_CLASSIFICATION"],
    targetsByCollection: { users: [item("CONFIRMED_TEST")] },
    reviewByCollection: {},
    preservedItems: [
      {
        ...item("PRESERVE", "demoCooperativeMaster"),
        classificationMethod: "MASTER_ALWAYS_PRESERVED",
      },
    ],
    blockedItems: [],
    authUsers: [],
    storageObjects: [],
    resetFields: [
      {
        field: "signupStatus",
        currentValue: "REGISTERED",
        expectedValue: "AVAILABLE",
      },
    ],
    preservedFields: ["cooperativeName", "internalCode"],
    totalTargetCount: 1,
    warnings: [],
    blockedReasons: [],
    checksum: "checksum",
    expiresAt: "2099-01-01T00:15:00.000Z",
    ...overrides,
  };
}

describe("test data admin UI policy", () => {
  it("counts delete, review, preserve, Auth, and Storage previews separately", () => {
    const review = item("REVIEW_REQUIRED");
    const candidate = manifest({
      reviewByCollection: { users: [review] },
      authUsers: [
        {
          uid: "uid-test",
          providerIds: ["password"],
          classification: "CONFIRMED_TEST",
          classificationMethod: "EXPLICIT_DATA_CLASSIFICATION",
        },
      ],
      storageObjects: [
        {
          path: "safe/object.pdf",
          sourceDocumentPath: "users/safe-id",
          classification: "CONFIRMED_TEST",
          classificationMethod: "EXPLICIT_DATA_CLASSIFICATION",
        },
      ],
    });
    assert.deepEqual(getTestDataManifestCounts(candidate), {
      confirmed: 1,
      review: 1,
      preserve: 1,
      auth: 1,
      storage: 1,
    });
  });

  it("blocks review-required, blocked, expired, mixed, and master-target manifests", () => {
    const review = getTestDataExecutionBlockers(
      manifest({ reviewByCollection: { users: [item("REVIEW_REQUIRED")] } }),
      null,
      Date.parse("2026-07-23T00:00:00.000Z"),
    );
    assert.ok(review.includes("REVIEW_REQUIRED"));

    const mixed = getTestDataExecutionBlockers(
      manifest({
        executionStatus: "BLOCKED",
        blockedReasons: ["MIXED_ORGANIZATION_USERS"],
      }),
      null,
      Date.parse("2026-07-23T00:00:00.000Z"),
    );
    assert.ok(mixed.includes("MIXED_ORGANIZATION_USERS"));

    const expired = getTestDataExecutionBlockers(
      manifest({ expiresAt: "2020-01-01T00:00:00.000Z" }),
      null,
      Date.parse("2026-07-23T00:00:00.000Z"),
    );
    assert.ok(expired.includes("STALE_MANIFEST"));

    const masterTarget = getTestDataExecutionBlockers(
      manifest({
        targetsByCollection: {
          demoCooperativeMaster: [
            item("CONFIRMED_TEST", "demoCooperativeMaster"),
          ],
        },
      }),
      null,
      Date.parse("2026-07-23T00:00:00.000Z"),
    );
    assert.ok(masterTarget.includes("MASTER_DELETE_FORBIDDEN"));
  });

  it("keeps visible copy in CMS and protected confirmation logic in code", () => {
    const defaults = CMS_PAGE_DEFAULTS["admin.operations"];
    const section = defaults.sections.find(
      (candidate) => candidate.id === "testDataManagement",
    );
    assert.ok(section);
    assert.equal(section.locked, true);
    assert.equal(section.text.demoBadge, "업무 테스트용");
    assert.equal(section.text.resettableBadge, "초기화 가능");

    const component = source("components/TestDataManagement.tsx");
    assert.doesNotMatch(
      component,
      /from ["']firebase-admin|adminDb\(|FirestorePurge/,
    );
    assert.match(component, /masterAcknowledged/);
    assert.match(component, /testDataAcknowledged/);
    assert.match(component, /confirmationInput !== purgePreview\.confirmation/);
    assert.match(component, /ACTIVE_JOB_STATUSES/);
    assert.match(component, /window\.localStorage\.setItem\(STORAGE_KEY/);
    assert.match(component, /orphanVerification/);
    assert.doesNotMatch(component, /질문 본문|답변 본문|signed URL/);
  });

  it("uses a mobile-safe scrollable two-step dialog", () => {
    const css = source("app/globals.css");
    assert.match(css, /\.test-data-confirmation \.admin-modal__panel/);
    assert.match(css, /max-height:\s*calc\(100dvh - 20px\)/);
    assert.match(css, /flex-direction:\s*column-reverse/);
  });

  it("requires a server page role check and server API authorization", () => {
    const page = source("app/admin/test-data/page.tsx");
    assert.match(page, /requirePortalPageSession\("admin"\)/);
    assert.match(page, /account\.role !== "super_admin"/);
    for (const route of [
      "app/api/admin/test-data/institutions/route.ts",
      "app/api/admin/test-data/jobs/[purgeJobId]/route.ts",
      "app/api/admin/test-data/history/route.ts",
      "app/api/admin/test-data/purge/route.ts",
    ]) {
      assert.match(source(route), /authorizePurgeAdmin/);
    }
    const runtime = source("lib/test-data/purge-runtime.ts");
    assert.match(runtime, /requireRole\(request, "super_admin"\)/);
    assert.match(runtime, /recent_authentication_required/);
  });
});

describe("test data admin read API", () => {
  const summary = {
    institutionId: "demo-dunggi-nh",
    institutionName: "둥기농협",
    institutionCode: "DEMO_DUNGGI_NH",
    institutionType: "지역농협",
    isDemoInstitution: true,
    signupStatus: "AVAILABLE",
    dataClassification: "DEMO" as const,
    resettable: true,
    connectedCustomerAccounts: 1,
    connectedOrganizations: 1,
    hasExplicitTestMarker: true,
    classificationStatus: "CONFIRMED_TEST" as const,
  };
  const service = {
    async searchInstitutions() {
      return [summary];
    },
    async getInstitutionSummary() {
      return summary;
    },
    async getJob() {
      return null;
    },
    async listHistory() {
      return [];
    },
  } as unknown as PurgeAdminReadService;

  it("blocks unauthorized institution reads", async () => {
    const handlers = createPurgeAdminReadHandlers({
      authorize: async () => {
        throw { code: "permission_denied", status: 403 };
      },
      service: () => service,
      environment: () => "development",
      projectId: () => "demo-step7",
    });
    const response = await handlers.institutions(
      new Request("http://localhost/api/admin/test-data/institutions"),
    );
    assert.equal(response.status, 403);
  });

  it("returns sanitized institution summaries and 404 for unknown jobs", async () => {
    const handlers = createPurgeAdminReadHandlers({
      authorize: async () => ({ uid: "super-admin" }),
      service: () => service,
      environment: () => "development",
      projectId: () => "demo-step7",
    });
    const institutionResponse = await handlers.institutions(
      new Request(
        "http://localhost/api/admin/test-data/institutions?institutionId=demo-dunggi-nh",
      ),
    );
    assert.equal(institutionResponse.status, 200);
    assert.deepEqual(
      (await institutionResponse.json()).summary,
      summary,
    );

    const jobResponse = await handlers.job(
      new Request("http://localhost/api/admin/test-data/jobs/unknown"),
      "purge-job-00000000000000000000",
    );
    assert.equal(jobResponse.status, 404);
  });

  it("records a minimal scan audit event without copying customer payloads", async () => {
    let recorded:
      | {
          actorId: string;
          manifest: PurgeManifest;
        }
      | undefined;
    const handler = createPurgeScanPostHandler({
      authorize: async () => ({
        uid: "super-admin",
        email: "admin@example.com",
      }),
      scan: async () => manifest({ mode: "SCAN", executionStatus: "SCANNED" }),
      environment: () => "development",
      projectId: () => "demo-step7",
      recordScan: async (event) => {
        recorded = event;
      },
    });
    const response = await handler(
      new Request("http://localhost/api/admin/test-data/scan", {
        method: "POST",
        body: JSON.stringify({
          institutionId: "demo-dunggi-nh",
          mode: "SCAN",
        }),
        headers: { "content-type": "application/json" },
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(recorded?.actorId, "super-admin");
    assert.equal(recorded?.manifest.institutionId, "demo-dunggi-nh");
    assert.equal(
      JSON.stringify(recorded).includes("questionBody"),
      false,
    );
    assert.equal("actorEmail" in (recorded ?? {}), false);
  });
});
