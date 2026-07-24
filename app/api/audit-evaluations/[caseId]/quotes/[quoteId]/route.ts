import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateAuditEvaluationMutationRequest } from "@/lib/audit-evaluation/customer-api-access";
import { auditEvaluationReviewApiError } from "@/lib/audit-evaluation/review-api-response";
import { AuditEvaluationReviewService } from "@/lib/audit-evaluation/review-service";
import { readLimitedJson } from "@/lib/audit-evaluation/api-security";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ caseId: string; quoteId: string }>;
};

export async function PATCH(request: NextRequest, { params }: Props) {
  const { caseId, quoteId } = await params;
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
    field?: unknown;
    valueText?: unknown;
    reason?: unknown;
    expectedRevision?: unknown;
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
    const result = await new AuditEvaluationReviewService().saveCorrection({
      caseId,
      quoteId,
      field: body?.field as never,
      valueText: body?.valueText as never,
      reason: body?.reason as never,
      expectedRevision: body?.expectedRevision as never,
      actor: access.actor,
      now: new Date().toISOString(),
    });
    return NextResponse.json(
      {
        ok: true,
        revision: result.quote.revision ?? 0,
        requiresAdminReview: result.correction.requiresAdminReview,
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
