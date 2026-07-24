import { NextResponse } from "next/server";
import { authErrorCode, authErrorStatus } from "@/lib/firebase/server";
import { CustomerClassificationService } from "@/lib/test-data/customer-classification-service";
import { authorizePurgeAdmin } from "@/lib/test-data/purge-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await authorizePurgeAdmin(request, false);
    const result = await new CustomerClassificationService().list();
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }
}
