import { NextResponse } from "next/server";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requireAnyPermission,
} from "@/lib/firebase/server";
import type { PartnerRecord } from "@/lib/firebase/schema";
import { renderQuotePdf } from "@/lib/quotes/quote-pdf";
import { renderQuoteComparisonQrDataUri } from "@/lib/quotes/quote-pdf-qr";
import {
  buildQuoteScreenPreviewQuote,
  buildQuoteScreenPreviewRequest,
  parseQuoteScreenPreviewProfile,
} from "@/lib/quotes/quote-screen-preview";
import {
  applyRecommendedQuoteLayout,
  getPartnerQuoteScreenProfile,
  mergeQuoteScreenProfile,
} from "@/lib/quotes/quote-screen-profile";
import { readStorageFileAsDataUri } from "@/lib/quotes/quote-storage";

export const runtime = "nodejs";
export const maxDuration = 60;

let previewQrDataUriPromise: Promise<string> | null = null;

type Params = { params: Promise<{ partnerId: string }> };

async function loadPartner(partnerId: string) {
  const snapshot = await adminDb().collection("partners").doc(partnerId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as PartnerRecord;
  return { ...data, id: data.id || snapshot.id };
}

export async function POST(req: Request, { params }: Params) {
  let session;
  try {
    session = await requireAnyPermission(req, [
      "auditQuotes:read",
      "auditQuotes:write",
    ]);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  try {
    const { partnerId } = await params;
    const now = new Date().toISOString();
    const [partner, cmsBundle, savedProfile, rawBody] = await Promise.all([
      loadPartner(partnerId),
      loadPublishedCmsPage("partner.portal"),
      getPartnerQuoteScreenProfile(adminDb(), partnerId),
      req.json().catch(() => null) as Promise<Record<string, unknown> | null>,
    ]);
    if (!partner) {
      return NextResponse.json(
        { ok: false, error: "partner_not_found" },
        { status: 404 },
      );
    }

    const profile =
      parseQuoteScreenPreviewProfile(
        rawBody,
        { uid: session.decoded.uid, email: session.decoded.email },
        now,
      ) ??
      savedProfile?.draft ??
      savedProfile?.published ??
      null;
    const documentContent = applyRecommendedQuoteLayout(
      mergeQuoteScreenProfile(cmsBundle.content, profile),
      partner,
    );
    const quoteRequest = buildQuoteScreenPreviewRequest(now);
    const quote = buildQuoteScreenPreviewQuote(partner, quoteRequest, now);
    previewQrDataUriPromise ??= renderQuoteComparisonQrDataUri(
      "https://preview.local/events/audit-quote/compare",
    );
    const [logoDataUri, sealDataUri, qrDataUri] = await Promise.all([
      readStorageFileAsDataUri(partner.logoPath),
      readStorageFileAsDataUri(partner.sealPath),
      previewQrDataUriPromise,
    ]);
    const pdfBuffer = await renderPreviewPdf({
      quote,
      quoteRequest,
      logoDataUri,
      sealDataUri,
      qrDataUri,
      documentContent,
    });
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": 'inline; filename="quote-screen-preview.pdf"',
        "content-type": "application/pdf",
      },
    });
  } catch (error) {
    console.error("quote-screen-preview-failed", error);
    return NextResponse.json(
      { ok: false, error: "preview_failed" },
      { status: 500 },
    );
  }
}

async function renderPreviewPdf(
  input: Parameters<typeof renderQuotePdf>[0],
) {
  try {
    return await renderQuotePdf(input);
  } catch (error) {
    console.error("quote-screen-preview-render-failed", error);
    return renderQuotePdf({
      ...input,
      logoDataUri: undefined,
      sealDataUri: undefined,
      documentContent: input.documentContent
        ? {
            ...input.documentContent,
            layoutFamily: "classicNavy",
            theme: undefined,
          }
        : undefined,
    });
  }
}
