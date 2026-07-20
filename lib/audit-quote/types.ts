import type { FieldValue, Timestamp } from "firebase-admin/firestore";

export const AUDIT_QUOTE_SCHEMA_VERSION = 2 as const;

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
  schemaVersion: typeof AUDIT_QUOTE_SCHEMA_VERSION;
  requestId: string;
  publicReference: string;
  email: string;
  emailHash: string;
  /** Optional on schema v1 documents. */
  contactName?: string;
  phone?: string;
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
