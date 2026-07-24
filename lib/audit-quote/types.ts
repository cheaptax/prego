import type { FieldValue, Timestamp } from "firebase-admin/firestore";

export const AUDIT_QUOTE_SCHEMA_VERSION = 3 as const;

export type AuditQuoteStatus =
  | "received"
  | "contacting"
  | "qualified"
  | "info_complete"
  | "quotes_requested"
  | "delivered"
  | "report_delivered"
  | "closed"
  | "invalid";

export type AuditQuoteRequestRecord = {
  /** Schema v2 records predate target cooperative and fiscal-year fields. */
  schemaVersion: 2 | typeof AUDIT_QUOTE_SCHEMA_VERSION;
  requestId: string;
  publicReference: string;
  email: string;
  emailHash: string;
  /** Trusted Firebase customer UID provisioned or linked by the server. */
  customerUid?: string;
  /** Optional on schema v1 documents. */
  contactName?: string;
  phone?: string;
  /** Required for schema v3 records; absent on legacy requests. */
  targetCooperativeName?: string;
  fiscalYear?: number;
  status: AuditQuoteStatus;
  quoteCount: number;
  privacyPolicyVersion: string;
  agreedAt: Timestamp | FieldValue;
  marketingConsent: boolean;
  campaign: string;
  channel: string;
  referrerHost?: string;
  pagePath: string;
  idempotencyKeyHash: string;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
  assignedTo: string | null;
};

export type AuditQuoteSuccessBody = {
  ok: true;
  publicReference: string;
};

export type AuditQuoteErrorBody = {
  ok: false;
  error: string;
};

export type SubmitAuditQuoteInput = {
  email: string;
  contactName: string;
  phone: string;
  targetCooperativeName: string;
  fiscalYear: number;
  privacyConsent: boolean;
  privacyPolicyVersion: string;
  marketingConsent?: boolean;
  campaign: string;
  channel: string;
  referrerHost?: string;
  pagePath: string;
  idempotencyKey: string;
  companyWebsite?: string;
};

export type SubmitAuditQuoteResult =
  | {
      kind: "success";
      publicReference: string;
      requestId: string;
      email: string;
      created: boolean;
    }
  | { kind: "honeypot"; publicReference: string }
  | { kind: "rejected"; error: string; status: number };
