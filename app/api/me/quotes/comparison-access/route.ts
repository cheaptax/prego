import { NextResponse } from "next/server";
import { AuditEvaluationCustomerAccessService } from "@/lib/audit-evaluation/customer-access-service";
import { AUDIT_EVALUATION_SESSION_COOKIE } from "@/lib/audit-evaluation/customer-access-token";
import {
  AuditEvaluationFeatureDisabledError,
} from "@/lib/audit-evaluation/feature-flags";
import {
  InboxReportBridgeError,
  isReportWorkspaceReady,
  prepareInboxCaseForNhAuditReport,
} from "@/lib/audit-evaluation/inbox-report-bridge";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requireQuoteInboxMember,
} from "@/lib/firebase/server";
import type { QuoteRequestRecord } from "@/lib/firebase/schema";
import { canCustomerReadQuoteRequest } from "@/lib/quotes/quote-access";
import { comparisonRedirectPath } from "@/lib/quotes/customer-quote-comparison";
import { readLimitedJson } from "@/lib/audit-evaluation/api-security-core";

export const runtime = "nodejs";

const MAX_PAYLOAD_BYTES = 4 * 1024;

export async function POST(req: Request) {
  let memberSession;
  try {
    memberSession = await requireQuoteInboxMember(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const payload = (await readLimitedJson(req, MAX_PAYLOAD_BYTES).catch(
    () => null,
  )) as { quoteRequestId?: unknown } | null;
  const quoteRequestId =
    typeof payload?.quoteRequestId === "string"
      ? payload.quoteRequestId.trim()
      : "";
  if (!quoteRequestId) {
    return NextResponse.json(
      { ok: false, error: "invalid_input" },
      { status: 400 },
    );
  }

  const { decoded } = memberSession;
  const db = adminDb();
  const requestSnapshot = await db
    .collection("quoteRequests")
    .doc(quoteRequestId)
    .get();
  if (!requestSnapshot.exists) {
    return NextResponse.json(
      { ok: false, error: "quote_request_not_found" },
      { status: 404 },
    );
  }
  const quoteRequest = {
    ...(requestSnapshot.data() as QuoteRequestRecord),
    id: quoteRequestId,
  };
  if (!canCustomerReadQuoteRequest(decoded, quoteRequest)) {
    return NextResponse.json(
      { ok: false, error: "permission_denied" },
      { status: 403 },
    );
  }
  if (
    quoteRequest.sourceType !== "audit_quote" ||
    !quoteRequest.sourceId
  ) {
    return NextResponse.json(
      { ok: false, error: "not_audit_quote_request" },
      { status: 400 },
    );
  }

  const email = decoded.email?.trim() ?? "";
  if (!email) {
    return NextResponse.json(
      { ok: false, error: "email_required" },
      { status: 400 },
    );
  }

  try {
    const service = new AuditEvaluationCustomerAccessService();
    const grant = await service.createQuoteInboxCustomerSession({
      uid: decoded.uid,
      email,
      auditQuoteRequestId: quoteRequest.sourceId,
      now: new Date().toISOString(),
    });
    if (!grant) {
      return NextResponse.json(
        { ok: false, error: "comparison_unavailable" },
        { status: 409 },
      );
    }

    let evaluationCase = grant.evaluationCase;
    try {
      evaluationCase = await prepareInboxCaseForNhAuditReport({
        evaluationCase: grant.evaluationCase,
        actor: { type: "CUSTOMER", subjectId: decoded.uid },
        now: new Date().toISOString(),
        cooperativeNameSnapshot: quoteRequest.cooperativeName,
        fiscalYear: quoteRequest.fiscalYear,
      });
    } catch (error) {
      if (
        !(error instanceof InboxReportBridgeError) ||
        error.code !== "insufficient_nh_quotes"
      ) {
        console.error("inbox_report_bridge_failed", {
          caseId: grant.evaluationCase.id,
          code:
            error instanceof InboxReportBridgeError
              ? error.code
              : "unknown",
        });
      }
    }

    const reportWorkspaceReady = isReportWorkspaceReady(
      evaluationCase.status,
    );
    const reportAvailable = evaluationCase.status === "COMPLETED";
    const redirectTo = comparisonRedirectPath({
      caseId: evaluationCase.id,
      reportAvailable,
      reportWorkspaceReady,
    });
    const response = NextResponse.json({
      ok: true,
      caseId: evaluationCase.id,
      reportAvailable,
      reportWorkspaceReady,
      redirectTo,
    });
    response.cookies.set({
      name: AUDIT_EVALUATION_SESSION_COOKIE,
      value: grant.rawSessionToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(grant.session.expiresAt),
    });
    return response;
  } catch (error) {
    if (error instanceof AuditEvaluationFeatureDisabledError) {
      return NextResponse.json(
        { ok: false, error: "feature_disabled" },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "comparison_unavailable" },
      { status: 409 },
    );
  }
}
