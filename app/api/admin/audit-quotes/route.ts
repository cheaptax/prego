import { NextResponse } from "next/server";
import { toAuditQuoteListItem } from "@/lib/audit-quote/admin";
import { AUDIT_QUOTE_REQUESTS } from "@/lib/audit-quote/collections";
import { isAuditQuoteStatus } from "@/lib/audit-quote/status";
import type { AuditQuoteRequestRecord } from "@/lib/audit-quote/types";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requireAdmin,
} from "@/lib/firebase/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) }
    );
  }

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status")?.trim() ?? "";

  const db = adminDb();
  const snapshot = await db.collection(AUDIT_QUOTE_REQUESTS).get();
  let items = snapshot.docs
    .map((doc) => doc.data() as AuditQuoteRequestRecord)
    .map((record) => toAuditQuoteListItem(record))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (statusFilter && isAuditQuoteStatus(statusFilter)) {
    items = items.filter((item) => item.status === statusFilter);
  }

  const receivedCount = snapshot.docs.filter((doc) => {
    const data = doc.data() as AuditQuoteRequestRecord;
    return data.status === "received";
  }).length;

  return NextResponse.json({
    ok: true,
    receivedCount,
    items,
    syncedAt: new Date().toISOString(),
  });
}
