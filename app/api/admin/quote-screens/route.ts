import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requirePermission,
} from "@/lib/firebase/server";
import type {
  PartnerQuoteScreenProfileRecord,
  PartnerRecord,
} from "@/lib/firebase/schema";
import {
  getPartnerQuoteScreenProfile,
  PARTNER_QUOTE_SCREEN_PROFILES_COLLECTION,
} from "@/lib/quotes/quote-screen-profile";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await requirePermission(req, "auditQuotes:read");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const db = adminDb();
  const partnersSnapshot = await db
    .collection("partners")
    .orderBy("updatedAt", "desc")
    .get();
  const partners = partnersSnapshot.docs
    .map((doc) => {
      const data = doc.data() as PartnerRecord;
      return { ...data, id: data.id || doc.id };
    })
    .filter((partner) => partner.status !== "terminated");

  const profiles = new Map<string, PartnerQuoteScreenProfileRecord>();
  const profileSnapshot = await db
    .collection(PARTNER_QUOTE_SCREEN_PROFILES_COLLECTION)
    .get();
  for (const doc of profileSnapshot.docs) {
    const profile = await getPartnerQuoteScreenProfile(db, doc.id);
    if (profile) profiles.set(profile.partnerId, profile);
  }

  return NextResponse.json({
    ok: true,
    partners: partners.map((partner) => {
      const profile = profiles.get(partner.id);
      return {
        id: partner.id,
        name: partner.name,
        displayName: partner.displayName,
        contactEmail: partner.contactEmail,
        status: partner.status,
        logoPath: partner.logoPath,
        sealPath: partner.sealPath,
        hasDraft: Boolean(profile?.draft),
        hasPublished: Boolean(profile?.published),
        publishedVersion: profile?.published?.version ?? null,
        publishedAt: profile?.published?.publishedAt ?? null,
        updatedAt: profile?.updatedAt ?? null,
      };
    }),
  });
}
