import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateAuditEvaluationCaseRequest } from "@/lib/audit-evaluation/customer-api-access";
import { auditEvaluationUploadApiError } from "@/lib/audit-evaluation/upload-api-response";
import { AuditEvaluationUploadService } from "@/lib/audit-evaluation/upload-service";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ caseId: string; documentId: string }>;
};

export async function GET(request: NextRequest, { params }: Props) {
  const { caseId, documentId } = await params;
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
    const result = await new AuditEvaluationUploadService()
      .createDownloadUrl({
        evaluationCase: access.evaluationCase,
        documentId,
        now: new Date().toISOString(),
      });
    return NextResponse.json(
      { ok: true, ...result },
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
