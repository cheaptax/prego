import { requireRole } from "@/lib/firebase/server";
import { createLegacyReviewHandlers } from "@/lib/test-data/legacy-review-api";
import { createRuntimeLegacyReviewService } from "@/lib/test-data/legacy-review-service";
import {
  purgeRuntimeEnvironment,
  purgeRuntimeProjectId,
} from "@/lib/test-data/purge-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const handlers = createLegacyReviewHandlers({
  authorizeScan: async (request) => {
    const session = await requireRole(request, "super_admin");
    return { uid: session.decoded.uid, email: session.decoded.email };
  },
  authorizeReview: async () => {
    throw new Error("review_handler_not_available_on_this_route");
  },
  service: createRuntimeLegacyReviewService,
  environment: purgeRuntimeEnvironment,
  projectId: purgeRuntimeProjectId,
});

export const GET = handlers.get;
export const POST = handlers.scan;
