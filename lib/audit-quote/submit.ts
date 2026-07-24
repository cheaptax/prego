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
import { assertSourceAllowed, isHoneypotTriggered } from "@/lib/audit-quote/security";
import {
  AUDIT_QUOTE_SCHEMA_VERSION,
  type SubmitAuditQuoteInput,
  type SubmitAuditQuoteResult,
} from "@/lib/audit-quote/types";
import { withoutUndefined } from "@/lib/firebase/clean";

type DedupRecord = {
  requestId: string;
  publicReference: string;
  emailHash: string;
  campaign: string;
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

  const targetCooperativeName = normalizeTargetCooperativeName(
    input.targetCooperativeName,
  );
  if (!honeypot && !isValidTargetCooperativeName(targetCooperativeName)) {
    return {
      kind: "rejected",
      error: "invalid_target_cooperative",
      status: 400,
    };
  }

  const fiscalYear = Number(input.fiscalYear);
  if (
    !honeypot &&
    (!Number.isSafeInteger(fiscalYear) ||
      fiscalYear < 2_000 ||
      fiscalYear > 2_100)
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
  const dedupId = emailHash ? emailDedupDocId(campaign, emailHash) : "";
  const ipHash = options?.ipHash;

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

      // Firestore requires all reads before any writes.
      const idempotencySnap = honeypot
        ? null
        : await transaction.get(idempotencyRef);
      const dedupSnap =
        !honeypot && dedupRef ? await transaction.get(dedupRef) : null;
      const ipRateSnap = ipRateRef ? await transaction.get(ipRateRef) : null;
      const emailRateSnap =
        !honeypot && emailRateRef ? await transaction.get(emailRateRef) : null;

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
    throw error;
  }
}

class RateLimitError extends Error {
  constructor() {
    super("rate_limited");
    this.name = "RateLimitError";
  }
}
