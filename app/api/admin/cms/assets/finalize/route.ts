import { Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CMS_ALLOWED_MIME_TYPES,
  CMS_MAX_ASSET_BYTES,
  CMS_SCHEMA_VERSION,
} from "@/lib/cms/constants";
import { FirestoreCmsRepository } from "@/lib/cms/repository";
import { matchesCmsFileSignature } from "@/lib/cms/file-signature";
import {
  cmsStableIdSchema,
  nonEmptyPlainTextSchema,
  safePlainTextSchema,
} from "@/lib/cms/schemas";
import { adminStorage } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
} from "@/lib/firebase/server";

export const runtime = "nodejs";

const payloadSchema = z
  .object({
    assetId: cmsStableIdSchema,
    storagePath: z.string().max(500),
    originalFileName: safePlainTextSchema.trim().min(1).max(255),
    mimeType: z.enum(CMS_ALLOWED_MIME_TYPES),
    byteSize: z.number().int().positive().max(CMS_MAX_ASSET_BYTES),
    width: z.number().int().positive().max(20_000).optional(),
    height: z.number().int().positive().max(20_000).optional(),
    alt: nonEmptyPlainTextSchema,
  })
  .strict();

export async function POST(request: Request) {
  let admin;
  try {
    admin = await requireAdminCapability(request, "cms:write");
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
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
  const fileName = payload.data.storagePath.split("/").at(-1);
  const expectedPrefix = `cms/drafts/${payload.data.assetId}/`;
  if (
    !fileName ||
    fileName.includes("\\") ||
    !payload.data.storagePath.startsWith(expectedPrefix) ||
    payload.data.storagePath.slice(expectedPrefix.length).includes("/")
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid_request" },
      { status: 400 },
    );
  }

  try {
    const file = adminStorage().bucket().file(payload.data.storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      return NextResponse.json(
        { ok: false, error: "upload_not_found" },
        { status: 404 },
      );
    }
    const [metadata] = await file.getMetadata();
    const storedSize = Number(metadata.size);
    if (
      metadata.contentType !== payload.data.mimeType ||
      storedSize !== payload.data.byteSize ||
      storedSize > CMS_MAX_ASSET_BYTES
    ) {
      await file.delete({ ignoreNotFound: true }).catch(() => undefined);
      return NextResponse.json(
        { ok: false, error: "upload_mismatch" },
        { status: 400 },
      );
    }
    const [signatureBytes] = await file.download({ start: 0, end: 15 });
    if (!matchesCmsFileSignature(signatureBytes, payload.data.mimeType)) {
      await file.delete({ ignoreNotFound: true }).catch(() => undefined);
      return NextResponse.json(
        { ok: false, error: "upload_mismatch" },
        { status: 400 },
      );
    }
    const now = Timestamp.now();
    const repository = new FirestoreCmsRepository();
    await repository.saveAsset(
      {
        schemaVersion: CMS_SCHEMA_VERSION,
        assetId: payload.data.assetId,
        status: "draft",
        storagePath: payload.data.storagePath,
        originalFileName: payload.data.originalFileName,
        mimeType: payload.data.mimeType,
        byteSize: storedSize,
        width: payload.data.width,
        height: payload.data.height,
        alt: payload.data.alt,
        createdAt: now,
        createdBy: admin.uid,
        updatedAt: now,
        updatedBy: admin.uid,
      },
      admin.uid,
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, error: "finalize_failed" },
      { status: 500 },
    );
  }
}
