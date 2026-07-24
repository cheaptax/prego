import { NextResponse } from "next/server";
import {
  adminConfigErrorResponse,
  requireConfigAdmin,
} from "@/app/api/admin/audit-evaluations/configs/_shared";
import {
  FirestoreAuditEvaluationAdminConfigRepository,
} from "@/lib/audit-evaluation/admin-config-repository";
import {
  adminConfigPatchPayloadSchema,
  validateEvaluationConfigForPublish,
} from "@/lib/audit-evaluation/admin-config-validation";
import { readAdminJson } from "@/lib/audit-evaluation/admin-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ configId: string; version: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const authorization = await requireConfigAdmin(request);
  if (authorization.response) return authorization.response;

  const identity = await parseIdentity(context);
  if (!identity) {
    return NextResponse.json(
      { ok: false, error: "config_not_found" },
      { status: 404 },
    );
  }
  try {
    const repository =
      new FirestoreAuditEvaluationAdminConfigRepository();
    const [config, versions] = await Promise.all([
      repository.getVersion(identity.configId, identity.version),
      repository.listVersions(),
    ]);
    if (!config) {
      return NextResponse.json(
        { ok: false, error: "config_not_found" },
        { status: 404 },
      );
    }
    const validation = validateEvaluationConfigForPublish(
      config,
      versions.filter((candidate) => candidate.status === "PUBLISHED"),
    );
    return NextResponse.json({ ok: true, config, validation });
  } catch (error) {
    return adminConfigErrorResponse(error, "config_unavailable");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const authorization = await requireConfigAdmin(request);
  if (authorization.response) return authorization.response;

  const identity = await parseIdentity(context);
  if (!identity) {
    return NextResponse.json(
      { ok: false, error: "config_not_found" },
      { status: 404 },
    );
  }
  const payload = adminConfigPatchPayloadSchema.safeParse(
    await readAdminJson(request, 256_000).catch(() => null),
  );
  if (!payload.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_request" },
      { status: 400 },
    );
  }
  try {
    const repository =
      new FirestoreAuditEvaluationAdminConfigRepository();
    const config = await repository.patchDraft({
      ...identity,
      expectedDraftRevision: payload.data.expectedDraftRevision,
      changes: payload.data.changes,
      actorUid: authorization.admin.uid,
    });
    const versions = await repository.listVersions();
    const validation = validateEvaluationConfigForPublish(
      config,
      versions.filter((candidate) => candidate.status === "PUBLISHED"),
    );
    return NextResponse.json({ ok: true, config, validation });
  } catch (error) {
    return adminConfigErrorResponse(error, "config_update_failed");
  }
}

async function parseIdentity(context: RouteContext) {
  const { configId, version: rawVersion } = await context.params;
  const version = Number(rawVersion);
  if (
    !/^[a-z][a-zA-Z0-9._-]{0,79}$/.test(configId) ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    return null;
  }
  return { configId, version };
}
