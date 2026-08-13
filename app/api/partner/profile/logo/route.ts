import { NextResponse } from "next/server";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requirePartner,
} from "@/lib/firebase/server";
import type { PartnerRecord } from "@/lib/firebase/schema";

export const runtime = "nodejs";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg"]);

export async function GET(req: Request) {
  let session;
  try {
    session = await requirePartner(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const partnerId = session.profile.partnerId as string;
  const snapshot = await adminDb().collection("partners").doc(partnerId).get();
  if (!snapshot.exists) {
    return NextResponse.json(
      { ok: false, error: "partner_not_found" },
      { status: 404 },
    );
  }
  const partner = snapshot.data() as PartnerRecord;
  if (!partner.logoPath) {
    return NextResponse.json(
      { ok: false, error: "logo_not_found" },
      { status: 404 },
    );
  }
  try {
    const [buffer] = await adminStorage()
      .bucket()
      .file(partner.logoPath)
      .download();
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "content-type": partner.logoContentType || "image/png",
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "logo_unavailable" },
      { status: 404 },
    );
  }
}

export async function POST(req: Request) {
  let session;
  try {
    session = await requirePartner(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const formData = await req.formData();
  const file = formData.get("logo");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "missing_logo" },
      { status: 400 },
    );
  }
  if (!ALLOWED_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_LOGO_BYTES) {
    return NextResponse.json(
      { ok: false, error: "invalid_logo" },
      { status: 400 },
    );
  }

  const partnerId = session.profile.partnerId as string;
  const extension = file.type === "image/png" ? "png" : "jpg";
  const path = `partner-assets/${partnerId}/logo.${extension}`;
  await adminStorage()
    .bucket()
    .file(path)
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
        logoPath: path,
        logoContentType: file.type,
        logoUpdatedAt: now,
        updatedAt: now,
      } satisfies Partial<PartnerRecord>,
      { merge: true },
    );

  return NextResponse.json({
    ok: true,
    logoPath: path,
    logoContentType: file.type,
    logoUpdatedAt: now,
  });
}
