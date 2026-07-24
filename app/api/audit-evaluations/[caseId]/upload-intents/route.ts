import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAuditEvaluationMutationRequest } from "@/lib/audit-evaluation/customer-api-access";
import { auditEvaluationUploadApiError } from "@/lib/audit-evaluation/upload-api-response";
import { AuditEvaluationUploadService } from "@/lib/audit-evaluation/upload-service";
import { readLimitedJson } from "@/lib/audit-evaluation/api-security";

export const runtime = "nodejs";

const payloadSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(200),
    size: z.number().int().nonnegative(),
  })
  .strict();

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
  let rawPayload: unknown;
  try {
    rawPayload = await readLimitedJson(request, 2_048);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_request" },
      { status: 400 },
    );
  }
  const payload = payloadSchema.safeParse(rawPayload);
  if (!payload.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_request" },
      { status: 400 },
    );
  }
  try {
    const intent = await new AuditEvaluationUploadService()
      .createUploadIntent({
        evaluationCase: access.evaluationCase,
        ...payload.data,
        idempotencyKey:
          request.headers.get("idempotency-key")?.trim() ?? "",
        now: new Date().toISOString(),
      });
    return NextResponse.json(
      { ok: true, ...intent },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const response = auditEvaluationUploadApiError(error);
    return NextResponse.json(
      { ok: false, error: response.error },
      { status: response.status },
    );
  }
}
