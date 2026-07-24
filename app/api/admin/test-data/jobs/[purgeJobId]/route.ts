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

type Context = { params: Promise<{ purgeJobId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { purgeJobId } = await params;
  return handlers.job(request, purgeJobId);
}
