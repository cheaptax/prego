import { NextResponse } from "next/server";
import {
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
} from "@/lib/firebase/server";
import {
  parseQuotePriceMasterWorkbook,
  validateQuotePriceMasterExcelRows,
} from "@/lib/quotes/cooperative-quote-price-master-excel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await requireAdminCapability(request, "auditQuotes:write");
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }
  const url = new URL(request.url);
  const fiscalYear = Number(
    url.searchParams.get("fiscalYear") ?? new Date().getFullYear() + 1,
  );
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "missing_file" },
      { status: 400 },
    );
  }
  const rows = await parseQuotePriceMasterWorkbook(
    Buffer.from(await file.arrayBuffer()),
  );
  const validation = await validateQuotePriceMasterExcelRows(rows, fiscalYear);
  return NextResponse.json({ ok: true, validation });
}
