import { NextResponse } from "next/server";
import { z } from "zod";
import { CMS_GLOBAL_KEYS, type CmsGlobalKey } from "@/lib/cms/constants";
import { loadCmsGlobalEditorData } from "@/lib/cms/global-editor-data";
import {
  CmsRepositoryError,
  FirestoreCmsRepository,
} from "@/lib/cms/repository";
import { cmsGlobalContentSchema } from "@/lib/cms/schemas";
import {
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
} from "@/lib/firebase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const savePayloadSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    content: cmsGlobalContentSchema,
  })
  .strict();

function isCmsGlobalKey(value: string): value is CmsGlobalKey {
  return (CMS_GLOBAL_KEYS as readonly string[]).includes(value);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ documentKey: string }> },
) {
  try {
    await requireAdminCapability(request, "cms:read");
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }
  const { documentKey } = await context.params;
  if (!isCmsGlobalKey(documentKey)) {
    return NextResponse.json(
      { ok: false, error: "common_area_not_found" },
      { status: 404 },
    );
  }
  try {
    return NextResponse.json({
      ok: true,
      editor: await loadCmsGlobalEditorData(documentKey),
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "editor_unavailable" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ documentKey: string }> },
) {
  let admin;
  try {
    admin = await requireAdminCapability(request, "cms:write");
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }
  const { documentKey } = await context.params;
  if (!isCmsGlobalKey(documentKey)) {
    return NextResponse.json(
      { ok: false, error: "common_area_not_found" },
      { status: 404 },
    );
  }
  const payload = savePayloadSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!payload.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_request" },
      { status: 400 },
    );
  }
  try {
    const repository = new FirestoreCmsRepository();
    await repository.saveDraftGlobal({
      documentKey,
      content: payload.data.content,
      expectedVersion: payload.data.expectedVersion,
      actorUid: admin.uid,
    });
    return NextResponse.json({
      ok: true,
      editor: await loadCmsGlobalEditorData(documentKey, repository),
    });
  } catch (error) {
    if (error instanceof CmsRepositoryError) {
      return NextResponse.json(
        { ok: false, error: error.code },
        { status: error.code === "version_conflict" ? 409 : 400 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "editor_unavailable" },
      { status: 500 },
    );
  }
}
