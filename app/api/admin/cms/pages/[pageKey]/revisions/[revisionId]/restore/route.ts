import { NextResponse } from "next/server";
import { z } from "zod";
import { CMS_PAGE_KEYS, type CmsPageKey } from "@/lib/cms/constants";
import { loadCmsPageEditorData } from "@/lib/cms/page-editor-data";
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

function isCmsPageKey(value: string): value is CmsPageKey {
  return (CMS_PAGE_KEYS as readonly string[]).includes(value);
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{ pageKey: string; revisionId: string }>;
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
  const { pageKey, revisionId } = await context.params;
  if (!isCmsPageKey(pageKey)) {
    return NextResponse.json(
      { ok: false, error: "page_not_found" },
      { status: 404 },
    );
  }
  const payload = payloadSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!payload.success || !/^r[a-zA-Z0-9._-]{1,79}$/.test(revisionId)) {
    return NextResponse.json(
      { ok: false, error: "invalid_request" },
      { status: 400 },
    );
  }

  try {
    const repository = new FirestoreCmsRepository();
    await repository.restorePageRevision(
      pageKey,
      revisionId,
      payload.data.expectedDraftVersion,
      admin.uid,
    );
    const editor = await loadCmsPageEditorData(pageKey, repository);
    return NextResponse.json({ ok: true, editor });
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
