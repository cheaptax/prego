import { NextResponse } from "next/server";
import {
  adminConfigErrorResponse,
  requireConfigAdmin,
} from "@/app/api/admin/audit-evaluations/configs/_shared";
import {
  FirestoreAuditEvaluationAdminConfigRepository,
} from "@/lib/audit-evaluation/admin-config-repository";
import { adminConfigPublishPayloadSchema } from "@/lib/audit-evaluation/admin-config-validation";
import { readAdminJson } from "@/lib/audit-evaluation/admin-api";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ configId: string; version: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const authorization = await requireConfigAdmin(request);
  if (authorization.response) return authorization.response;

  const { configId, version: rawVersion } = await context.params;
  const version = Number(rawVersion);
  if (
    !/^[a-z][a-zA-Z0-9._-]{0,79}$/.test(configId) ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    return NextResponse.json(
      { ok: false, error: "config_not_found" },
      { status: 404 },
    );
  }
  const payload = adminConfigPublishPayloadSchema.safeParse(
    await readAdminJson(request).catch(() => null),
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
    const result = await repository.publishDraft({
      configId,
      version,
      expectedDraftRevision: payload.data.expectedDraftRevision,
      confirmWarnings: payload.data.confirmWarnings,
      actorUid: authorization.admin.uid,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return adminConfigErrorResponse(error, "config_publish_failed");
  }
}
