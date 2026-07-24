import { requireRole } from "@/lib/firebase/server";
import { createPurgeScanPostHandler } from "@/lib/test-data/purge-api";
import { PurgeAdminReadService } from "@/lib/test-data/purge-admin-read";
import { FirestorePurgeScanDataSource } from "@/lib/test-data/purge-firestore-source";
import { PurgeScanService } from "@/lib/test-data/purge-scan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = createPurgeScanPostHandler({
  authorize: async (request) => {
    const session = await requireRole(request, "super_admin");
    return { uid: session.decoded.uid, email: session.decoded.email };
  },
  scan: async (input) =>
    new PurgeScanService(new FirestorePurgeScanDataSource()).scan(input),
  environment: () =>
    process.env.VERCEL_ENV?.trim() ||
    process.env.NODE_ENV?.trim() ||
    "development",
  projectId: () =>
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.GCLOUD_PROJECT?.trim(),
  recordScan: async (input) =>
    new PurgeAdminReadService().recordScan(input),
});
