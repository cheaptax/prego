import { getTestCooperativeDefinition } from "@/lib/cooperatives/demo-cooperative";
import type {
  PurgeJobPhase,
} from "@/lib/test-data/purge-job-types";
import type {
  PurgeManifest,
  PurgeManifestItem,
} from "@/lib/test-data/purge-types";

export const MAX_PURGE_FIRESTORE_DOCUMENTS = 2_000;
export const MAX_PURGE_AUTH_USERS = 20;
export const MAX_PURGE_STORAGE_OBJECTS = 500;
export const MAX_PURGE_STORAGE_BYTES = 5 * 1024 * 1024 * 1024;

const MASTER_OR_CONTROL_COLLECTIONS = new Set([
  "demoCooperativeMaster",
  "static:nonghyupMaster",
  "testDataPurgeManifests",
  "testDataPurgeJobs",
  "testDataPurgeLocks",
  "testDataPurgeAuditLogs",
  "testDataScenarios",
  "testDataSeedManifests",
  "legacyTestDataClassifications",
]);

const PHASE_BY_COLLECTION: Record<string, PurgeJobPhase> = {
  auditEvaluationSessions: "DELETING_ACCESS_RECORDS",
  auditEvaluationAccessTokens: "DELETING_ACCESS_RECORDS",
  auditEvaluationUploadIntents: "DELETING_ACCESS_RECORDS",
  auditEvaluationRateLimits: "DELETING_ACCESS_RECORDS",

  auditEvaluationCorrections: "DELETING_EVALUATION_DATA",
  auditEvaluationConfirmations: "DELETING_EVALUATION_DATA",
  auditEvaluationExtractionRuns: "DELETING_EVALUATION_DATA",
  auditEvaluationParsingQueue: "DELETING_EVALUATION_DATA",
  auditEvaluationNormalizedQuotes: "DELETING_EVALUATION_DATA",
  auditEvaluationDocuments: "DELETING_EVALUATION_DATA",
  auditEvaluationReportRuns: "DELETING_EVALUATION_DATA",
  auditEvaluationAuditLogs: "DELETING_EVALUATION_DATA",
  auditEvaluationCaseByQuoteRequest: "DELETING_EVALUATION_DATA",
  auditEvaluationCases: "DELETING_EVALUATION_DATA",

  quoteEmailDeliveries: "DELETING_QUOTES",
  quotes: "DELETING_QUOTES",
  quoteAssignments: "DELETING_QUOTES",
  quoteRequests: "DELETING_QUOTES",

  answerRatings: "DELETING_CONSULTATIONS",
  answerViews: "DELETING_CONSULTATIONS",
  partnerAnswerDrafts: "DELETING_CONSULTATIONS",
  partnerAssignments: "DELETING_CONSULTATIONS",
  answers: "DELETING_CONSULTATIONS",
  consultRequests: "DELETING_CONSULTATIONS",

  auditQuoteNotifications: "DELETING_AUDIT_INTAKE",
  auditQuoteIdempotency: "DELETING_AUDIT_INTAKE",
  auditQuoteEmailDedup: "DELETING_AUDIT_INTAKE",
  auditQuoteRateLimits: "DELETING_AUDIT_INTAKE",
  auditQuoteRequests: "DELETING_AUDIT_INTAKE",

  auditLogs: "DELETING_ACTIVITY",
  pointLedger: "DELETING_POINTS",
  point_transactions: "DELETING_POINTS",
  memberships: "DELETING_MEMBERSHIPS",
  tenants: "DELETING_MEMBERSHIPS",
  users: "DELETING_USERS",
  organizations: "DELETING_ORGANIZATION",
};

const PHASE_ORDER: PurgeJobPhase[] = [
  "DELETING_ACCESS_RECORDS",
  "DELETING_EVALUATION_DATA",
  "DELETING_QUOTES",
  "DELETING_CONSULTATIONS",
  "DELETING_AUDIT_INTAKE",
  "DELETING_ACTIVITY",
  "DELETING_POINTS",
  "DELETING_MEMBERSHIPS",
  "DELETING_USERS",
  "DELETING_ORGANIZATION",
];

export function expectedPurgeConfirmation(manifest: PurgeManifest) {
  return getTestCooperativeDefinition(manifest.institutionId)
    ? `DELETE TEST DATA: ${manifest.institutionName}`
    : `DELETE TEST DATA: ${manifest.institutionName} [${manifest.institutionId}]`;
}

export function isMasterOrControlTarget(item: PurgeManifestItem) {
  return (
    MASTER_OR_CONTROL_COLLECTIONS.has(item.collection) ||
    item.resourcePath.startsWith("static:") ||
    item.resourcePath === `demoCooperativeMaster/${item.resourceId}`
  );
}

export function isDeferredStep6Item(item: PurgeManifestItem) {
  return item.collection === "testAuthSubjects";
}

export function phaseForPurgeItem(item: PurgeManifestItem): PurgeJobPhase {
  return PHASE_BY_COLLECTION[item.collection] ?? "DELETING_ACTIVITY";
}

function pathDepth(path: string) {
  return path.split("/").length;
}

function isAncestorPath(ancestor: string, child: string) {
  return child.startsWith(`${ancestor}/`);
}

export function orderedFirestoreTargets(manifest: PurgeManifest) {
  const targets = Object.values(manifest.targetsByCollection)
    .flat()
    .filter((item) => item.targetType === "FIRESTORE_DOCUMENT");
  return targets.sort((left, right) => {
    if (isAncestorPath(left.resourcePath, right.resourcePath)) return 1;
    if (isAncestorPath(right.resourcePath, left.resourcePath)) return -1;
    const leftPhase = PHASE_ORDER.indexOf(phaseForPurgeItem(left));
    const rightPhase = PHASE_ORDER.indexOf(phaseForPurgeItem(right));
    if (leftPhase !== rightPhase) return leftPhase - rightPhase;
    const depth = pathDepth(right.resourcePath) - pathDepth(left.resourcePath);
    if (depth !== 0) return depth;
    if (
      left.collection === "consultRequests" &&
      right.collection === "consultRequests"
    ) {
      const leftFollowUp = left.relationship.some((value) =>
        value.startsWith("parentRequestId:")
      );
      const rightFollowUp = right.relationship.some((value) =>
        value.startsWith("parentRequestId:")
      );
      if (leftFollowUp !== rightFollowUp) return leftFollowUp ? -1 : 1;
    }
    return left.resourcePath.localeCompare(right.resourcePath);
  });
}

export function firestoreTargetCount(manifest: PurgeManifest) {
  return Object.values(manifest.targetsByCollection).flat().length;
}

export function reviewItemCount(manifest: PurgeManifest) {
  return Object.values(manifest.reviewByCollection).flat().length;
}

export function storageByteCount(manifest: PurgeManifest) {
  return manifest.storageObjects.reduce(
    (total, item) => total + (item.size ?? 0),
    0,
  );
}
