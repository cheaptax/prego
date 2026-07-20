/** Client-safe public config shape (no server secrets). */
export type PublicAuditQuoteConfig = {
  enabled: boolean;
  privacyPolicyVersion: string;
  campaign: string;
  channel: string;
  pagePath: string;
  privacyPolicyHref: string;
  guaranteeMinQuotes: boolean;
  showPointsBenefit: boolean;
  pointsBenefitBaseLabel: string | null;
  retentionCopy: string | null;
  closedMessage: string;
};
