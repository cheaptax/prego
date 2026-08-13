import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { AuditQuoteConfig } from "@/lib/audit-quote/config";
import {
  AUDIT_QUOTE_EMAIL_DEDUP,
  AUDIT_QUOTE_IDEMPOTENCY,
  AUDIT_QUOTE_RATE_LIMITS,
  AUDIT_QUOTE_REQUESTS,
  emailDedupDocId,
} from "@/lib/audit-quote/collections";
import {
  formatKoreanMobile,
  isValidContactName,
  isValidKoreanMobile,
  normalizeContactName,
  normalizePhoneDigits,
} from "@/lib/audit-quote/contact-core";
import {
  fakePublicReference,
  hmacEmailHash,
  isValidBusinessEmail,
  normalizeEmail,
} from "@/lib/audit-quote/email";
import { isAllowedAuditQuoteRequesterEmail } from "@/lib/audit-quote/email-policy";
import {
  hashIdempotencyKey,
  isValidIdempotencyKey,
} from "@/lib/audit-quote/idempotency";
import { createPublicReference } from "@/lib/audit-quote/public-reference";
import { AUDIT_QUOTE_FIXED_FISCAL_YEAR } from "@/lib/audit-quote/fiscal-year";
import {
  assertSourceAllowed,
  hashRateLimitKey,
  isHoneypotTriggered,
} from "@/lib/audit-quote/security";
import {
  AUDIT_QUOTE_SCHEMA_VERSION,
  type SubmitAuditQuoteInput,
  type SubmitAuditQuoteResult,
} from "@/lib/audit-quote/types";
import { resolveSignupCooperative } from "@/lib/cooperatives/server";
import { withoutUndefined } from "@/lib/firebase/clean";
import { UNLIMITED_TEST_PHONE } from "@/lib/test-data/email-classification";

const MAX_QUOTE_REQUESTS_PER_PHONE = 5;

type DedupRecord = {
  requestId: string;
  publicReference: string;
  emailHash: string;
  campaign: string;
  targetCooperativeId?: string;
  fiscalYear?: number;
  createdAtMs: number;
};

type IdempotencyRecord = {
  keyHash: string;
  requestId: string;
  publicReference: string;
  createdAtMs: number;
};

type RateLimitRecord = {
  count: number;
  windowStartMs: number;
  updatedAtMs?: number;
};

type PhoneQuoteLimitRecord = {
  count: number;
  updatedAtMs: number;
};

function readCreatedAtMs(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof (value as { toMillis: () => number }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return fallback;
}

function normalizeTargetCooperativeName(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 300);
}

function isValidTargetCooperativeName(value: string) {
  return value.length >= 2 && value.length <= 300;
}

function nextRateLimit(
  current: RateLimitRecord | null,
  nowMs: number,
  windowMs: number,
  max: number
): { allowed: boolean; next: RateLimitRecord } {
  const windowStartMs =
    current && nowMs - current.windowStartMs < windowMs
      ? current.windowStartMs
      : nowMs;
  const count =
    current && windowStartMs === current.windowStartMs ? current.count : 0;
  if (count >= max) {
    return {
      allowed: false,
      next: {
        count,
        windowStartMs,
        updatedAtMs: nowMs,
      },
    };
  }
  return {
    allowed: true,
    next: {
      count: count + 1,
      windowStartMs,
      updatedAtMs: nowMs,
    },
  };
}

