import {
  AdminAuthorizationError,
  getRequestId,
  requireRole,
} from "@/lib/firebase/server";
import { PurgeApplyService, defaultPurgeConfiguration } from "@/lib/test-data/purge-apply-service";
import { FirestorePurgeControlStore, FirestorePurgeExecutor } from "@/lib/test-data/purge-firestore-executor";
import { FirebasePurgeExternalExecutor } from "@/lib/test-data/purge-external-executor";
import { FirestorePurgeScanDataSource } from "@/lib/test-data/purge-firestore-source";
import { FirebasePurgeOrphanVerifier } from "@/lib/test-data/purge-orphan-verifier";
import { PurgeScanService } from "@/lib/test-data/purge-scan-service";

const RECENT_AUTH_SECONDS = 10 * 60;

export function createRuntimePurgeService() {
  const externalCleanupEnabled =
    process.env.TEST_DATA_PURGE_EXTERNAL_ENABLED === "true";
  return new PurgeApplyService({
    store: new FirestorePurgeControlStore(),
    executor: new FirestorePurgeExecutor(),
    externalExecutor: externalCleanupEnabled
      ? new FirebasePurgeExternalExecutor()
      : undefined,
    orphanVerifier: externalCleanupEnabled
      ? new FirebasePurgeOrphanVerifier()
      : undefined,
    scanner: new PurgeScanService(new FirestorePurgeScanDataSource()),
    configuration: defaultPurgeConfiguration(),
  });
}

export async function authorizePurgeAdmin(
  request: Request,
  requireRecentAuthentication: boolean,
) {
  const session = await requireRole(request, "super_admin");
  if (requireRecentAuthentication) {
    const authTime = Number(session.decoded.auth_time ?? 0);
    const nowSeconds = Math.floor(Date.now() / 1_000);
    if (
      !Number.isFinite(authTime) ||
      authTime <= 0 ||
      nowSeconds - authTime > RECENT_AUTH_SECONDS
    ) {
      throw new AdminAuthorizationError(
        "recent_authentication_required",
        403,
      );
    }
  }
  return {
    uid: session.decoded.uid,
    email: session.decoded.email,
  };
}

export function purgeRuntimeEnvironment() {
  return process.env.VERCEL_ENV?.trim() ||
    process.env.NODE_ENV?.trim() ||
    "development";
}

export function purgeRuntimeProjectId() {
  return process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.GCLOUD_PROJECT?.trim();
}

export { getRequestId as purgeApiRequestId };
