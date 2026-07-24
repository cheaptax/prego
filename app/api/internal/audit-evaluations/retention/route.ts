import { NextResponse } from "next/server";
import {
  AuditEvaluationFeatureDisabledError,
  assertAuditEvaluationCapabilityEnabled,
} from "@/lib/audit-evaluation/feature-flags";
import { AuditEvaluationRetentionService } from "@/lib/audit-evaluation/retention-service";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  try {
    const asOf = new Date().toISOString();
    const result = await new AuditEvaluationRetentionService().execute({
      asOf,
      actor: {
        type: "SYSTEM",
        service: "audit-evaluation-retention-cron",
      },
      automatic: true,
    });
    return NextResponse.json(
      {
        ok: true,
        executed: result.executed,
        deletedCount: result.deletedCount,
        failedCount: result.failedCount,
        planHash: result.planHash,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch {
    const correlationId = crypto.randomUUID();
    console.error("audit_evaluation_retention_failed", { correlationId });
    return NextResponse.json(
      { ok: false, error: "retention_failed", correlationId },
      { status: 500 },
    );
  }
}
