import { NextResponse } from "next/server";
import { authErrorCode, authErrorStatus } from "@/lib/firebase/server";
import { authorizePurgeAdmin } from "@/lib/test-data/purge-runtime";
import { TestDashboardService } from "@/lib/test-data/test-dashboard-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await authorizePurgeAdmin(request, false);
    const dashboard = await new TestDashboardService().get();
    return NextResponse.json(
      { ok: true, dashboard },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }
}
