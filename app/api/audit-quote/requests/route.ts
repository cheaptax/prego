import { NextResponse } from "next/server";
import { getAuditQuoteConfig } from "@/lib/audit-quote/config";
import { guardAuditQuoteRequest } from "@/lib/audit-quote/http";
import { notifyAuditQuoteReceived } from "@/lib/audit-quote/notify";
import { submitAuditQuoteRequest } from "@/lib/audit-quote/submit";
import {
  extractReferrerHost,
  getClientIpHash,
  verifyBotProtection,
} from "@/lib/audit-quote/security";
import type {
  AuditQuoteErrorBody,
  AuditQuoteRequestRecord,
  AuditQuoteSuccessBody,
} from "@/lib/audit-quote/types";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
  ensureQuoteRequest,
  quoteRequestIdFor,
} from "@/lib/quotes/quote-requests";
import { provisionTemporaryQuoteMember } from "@/lib/members/temporary-quote-member";

export const runtime = "nodejs";

type Payload = {
  email?: string;
  name?: string;
  phone?: string;
  targetCooperativeName?: string;
  fiscalYear?: number;
  privacyConsent?: boolean;
  privacyPolicyVersion?: string;
  marketingConsent?: boolean;
  source?: {
    campaign?: string;
    channel?: string;
  };
  companyWebsite?: string;
  captchaToken?: string;
  appCheckToken?: string;
};

function jsonError(error: string, status: number) {
  const body: AuditQuoteErrorBody = { ok: false, error };
  return NextResponse.json(body, { status });
}

function jsonSuccess(publicReference: string) {
  const body: AuditQuoteSuccessBody = { ok: true, publicReference };
  return NextResponse.json(body, { status: 200 });
}

export async function POST(req: Request) {
  const config = getAuditQuoteConfig();

  if (!config.enabled) {
    return jsonError("event_disabled", 403);
  }

  const guarded = await guardAuditQuoteRequest(req, config);
  if (!guarded.ok) {
    return jsonError(guarded.error, guarded.status);
  }

  let body: Payload;
  try {
    body = JSON.parse(guarded.rawBody) as Payload;
  } catch {
    return jsonError("invalid_json", 400);
  }

  const botProtection = await verifyBotProtection({
    captchaEnabled: config.captchaEnabled,
    appCheckEnabled: config.appCheckEnabled,
    captchaToken: body.captchaToken,
    appCheckToken: body.appCheckToken,
  });
  if (!botProtection.ok) {
    return jsonError(botProtection.error, 403);
  }

  const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? "";

  try {
    const result = await submitAuditQuoteRequest(
      adminDb(),
      config,
      {
        email: body.email ?? "",
        contactName: body.name ?? "",
        phone: body.phone ?? "",
        targetCooperativeName: body.targetCooperativeName ?? "",
        fiscalYear: body.fiscalYear ?? Number.NaN,
        privacyConsent: body.privacyConsent === true,
        privacyPolicyVersion: body.privacyPolicyVersion ?? "",
        marketingConsent: body.marketingConsent === true,
        campaign: body.source?.campaign ?? "",
        channel: body.source?.channel ?? "",
        referrerHost: extractReferrerHost(req),
        pagePath: config.pagePath,
        idempotencyKey,
        companyWebsite: body.companyWebsite,
      },
      {
        ipHash: getClientIpHash(req, config.hashPepper || "audit-quote-fallback"),
      }
    );

    if (result.kind === "rejected") {
      return jsonError(result.error, result.status);
    }

    if (result.kind === "success") {
      const db = adminDb();
      const quoteSourceSnapshot = await db
        .collection("auditQuoteRequests")
        .doc(result.requestId)
        .get();
      if (quoteSourceSnapshot.exists) {
        const source =
          quoteSourceSnapshot.data() as AuditQuoteRequestRecord;
        const quoteRequest = await ensureQuoteRequest(db, {
          sourceType: "audit_quote",
          source,
        });
        await provisionTemporaryQuoteMember({
          db,
          auth: adminAuth(),
          requestId: result.requestId,
          quoteRequestId:
            quoteRequest.id ||
            quoteRequestIdFor("audit_quote", result.requestId),
          email: source.email,
          contactName: source.contactName ?? "",
          phone: source.phone ?? "",
          marketingConsent: source.marketingConsent === true,
        });
      }
    }
    if (result.kind === "success" && result.created) {
      // Fire-and-forget: notification failure must not fail customer intake.
      void notifyAuditQuoteReceived(adminDb(), {
        requestId: result.requestId,
        publicReference: result.publicReference,
        email: result.email,
        campaign: body.source?.campaign?.trim() || config.allowedCampaigns[0] || "fy27-audit-quote",
      }).catch((error: unknown) => {
        console.error("[audit-quote] notify_unhandled", {
          requestId: result.requestId,
          error: error instanceof Error ? error.message : "notify_failed",
        });
      });
    }

    return jsonSuccess(result.publicReference);
  } catch (error) {
    const code = error instanceof Error ? error.message : "submit_failed";
    console.error("[audit-quote] submit_failed", { error: code });
    return jsonError("submit_failed", 500);
  }
}
