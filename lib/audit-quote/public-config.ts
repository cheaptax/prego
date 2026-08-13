import { getAuditQuoteConfig } from "@/lib/audit-quote/config";
import { AUDIT_QUOTE_FIXED_FISCAL_YEAR } from "@/lib/audit-quote/fiscal-year";
import type { PublicAuditQuoteConfig } from "@/lib/audit-quote/public-types";

export type { PublicAuditQuoteConfig };

type EnvMap = Record<string, string | undefined>;

function readBool(env: EnvMap, name: string, fallback: boolean) {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return fallback;
}

export function getPublicAuditQuoteConfig(
  env: EnvMap = process.env
): PublicAuditQuoteConfig {
  const base = getAuditQuoteConfig(env);
  const endsAtRaw = env.AUDIT_QUOTE_ENDS_AT?.trim() || "";
  let enabled = base.enabled;
  if (endsAtRaw) {
    const endsAt = Date.parse(endsAtRaw);
    if (Number.isFinite(endsAt) && Date.now() > endsAt) {
      enabled = false;
    }
  }

  const pointsLabel = env.AUDIT_QUOTE_POINTS_BASE_LABEL?.trim() || "";
  const showPointsBenefit =
    readBool(env, "AUDIT_QUOTE_SHOW_POINTS_BENEFIT", false) &&
    Boolean(pointsLabel);

  const retentionCopy = env.AUDIT_QUOTE_RETENTION_COPY?.trim() || null;

  return {
    enabled,
    privacyPolicyVersion: base.privacyPolicyVersion,
    campaign: base.allowedCampaigns[0] ?? "fy27-audit-quote",
    channel: "event_page",
    pagePath: base.pagePath,
    privacyPolicyHref: env.AUDIT_QUOTE_PRIVACY_POLICY_HREF?.trim() || "/signup",
    fixedFiscalYear: AUDIT_QUOTE_FIXED_FISCAL_YEAR,
    guaranteeMinQuotes: readBool(env, "AUDIT_QUOTE_GUARANTEE_MIN_QUOTES", false),
    showPointsBenefit,
    pointsBenefitBaseLabel: showPointsBenefit ? pointsLabel : null,
    retentionCopy,
    closedMessage:
      env.AUDIT_QUOTE_CLOSED_MESSAGE?.trim() ||
      "현재 FY27 회계감사 견적 접수 기간이 아닙니다. 접수 가능 시 이 페이지에서 다시 안내드립니다.",
  };
}
