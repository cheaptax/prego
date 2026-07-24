import { NextResponse } from "next/server";
import {
  adminAuditEvaluationApiError,
  requireAuditEvaluationAdmin,
} from "@/lib/audit-evaluation/admin-api";
import { FirestoreAuditEvaluationAdminRepository } from "@/lib/audit-evaluation/admin-repository";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ caseId: string }>;
};

export async function GET(request: Request, { params }: Props) {
  try {
    await requireAuditEvaluationAdmin(request);
    const { caseId } = await params;
    const detail = await new FirestoreAuditEvaluationAdminRepository()
      .getDetail(caseId);
    if (!detail) {
      return NextResponse.json(
        { ok: false, error: "case_not_found" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { ok: true, item: detail },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return adminAuditEvaluationApiError(error);
  }
}
