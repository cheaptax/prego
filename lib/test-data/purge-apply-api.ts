import { z } from "zod";
import {
  PurgeApplyError,
  isPurgeManifest,
  type PurgeApplyService,
} from "@/lib/test-data/purge-apply-service";
import { PurgeStoreError } from "@/lib/test-data/purge-firestore-executor";

type AuthorizedPurgeActor = {
  uid: string;
  email?: string;
};

type PurgeApiDependencies = {
  authorize(request: Request, requireRecentAuthentication: boolean): Promise<
    AuthorizedPurgeActor
  >;
  service(): PurgeApplyService;
  environment(): string;
  projectId(): string | undefined;
  requestId(request: Request): string;
};

const applySchema = z
  .object({
    apply: z.literal(true),
    manifestId: z.string().min(1).max(240),
    confirmation: z.string().min(1).max(300),
  })
  .strict();

const registerSchema = z
  .object({
    manifest: z.unknown(),
  })
  .strict();

export function createPurgeApplyHandlers(dependencies: PurgeApiDependencies) {
  return {
    preview: async (request: Request) => {
      try {
        await dependencies.authorize(request, false);
        const manifestId = new URL(request.url).searchParams.get("manifestId");
        if (!manifestId) {
          return Response.json(
            { ok: false, error: "manifest_id_required" },
            { status: 400 },
          );
        }
        const context = environmentContext(dependencies);
        const preview = await dependencies.service().previewRegisteredManifest({
          manifestId,
          ...context,
        });
        return Response.json(
          { ok: true, preview },
          { headers: { "cache-control": "private, no-store" } },
        );
      } catch (error) {
        return purgeApiErrorResponse(error);
      }
    },
    apply: async (request: Request) => {
      try {
        const actor = await dependencies.authorize(request, true);
        const body = applySchema.parse(await request.json());
        const context = environmentContext(dependencies);
        const result = await dependencies.service().apply({
          manifestId: body.manifestId,
          confirmation: body.confirmation,
          requestedBy: actor.uid,
          requestedByEmail: actor.email,
          requestId: dependencies.requestId(request),
          ...context,
        });
        return Response.json(
          { ok: true, result },
          { headers: { "cache-control": "private, no-store" } },
        );
      } catch (error) {
        return purgeApiErrorResponse(error);
      }
    },
    register: async (request: Request) => {
      try {
        const actor = await dependencies.authorize(request, false);
        const body = registerSchema.parse(await request.json());
        if (!isPurgeManifest(body.manifest)) {
          return Response.json(
            { ok: false, error: "invalid_manifest" },
            { status: 400 },
          );
        }
        const context = environmentContext(dependencies);
        const registered = await dependencies.service().registerManifest({
          manifest: body.manifest,
          approvedBy: actor.uid,
          approvedByEmail: actor.email,
          ...context,
        });
        return Response.json(
          {
            ok: true,
            manifestId: registered.manifest.manifestId,
            approvedAt: registered.approvedAt,
          },
          {
            status: 201,
            headers: { "cache-control": "private, no-store" },
          },
        );
      } catch (error) {
        return purgeApiErrorResponse(error);
      }
    },
  };
}

function environmentContext(dependencies: PurgeApiDependencies) {
  const projectId = dependencies.projectId();
  if (!projectId) throw new PurgeApplyError("firebase_project_id_unavailable", 503);
  return {
    environment: dependencies.environment(),
    projectId,
  };
}

function purgeApiErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return Response.json(
      { ok: false, error: "invalid_request" },
      { status: 400 },
    );
  }
  if (error instanceof PurgeApplyError || error instanceof PurgeStoreError) {
    return Response.json(
      { ok: false, error: error.code },
      { status: error.status },
    );
  }
  const authorizationError = error as {
    code?: unknown;
    status?: unknown;
  };
  if (
    typeof authorizationError.code === "string" &&
    typeof authorizationError.status === "number"
  ) {
    return Response.json(
      { ok: false, error: authorizationError.code },
      { status: authorizationError.status },
    );
  }
  console.error("Test data purge API failed.", error);
  return Response.json(
    { ok: false, error: "test_data_purge_failed" },
    { status: 500 },
  );
}
