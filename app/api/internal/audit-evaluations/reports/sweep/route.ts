import { NextResponse } from "next/server";
import {
  AuditEvaluationFeatureDisabledError,
  assertAuditEvaluationCapabilityEnabled,
} from "@/lib/audit-evaluation/feature-flags";
import { AuditEvaluationReportGenerationService } from "@/lib/audit-evaluation/report-generation-service";
import { FirestoreAuditEvaluationReportRepository } from "@/lib/audit-evaluation/report-repository";

export const runtime = "nodejs";
export const maxDuration = 300;

const STALE_PENDING_MS = 5 * 60 * 1_000;
const MAX_SWEEP_REPORTS = 10;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (
    !cronSecret ||
    request.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    return NextResponse.json(
      { ok: false, error: "access_denied" },
      { status: 401 },
    );
  }
  try {
    assertAuditEvaluationCapabilityEnabled("enabled");
  } catch (error) {
    if (error instanceof AuditEvaluationFeatureDisabledError) {
      return NextResponse.json(
        { ok: true, skipped: true, reason: "feature_disabled" },
        { headers: { "cache-control": "private, no-store" } },
      );
    }
    throw error;
  }

  const now = new Date().toISOString();
  const repository = new FirestoreAuditEvaluationReportRepository();
  const generationService = new AuditEvaluationReportGenerationService({
    repository,
  });
  const recoverable = await repository.listRecoverableGenerations({
    now,
    staleAfterMilliseconds: STALE_PENDING_MS,
    limit: MAX_SWEEP_REPORTS,
  });
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  for (const report of recoverable) {
    const result = await generationService.generate({
      caseId: report.caseId,
      reportVersion: report.reportVersion,
      now: new Date().toISOString(),
    });
    if (result.status === "COMPLETED") completed += 1;
    else if (result.status === "FAILED") failed += 1;
    else skipped += 1;
  }
  return NextResponse.json(
    {
      ok: true,
      scannedCount: recoverable.length,
      completed,
      failed,
      skipped,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
