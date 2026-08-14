import { NextResponse } from "next/server";
import { getAuditQuoteConfig } from "@/lib/audit-quote/config";
import { guardAuditQuoteRequest } from "@/lib/audit-quote/http";
import { notifyAuditQuoteReceived } from "@/lib/audit-quote/notify";
import { notifyCustomerAuditQuoteRequestReceived } from "@/lib/audit-quote/customer-request-email";
import { notifyOpsAuditQuoteRequestReceived } from "@/lib/audit-quote/ops-alert";
import { submitAuditQuoteRequest } from "@/lib/audit-quote/submit";
import {
  extractReferrerHost,
  getClientIpHash,
  isHoneypotTriggered,
  verifyBotProtection,
} from "@/lib/audit-quote/security";
import type {
  AuditQuoteErrorBody,
  AuditQuoteRequestRecord,
  AuditQuoteSuccessBody,
} from "@/lib/audit-quote/types";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { isValidKrMobilePhone, normalizeKrMobilePhone } from "@/lib/phone";
import { verifyAuditQuotePhoneVerificationToken } from "@/lib/audit-quote/phone-token";
import {
  ensureQuoteRequest,
  quoteRequestIdFor,
} from "@/lib/quotes/quote-requests";
import { provisionTemporaryQuoteMember } from "@/lib/members/temporary-quote-member";

export const runtime = "nodejs";
export const maxDuration = 30;

type Payload = {
  email?: string;
  name?: string;
  phone?: string;
  phoneVerificationIdToken?: string;
  targetCooperativeId?: string;
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

  const honeypot = isHoneypotTriggered(body.companyWebsite);
  const normalizedPhone = normalizeKrMobilePhone(body.phone ?? "");
  if (!honeypot) {
    if (!isValidKrMobilePhone(normalizedPhone)) {
      return jsonError("invalid_phone", 400);
    }
    if (!body.phoneVerificationIdToken?.trim()) {
      return jsonError("missing_phone_verification", 400);
    }
    const verified = await verifyAuditQuotePhoneVerificationToken({
      token: body.phoneVerificationIdToken,
      phone: normalizedPhone,
      pepper: config.hashPepper || "audit-quote-fallback",
      verifyFirebaseIdToken: (token) => adminAuth().verifyIdToken(token),
    });
    if (!verified.ok) {
      return jsonError(verified.error, verified.status);
    }
  }

  const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? "";

  try {
    let temporaryMemberInitialPassword: string | null = null;
    const result = await submitAuditQuoteRequest(
      adminDb(),
      config,
      {
        email: body.email ?? "",
        contactName: body.name ?? "",
        phone: body.phone ?? "",
        targetCooperativeId: body.targetCooperativeId ?? "",
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
        const temporaryMember = await provisionTemporaryQuoteMember({
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
        temporaryMemberInitialPassword = temporaryMember.initialPassword;
      }
    }
    if (result.kind === "success" && result.created) {
      // Await delivery so Vercel does not freeze the isolate before Resend
      // completes. Failures are logged and never fail customer intake.
      await Promise.allSettled([
        notifyAuditQuoteReceived(adminDb(), {
          requestId: result.requestId,
          publicReference: result.publicReference,
          email: result.email,
          campaign:
            body.source?.campaign?.trim() ||
            config.allowedCampaigns[0] ||
            "fy27-audit-quote",
        }),
        notifyCustomerAuditQuoteRequestReceived({
          requestId: result.requestId,
          publicReference: result.publicReference,
          email: result.email,
          contactName: body.name,
          targetCooperativeName: body.targetCooperativeName,
          fiscalYear: body.fiscalYear,
          phone: body.phone,
          initialPassword: temporaryMemberInitialPassword,
        }),
        notifyOpsAuditQuoteRequestReceived({
          requestId: result.requestId,
          publicReference: result.publicReference,
        }),
      ]);
    }

    return jsonSuccess(result.publicReference);
  } catch (error) {
    const code = error instanceof Error ? error.message : "submit_failed";
    console.error("[audit-quote] submit_failed", { error: code });
    return jsonError("submit_failed", 500);
  }
}
