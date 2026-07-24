import { NextResponse } from "next/server";
import { z } from "zod";
import {
  adminAuditEvaluationApiError,
  readAdminJson,
  requireAuditEvaluationAdmin,
} from "@/lib/audit-evaluation/admin-api";
import {
  AuditEvaluationRetentionError,
  AuditEvaluationRetentionService,
} from "@/lib/audit-evaluation/retention-service";

export const runtime = "nodejs";
export const maxDuration = 300;

const executeSchema = z
  .object({
    confirm: z.literal(true),
    asOf: z.string().datetime({ offset: true }),
    expectedPlanHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export async function GET(request: Request) {
  try {
    await requireAuditEvaluationAdmin(request);
    const preview = await new AuditEvaluationRetentionService().preview();
    return NextResponse.json(
      { ok: true, preview },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return retentionErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAuditEvaluationAdmin(
      request,
      "auditEvaluations:write",
    );
    const payload = executeSchema.parse(await readAdminJson(request));
    const result = await new AuditEvaluationRetentionService().execute({
      asOf: payload.asOf,
      expectedPlanHash: payload.expectedPlanHash,
      actor: { type: "ADMIN", uid: admin.uid },
      automatic: false,
    });
    return NextResponse.json(
      { ok: true, result },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return retentionErrorResponse(error);
  }
}

function retentionErrorResponse(error: unknown) {
  if (error instanceof AuditEvaluationRetentionError) {
    const status = error.code === "retention_config_not_found"
      ? 409
      : 412;
    return NextResponse.json(
      { ok: false, error: error.code },
      { status },
    );
  }
  return adminAuditEvaluationApiError(error);
}
