import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  adminAuditEvaluationApiError,
  requireAuditEvaluationAdmin,
} from "@/lib/audit-evaluation/admin-api";
import { FirestoreAuditEvaluationAdminRepository } from "@/lib/audit-evaluation/admin-repository";
import { parseAdminCaseFilters } from "@/lib/audit-evaluation/admin-types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requireAuditEvaluationAdmin(request);
    const result = await new FirestoreAuditEvaluationAdminRepository()
      .listCases(parseAdminCaseFilters(request.nextUrl.searchParams));
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return adminAuditEvaluationApiError(error);
  }
}
