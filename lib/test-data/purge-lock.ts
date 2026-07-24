import type { Firestore } from "firebase-admin/firestore";
import { PURGE_LOCK_COLLECTION } from "@/lib/test-data/purge-job-types";

export function isActivePurgeLock(value: unknown, nowMs = Date.now()) {
  if (!value || typeof value !== "object") return false;
  const lock = value as Record<string, unknown>;
  if (lock.status !== "ACTIVE") return false;
  if (typeof lock.leaseExpiresAt !== "string") return true;
  const leaseExpiresAt = Date.parse(lock.leaseExpiresAt);
  return !Number.isFinite(leaseExpiresAt) || leaseExpiresAt > nowMs;
}

export async function assertInstitutionWriteAllowed(
  db: Firestore,
  institutionId: string,
) {
  const snapshot = await db
    .collection(PURGE_LOCK_COLLECTION)
    .doc(institutionId)
    .get();
  if (snapshot.exists && isActivePurgeLock(snapshot.data())) {
    throw new InstitutionPurgeLockedError();
  }
}

export class InstitutionPurgeLockedError extends Error {
  readonly code = "institution_purge_in_progress";
  readonly status = 409;

  constructor() {
    super("institution_purge_in_progress");
    this.name = "InstitutionPurgeLockedError";
  }
}
