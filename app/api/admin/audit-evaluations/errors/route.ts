import { type NextRequest, NextResponse } from "next/server";
import {
  adminAuditEvaluationApiError,
  requireAuditEvaluationAdmin,
} from "@/lib/audit-evaluation/admin-api";
import { FirestoreAuditEvaluationAdminRepository } from "@/lib/audit-evaluation/admin-repository";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requireAuditEvaluationAdmin(request);
    const items = await new FirestoreAuditEvaluationAdminRepository()
      .listErrors();
    const type = request.nextUrl.searchParams.get("type")?.trim();
    const filteredItems = type
      ? items.filter((item) => item.type === type)
      : items;
    return NextResponse.json(
      { ok: true, items: filteredItems },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return adminAuditEvaluationApiError(error);
  }
}
