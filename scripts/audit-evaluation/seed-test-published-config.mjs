/**
 * Local/test helper: publish a complete evaluation config for internal testing.
 * Usage: node --import tsx --env-file=.env.local scripts/audit-evaluation/seed-test-published-config.mjs
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  auditEvaluationConfigVersionDocumentId,
} from "../../lib/audit-evaluation/admin-config-repository.ts";
import {
  createPublishedCandidate,
  validateEvaluationConfigForPublish,
} from "../../lib/audit-evaluation/admin-config-validation.ts";
import { AUDIT_EVALUATION_COLLECTIONS } from "../../lib/audit-evaluation/collections.ts";
import { createValidEvaluationConfig } from "../../lib/audit-evaluation/testing/fixtures.ts";

const CONFIG_ID =
  process.env.AUDIT_EVALUATION_ACTIVE_CONFIG_ID?.trim() || "fy27.default";

const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
if (!projectId || !clientEmail || !privateKey) {
  throw new Error("Firebase Admin env is required");
}

if (!getApps().length) {
  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

const db = getFirestore();
const now = new Date().toISOString();
const actorUid = "seed-test-admin";
const draft = {
  ...createValidEvaluationConfig(),
  id: CONFIG_ID,
  name: "내부 테스트용 평가기준",
  status: "DRAFT",
  permittedMimeTypes: ["application/pdf"],
  reportSections: [
    { id: "cover", name: "표지", order: 0, enabled: true, type: "COVER" },
    {
      id: "purpose",
      name: "목적과 범위",
      order: 1,
      enabled: true,
      type: "PURPOSE_SCOPE",
    },
    {
      id: "summary",
      name: "핵심 요약",
      order: 2,
      enabled: true,
      type: "EXECUTIVE_SUMMARY",
    },
    {
      id: "comparison",
      name: "견적 비교",
      order: 3,
      enabled: true,
      type: "QUOTE_COMPARISON",
    },
    {
      id: "scores",
      name: "정량 평가",
      order: 4,
      enabled: true,
      type: "SCORE_BREAKDOWN",
    },
    {
      id: "capability",
      name: "수행역량",
      order: 5,
      enabled: true,
      type: "CAPABILITY_ANALYSIS",
    },
    {
      id: "fee",
      name: "감사보수 분석",
      order: 6,
      enabled: true,
      type: "FEE_ANALYSIS",
    },
    {
      id: "firm",
      name: "부적격·우려 견적 내역",
      order: 7,
      enabled: true,
      type: "FIRM_REVIEW",
    },
    {
      id: "opinion",
      name: "종합 의견",
      order: 8,
      enabled: true,
      type: "OVERALL_OPINION",
    },
    {
      id: "appendix",
      name: "부록",
      order: 9,
      enabled: true,
      type: "APPENDIX",
    },
  ],
  reportRenderingPolicy: {
    watermarkEnabled: false,
    watermarkText: "내부 테스트용",
    downloadUrlLifetimeSeconds: 60,
    reportTitle: "감사인 선임 검토보고서",
    centerContact: "농협지원센터 테스트",
    customerDownloadDays: 30,
  },
  retentionPolicy: {
    sourceDocumentDays: 365,
    normalizedDataDays: 365,
    reportDays: 365,
    expiredAccessTokenDays: 30,
    auditLogDays: 2_555,
    deleteAfterExpiry: false,
  },
};

const published = createPublishedCandidate({
  draft,
  actorUid,
  now,
});
const validation = validateEvaluationConfigForPublish(published, []);
if (!validation.valid) {
  console.error(JSON.stringify(validation.issues, null, 2));
  throw new Error("test config failed publish validation");
}

const docId = auditEvaluationConfigVersionDocumentId(
  published.id,
  published.version,
);
const ref = db
  .collection(AUDIT_EVALUATION_COLLECTIONS.configVersions)
  .doc(docId);
const existing = await ref.get();
if (existing.exists && existing.data()?.status === "PUBLISHED") {
  console.log(
    JSON.stringify({
      ok: true,
      reused: true,
      configId: published.id,
      version: published.version,
      documentId: docId,
    }),
  );
  process.exit(0);
}

await ref.set(published, { merge: false });
console.log(
  JSON.stringify({
    ok: true,
    created: true,
    configId: published.id,
    version: published.version,
    documentId: docId,
  }),
);
