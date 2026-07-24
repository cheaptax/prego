import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateAuditEvaluationMutationRequest } from "@/lib/audit-evaluation/customer-api-access";
import { auditEvaluationReviewApiError } from "@/lib/audit-evaluation/review-api-response";
import { AuditEvaluationReviewService } from "@/lib/audit-evaluation/review-service";
import { readLimitedJson } from "@/lib/audit-evaluation/api-security";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ caseId: string }>;
};

export async function POST(request: NextRequest, { params }: Props) {
  const { caseId } = await params;
  const access = await authenticateAuditEvaluationMutationRequest(
    request,
    caseId,
  );
  if (!access) {
    return NextResponse.json(
      { ok: false, error: "access_denied" },
      { status: 401 },
    );
  }
  let body: {
    finalAcknowledged?: unknown;
    expectedQuoteRevisions?: unknown;
  } | null;
  try {
    body = await readLimitedJson(request, 20_000) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_input" },
      { status: 413 },
    );
  }
  try {
    const result = await new AuditEvaluationReviewService().confirmCase({
      caseId,
      finalAcknowledged: body?.finalAcknowledged as never,
      expectedQuoteRevisions: body?.expectedQuoteRevisions as never,
      actor: access.actor,
      now: new Date().toISOString(),
    });
    return NextResponse.json(
      {
        ok: true,
        confirmationVersion: result.confirmation.version,
        status: result.evaluationCase.status,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const response = auditEvaluationReviewApiError(error);
    return NextResponse.json(
      {
        ok: false,
        error: response.error,
        issues: response.issues,
      },
      { status: response.status },
    );
  }
}
