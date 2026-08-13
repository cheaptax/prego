import {
  getTransactionalEmailConfigurationError,
  sendTransactionalEmail,
} from "@/lib/email/resend";
import { normalizeKrMobilePhone } from "@/lib/phone";
import {
  getTransactionalSmsConfigurationError,
  maskPhoneForLog,
  sendTransactionalSms,
} from "@/lib/sms/transactional";

export const AUDIT_QUOTE_OPS_ALERT_MESSAGE =
  "농협에서 견적 요청이 도착했습니다.";

const DEFAULT_OPS_ALERT_EMAIL = "prego.ceo@gmail.com";
const DEFAULT_OPS_ALERT_PHONE = "01063877780";

export function getAuditQuoteOpsAlertEmail() {
  return (
    process.env.AUDIT_QUOTE_OPS_ALERT_EMAIL?.trim().toLowerCase() ||
    DEFAULT_OPS_ALERT_EMAIL
  );
}

export function getAuditQuoteOpsAlertPhone() {
  return normalizeKrMobilePhone(
    process.env.AUDIT_QUOTE_OPS_ALERT_PHONE?.trim() || DEFAULT_OPS_ALERT_PHONE,
  );
}

export function buildOpsAuditQuoteAlertEmail() {
  const message = AUDIT_QUOTE_OPS_ALERT_MESSAGE;
  return {
    subject: message,
    text: message,
    html: `<p>${message}</p>`,
  };
}

/**
 * Staff alert when a customer submits an audit-quote request.
 * Failures are logged and never thrown to the intake path.
 */
export async function notifyOpsAuditQuoteRequestReceived(input: {
  requestId: string;
  publicReference: string;
}): Promise<{
  email: { ok: boolean; skipped?: boolean; error?: string };
  sms: { ok: boolean; skipped?: boolean; error?: string };
}> {
  const emailTo = getAuditQuoteOpsAlertEmail();
  const phoneTo = getAuditQuoteOpsAlertPhone();
  const content = buildOpsAuditQuoteAlertEmail();

  let emailResult: { ok: boolean; skipped?: boolean; error?: string } = {
    ok: false,
    skipped: true,
    error: "not_attempted",
  };
  let smsResult: { ok: boolean; skipped?: boolean; error?: string } = {
    ok: false,
    skipped: true,
    error: "not_attempted",
  };

  const emailConfigError = getTransactionalEmailConfigurationError();
  if (emailConfigError) {
    emailResult = { ok: false, skipped: true, error: emailConfigError };
    console.info("[audit-quote] ops_alert_email_skipped", {
      requestId: input.requestId,
      error: emailConfigError,
    });
  } else {
    try {
      await sendTransactionalEmail({
        to: emailTo,
        subject: content.subject,
        html: content.html,
        text: content.text,
        idempotencyKey: `audit-quote-ops-alert/${input.requestId}/email`,
      });
      emailResult = { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "send_failed";
      emailResult = { ok: false, error: message };
      console.error("[audit-quote] ops_alert_email_failed", {
        requestId: input.requestId,
        error: message,
      });
    }
  }

  const smsConfigError = getTransactionalSmsConfigurationError();
  if (smsConfigError) {
    smsResult = { ok: false, skipped: true, error: smsConfigError };
    console.info("[audit-quote] ops_alert_sms_skipped", {
      requestId: input.requestId,
      to: maskPhoneForLog(phoneTo),
      error: smsConfigError,
    });
  } else {
    try {
      const sent = await sendTransactionalSms({
        to: phoneTo,
        text: AUDIT_QUOTE_OPS_ALERT_MESSAGE,
        idempotencyKey: `audit-quote-ops-alert/${input.requestId}/sms`,
      });
      if (sent.ok) {
        smsResult = { ok: true };
      } else {
        smsResult = {
          ok: false,
          skipped: sent.skipped,
          error: sent.error,
        };
        if (!sent.skipped) {
          console.error("[audit-quote] ops_alert_sms_failed", {
            requestId: input.requestId,
            to: maskPhoneForLog(phoneTo),
            error: sent.error,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "send_failed";
      smsResult = { ok: false, error: message };
      console.error("[audit-quote] ops_alert_sms_failed", {
        requestId: input.requestId,
        to: maskPhoneForLog(phoneTo),
        error: message,
      });
    }
  }

  return { email: emailResult, sms: smsResult };
}
