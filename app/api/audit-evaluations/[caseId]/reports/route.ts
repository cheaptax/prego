import type { NextRequest } from "next/server";
import { after, NextResponse } from "next/server";
import {
  authenticateAuditEvaluationCaseRequest,
  authenticateAuditEvaluationMutationRequest,
} from "@/lib/audit-evaluation/customer-api-access";
import { AuditEvaluationReportGenerationService } from "@/lib/audit-evaluation/report-generation-service";
import {
  NhAuditReportEvaluationService,
  nhAuditReportServiceErrorStatus,
} from "@/lib/audit-evaluation/nh-audit-report-service";
import { createDefaultNhAuditCustomerWeightsV2 } from "@/lib/audit-evaluation/nh-audit-v2-schemas";
import {
  AuditEvaluationReportService,
  reportServiceErrorStatus,
} from "@/lib/audit-evaluation/report-service";
import { auditEvaluationReviewApiError } from "@/lib/audit-evaluation/review-api-response";
import { AuditEvaluationReviewService } from "@/lib/audit-evaluation/review-service";
import { readLimitedJson } from "@/lib/audit-evaluation/api-security";

export const runtime = "nodejs";
export const maxDuration = 300;

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
    const rawVersion = request.nextUrl.searchParams.get("version");
    const selectedVersion = rawVersion === null
      ? undefined
      : Number(rawVersion);
    if (
      selectedVersion !== undefined &&
      (!Number.isInteger(selectedVersion) || selectedVersion <= 0)
    ) {
      return NextResponse.json(
        { ok: false, error: "report_not_found" },
        { status: 404 },
      );
    }
    const report = await new AuditEvaluationReportService()
      .getLatestReport(caseId, selectedVersion);
    return NextResponse.json(
      { ok: true, report },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "report_unavailable" },
      { status: reportServiceErrorStatus(error) },
    );
  }
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
  let body: {
    confirmationVersion?: unknown;
    weights?: unknown;
  } | null;
  try {
    body = await readLimitedJson(request, 10_000) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_input" },
      { status: 413 },
    );
  }
  const confirmationVersion = body?.confirmationVersion;
  if (
    !Number.isInteger(confirmationVersion) ||
    Number(confirmationVersion) <= 0
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid_input" },
      { status: 400 },
    );
  }
  try {
    const now = new Date().toISOString();
    const nhAuditEvaluationSnapshot =
      await new NhAuditReportEvaluationService().createSnapshot({
        caseId,
        confirmationVersion: Number(confirmationVersion),
        weights:
          body?.weights ?? createDefaultNhAuditCustomerWeightsV2(),
        actor: access.actor,
        now,
      });
    const result = await new AuditEvaluationReviewService().requestReport({
      caseId,
      confirmationVersion: Number(confirmationVersion),
      nhAuditEvaluationSnapshot,
      actor: access.actor,
      now,
    });
    if (result.report.status !== "COMPLETED") {
      after(async () => {
        const generation = await new AuditEvaluationReportGenerationService()
          .generate({
            caseId,
            reportVersion: result.report.reportVersion,
            now: new Date().toISOString(),
          });
        if (generation.status === "FAILED") {
          console.error("audit_report_generation_failed", {
            caseId,
            reportVersion: result.report.reportVersion,
          });
        }
      });
    }
    return NextResponse.json(
      {
        ok: true,
        reportVersion: result.report.reportVersion,
        status: result.report.status,
        replayed: result.replayed,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const nhStatus = nhAuditReportServiceErrorStatus(error);
    if (nhStatus !== 500) {
      return NextResponse.json(
        {
          ok: false,
          error:
            nhStatus === 400 ? "invalid_weights" : "report_unavailable",
        },
        { status: nhStatus },
      );
    }
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
