import { NextResponse } from "next/server";
import { loadCmsAdminOverview } from "@/lib/cms/admin-console-data";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
} from "@/lib/firebase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAdminCapability(request, "cms:read");
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }

  try {
    const overview = await loadCmsAdminOverview(adminDb());
    return NextResponse.json({ ok: true, overview });
  } catch {
    return NextResponse.json(
      { ok: false, error: "cms_overview_unavailable" },
      { status: 500 },
    );
  }
}
