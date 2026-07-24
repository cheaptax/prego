import { z } from "zod";
import type { PurgeManifest } from "@/lib/test-data/purge-types";
import { PurgeScanError } from "@/lib/test-data/purge-scan-service";
import { PurgeScanSourceError } from "@/lib/test-data/purge-firestore-source";

const requestSchema = z
  .object({
    institutionId: z.string().min(1).max(80),
    mode: z.string().optional().default("SCAN"),
  })
  .strict();

type PurgeScanHandlerDependencies = {
  authorize(request: Request): Promise<{ uid: string; email?: string }>;
  scan(input: {
    institutionId: string;
    mode: "SCAN" | "DRY_RUN";
    generatedBy: string;
    environment: string;
    projectId: string;
  }): Promise<PurgeManifest>;
  environment(): string;
  projectId(): string | undefined;
  recordScan?(input: {
    actorId: string;
    manifest: PurgeManifest;
  }): Promise<void>;
};

export function createPurgeScanPostHandler(
  dependencies: PurgeScanHandlerDependencies,
) {
  return async function POST(request: Request) {
    try {
      const actor = await dependencies.authorize(request);
      const parsed = requestSchema.parse(await request.json());
      if (parsed.mode === "APPLY") {
        return Response.json(
          { ok: false, error: "apply_not_implemented" },
          { status: 405 },
        );
      }
      if (parsed.mode !== "SCAN" && parsed.mode !== "DRY_RUN") {
        return Response.json(
          { ok: false, error: "invalid_scan_mode" },
          { status: 400 },
        );
      }
      const projectId = dependencies.projectId();
      if (!projectId) {
        return Response.json(
          { ok: false, error: "firebase_project_id_unavailable" },
          { status: 503 },
        );
      }
      const manifest = await dependencies.scan({
        institutionId: parsed.institutionId,
        mode: parsed.mode,
        generatedBy: actor.uid,
        environment: dependencies.environment(),
        projectId,
      });
      if (dependencies.recordScan) {
        await dependencies.recordScan({
          actorId: actor.uid,
          manifest,
        });
      }
      return Response.json(
        { ok: true, manifest },
        { headers: { "cache-control": "private, no-store" } },
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        return Response.json(
          { ok: false, error: "invalid_request" },
          { status: 400 },
        );
      }
      if (error instanceof PurgeScanError) {
        return Response.json(
          { ok: false, error: error.code },
          { status: error.status },
        );
      }
      if (error instanceof PurgeScanSourceError) {
        return Response.json(
          { ok: false, error: error.code },
          { status: 404 },
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
      console.error("Test data purge scan failed.", error);
      return Response.json(
        { ok: false, error: "purge_scan_failed" },
        { status: 500 },
      );
    }
  };
}
