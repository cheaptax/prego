import { NextResponse } from "next/server";
import { z } from "zod";
import { CMS_GLOBAL_KEYS, type CmsGlobalKey } from "@/lib/cms/constants";
import { loadCmsGlobalEditorData } from "@/lib/cms/global-editor-data";
import {
  CmsRepositoryError,
  FirestoreCmsRepository,
} from "@/lib/cms/repository";
import {
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
} from "@/lib/firebase/server";

export const runtime = "nodejs";

const payloadSchema = z
  .object({
    expectedDraftVersion: z.number().int().nonnegative(),
  })
  .strict();

function isCmsGlobalKey(value: string): value is CmsGlobalKey {
  return (CMS_GLOBAL_KEYS as readonly string[]).includes(value);
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{ documentKey: string; revisionId: string }>;
  },
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
  const { documentKey, revisionId } = await context.params;
  const payload = payloadSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (
    !isCmsGlobalKey(documentKey) ||
    !payload.success ||
    !/^r[a-zA-Z0-9._-]{1,79}$/.test(revisionId)
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid_request" },
      { status: 400 },
    );
  }
  try {
    const repository = new FirestoreCmsRepository();
    await repository.restoreGlobalRevision(
      documentKey,
      revisionId,
      payload.data.expectedDraftVersion,
      admin.uid,
    );
    return NextResponse.json({
      ok: true,
      editor: await loadCmsGlobalEditorData(documentKey, repository),
    });
  } catch (error) {
    if (error instanceof CmsRepositoryError) {
      return NextResponse.json(
        { ok: false, error: error.code },
        {
          status:
            error.code === "version_conflict"
              ? 409
              : error.code === "revision_not_found"
                ? 404
                : 400,
        },
      );
    }
    return NextResponse.json(
      { ok: false, error: "restore_failed" },
      { status: 500 },
    );
  }
}
