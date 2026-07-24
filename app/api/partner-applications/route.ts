import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import type { PartnerApplicationRecord } from "@/lib/firebase/schema";
import { normalizePartnerApplicationPayload } from "@/lib/partner-applications";
import { consumePublicRateLimit } from "@/lib/security/public-rate-limit";

export const runtime = "nodejs";

type Payload = {
  companyWebsite?: string;
};

const MAX_BODY_BYTES = 16 * 1024;

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  const rateLimitSecret =
    process.env.PARTNER_APPLICATION_HASH_PEPPER?.trim() ||
    process.env.AUDIT_QUOTE_HASH_PEPPER?.trim() ||
    "";
  if (process.env.NODE_ENV === "production" && rateLimitSecret.length < 16) {
    return jsonError("service_unavailable", 503);
  }
  const db = adminDb();
  const rateLimit = await consumePublicRateLimit({
    db,
    request: req,
    namespace: "partner-application",
    secret: rateLimitSecret || "local-partner-application-only",
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: "too_many_requests" },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return jsonError("body_too_large", 413);
  }

  let body: Payload & Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Payload & Record<string, unknown>;
  } catch {
    return jsonError("invalid_json", 400);
  }
  if (body.companyWebsite?.trim()) {
    return NextResponse.json({ ok: true, applicationId: "received" });
  }

  const payload = normalizePartnerApplicationPayload(body);
  if (!payload) return jsonError("invalid_partner_application", 400);

  const now = new Date().toISOString();
  const normalizedEmail = payload.contactEmail;
  const recentDuplicate = await db
    .collection("partnerApplications")
    .where("contactEmail", "==", normalizedEmail)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  if (!recentDuplicate.empty) {
    return NextResponse.json({
      ok: true,
      applicationId: "received",
      deduped: true,
    });
  }

  const ref = db.collection("partnerApplications").doc();
  const application: PartnerApplicationRecord = withoutUndefined({
    id: ref.id,
    ...payload,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  } satisfies PartnerApplicationRecord);

  await ref.set(application);
  await db.collection("auditLogs").add({
    actorUid: "public",
    actorEmail: "",
    action: "partner_application.submitted",
    targetType: "partnerApplication",
    targetId: ref.id,
    metadata: {
      profession: application.profession,
      fieldCount: application.fields.length,
    },
    createdAt: now,
  });

  return NextResponse.json({ ok: true, applicationId: ref.id });
}
