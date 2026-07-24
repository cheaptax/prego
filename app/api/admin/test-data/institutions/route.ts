import { createPurgeAdminReadHandlers } from "@/lib/test-data/purge-admin-api";
import { PurgeAdminReadService } from "@/lib/test-data/purge-admin-read";
import {
  authorizePurgeAdmin,
  purgeRuntimeEnvironment,
  purgeRuntimeProjectId,
} from "@/lib/test-data/purge-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createPurgeAdminReadHandlers({
  authorize: (request) => authorizePurgeAdmin(request, false),
  service: () => new PurgeAdminReadService(),
  environment: purgeRuntimeEnvironment,
  projectId: purgeRuntimeProjectId,
});

export const GET = handlers.institutions;
