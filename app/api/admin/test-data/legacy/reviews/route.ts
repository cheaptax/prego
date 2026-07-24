import { requireActiveAdmin, requireRole } from "@/lib/firebase/server";
import { createLegacyReviewHandlers } from "@/lib/test-data/legacy-review-api";
import { createRuntimeLegacyReviewService } from "@/lib/test-data/legacy-review-service";
import type { LegacyReviewDecision } from "@/lib/test-data/legacy-review-types";
import {
  purgeRuntimeEnvironment,
  purgeRuntimeProjectId,
} from "@/lib/test-data/purge-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createLegacyReviewHandlers({
  authorizeScan: async () => {
    throw new Error("scan_handler_not_available_on_this_route");
  },
  authorizeReview: async (
    request: Request,
    decision: LegacyReviewDecision,
  ) => {
    if (decision === "CONFIRMED_TEST") {
      const session = await requireRole(request, "super_admin");
      return {
        uid: session.decoded.uid,
        email: session.decoded.email,
        isSuperAdmin: true,
      };
    }
    const session = await requireActiveAdmin(request);
    return {
      uid: session.decoded.uid,
      email: session.decoded.email,
      isSuperAdmin: session.context.adminRole === "super_admin",
    };
  },
  service: createRuntimeLegacyReviewService,
  environment: purgeRuntimeEnvironment,
  projectId: purgeRuntimeProjectId,
});

export const POST = handlers.review;
