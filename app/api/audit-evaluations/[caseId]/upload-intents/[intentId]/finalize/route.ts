import type { NextRequest } from "next/server";
import { after, NextResponse } from "next/server";
import { authenticateAuditEvaluationMutationRequest } from "@/lib/audit-evaluation/customer-api-access";
import { auditEvaluationUploadApiError } from "@/lib/audit-evaluation/upload-api-response";
import { AuditEvaluationParsingService } from "@/lib/audit-evaluation/parsing-service";
import { AuditEvaluationUploadService } from "@/lib/audit-evaluation/upload-service";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ caseId: string; intentId: string }>;
};

export async function POST(request: NextRequest, { params }: Props) {
  const { caseId, intentId } = await params;
  const access = await authenticateAuditEvaluationMutationRequest(
    request,
    caseId,
    { requireJson: false },
  );
  if (!access) {
    return NextResponse.json(
      { ok: false, error: "access_denied" },
      { status: 401 },
    );
  }
  try {
    const document = await new AuditEvaluationUploadService()
      .finalizeUpload({
        evaluationCase: access.evaluationCase,
        actor: access.actor,
        intentId,
        idempotencyKey:
          request.headers.get("idempotency-key")?.trim() ?? "",
        now: new Date().toISOString(),
      });
    after(async () => {
      await new AuditEvaluationParsingService()
        .processDocument({
          caseId,
          documentId: document.id,
          now: new Date().toISOString(),
        })
        .catch(() => undefined);
    });
    return NextResponse.json(
      { ok: true, document },
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
