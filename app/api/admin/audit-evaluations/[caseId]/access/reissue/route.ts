import { NextResponse } from "next/server";
import {
  adminAuditEvaluationApiError,
  readAdminJson,
  requireAuditEvaluationAdmin,
} from "@/lib/audit-evaluation/admin-api";
import { FirestoreAuditEvaluationAdminRepository } from "@/lib/audit-evaluation/admin-repository";
import { adminAccessReissueRequestSchema } from "@/lib/audit-evaluation/admin-types";
import { assertAuditEvaluationCapabilityEnabled } from "@/lib/audit-evaluation/feature-flags";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ caseId: string }>;
};

export async function POST(request: Request, { params }: Props) {
  try {
    const admin = await requireAuditEvaluationAdmin(
      request,
      "auditEvaluations:write",
    );
    assertAuditEvaluationCapabilityEnabled("customerEntryEnabled");
    const { caseId } = await params;
    const body = adminAccessReissueRequestSchema.parse(
      await readAdminJson(request),
    );
    const result = await new FirestoreAuditEvaluationAdminRepository()
      .reissueAccess({
        caseId,
        extendDays: body.extendDays,
        expectedExpiresAt: body.expectedExpiresAt,
        actorUid: admin.uid,
        now: new Date().toISOString(),
      });
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return adminAuditEvaluationApiError(error);
  }
}
