import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateAuditEvaluationCaseRequest } from "@/lib/audit-evaluation/customer-api-access";
import { auditEvaluationUploadApiError } from "@/lib/audit-evaluation/upload-api-response";
import { AuditEvaluationUploadService } from "@/lib/audit-evaluation/upload-service";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ caseId: string }>;
};

export async function GET(request: NextRequest, { params }: Props) {
  const { caseId } = await params;
  const access = await authenticateAuditEvaluationCaseRequest(
    request,
    caseId,
  );
  if (!access) {
    return NextResponse.json(
      { ok: false, error: "access_denied" },
      { status: 401 },
    );
  }
  try {
    const workspace = await new AuditEvaluationUploadService()
      .getUploadWorkspace(access.evaluationCase);
    return NextResponse.json(
      { ok: true, ...workspace },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const response = auditEvaluationUploadApiError(error);
    return NextResponse.json(
      { ok: false, error: response.error },
      { status: response.status },
    );
  }
}
