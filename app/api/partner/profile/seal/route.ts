import { NextResponse } from "next/server";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requirePartner,
} from "@/lib/firebase/server";
import type { PartnerRecord } from "@/lib/firebase/schema";

export const runtime = "nodejs";

const MAX_SEAL_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg"]);

export async function POST(req: Request) {
  let session;
  try {
    session = await requirePartner(req);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }

  const formData = await req.formData();
  const file = formData.get("seal");
  if (
    !(file instanceof File) ||
    !ALLOWED_TYPES.has(file.type) ||
    file.size <= 0 ||
    file.size > MAX_SEAL_BYTES
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid_seal" },
      { status: 400 },
    );
  }

  const partnerId = session.profile.partnerId as string;
  const extension = file.type === "image/png" ? "png" : "jpg";
  const sealPath = `partner-assets/${partnerId}/seal.${extension}`;
  await adminStorage()
    .bucket()
    .file(sealPath)
    .save(Buffer.from(await file.arrayBuffer()), {
      metadata: {
        contentType: file.type,
        cacheControl: "private, no-store",
      },
    });

  const now = new Date().toISOString();
  await adminDb()
    .collection("partners")
    .doc(partnerId)
    .set(
      {
        sealPath,
        sealContentType: file.type,
        sealUpdatedAt: now,
        updatedAt: now,
      } satisfies Partial<PartnerRecord>,
      { merge: true },
    );

  return NextResponse.json({ ok: true, sealPath });
}
