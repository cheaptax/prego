import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  addAdminAuditLog,
  authErrorCode,
  authErrorStatus,
  requirePermission,
} from "@/lib/firebase/server";
import type { PartnerRecord } from "@/lib/firebase/schema";
import {
  parsePartnerAssetFile,
  readPartnerAssetFile,
  savePartnerAssetFile,
} from "@/lib/partner/partner-assets";

export const runtime = "nodejs";

type Params = { params: Promise<{ partnerId: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    await requirePermission(req, "partners:read");
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }
  const { partnerId } = await params;
  const snapshot = await adminDb().collection("partners").doc(partnerId).get();
  if (!snapshot.exists) {
    return NextResponse.json(
      { ok: false, error: "partner_not_found" },
      { status: 404 },
    );
  }
  const asset = await readPartnerAssetFile(
    snapshot.data() as PartnerRecord,
    "logo",
  );
  if (!asset.ok) {
    return NextResponse.json(
      { ok: false, error: asset.error },
      { status: 404 },
    );
  }
  return new NextResponse(new Uint8Array(asset.buffer), {
    status: 200,
    headers: {
      "content-type": asset.contentType,
      "cache-control": "private, no-store",
    },
  });
}

export async function POST(req: Request, { params }: Params) {
  let admin;
  try {
    admin = await requirePermission(req, "partners:update");
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }
  const { partnerId } = await params;
  const snapshot = await adminDb().collection("partners").doc(partnerId).get();
  if (!snapshot.exists) {
    return NextResponse.json(
      { ok: false, error: "partner_not_found" },
      { status: 404 },
    );
  }
  const partner = snapshot.data() as PartnerRecord;
  if (partner.status === "terminated") {
    return NextResponse.json(
      { ok: false, error: "terminated_partner_immutable" },
      { status: 409 },
    );
  }
  const parsed = parsePartnerAssetFile(
    (await req.formData()).get("logo"),
    "logo",
  );
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.error },
      { status: 400 },
    );
  }
  const saved = await savePartnerAssetFile({
    partnerId,
    kind: "logo",
    file: parsed.file,
    actor: { uid: admin.decoded.uid, email: admin.decoded.email },
  });
  await addAdminAuditLog(adminDb(), {
    actorId: admin.decoded.uid,
    actorEmail: admin.decoded.email,
    actorRole: admin.context.adminRole,
    requiredPermission: "partners:update",
    action: "partner.logo_uploaded",
    targetType: "partner",
    targetId: partnerId,
    metadata: { partnerName: partner.displayName },
  });
  return NextResponse.json({
    ok: true,
    logoPath: saved.path,
    logoContentType: saved.contentType,
    logoUpdatedAt: saved.updatedAt,
  });
}
