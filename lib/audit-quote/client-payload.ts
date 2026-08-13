import type { PublicAuditQuoteConfig } from "@/lib/audit-quote/public-types";

export const AUDIT_QUOTE_REQUEST_ENDPOINT = "/api/audit-quote/requests";

export type AuditQuoteRequestPayload = {
  email: string;
  name: string;
  phone: string;
  phoneVerificationIdToken: string;
  targetCooperativeId: string;
  targetCooperativeName: string;
  fiscalYear: number;
  privacyConsent: true;
  privacyPolicyVersion: string;
  marketingConsent: boolean;
  source: {
    campaign: string;
    channel: string;
  };
  companyWebsite: string;
};

/**
 * This boundary intentionally accepts no CMS content. Editors may change
 * presentation copy and styles, but never request keys or server-owned values.
 */
export function buildAuditQuoteRequestPayload(
  input: {
    email: string;
    name: string;
    phone: string;
    phoneVerificationIdToken: string;
    targetCooperativeId: string;
    targetCooperativeName: string;
    fiscalYear: number;
    marketingConsent: boolean;
    companyWebsite: string;
  },
  config: PublicAuditQuoteConfig,
): AuditQuoteRequestPayload {
  return {
    email: input.email,
    name: input.name,
    phone: input.phone,
    phoneVerificationIdToken: input.phoneVerificationIdToken,
    targetCooperativeId: input.targetCooperativeId,
    targetCooperativeName: input.targetCooperativeName,
    fiscalYear: input.fiscalYear,
    privacyConsent: true,
    privacyPolicyVersion: config.privacyPolicyVersion,
    marketingConsent: input.marketingConsent,
    source: {
      campaign: config.campaign,
      channel: config.channel,
    },
    companyWebsite: input.companyWebsite,
  };
}
