import { type NextRequest, NextResponse } from "next/server";
import {
  adminAuditEvaluationApiError,
  requireAuditEvaluationAdmin,
} from "@/lib/audit-evaluation/admin-api";
import {
  AuditEvaluationMonitoringError,
  AuditEvaluationMonitoringService,
} from "@/lib/audit-evaluation/monitoring-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requireAuditEvaluationAdmin(request);
    const now = new Date();
    const defaultFrom = new Date(
      now.getTime() - 24 * 60 * 60 * 1_000,
    ).toISOString();
    const metrics = await new AuditEvaluationMonitoringService().read({
      from: request.nextUrl.searchParams.get("from") ?? defaultFrom,
      to: request.nextUrl.searchParams.get("to") ?? now.toISOString(),
    });
    return NextResponse.json(
      { ok: true, metrics },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof AuditEvaluationMonitoringError) {
      return NextResponse.json(
        { ok: false, error: error.code },
        { status: 400 },
      );
    }
    return adminAuditEvaluationApiError(error);
  }
}
