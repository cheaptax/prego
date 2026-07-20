import {
  FieldValue,
  type Firestore,
  type Timestamp,
} from "firebase-admin/firestore";
import { maskEmail } from "@/lib/audit-quote/email";
import { withoutUndefined } from "@/lib/firebase/clean";

export const AUDIT_QUOTE_NOTIFICATIONS = "auditQuoteNotifications";

type TimeValue = Timestamp | FieldValue | string;

export type NotificationRecord = {
  requestId: string;
  publicReference: string;
  channel: "webhook";
  status: "pending" | "sent" | "failed" | "skipped";
  attempts: number;
  lastError?: string | null;
  lastAttemptAt?: TimeValue;
  sentAt?: TimeValue;
  createdAt: TimeValue;
  updatedAt: TimeValue;
};

type NotifyInput = {
  requestId: string;
  publicReference: string;
  email: string;
  campaign: string;
};

function webhookUrl() {
  return process.env.AUDIT_QUOTE_NOTIFY_WEBHOOK_URL?.trim() || "";
}

function includeEmailInBody() {
  const raw = process.env.AUDIT_QUOTE_NOTIFY_INCLUDE_EMAIL?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function adminBaseUrl() {
  return (
    process.env.AUDIT_QUOTE_ADMIN_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export function buildAuditQuoteNotifyPayload(input: NotifyInput) {
  const title = `신규 회계감사 견적 요청 · ${input.publicReference}`;
  const detailUrl = `${adminBaseUrl()}/admin`;
  const lines = [
    "신규 회계감사 견적 요청이 접수되었습니다.",
    `접수번호: ${input.publicReference}`,
    `캠페인: ${input.campaign}`,
    `이메일(마스킹): ${maskEmail(input.email)}`,
    `관리자: ${detailUrl}`,
  ];
  if (includeEmailInBody()) {
    lines.push(`이메일(원문): ${input.email}`);
  }
  return {
    title,
    text: lines.join("\n"),
    publicReference: input.publicReference,
    requestId: input.requestId,
    campaign: input.campaign,
  };
}

async function deliverWebhook(payload: ReturnType<typeof buildAuditQuoteNotifyPayload>) {
  const url = webhookUrl();
  if (!url) {
    return { ok: false as const, error: "webhook_not_configured", skipped: true };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      // Generic adapter: works with Slack incoming webhooks (text) and generic receivers.
      text: `${payload.title}\n${payload.text}`,
      title: payload.title,
      publicReference: payload.publicReference,
      requestId: payload.requestId,
      campaign: payload.campaign,
    }),
  });

  if (!res.ok) {
    return {
      ok: false as const,
      error: `webhook_http_${res.status}`,
      skipped: false,
    };
  }
  return { ok: true as const };
}

/**
 * Idempotent staff notification. Safe to call multiple times for the same requestId.
 * Never throws to the customer intake path — failures are persisted for retry.
 */
export async function notifyAuditQuoteReceived(
  db: Firestore,
  input: NotifyInput
): Promise<{ status: NotificationRecord["status"]; attempts: number }> {
  const ref = db.collection(AUDIT_QUOTE_NOTIFICATIONS).doc(input.requestId);
  const now = FieldValue.serverTimestamp();

  const gate = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (snap.exists) {
      const existing = snap.data() as NotificationRecord;
      if (existing.status === "sent" || existing.status === "skipped") {
        return { proceed: false as const, status: existing.status, attempts: existing.attempts };
      }
      transaction.set(
        ref,
        {
          status: "pending",
          attempts: (existing.attempts ?? 0) + 1,
          lastAttemptAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
      return {
        proceed: true as const,
        status: "pending" as const,
        attempts: (existing.attempts ?? 0) + 1,
      };
    }

    transaction.set(
      ref,
      withoutUndefined({
        requestId: input.requestId,
        publicReference: input.publicReference,
        channel: "webhook",
        status: "pending",
        attempts: 1,
        lastError: null,
        lastAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      } satisfies NotificationRecord)
    );
    return { proceed: true as const, status: "pending" as const, attempts: 1 };
  });

  if (!gate.proceed) {
    return { status: gate.status, attempts: gate.attempts };
  }

  const payload = buildAuditQuoteNotifyPayload(input);
  try {
    const delivered = await deliverWebhook(payload);
    if (delivered.ok) {
      await ref.set(
        {
          status: "sent",
          sentAt: FieldValue.serverTimestamp(),
          lastError: null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return { status: "sent", attempts: gate.attempts };
    }

    const status = delivered.skipped ? "skipped" : "failed";
    await ref.set(
      {
        status,
        lastError: delivered.error,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    if (!delivered.skipped) {
      console.error("[audit-quote] notify_failed", {
        requestId: input.requestId,
        error: delivered.error,
      });
    }
    return { status, attempts: gate.attempts };
  } catch (error) {
    const message = error instanceof Error ? error.message : "notify_failed";
    await ref.set(
      {
        status: "failed",
        lastError: message,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.error("[audit-quote] notify_failed", {
      requestId: input.requestId,
      error: message,
    });
    return { status: "failed", attempts: gate.attempts };
  }
}

export async function retryAuditQuoteNotification(
  db: Firestore,
  requestId: string,
  lookup: { publicReference: string; email: string; campaign: string }
) {
  const ref = db.collection(AUDIT_QUOTE_NOTIFICATIONS).doc(requestId);
  await ref.set(
    {
      status: "pending",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return notifyAuditQuoteReceived(db, {
    requestId,
    publicReference: lookup.publicReference,
    email: lookup.email,
    campaign: lookup.campaign,
  });
}