export async function submitAuditQuoteRequest(
  db: Firestore,
  config: AuditQuoteConfig,
  input: SubmitAuditQuoteInput,
  options?: {
    ipHash?: string;
    nowMs?: number;
    serverTimestamp?: FieldValue;
    resolveCooperative?: (
      cooperativeId: string,
    ) => Promise<{
      cooperative_id: string;
      cooperative_name: string;
      status: string;
    } | null>;
  }
): Promise<SubmitAuditQuoteResult> {
  if (!isValidIdempotencyKey(input.idempotencyKey)) {
    return {
      kind: "rejected",
      error: "missing_idempotency_key",
      status: 400,
    };
  }

  const honeypot = isHoneypotTriggered(input.companyWebsite);

  if (!config.hashPepper || config.hashPepper.length < 16) {
    return { kind: "rejected", error: "server_misconfigured", status: 500 };
  }

  const email = normalizeEmail(input.email ?? "");
  if (!honeypot && !isAllowedAuditQuoteRequesterEmail(email)) {
    return { kind: "rejected", error: "invalid_email", status: 400 };
  }

  const contactName = normalizeContactName(input.contactName ?? "");
  if (!honeypot && !isValidContactName(contactName)) {
    return { kind: "rejected", error: "invalid_name", status: 400 };
  }

  const phoneDigits = normalizePhoneDigits(input.phone ?? "");
  if (!honeypot && !isValidKoreanMobile(phoneDigits)) {
    return { kind: "rejected", error: "invalid_phone", status: 400 };
  }
  const phone = formatKoreanMobile(phoneDigits);

  const targetCooperativeId = String(input.targetCooperativeId ?? "").trim();
  let targetCooperativeName = "";
  if (!honeypot) {
    if (!targetCooperativeId) {
      return {
        kind: "rejected",
        error: "invalid_target_cooperative",
        status: 400,
      };
    }
    const cooperative = await (
      options?.resolveCooperative ?? resolveSignupCooperative
    )(targetCooperativeId);
    if (!cooperative || cooperative.status !== "active") {
      return {
        kind: "rejected",
        error: "invalid_target_cooperative",
        status: 400,
      };
    }
    targetCooperativeName = cooperative.cooperative_name;
  } else {
    targetCooperativeName = normalizeTargetCooperativeName(
      input.targetCooperativeName,
    );
  }

  // FY27 intake locks the business year in code; ignore client-submitted values.
  const fiscalYear = AUDIT_QUOTE_FIXED_FISCAL_YEAR;
  if (
    !honeypot &&
    Number.isFinite(Number(input.fiscalYear)) &&
    Number(input.fiscalYear) !== AUDIT_QUOTE_FIXED_FISCAL_YEAR
  ) {
    return { kind: "rejected", error: "invalid_fiscal_year", status: 400 };
  }

  if (!honeypot && input.privacyConsent !== true) {
    return { kind: "rejected", error: "consent_required", status: 400 };
  }

  if (
    !honeypot &&
    (!input.privacyPolicyVersion?.trim() ||
      input.privacyPolicyVersion.trim() !== config.privacyPolicyVersion)
  ) {
    return {
      kind: "rejected",
      error: "privacy_version_mismatch",
      status: 400,
    };
  }

  const campaign = input.campaign?.trim() || "fy27-audit-quote";
  const channel = input.channel?.trim() || "event_page";
  if (!honeypot && !assertSourceAllowed(campaign, channel, config)) {
    return { kind: "rejected", error: "invalid_source", status: 400 };
  }

  const nowMs = options?.nowMs ?? Date.now();
  const serverTimestamp = options?.serverTimestamp ?? FieldValue.serverTimestamp();
  const emailHash = isValidBusinessEmail(email)
    ? hmacEmailHash(email, config.hashPepper)
    : "";
  const idempotencyKeyHash = hashIdempotencyKey(
    input.idempotencyKey,
    config.hashPepper
  );
  const dedupId = emailHash
    ? emailDedupDocId({
        campaign,
        emailHash,
        targetCooperativeId,
        fiscalYear,
      })
    : "";
  const ipHash = options?.ipHash;
  const phoneLimitHash =
    !honeypot && phoneDigits !== UNLIMITED_TEST_PHONE
      ? hashRateLimitKey("audit_quote_phone", phoneDigits, config.hashPepper)
      : "";

  try {
    type TxResult =
      | {
          kind: "success";
          publicReference: string;
          requestId: string;
          email: string;
          created: boolean;
        }
      | { kind: "honeypot"; publicReference: string };

    const txResult = await db.runTransaction(async (transaction) => {
      const idempotencyRef = db
        .collection(AUDIT_QUOTE_IDEMPOTENCY)
        .doc(idempotencyKeyHash);
      const dedupRef = emailHash
        ? db.collection(AUDIT_QUOTE_EMAIL_DEDUP).doc(dedupId)
        : null;
      const ipRateRef = ipHash
        ? db.collection(AUDIT_QUOTE_RATE_LIMITS).doc(`ip_${ipHash}`)
        : null;
      const emailRateRef = emailHash
        ? db.collection(AUDIT_QUOTE_RATE_LIMITS).doc(`email_${emailHash}`)
        : null;
      const phoneLimitRef = phoneLimitHash
        ? db
            .collection(AUDIT_QUOTE_RATE_LIMITS)
            .doc(`phone_quote_${phoneLimitHash}`)
        : null;

      // Firestore requires all reads before any writes.
      const idempotencySnap = honeypot
        ? null
        : await transaction.get(idempotencyRef);
      const dedupSnap =
        !honeypot && dedupRef ? await transaction.get(dedupRef) : null;
      const ipRateSnap = ipRateRef ? await transaction.get(ipRateRef) : null;
      const emailRateSnap =
        !honeypot && emailRateRef ? await transaction.get(emailRateRef) : null;
      const phoneLimitSnap =
        !honeypot && phoneLimitRef
          ? await transaction.get(phoneLimitRef)
          : null;

      if (idempotencySnap?.exists) {
        const existing = idempotencySnap.data() as IdempotencyRecord;
        return {
          kind: "success",
          publicReference: existing.publicReference,
          requestId: existing.requestId,
          email,
          created: false,
        } satisfies TxResult;
      }

      if (dedupSnap?.exists) {
        const existing = dedupSnap.data() as DedupRecord;
        const createdAtMs = readCreatedAtMs(existing.createdAtMs, 0);
        if (nowMs - createdAtMs < config.dedupeWindowMs) {
          transaction.set(idempotencyRef, {
            keyHash: idempotencyKeyHash,
            requestId: existing.requestId,
            publicReference: existing.publicReference,
            createdAtMs: nowMs,
          } satisfies IdempotencyRecord);
          return {
            kind: "success",
            publicReference: existing.publicReference,
            requestId: existing.requestId,
            email,
            created: false,
          } satisfies TxResult;
        }
      }

      if (ipRateRef) {
        const ipLimit = nextRateLimit(
          ipRateSnap?.exists ? (ipRateSnap.data() as RateLimitRecord) : null,
          nowMs,
          config.rateLimit.ipWindowMs,
          config.rateLimit.ipMax
        );
        if (!ipLimit.allowed) {
          throw new RateLimitError();
        }
        transaction.set(ipRateRef, ipLimit.next);
      }

      if (honeypot) {
        return {
          kind: "honeypot",
          publicReference: fakePublicReference(),
        } satisfies TxResult;
      }

      if (emailRateRef) {
        const emailLimit = nextRateLimit(
          emailRateSnap?.exists
            ? (emailRateSnap.data() as RateLimitRecord)
            : null,
          nowMs,
          config.rateLimit.emailWindowMs,
          config.rateLimit.emailMax
        );
        if (!emailLimit.allowed) {
          throw new RateLimitError();
        }
        transaction.set(emailRateRef, emailLimit.next);
      }

      if (phoneLimitRef) {
        const currentPhoneLimit = phoneLimitSnap?.exists
          ? (phoneLimitSnap.data() as PhoneQuoteLimitRecord)
          : null;
        const currentCount =
          currentPhoneLimit && Number.isFinite(currentPhoneLimit.count)
            ? currentPhoneLimit.count
            : 0;
        if (currentCount >= MAX_QUOTE_REQUESTS_PER_PHONE) {
          throw new PhoneQuoteLimitError();
        }
        transaction.set(phoneLimitRef, {
          count: currentCount + 1,
          updatedAtMs: nowMs,
        } satisfies PhoneQuoteLimitRecord);
      }

      const requestRef = db.collection(AUDIT_QUOTE_REQUESTS).doc();
      const publicReference = createPublicReference(new Date(nowMs));

      transaction.set(
        requestRef,
        withoutUndefined({
          schemaVersion: AUDIT_QUOTE_SCHEMA_VERSION,
          requestId: requestRef.id,
          publicReference,
          email,
          emailHash,
          contactName,
          phone,
          targetCooperativeId: honeypot ? undefined : targetCooperativeId,
          targetCooperativeName,
          fiscalYear,
          status: "received",
          quoteCount: 0,
          privacyPolicyVersion: config.privacyPolicyVersion,
          agreedAt: serverTimestamp,
          marketingConsent: input.marketingConsent === true,
          campaign,
          channel,
          referrerHost: input.referrerHost,
          pagePath: input.pagePath || config.pagePath,
          idempotencyKeyHash,
          createdAt: serverTimestamp,
          updatedAt: serverTimestamp,
          assignedTo: null,
        })
      );

      if (dedupRef) {
        transaction.set(dedupRef, {
          requestId: requestRef.id,
          publicReference,
          emailHash,
          campaign,
          targetCooperativeId,
          fiscalYear,
          createdAtMs: nowMs,
        } satisfies DedupRecord);
      }

      transaction.set(idempotencyRef, {
        keyHash: idempotencyKeyHash,
        requestId: requestRef.id,
        publicReference,
        createdAtMs: nowMs,
      } satisfies IdempotencyRecord);

      return {
        kind: "success",
        publicReference,
        requestId: requestRef.id,
        email,
        created: true,
      } satisfies TxResult;
    });

    return txResult;
  } catch (error) {
    if (error instanceof RateLimitError) {
      return { kind: "rejected", error: "rate_limited", status: 429 };
    }
    if (error instanceof PhoneQuoteLimitError) {
      return {
        kind: "rejected",
        error: "phone_quote_limit_exceeded",
        status: 429,
      };
    }
    throw error;
  }
}

class RateLimitError extends Error {
  constructor() {
    super("rate_limited");
    this.name = "RateLimitError";
  }
}

class PhoneQuoteLimitError extends Error {
  constructor() {
    super("phone_quote_limit_exceeded");
    this.name = "PhoneQuoteLimitError";
  }
}
