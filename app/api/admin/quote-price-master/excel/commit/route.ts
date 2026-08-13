import { NextResponse } from "next/server";
import {
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
} from "@/lib/firebase/server";
import {
  buildPayloadsFromWideExcelRows,
  parseQuotePriceMasterWorkbook,
  validateQuotePriceMasterExcelRows,
} from "@/lib/quotes/cooperative-quote-price-master-excel";
import {
  saveCooperativeQuotePriceMasterBulk,
} from "@/lib/quotes/cooperative-quote-price-master-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const startedAt = Date.now();
  let admin;
  try {
    admin = await requireAdminCapability(request, "auditQuotes:write");
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }
  const url = new URL(request.url);
  const strict = url.searchParams.get("strict") === "true";
  const fiscalYear = Number(
    url.searchParams.get("fiscalYear") ?? new Date().getFullYear() + 1,
  );
  if (!Number.isSafeInteger(fiscalYear) || fiscalYear < 2020 || fiscalYear > 2100) {
    return NextResponse.json(
      { ok: false, error: "invalid_fiscal_year" },
      { status: 400 },
    );
  }
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
  if (strict && !validation.ok) {
    return NextResponse.json(
      { ok: false, error: "validation_failed", validation },
      { status: 400 },
    );
  }
  const payloads = await buildPayloadsFromWideExcelRows({
    rows: validation.validRows,
    fiscalYear,
  });
  const now = new Date().toISOString();
  const result = await saveCooperativeQuotePriceMasterBulk({
    payloads,
    actor: { uid: admin.uid, email: admin.email },
    now,
  });
  console.info("[quote-price-master] excel_commit", {
    fiscalYear,
    totalRows: rows.length,
    validRows: validation.validRows.length,
    committed: result.committed,
    elapsedMs: Date.now() - startedAt,
  });
  return NextResponse.json({
    ok: true,
    validation,
    committed: result.committed,
    elapsedMs: Date.now() - startedAt,
  });
}
