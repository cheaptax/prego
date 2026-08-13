import { NextResponse } from "next/server";
import { AUDIT_QUOTE_REQUESTS } from "@/lib/audit-quote/collections";
import type { AuditQuoteRequestRecord } from "@/lib/audit-quote/types";
import {
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
} from "@/lib/firebase/server";
import { adminDb } from "@/lib/firebase/admin";
import type { QuoteAssignmentRecord } from "@/lib/firebase/schema";
import {
  getQuoteAutomationPlan,
  inboxQuoteRequestId,
  saveQuoteAutomationPlan,
} from "@/lib/quotes/quote-automation-repository";

export const runtime = "nodejs";

type Params = { params: Promise<{ requestId: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    await requireAdminCapability(req, "auditQuotes:read");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }
  const { requestId } = await params;
  const quoteRequestId = inboxQuoteRequestId(requestId);
  const [{ plan, presets }, assignmentsSnap] = await Promise.all([
    getQuoteAutomationPlan(quoteRequestId),
    adminDb()
      .collection("quoteAssignments")
      .where("quoteRequestId", "==", quoteRequestId)
      .limit(100)
      .get(),
  ]);
  const assignments = assignmentsSnap.docs.map((document) => ({
    ...(document.data() as QuoteAssignmentRecord),
    id: document.id,
  }));
  return NextResponse.json({
    ok: true,
    quoteRequestId,
    auditQuoteRequestId: requestId,
    plan,
    presets,
    assignments: assignments.filter((item) => item.status !== "revoked"),
  });
}

export async function PUT(req: Request, { params }: Params) {
  let admin;
  try {
    admin = await requireAdminCapability(req, "auditQuotes:write");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }
  const { requestId } = await params;
  const quoteRequestId = inboxQuoteRequestId(requestId);
  const requestSnap = await adminDb()
    .collection(AUDIT_QUOTE_REQUESTS)
    .doc(requestId)
    .get();
  if (!requestSnap.exists) {
    return NextResponse.json(
      { ok: false, error: "request_not_found" },
      { status: 404 },
    );
  }
  const requestData = requestSnap.data() as AuditQuoteRequestRecord;
  const payload = await req.json().catch(() => null);
  const result = await saveQuoteAutomationPlan({
    quoteRequestId,
    auditQuoteRequestId: requestId,
    cooperativeName: requestData.targetCooperativeName,
    fiscalYear: requestData.fiscalYear,
    payload,
    actor: {
      uid: admin.uid,
      email: admin.email,
    },
    now: new Date().toISOString(),
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, issues: result.issues },
      { status: 400 },
    );
  }
  return NextResponse.json({
    ok: true,
    plan: result.plan,
    presets: result.presets,
  });
}
