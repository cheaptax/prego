import { z } from "zod";
import type {
  PurgeAdminReadService,
  PurgeInstitutionListItem,
  PurgeInstitutionSummary,
} from "@/lib/test-data/purge-admin-read";
import { PurgeScanSourceError } from "@/lib/test-data/purge-firestore-source";

type AuthorizedActor = { uid: string; email?: string };

type PurgeAdminApiDependencies = {
  authorize(request: Request): Promise<AuthorizedActor>;
  service(): Pick<
    PurgeAdminReadService,
    "searchInstitutions" | "getInstitutionSummary" | "getJob" | "listHistory"
  >;
  environment(): string;
  projectId(): string | undefined;
};

const institutionIdSchema = z.string().min(1).max(80);
const jobIdSchema = z.string().min(1).max(120);

export function createPurgeAdminReadHandlers(
  dependencies: PurgeAdminApiDependencies,
) {
  return {
    institutions: async (request: Request) => {
      try {
        const actor = await dependencies.authorize(request);
        const url = new URL(request.url);
        const institutionId = url.searchParams.get("institutionId");
        const projectId = dependencies.projectId();
        if (!projectId) {
          return apiResponse(
            { ok: false, error: "firebase_project_id_unavailable" },
            503,
          );
        }
        if (institutionId) {
          institutionIdSchema.parse(institutionId);
          const summary = await dependencies.service().getInstitutionSummary({
            institutionId,
            generatedBy: actor.uid,
            environment: dependencies.environment(),
            projectId,
          });
          return apiResponse<{
            ok: true;
            summary: PurgeInstitutionSummary;
          }>({ ok: true, summary });
        }
        const query = (url.searchParams.get("q") ?? "").slice(0, 80);
        const institutions = await dependencies
          .service()
          .searchInstitutions(query, 20);
        return apiResponse<{
          ok: true;
          institutions: PurgeInstitutionListItem[];
        }>({ ok: true, institutions });
      } catch (error) {
        return adminReadError(error);
      }
    },
    job: async (request: Request, purgeJobId: string) => {
      try {
        await dependencies.authorize(request);
        jobIdSchema.parse(purgeJobId);
        const result = await dependencies.service().getJob(purgeJobId);
        if (!result) {
          return apiResponse(
            { ok: false, error: "purge_job_not_found" },
            404,
          );
        }
        return apiResponse({ ok: true, ...result });
      } catch (error) {
        return adminReadError(error);
      }
    },
    history: async (request: Request) => {
      try {
        await dependencies.authorize(request);
        const institutionId = institutionIdSchema.parse(
          new URL(request.url).searchParams.get("institutionId"),
        );
        const history = await dependencies
          .service()
          .listHistory(institutionId, 50);
        return apiResponse({ ok: true, history });
      } catch (error) {
        return adminReadError(error);
      }
    },
  };
}

function apiResponse<T extends object>(body: T, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

function adminReadError(error: unknown) {
  if (error instanceof z.ZodError) {
    return apiResponse({ ok: false, error: "invalid_request" }, 400);
  }
  if (error instanceof PurgeScanSourceError) {
    return apiResponse({ ok: false, error: error.code }, 404);
  }
  const authorizationError = error as {
    code?: unknown;
    status?: unknown;
  };
  if (
    typeof authorizationError.code === "string" &&
    typeof authorizationError.status === "number"
  ) {
    return apiResponse(
      { ok: false, error: authorizationError.code },
      authorizationError.status,
    );
  }
  console.error("Test data admin read API failed.", error);
  return apiResponse(
    { ok: false, error: "test_data_admin_read_failed" },
    500,
  );
}
