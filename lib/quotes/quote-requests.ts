import type { Firestore } from "firebase-admin/firestore";
import { withoutUndefined } from "@/lib/firebase/clean";
import type {
  ConsultRequestRecord,
  QuoteRequestRecord,
} from "@/lib/firebase/schema";
import type { AuditQuoteRequestRecord } from "@/lib/audit-quote/types";
import { MIN_AUDIT_QUOTE_ASSIGNMENTS } from "@/lib/quotes/audit-quote-assignment";

type EnsureQuoteRequestInput =
  | {
      sourceType: "consult";
      source: ConsultRequestRecord;
    }
  | {
      sourceType: "audit_quote";
      source: AuditQuoteRequestRecord;
    };

export function quoteRequestIdFor(sourceType: string, sourceId: string) {
  return `${sourceType}_${sourceId}`.replace(/[^A-Za-z0-9_-]/g, "_");
}

export async function ensureQuoteRequest(
  db: Firestore,
  input: EnsureQuoteRequestInput,
  now = new Date().toISOString(),
) {
  const id = quoteRequestIdFor(
    input.sourceType,
    input.sourceType === "consult"
      ? input.source.id
      : input.source.requestId,
  );
  const ref = db.collection("quoteRequests").doc(id);
  const snapshot = await ref.get();
  if (snapshot.exists) {
    return snapshot.data() as QuoteRequestRecord;
  }

  const record = input.sourceType === "consult"
    ? quoteRequestFromConsult(id, input.source, now)
    : quoteRequestFromAuditQuote(id, input.source, now);
  await ref.set(withoutUndefined(record));
  return record;
}

function quoteRequestFromConsult(
  id: string,
  source: ConsultRequestRecord,
  now: string,
): QuoteRequestRecord {
  return {
    id,
    sourceType: "consult",
    sourceId: source.id,
    sourceReference: source.requestNumber,
    customerUid: source.uid,
    customerEmail: source.userEmail,
    customerName: source.userName,
    cooperativeId: source.cooperativeId ?? source.nh_org_id,
    cooperativeName: source.cooperativeName,
    subject: source.subject,
    message: source.message,
    supportField: source.internalCategory ?? source.internal_category,
    status: "requested",
    submittedQuoteCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function quoteRequestFromAuditQuote(
  id: string,
  source: AuditQuoteRequestRecord,
  now: string,
): QuoteRequestRecord {
  return {
    id,
    sourceType: "audit_quote",
    sourceId: source.requestId,
    sourceReference: source.publicReference,
    customerUid: source.customerUid,
    customerEmail: source.email,
    customerEmailHash: source.emailHash,
    customerName: source.contactName,
    customerPhone: source.phone,
    cooperativeName: source.targetCooperativeName,
    fiscalYear: source.fiscalYear,
    subject: `감사견적 요청 ${source.publicReference}`,
    supportField: "감사",
    status: "requested",
    expectedQuoteCount: Math.max(
      source.quoteCount || 0,
      MIN_AUDIT_QUOTE_ASSIGNMENTS,
    ),
    submittedQuoteCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}
