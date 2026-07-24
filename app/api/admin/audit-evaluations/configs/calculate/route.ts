import { NextResponse } from "next/server";
import {
  requireConfigAdmin,
} from "@/app/api/admin/audit-evaluations/configs/_shared";
import {
  AdminConfigValidationError,
  adminConfigCalculatePayloadSchema,
  calculateEvaluationPreview,
} from "@/lib/audit-evaluation/admin-config-validation";
import { readAdminJson } from "@/lib/audit-evaluation/admin-api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authorization = await requireConfigAdmin(request);
  if (authorization.response) return authorization.response;

  const payload = adminConfigCalculatePayloadSchema.safeParse(
    await readAdminJson(request, 256_000).catch(() => null),
  );
  if (!payload.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_request" },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json({
      ok: true,
      calculation: calculateEvaluationPreview(payload.data),
    });
  } catch (error) {
    if (error instanceof AdminConfigValidationError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.code,
          issues: error.issues,
        },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "calculation_failed" },
      { status: 422 },
    );
  }
}
