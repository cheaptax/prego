import type {
  PurgeJobPhase,
  PurgeJobRecord,
} from "@/lib/test-data/purge-job-types";
import type { PurgeManifest } from "@/lib/test-data/purge-types";
import type { PurgeInstitutionSummary } from "@/lib/test-data/purge-admin-read";

const HIGH_LEVEL_PHASES: PurgeJobPhase[] = [
  "DISABLE_AUTH_USERS",
  "REVOKE_SESSIONS",
  "DELETE_FIRESTORE_DATA",
  "DELETE_STORAGE_OBJECTS",
  "DELETE_AUTH_USERS",
  "RESET_INSTITUTION",
  "VERIFY_ORPHANS",
  "COMPLETE",
];

export function getTestDataManifestCounts(manifest: PurgeManifest | null) {
  if (!manifest) {
    return { confirmed: 0, review: 0, preserve: 0, auth: 0, storage: 0 };
  }
  return {
    confirmed: Object.values(manifest.targetsByCollection).flat().length,
    review: Object.values(manifest.reviewByCollection).flat().length,
    preserve: manifest.preservedItems.length,
    auth: manifest.authUsers.filter(
      (item) => item.classification === "CONFIRMED_TEST",
    ).length,
    storage: manifest.storageObjects.filter(
      (item) => item.classification === "CONFIRMED_TEST",
    ).length,
  };
}

export function getTestDataExecutionBlockers(
  manifest: PurgeManifest | null,
  summary: PurgeInstitutionSummary | null,
  nowMs: number,
) {
  if (!manifest) return [];
  const blockers = new Set<string>(manifest.blockedReasons);
  if (Object.values(manifest.reviewByCollection).flat().length > 0) {
    blockers.add("REVIEW_REQUIRED");
  }
  if (manifest.blockedItems.length > 0) blockers.add("BLOCKED_ITEMS");
  if (nowMs >= Date.parse(manifest.expiresAt)) {
    blockers.add("STALE_MANIFEST");
  }
  if (
    Object.values(manifest.targetsByCollection)
      .flat()
      .some((item) =>
        ["demoCooperativeMaster", "static:nonghyupMaster"].includes(
          item.collection,
        )
      )
  ) {
    blockers.add("MASTER_DELETE_FORBIDDEN");
  }
  if (
    !manifest.preservedItems.some(
      (item) => item.classificationMethod === "MASTER_ALWAYS_PRESERVED",
    )
  ) {
    blockers.add("MASTER_PRESERVATION_MISSING");
  }
  if (summary?.activeLock) blockers.add("PURGE_JOB_ALREADY_RUNNING");
  return Array.from(blockers).sort();
}

export function getTestDataJobProgress(job: PurgeJobRecord | null) {
  if (!job) return 0;
  if (job.status === "COMPLETED") return 100;
  const completedPhases = HIGH_LEVEL_PHASES.filter(
    (phase) => Boolean(job.phaseResults?.[phase]?.completedAt),
  ).length;
  const phaseBase = (completedPhases / HIGH_LEVEL_PHASES.length) * 100;
  const firestoreProgress =
    job.progress.totalFirestoreTargets > 0
      ? job.progress.processedFirestoreTargets /
        job.progress.totalFirestoreTargets
      : 0;
  return Math.min(
    99,
    Math.max(
      1,
      Math.round(
        phaseBase +
          (job.currentPhase === "DELETE_FIRESTORE_DATA"
            ? firestoreProgress * (100 / HIGH_LEVEL_PHASES.length)
            : 0),
      ),
    ),
  );
}
