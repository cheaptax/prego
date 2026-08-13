/** Client-safe public config shape (no server secrets). */
export type PublicAuditQuoteConfig = {
  enabled: boolean;
  privacyPolicyVersion: string;
  campaign: string;
  channel: string;
  pagePath: string;
  privacyPolicyHref: string;
  /** Fixed intake fiscal year; applicants cannot change this value. */
  fixedFiscalYear: number;
  guaranteeMinQuotes: boolean;
  showPointsBenefit: boolean;
  pointsBenefitBaseLabel: string | null;
  retentionCopy: string | null;
  closedMessage: string;
};
