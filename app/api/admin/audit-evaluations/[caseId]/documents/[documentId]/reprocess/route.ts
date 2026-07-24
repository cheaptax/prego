import { after, NextResponse } from "next/server";
import {
  adminAuditEvaluationApiError,
  readAdminJson,
  requireAuditEvaluationAdmin,
} from "@/lib/audit-evaluation/admin-api";
import { FirestoreAuditEvaluationAdminRepository } from "@/lib/audit-evaluation/admin-repository";
import { adminDocumentReprocessRequestSchema } from "@/lib/audit-evaluation/admin-types";
import { AuditEvaluationParsingService } from "@/lib/audit-evaluation/parsing-service";

export const runtime = "nodejs";
export const maxDuration = 300;

type Props = {
  params: Promise<{ caseId: string; documentId: string }>;
};

export async function POST(request: Request, { params }: Props) {
  try {
    const admin = await requireAuditEvaluationAdmin(
      request,
      "auditEvaluations:write",
    );
    const { caseId, documentId } = await params;
    adminDocumentReprocessRequestSchema.parse(await readAdminJson(request));
    const result = await new FirestoreAuditEvaluationAdminRepository()
      .reprocessDocument({
        caseId,
        documentId,
        actorUid: admin.uid,
        now: new Date().toISOString(),
      });
    after(async () => {
      await new AuditEvaluationParsingService().processDocument({
        caseId,
        documentId,
        now: new Date().toISOString(),
      }).catch(() => undefined);
    });
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return adminAuditEvaluationApiError(error);
  }
}
