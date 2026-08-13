import { NextResponse } from "next/server";
import { readLimitedJson } from "@/lib/audit-evaluation/api-security-core";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requireAnyPermission,
} from "@/lib/firebase/server";
import type { PartnerRecord } from "@/lib/firebase/schema";
import { extractNhAuditEvaluationDefaults } from "@/lib/quotes/nh-audit-evaluation-defaults";
import { sanitizeNhAuditPartnerFormDraft } from "@/lib/quotes/nh-audit-quote-form";

export const runtime = "nodejs";

const MAX_PAYLOAD_BYTES = 64 * 1024;

type Params = { params: Promise<{ partnerId: string }> };

export async function PUT(req: Request, { params }: Params) {
  let admin;
  try {
    admin = await requireAnyPermission(req, [
      "partners:update",
      "auditQuotes:write",
    ]);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const { partnerId } = await params;
  if (!partnerId) {
    return NextResponse.json(
      { ok: false, error: "missing_partner" },
      { status: 400 },
    );
  }

  const partnerRef = adminDb().collection("partners").doc(partnerId);
  const snapshot = await partnerRef.get();
  if (!snapshot.exists) {
    return NextResponse.json(
      { ok: false, error: "partner_not_found" },
      { status: 404 },
    );
  }

  const payload = (await readLimitedJson(req, MAX_PAYLOAD_BYTES).catch(
    () => null,
  )) as { nhAuditEvaluationDefaults?: unknown } | null;
  const defaults = extractNhAuditEvaluationDefaults(
    sanitizeNhAuditPartnerFormDraft(payload?.nhAuditEvaluationDefaults),
  );
  if (!defaults) {
    return NextResponse.json(
      { ok: false, error: "empty_defaults" },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  await partnerRef.set(
    {
      nhAuditEvaluationDefaults: defaults,
      updatedAt: now,
      updatedBy: admin.decoded.uid,
      updatedByEmail: admin.decoded.email,
    } satisfies Partial<PartnerRecord>,
    { merge: true },
  );

  return NextResponse.json({
    ok: true,
    nhAuditEvaluationDefaults: defaults,
  });
}
