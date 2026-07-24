import { NextResponse } from "next/server";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
} from "@/lib/firebase/server";
import type { UserRecord } from "@/lib/firebase/schema";

export const runtime = "nodejs";

function guessContentType(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

export async function GET(
  req: Request,
  context: { params: Promise<{ uid: string }> },
) {
  try {
    await requireAdminCapability(req, "members:read");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const { uid } = await context.params;
  const snapshot = await adminDb().collection("users").doc(uid).get();
  if (!snapshot.exists) {
    return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
  }

  const user = snapshot.data() as UserRecord;
  const storagePath = user.businessCardPath?.trim();
  if (!storagePath) {
    if (user.businessCardUrl?.trim()) {
      return NextResponse.json({
        ok: true,
        url: user.businessCardUrl.trim(),
        contentType: guessContentType(user.businessCardUrl),
      });
    }
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  try {
    const bucket = adminStorage().bucket();
    const file = bucket.file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    const [metadata] = await file.getMetadata();
    const [url] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 60 * 60 * 1000,
    });

    return NextResponse.json({
      ok: true,
      url,
      contentType:
        typeof metadata.contentType === "string"
          ? metadata.contentType
          : guessContentType(storagePath),
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "storage_read_failed" },
      { status: 500 },
    );
  }
}
