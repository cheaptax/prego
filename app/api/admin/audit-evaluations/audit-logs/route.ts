import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  adminAuditEvaluationApiError,
  requireAuditEvaluationAdmin,
} from "@/lib/audit-evaluation/admin-api";
import { FirestoreAuditEvaluationAdminRepository } from "@/lib/audit-evaluation/admin-repository";
import { parseAdminAuditLogFilters } from "@/lib/audit-evaluation/admin-types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requireAuditEvaluationAdmin(request);
    const items = await new FirestoreAuditEvaluationAdminRepository()
      .listAuditLogs(parseAdminAuditLogFilters(request.nextUrl.searchParams));
    return NextResponse.json(
      { ok: true, items },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return adminAuditEvaluationApiError(error);
  }
}
