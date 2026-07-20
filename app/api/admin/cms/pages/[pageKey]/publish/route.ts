import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CMS_PAGE_KEYS,
  CMS_PAGE_ROUTES,
  type CmsPageKey,
} from "@/lib/cms/constants";
import {
  CmsRepositoryError,
  FirestoreCmsRepository,
} from "@/lib/cms/repository";
import { publishDraftAssetsForPage } from "@/lib/cms/asset-publishing";
import {
  authErrorCode,
  authErrorStatus,
  requireAdmin,
} from "@/lib/firebase/server";

export const runtime = "nodejs";

const payloadSchema = z
  .object({
    expectedDraftVersion: z.number().int().positive(),
  })
  .strict();

function isCmsPageKey(value: string): value is CmsPageKey {
  return (CMS_PAGE_KEYS as readonly string[]).includes(value);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ pageKey: string }> },
) {
  let admin;
  try {
    admin = await requireAdmin(request);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }

  const { pageKey } = await context.params;
  if (!isCmsPageKey(pageKey)) {
    return NextResponse.json(
      { ok: false, error: "page_not_found" },
      { status: 404 },
    );
  }
  const payload = payloadSchema.safeParse(
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
    await publishDraftAssetsForPage(
      pageKey,
      payload.data.expectedDraftVersion,
      admin.uid,
      repository,
    );
    await repository.publishPage(
      pageKey,
      payload.data.expectedDraftVersion,
      admin.uid,
    );
    revalidatePath(CMS_PAGE_ROUTES[pageKey]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof CmsRepositoryError) {
      const status =
        error.code === "version_conflict"
          ? 409
          : error.code === "validation_failed"
            ? 422
          : error.code === "draft_not_found"
            ? 404
            : 400;
      return NextResponse.json(
        { ok: false, error: error.code },
        { status },
      );
    }
    return NextResponse.json(
      { ok: false, error: "publish_failed" },
      { status: 500 },
    );
  }
}
