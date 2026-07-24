import { NextResponse } from "next/server";
import {
  adminAuditEvaluationApiError,
  readAdminJson,
  requireAuditEvaluationAdmin,
} from "@/lib/audit-evaluation/admin-api";
import { FirestoreAuditEvaluationAdminRepository } from "@/lib/audit-evaluation/admin-repository";
import { adminCorrectionRequestSchema } from "@/lib/audit-evaluation/admin-types";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ caseId: string; quoteId: string }>;
};

export async function POST(request: Request, { params }: Props) {
  try {
    const admin = await requireAuditEvaluationAdmin(
      request,
      "auditEvaluations:write",
    );
    const { caseId, quoteId } = await params;
    const body = adminCorrectionRequestSchema.parse(
      await readAdminJson(request),
    );
    const result = await new FirestoreAuditEvaluationAdminRepository()
      .saveAdminCorrection({
        caseId,
        quoteId,
        ...body,
        actorUid: admin.uid,
        now: new Date().toISOString(),
      });
    return NextResponse.json(
      {
        ok: true,
        revision: result.quote.revision ?? 0,
        reportRegenerationRequired:
          result.evaluationCase.reportRegenerationRequired ?? false,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return adminAuditEvaluationApiError(error);
  }
}
