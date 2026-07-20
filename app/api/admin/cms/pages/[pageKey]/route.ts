import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CMS_PAGE_KEYS,
  type CmsPageKey,
} from "@/lib/cms/constants";
import { loadCmsPageEditorData } from "@/lib/cms/page-editor-data";
import {
  CmsRepositoryError,
  FirestoreCmsRepository,
} from "@/lib/cms/repository";
import {
  cmsPageContentSchema,
  cmsThemeOverridesSchema,
} from "@/lib/cms/schemas";
import {
  authErrorCode,
  authErrorStatus,
  requireAdmin,
} from "@/lib/firebase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const savePayloadSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    content: cmsPageContentSchema,
    theme: cmsThemeOverridesSchema.optional(),
  })
  .strict();

function isCmsPageKey(value: string): value is CmsPageKey {
  return (CMS_PAGE_KEYS as readonly string[]).includes(value);
}

function repositoryErrorResponse(error: CmsRepositoryError) {
  return NextResponse.json(
    { ok: false, error: error.code },
    {
      status:
        error.code === "version_conflict"
          ? 409
          : error.code === "draft_not_found" ||
              error.code === "revision_not_found"
            ? 404
            : 400,
    },
  );
}

async function authorize(request: Request) {
  try {
    return { admin: await requireAdmin(request), response: null };
  } catch (error) {
    return {
      admin: null,
      response: NextResponse.json(
        { ok: false, error: authErrorCode(error) },
        { status: authErrorStatus(error) },
      ),
    };
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ pageKey: string }> },
) {
  const authorization = await authorize(request);
  if (authorization.response) return authorization.response;
  const { pageKey } = await context.params;
  if (!isCmsPageKey(pageKey)) {
    return NextResponse.json(
      { ok: false, error: "page_not_found" },
      { status: 404 },
    );
  }

  try {
    const editor = await loadCmsPageEditorData(pageKey);
    return NextResponse.json({ ok: true, editor });
  } catch {
    return NextResponse.json(
      { ok: false, error: "editor_unavailable" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ pageKey: string }> },
) {
  const authorization = await authorize(request);
  if (authorization.response || !authorization.admin) {
    return authorization.response;
  }
  const { pageKey } = await context.params;
  if (!isCmsPageKey(pageKey)) {
    return NextResponse.json(
      { ok: false, error: "page_not_found" },
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
    await repository.saveDraftPage({
      pageKey,
      content: payload.data.content,
      theme: payload.data.theme,
      expectedVersion: payload.data.expectedVersion,
      actorUid: authorization.admin.uid,
    });
    const editor = await loadCmsPageEditorData(pageKey, repository);
    return NextResponse.json({ ok: true, editor });
  } catch (error) {
    if (error instanceof CmsRepositoryError) {
      return repositoryErrorResponse(error);
    }
    return NextResponse.json(
      { ok: false, error: "editor_unavailable" },
      { status: 500 },
    );
  }
}
