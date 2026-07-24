import { after, NextResponse } from "next/server";
import {
  adminAuditEvaluationApiError,
  readAdminJson,
  requireAuditEvaluationAdmin,
} from "@/lib/audit-evaluation/admin-api";
import {
  AdminAuditEvaluationError,
  FirestoreAuditEvaluationAdminRepository,
} from "@/lib/audit-evaluation/admin-repository";
import { adminReportRegenerationRequestSchema } from "@/lib/audit-evaluation/admin-types";
import { assertAuditEvaluationCapabilityEnabled } from "@/lib/audit-evaluation/feature-flags";
import { AuditEvaluationReportGenerationService } from "@/lib/audit-evaluation/report-generation-service";

export const runtime = "nodejs";
export const maxDuration = 300;

type Props = {
  params: Promise<{ caseId: string; reportVersion: string }>;
};

export async function POST(request: Request, { params }: Props) {
  try {
    const admin = await requireAuditEvaluationAdmin(
      request,
      "auditEvaluations:write",
    );
    assertAuditEvaluationCapabilityEnabled("reportDownloadEnabled");
    const { caseId, reportVersion: rawReportVersion } = await params;
    const reportVersion = Number(rawReportVersion);
    if (!Number.isInteger(reportVersion) || reportVersion <= 0) {
      throw new AdminAuditEvaluationError("report_not_found");
    }
    const body = adminReportRegenerationRequestSchema.parse(
      await readAdminJson(request),
    );
    const result = await new FirestoreAuditEvaluationAdminRepository()
      .regenerateReport({
        caseId,
        sourceReportVersion: reportVersion,
        expectedSourceVersion: body.expectedSourceVersion,
        actorUid: admin.uid,
        now: new Date().toISOString(),
      });
    after(async () => {
      await new AuditEvaluationReportGenerationService().generate({
        caseId,
        reportVersion: result.report.reportVersion,
        now: new Date().toISOString(),
      }).catch(() => undefined);
    });
    return NextResponse.json(
      {
        ok: true,
        reportVersion: result.report.reportVersion,
        status: result.report.status,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return adminAuditEvaluationApiError(error);
  }
}
