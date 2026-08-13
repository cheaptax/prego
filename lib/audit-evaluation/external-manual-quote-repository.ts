import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import { externalManualQuoteInputSchema } from "@/lib/quotes/quote-automation-schemas";
import {
  AUDIT_EVALUATION_EXTERNAL_QUOTES,
  type ExternalManualQuoteRecord,
} from "@/lib/quotes/quote-automation-types";

export function createExternalManualQuoteId() {
  return `ext_${randomBytes(12).toString("hex")}`;
}

export async function listExternalManualQuotes(caseId: string) {
  const snapshot = await adminDb()
    .collection(AUDIT_EVALUATION_EXTERNAL_QUOTES)
    .where("caseId", "==", caseId)
    .limit(50)
    .get();
  return snapshot.docs
    .map((document) => {
      const data = document.data() as ExternalManualQuoteRecord;
      return normalizeExternalManualQuote({
        ...data,
        id: data.id || document.id,
      });
    })
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function normalizeExternalManualQuote(
  record: ExternalManualQuoteRecord,
): ExternalManualQuoteRecord {
  const accountingFirmName =
    record.accountingFirmName?.trim() ||
    record.supplierName?.trim() ||
    "비제휴 회계법인";
  return {
    ...record,
    supplierName: record.supplierName?.trim() || accountingFirmName,
    supplierBusinessRegistrationNumber:
      record.supplierBusinessRegistrationNumber ?? "",
    supplierAddress: record.supplierAddress ?? "",
    supplierContactName: record.supplierContactName ?? "",
    supplierContactEmail: record.supplierContactEmail ?? "",
    supplierContactPhone: record.supplierContactPhone ?? "",
    accountingFirmName,
    engagementPartnerName: record.engagementPartnerName ?? "",
    proposerType: record.proposerType || "ACCOUNTING_FIRM",
    noAuditedNonghyupTypes2025:
      record.noAuditedNonghyupTypes2025 ??
      !(record.auditedNonghyupTypes2025?.length > 0),
    auditedNonghyupTypes2025: record.auditedNonghyupTypes2025 ?? [],
  };
}

export async function upsertExternalManualQuote(input: {
  caseId: string;
  quoteRequestId: string;
  quoteId?: string;
  payload: unknown;
  actorSubjectId: string;
  now: string;
}) {
  const parsed = externalManualQuoteInputSchema.safeParse(input.payload);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: "invalid_input" as const,
      issues: parsed.error.issues,
    };
  }
  const id = input.quoteId?.trim() || createExternalManualQuoteId();
  if (input.quoteId) {
    const existing = await adminDb()
      .collection(AUDIT_EVALUATION_EXTERNAL_QUOTES)
      .doc(id)
      .get();
    if (!existing.exists || existing.data()?.caseId !== input.caseId) {
      return { ok: false as const, error: "not_found" as const };
    }
  }
  const previous = input.quoteId
    ? ((
        await adminDb()
          .collection(AUDIT_EVALUATION_EXTERNAL_QUOTES)
          .doc(id)
          .get()
      ).data() as ExternalManualQuoteRecord | undefined)
    : undefined;
  const record: ExternalManualQuoteRecord = {
    id,
    caseId: input.caseId,
    quoteRequestId: input.quoteRequestId,
    supplierName: parsed.data.supplierName,
    supplierBusinessRegistrationNumber:
      parsed.data.supplierBusinessRegistrationNumber,
    supplierAddress: parsed.data.supplierAddress,
    supplierContactName: parsed.data.supplierContactName,
    supplierContactEmail: parsed.data.supplierContactEmail,
    supplierContactPhone: parsed.data.supplierContactPhone,
    accountingFirmName: parsed.data.accountingFirmName,
    engagementPartnerName: parsed.data.engagementPartnerName,
    proposerType: parsed.data.proposerType,
    auditFeeWon: parsed.data.auditFeeWon,
    expenseBillingMode: parsed.data.expenseBillingMode,
    expectedExpenseWon: parsed.data.expectedExpenseWon,
    localNonghyupAuditCount2025: parsed.data.localNonghyupAuditCount2025,
    certifiedPublicAccountantCount:
      parsed.data.certifiedPublicAccountantCount,
    accountingFirmRevenueWon: parsed.data.accountingFirmRevenueWon,
    auditedNonghyupTypes2025: [...parsed.data.auditedNonghyupTypes2025],
    noAuditedNonghyupTypes2025: parsed.data.noAuditedNonghyupTypes2025,
    nonghyupTaxAgencyPerformed2025:
      parsed.data.nonghyupTaxAgencyPerformed2025,
    nonghyupSubsidySettlementPerformed2025:
      parsed.data.nonghyupSubsidySettlementPerformed2025,
    enteredBySubjectId: input.actorSubjectId,
    createdAt: previous?.createdAt ?? input.now,
    updatedAt: input.now,
  };
  await adminDb()
    .collection(AUDIT_EVALUATION_EXTERNAL_QUOTES)
    .doc(id)
    .set(withoutUndefined(record));
  return { ok: true as const, quote: record };
}

export async function deleteExternalManualQuote(input: {
  caseId: string;
  quoteId: string;
}) {
  const reference = adminDb()
    .collection(AUDIT_EVALUATION_EXTERNAL_QUOTES)
    .doc(input.quoteId);
  const snapshot = await reference.get();
  if (!snapshot.exists || snapshot.data()?.caseId !== input.caseId) {
    return false;
  }
  await reference.delete();
  return true;
}

export function externalQuoteStableKey(caseId: string, firmName: string) {
  return createHash("sha256")
    .update(`extkey|${caseId}|${firmName.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 24);
}
