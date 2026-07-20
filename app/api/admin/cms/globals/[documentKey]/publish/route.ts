import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { publishDraftAssetsForGlobal } from "@/lib/cms/asset-publishing";
import { CMS_GLOBAL_KEYS, type CmsGlobalKey } from "@/lib/cms/constants";
import {
  CmsRepositoryError,
  FirestoreCmsRepository,
} from "@/lib/cms/repository";
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

function isCmsGlobalKey(value: string): value is CmsGlobalKey {
  return (CMS_GLOBAL_KEYS as readonly string[]).includes(value);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ documentKey: string }> },
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
  const { documentKey } = await context.params;
  if (!isCmsGlobalKey(documentKey)) {
    return NextResponse.json(
      { ok: false, error: "common_area_not_found" },
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
    await publishDraftAssetsForGlobal(
      documentKey,
      payload.data.expectedDraftVersion,
      admin.uid,
      repository,
    );
    await repository.publishGlobal(
      documentKey,
      payload.data.expectedDraftVersion,
      admin.uid,
    );
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof CmsRepositoryError) {
      return NextResponse.json(
        { ok: false, error: error.code },
        {
          status:
            error.code === "version_conflict"
              ? 409
              : error.code === "draft_not_found"
                ? 404
                : error.code === "validation_failed"
                  ? 422
                  : 400,
        },
      );
    }
    return NextResponse.json(
      { ok: false, error: "publish_failed" },
      { status: 500 },
    );
  }
}
