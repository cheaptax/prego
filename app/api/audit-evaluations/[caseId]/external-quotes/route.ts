import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  authenticateAuditEvaluationCaseRequest,
  authenticateAuditEvaluationMutationRequest,
} from "@/lib/audit-evaluation/customer-api-access";
import {
  deleteExternalManualQuote,
  listExternalManualQuotes,
  upsertExternalManualQuote,
} from "@/lib/audit-evaluation/external-manual-quote-repository";
import { readLimitedJson } from "@/lib/audit-evaluation/api-security";
import { adminDb } from "@/lib/firebase/admin";
import { AUDIT_EVALUATION_COLLECTIONS } from "@/lib/audit-evaluation/collections";
import { splitExternalManualQuoteMutationBody } from "@/lib/quotes/quote-automation-schemas";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ caseId: string }>;
};

export async function GET(request: NextRequest, { params }: Props) {
  const { caseId } = await params;
  const access = await authenticateAuditEvaluationCaseRequest(request, caseId);
  if (!access) {
    return NextResponse.json(
      { ok: false, error: "access_denied" },
      { status: 401 },
    );
  }
  const quotes = await listExternalManualQuotes(caseId);
  return NextResponse.json(
    { ok: true, quotes },
    { headers: { "cache-control": "private, no-store" } },
  );
}

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
  const caseSnap = await adminDb()
    .collection(AUDIT_EVALUATION_COLLECTIONS.cases)
    .doc(caseId)
    .get();
  if (!caseSnap.exists) {
    return NextResponse.json(
      { ok: false, error: "case_not_found" },
      { status: 404 },
    );
  }
  const quoteRequestId = String(caseSnap.data()?.quoteRequestId ?? "");
  let body: unknown;
  try {
    body = await readLimitedJson(request, 20_000);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_input" },
      { status: 413 },
    );
  }
  const { quoteId, payload } = splitExternalManualQuoteMutationBody(body);
  const result = await upsertExternalManualQuote({
    caseId,
    quoteRequestId,
    quoteId,
    payload,
    actorSubjectId: access.actor.subjectId,
    now: new Date().toISOString(),
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        issues: "issues" in result ? result.issues : undefined,
      },
      { status: result.error === "not_found" ? 404 : 400 },
    );
  }
  return NextResponse.json({ ok: true, quote: result.quote });
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const { caseId } = await params;
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
  const quoteId = request.nextUrl.searchParams.get("quoteId")?.trim() ?? "";
  if (!quoteId) {
    return NextResponse.json(
      { ok: false, error: "invalid_input" },
      { status: 400 },
    );
  }
  const deleted = await deleteExternalManualQuote({ caseId, quoteId });
  if (!deleted) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
