import { NextResponse } from "next/server";
import {
  adminConfigErrorResponse,
  requireConfigAdmin,
} from "@/app/api/admin/audit-evaluations/configs/_shared";
import {
  FirestoreAuditEvaluationAdminConfigRepository,
} from "@/lib/audit-evaluation/admin-config-repository";
import { adminConfigActionPayloadSchema } from "@/lib/audit-evaluation/admin-config-validation";
import type { EvaluationConfig } from "@/lib/audit-evaluation/types";
import { readAdminJson } from "@/lib/audit-evaluation/admin-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requireConfigAdmin(request);
  if (authorization.response) return authorization.response;

  try {
    const repository =
      new FirestoreAuditEvaluationAdminConfigRepository();
    const [versions, logoAssets] = await Promise.all([
      repository.listVersions(),
      repository.listPublishedLogoAssets(),
    ]);
    return NextResponse.json({
      ok: true,
      configs: versions,
      versions,
      drafts: versions.filter((config) => config.status === "DRAFT"),
      published: versions.filter((config) => config.status === "PUBLISHED"),
      configSets: groupVersions(versions),
      logoAssets,
    });
  } catch (error) {
    return adminConfigErrorResponse(error, "config_list_unavailable");
  }
}

export async function POST(request: Request) {
  const authorization = await requireConfigAdmin(request);
  if (authorization.response) return authorization.response;

  const payload = adminConfigActionPayloadSchema.safeParse(
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
    const config = payload.data.action === "createDefault"
      ? await repository.createDefaultDraft(authorization.admin.uid)
      : await repository.cloneVersion({
          configId: payload.data.configId,
          version: payload.data.version,
          actorUid: authorization.admin.uid,
          action: payload.data.action,
        });
    return NextResponse.json({ ok: true, config }, { status: 201 });
  } catch (error) {
    return adminConfigErrorResponse(error, "config_mutation_failed");
  }
}

function groupVersions(versions: readonly EvaluationConfig[]) {
  const grouped = new Map<string, EvaluationConfig[]>();
  for (const config of versions) {
    const values = grouped.get(config.id) ?? [];
    values.push(config);
    grouped.set(config.id, values);
  }
  return [...grouped.entries()].map(([configId, values]) => ({
    configId,
    versions: [...values].sort((left, right) => right.version - left.version),
    latestDraft:
      values
        .filter((config) => config.status === "DRAFT")
        .sort((left, right) => right.version - left.version)[0] ?? null,
    latestPublished:
      values
        .filter((config) => config.status === "PUBLISHED")
        .sort((left, right) => right.version - left.version)[0] ?? null,
  }));
}
