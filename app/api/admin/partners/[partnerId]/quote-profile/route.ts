import { NextResponse } from "next/server";
import { readLimitedJson } from "@/lib/audit-evaluation/api-security-core";
import { adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import {
  addAdminAuditLog,
  authErrorCode,
  authErrorStatus,
  requirePermission,
} from "@/lib/firebase/server";
import type { PartnerRecord } from "@/lib/firebase/schema";
import { extractNhAuditEvaluationDefaults } from "@/lib/quotes/nh-audit-evaluation-defaults";
import { sanitizeNhAuditPartnerFormDraft } from "@/lib/quotes/nh-audit-quote-form";

export const runtime = "nodejs";

const MAX_PAYLOAD_BYTES = 64 * 1024;

type Params = { params: Promise<{ partnerId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  let admin;
  try {
    admin = await requirePermission(req, "partners:update");
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }

  const { partnerId } = await params;
  const partnerRef = adminDb().collection("partners").doc(partnerId);
  const snapshot = await partnerRef.get();
  if (!snapshot.exists) {
    return NextResponse.json(
      { ok: false, error: "partner_not_found" },
      { status: 404 },
    );
  }
  const current = snapshot.data() as PartnerRecord;
  if (current.status === "terminated") {
    return NextResponse.json(
      { ok: false, error: "terminated_partner_immutable" },
      { status: 409 },
    );
  }

  const payload = (await readLimitedJson(req, MAX_PAYLOAD_BYTES).catch(
    () => null,
  )) as {
    opsProxyQuoteSendConsent?: unknown;
    nhAuditEvaluationDefaults?: unknown;
  } | null;
  if (!payload) {
    return NextResponse.json(
      { ok: false, error: "invalid_quote_profile" },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const patch: Partial<PartnerRecord> = {
    updatedAt: now,
    updatedBy: admin.decoded.uid,
    updatedByEmail: admin.decoded.email,
  };

  if (payload.opsProxyQuoteSendConsent !== undefined) {
    if (typeof payload.opsProxyQuoteSendConsent !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "invalid_quote_profile" },
        { status: 400 },
      );
    }
    patch.opsProxyQuoteSendConsent = payload.opsProxyQuoteSendConsent;
    patch.opsProxyQuoteSendConsentAt = now;
    patch.opsProxyQuoteSendConsentBy = admin.decoded.uid;
  }

  if (payload.nhAuditEvaluationDefaults !== undefined) {
    const defaults = extractNhAuditEvaluationDefaults(
      sanitizeNhAuditPartnerFormDraft(payload.nhAuditEvaluationDefaults),
    );
    if (!defaults) {
      return NextResponse.json(
        { ok: false, error: "empty_defaults" },
        { status: 400 },
      );
    }
    patch.nhAuditEvaluationDefaults = defaults;
  }

  await partnerRef.set(withoutUndefined(patch), { merge: true });
  const next = {
    ...current,
    ...patch,
    id: current.id || partnerId,
  } as PartnerRecord;
  await addAdminAuditLog(adminDb(), {
    actorId: admin.decoded.uid,
    actorEmail: admin.decoded.email,
    actorRole: admin.context.adminRole,
    requiredPermission: "partners:update",
    action: "partner.quote_profile_updated",
    targetType: "partner",
    targetId: partnerId,
    metadata: {
      partnerName: current.displayName,
      consent: String(next.opsProxyQuoteSendConsent ?? ""),
    },
  });

  return NextResponse.json({
    ok: true,
    partner: next,
    nhAuditEvaluationDefaults: next.nhAuditEvaluationDefaults ?? null,
  });
}
