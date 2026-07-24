import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readLimitedJson } from "@/lib/audit-evaluation/api-security";
import { authenticateAuditEvaluationMutationRequest } from "@/lib/audit-evaluation/customer-api-access";
import {
  NhAuditReportEvaluationService,
  nhAuditReportServiceErrorStatus,
} from "@/lib/audit-evaluation/nh-audit-report-service";

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
  if (
    !Number.isInteger(body?.confirmationVersion) ||
    Number(body?.confirmationVersion) <= 0
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid_input" },
      { status: 400 },
    );
  }
  try {
    const preview = await new NhAuditReportEvaluationService().preview({
      caseId,
      confirmationVersion: Number(body?.confirmationVersion),
      weights: body?.weights,
      actor: access.actor,
      now: new Date().toISOString(),
    });
    return NextResponse.json(
      { ok: true, preview },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    const status = nhAuditReportServiceErrorStatus(error);
    return NextResponse.json(
      {
        ok: false,
        error:
          status === 400 ? "invalid_weights" : "preview_unavailable",
      },
      { status },
    );
  }
}
