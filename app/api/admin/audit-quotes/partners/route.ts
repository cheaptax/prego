import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
} from "@/lib/firebase/server";
import type { PartnerRecord } from "@/lib/firebase/schema";
import { isPartnerActive } from "@/lib/partners";
import { isPartnerEligibleForAuditQuote } from "@/lib/quotes/audit-quote-assignment";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await requireAdminCapability(req, "auditQuotes:read");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const snapshot = await adminDb().collection("partners").get();
  const partners = snapshot.docs
    .map((doc) => {
      const data = doc.data() as PartnerRecord;
      return { ...data, id: data.id || doc.id };
    })
    .filter(
      (partner) =>
        isPartnerActive(partner) && isPartnerEligibleForAuditQuote(partner),
    )
    .map((partner) => ({
      id: partner.id,
      displayName: partner.displayName,
      name: partner.name,
      profession: partner.profession ?? "OTHER",
      contactEmail: partner.contactEmail,
      fields: partner.fields,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"));

  return NextResponse.json({ ok: true, partners });
}
