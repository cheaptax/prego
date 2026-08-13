import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requirePartner,
} from "@/lib/firebase/server";
import type { PartnerRecord } from "@/lib/firebase/schema";
import {
  extractNhAuditEvaluationDefaults,
  sanitizeNhAuditEvaluationDefaults,
} from "@/lib/quotes/nh-audit-evaluation-defaults";
import { sanitizeNhAuditPartnerFormDraft } from "@/lib/quotes/nh-audit-quote-form";
import { readLimitedJson } from "@/lib/audit-evaluation/api-security-core";

export const runtime = "nodejs";

const MAX_PAYLOAD_BYTES = 64 * 1024;

export async function GET(req: Request) {
  let session;
  try {
    session = await requirePartner(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const partnerId = session.profile.partnerId as string;
  const snap = await adminDb().collection("partners").doc(partnerId).get();
  const partner = (snap.data() ?? {}) as PartnerRecord;
  return NextResponse.json({
    ok: true,
    nhAuditEvaluationDefaults: sanitizeNhAuditEvaluationDefaults(
      partner.nhAuditEvaluationDefaults,
    ),
  });
}

export async function PUT(req: Request) {
  let session;
  try {
    session = await requirePartner(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
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

  const partnerId = session.profile.partnerId as string;
  const now = new Date().toISOString();
  await adminDb()
    .collection("partners")
    .doc(partnerId)
    .set(
      {
        nhAuditEvaluationDefaults: defaults,
        updatedAt: now,
      } satisfies Partial<PartnerRecord>,
      { merge: true },
    );

  return NextResponse.json({
    ok: true,
    nhAuditEvaluationDefaults: defaults,
  });
}
