import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import {
  authErrorCode,
  authErrorStatus,
  requirePermission,
} from "@/lib/firebase/server";
import type { PartnerRecord } from "@/lib/firebase/schema";
import {
  DEFAULT_QUOTE_SCREEN_SECTIONS,
  DEFAULT_QUOTE_SCREEN_THEME,
  getPartnerQuoteScreenProfile,
  normalizeQuoteScreenProfile,
  PARTNER_QUOTE_SCREEN_PROFILES_COLLECTION,
  quoteScreenProfileToPayload,
  QUOTE_SCREEN_LAYOUT_FAMILIES,
  QUOTE_SCREEN_SECTIONS,
} from "@/lib/quotes/quote-screen-profile";

export const runtime = "nodejs";

type Params = { params: Promise<{ partnerId: string }> };

async function loadPartner(partnerId: string) {
  const snapshot = await adminDb().collection("partners").doc(partnerId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as PartnerRecord;
  return { ...data, id: data.id || snapshot.id };
}

export async function GET(req: Request, { params }: Params) {
  try {
    await requirePermission(req, "auditQuotes:read");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const { partnerId } = await params;
  const [partner, profile] = await Promise.all([
    loadPartner(partnerId),
    getPartnerQuoteScreenProfile(adminDb(), partnerId),
  ]);
  if (!partner) {
    return NextResponse.json(
      { ok: false, error: "partner_not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    partner: {
      id: partner.id,
      name: partner.name,
      displayName: partner.displayName,
      contactEmail: partner.contactEmail,
      logoPath: partner.logoPath,
      sealPath: partner.sealPath,
    },
    profile,
    defaults: {
      layoutFamilies: QUOTE_SCREEN_LAYOUT_FAMILIES,
      sections: QUOTE_SCREEN_SECTIONS,
      defaultSections: DEFAULT_QUOTE_SCREEN_SECTIONS,
      defaultTheme: DEFAULT_QUOTE_SCREEN_THEME,
    },
  });
}

export async function PUT(req: Request, { params }: Params) {
  let session;
  try {
    session = await requirePermission(req, "auditQuotes:write");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const { partnerId } = await params;
  const partner = await loadPartner(partnerId);
  if (!partner) {
    return NextResponse.json(
      { ok: false, error: "partner_not_found" },
      { status: 404 },
    );
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const now = new Date().toISOString();
    const draft = normalizeQuoteScreenProfile(
      (body ?? {}) as never,
      { uid: session.decoded.uid, email: session.decoded.email },
      now,
    );
    const db = adminDb();
    const ref = db
      .collection(PARTNER_QUOTE_SCREEN_PROFILES_COLLECTION)
      .doc(partnerId);
    const existing = await ref.get();
    await ref.set(
      withoutUndefined({
        id: partnerId,
        partnerId,
        draft,
        createdAt: existing.exists
          ? String(existing.data()?.createdAt ?? now)
          : now,
        updatedAt: now,
      }),
      { merge: true },
    );
    return NextResponse.json({
      ok: true,
      draft: quoteScreenProfileToPayload(draft),
      updatedAt: now,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_quote_screen_profile" },
      { status: 400 },
    );
  }
}

export async function POST(req: Request, { params }: Params) {
  let session;
  try {
    session = await requirePermission(req, "auditQuotes:write");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const { partnerId } = await params;
  const db = adminDb();
  const ref = db
    .collection(PARTNER_QUOTE_SCREEN_PROFILES_COLLECTION)
    .doc(partnerId);
  const snapshot = await ref.get();
  if (!snapshot.exists || !snapshot.data()?.draft) {
    return NextResponse.json(
      { ok: false, error: "draft_not_found" },
      { status: 404 },
    );
  }
  const data = snapshot.data()!;
  const draft = data.draft;
  const previousVersion = Number(data.published?.version ?? 0);
  const now = new Date().toISOString();
  const published = withoutUndefined({
    ...draft,
    version: previousVersion + 1,
    publishedBy: session.decoded.uid,
    publishedByEmail: session.decoded.email,
    publishedAt: now,
  });
  await ref.set(
    withoutUndefined({
      published,
      updatedAt: now,
    }),
    { merge: true },
  );
  return NextResponse.json({
    ok: true,
    published,
  });
}
