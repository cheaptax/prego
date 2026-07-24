import { createPurgeApplyHandlers } from "@/lib/test-data/purge-apply-api";
import {
  authorizePurgeAdmin,
  createRuntimePurgeService,
  purgeApiRequestId,
  purgeRuntimeEnvironment,
  purgeRuntimeProjectId,
} from "@/lib/test-data/purge-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const handlers = createPurgeApplyHandlers({
  authorize: authorizePurgeAdmin,
  service: createRuntimePurgeService,
  environment: purgeRuntimeEnvironment,
  projectId: purgeRuntimeProjectId,
  requestId: purgeApiRequestId,
});

export const GET = handlers.preview;
export const POST = handlers.apply;
