import { z } from "zod";
import {
  LEGACY_EVIDENCE_CODES,
  type LegacyReviewDecision,
} from "@/lib/test-data/legacy-review-types";
import {
  LegacyReviewError,
  type LegacyReviewService,
} from "@/lib/test-data/legacy-review-service";

type LegacyReviewApiDependencies = {
  authorizeScan(
    request: Request,
  ): Promise<{ uid: string; email?: string }>;
  authorizeReview(
    request: Request,
    decision: LegacyReviewDecision,
  ): Promise<{ uid: string; email?: string; isSuperAdmin: boolean }>;
  service(): LegacyReviewService;
  environment(): string;
  projectId(): string | undefined;
};

const scanSchema = z.object({
  institutionId: z.string().min(1).max(80),
}).strict();

const reviewSchema = z.object({
  reviewManifestId: z.string().min(1).max(160),
  candidateId: z.string().regex(/^[a-f0-9]{32}$/),
  decision: z.enum(["CONFIRMED_TEST", "PRESERVE", "UNRESOLVED"]),
  reason: z.string().trim().min(10).max(500),
  sourceEvidence: z.array(z.enum(LEGACY_EVIDENCE_CODES)).max(20),
  reviewVersion: z.number().int().min(1).max(10_000),
}).strict();

export function createLegacyReviewHandlers(
  dependencies: LegacyReviewApiDependencies,
) {
  return {
    scan: async (request: Request) => {
      try {
        const actor = await dependencies.authorizeScan(request);
        const body = scanSchema.parse(await request.json());
        const projectId = dependencies.projectId();
        if (!projectId) {
          throw new LegacyReviewError("firebase_project_id_unavailable", 503);
        }
        const result = await dependencies.service().scan({
          institutionId: body.institutionId,
          generatedBy: actor.uid,
          environment: dependencies.environment(),
          projectId,
        });
        return response({ ok: true, ...result }, 201);
      } catch (error) {
        return errorResponse(error);
      }
    },
    get: async (request: Request) => {
      try {
        await dependencies.authorizeScan(request);
        const reviewManifestId = new URL(request.url).searchParams.get(
          "reviewManifestId",
        );
        if (!reviewManifestId) {
          throw new LegacyReviewError("review_manifest_id_required");
        }
        const result = await dependencies
          .service()
          .getReviewManifest(reviewManifestId);
        return response({ ok: true, ...result });
      } catch (error) {
        return errorResponse(error);
      }
    },
    review: async (request: Request) => {
      try {
        const body = reviewSchema.parse(await request.json());
        const actor = await dependencies.authorizeReview(
          request,
          body.decision,
        );
        const result = await dependencies.service().review({
          ...body,
          reviewedBy: actor.uid,
          isSuperAdmin: actor.isSuperAdmin,
        });
        return response({ ok: true, ...result });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

function response(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return response({ ok: false, error: "invalid_request" }, 400);
  }
  if (error instanceof LegacyReviewError) {
    return response({ ok: false, error: error.code }, error.status);
  }
  const authorizationError = error as {
    code?: unknown;
    status?: unknown;
  };
  if (
    typeof authorizationError.code === "string" &&
    typeof authorizationError.status === "number"
  ) {
    return response(
      { ok: false, error: authorizationError.code },
      authorizationError.status,
    );
  }
  console.error("Legacy test data review API failed.", error);
  return response({ ok: false, error: "legacy_review_failed" }, 500);
}
