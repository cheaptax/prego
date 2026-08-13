import "server-only";

import {
  InboxReportBridgeError,
  isReportWorkspaceReady,
  normalizedQuoteFromPartnerNhAuditQuote,
  partnerQuoteRequestIdsForCase,
  resolveInboxCooperativeName,
  resolveInboxFiscalYear,
  selectNhAuditQuotesForReport,
} from "@/lib/audit-evaluation/inbox-report-bridge-core";
import {
  AuditEvaluationReviewService,
  ReviewServiceError,
} from "@/lib/audit-evaluation/review-service";
import type {
  AuditEvaluationActor,
  AuditEvaluationCase,
} from "@/lib/audit-evaluation/types";
import { adminDb } from "@/lib/firebase/admin";
import type { QuoteRecord } from "@/lib/firebase/schema";

export {
  InboxReportBridgeError,
  isReportWorkspaceReady,
  normalizedQuoteFromPartnerNhAuditQuote,
  selectNhAuditQuotesForReport,
} from "@/lib/audit-evaluation/inbox-report-bridge-core";

/** Resolve partner quotes linked to an evaluation case (inbox id + raw id). */
export async function listPartnerQuotesForEvaluationCase(
  evaluationCase: Pick<AuditEvaluationCase, "quoteRequestId">,
): Promise<QuoteRecord[]> {
  const db = adminDb();
  const requestIds = partnerQuoteRequestIdsForCase(evaluationCase);
  const snapshots = await Promise.all(
    requestIds.map((quoteRequestId) =>
      db
        .collection("quotes")
        .where("quoteRequestId", "==", quoteRequestId)
        .limit(500)
        .get()
    ),
  );
  const byId = new Map<string, QuoteRecord>();
  for (const snapshot of snapshots) {
    for (const document of snapshot.docs) {
      byId.set(document.id, {
        ...(document.data() as QuoteRecord),
        id: document.id,
      });
    }
  }
  return [...byId.values()];
}

/**
 * Bridge partner inbox NH quotes into READY + confirmation so the report
 * workspace can generate a printable evaluation PDF without PDF re-upload.
 */
export async function prepareInboxCaseForNhAuditReport(input: {
  evaluationCase: AuditEvaluationCase;
  actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }>;
  now: string;
  cooperativeNameSnapshot?: string;
  fiscalYear?: number;
  minimumQuotes?: number;
}): Promise<AuditEvaluationCase> {
  const evaluationCase = input.evaluationCase;
  if (
    evaluationCase.status === "COMPLETED" ||
    evaluationCase.status === "GENERATING" ||
    (evaluationCase.status === "READY" &&
      Number.isInteger(evaluationCase.confirmationVersion) &&
      (evaluationCase.confirmationVersion ?? 0) > 0)
  ) {
    return evaluationCase;
  }

  const partnerQuotes = selectNhAuditQuotesForReport(
    await listPartnerQuotesForEvaluationCase(evaluationCase),
  );
  const minimumQuotes = input.minimumQuotes ??
    Math.max(2, evaluationCase.expectedQuoteCount || 2);
  if (partnerQuotes.length < minimumQuotes) {
    throw new InboxReportBridgeError("insufficient_nh_quotes");
  }

  const confirmedQuotes = partnerQuotes.map((quote) =>
    normalizedQuoteFromPartnerNhAuditQuote({
      quote,
      caseId: evaluationCase.id,
      now: input.now,
    })
  );

  try {
    const result = await new AuditEvaluationReviewService()
      .confirmPartnerInboxQuotes({
        caseId: evaluationCase.id,
        quotes: confirmedQuotes,
        finalAcknowledged: true,
        actor: input.actor,
        now: input.now,
        cooperativeNameSnapshot: resolveInboxCooperativeName(
          input.cooperativeNameSnapshot,
          partnerQuotes,
          evaluationCase.cooperativeNameSnapshot,
        ),
        fiscalYear: resolveInboxFiscalYear(
          input.fiscalYear,
          partnerQuotes,
          evaluationCase.fiscalYear,
        ),
      });
    return result.evaluationCase;
  } catch (error) {
    if (error instanceof ReviewServiceError) {
      throw new InboxReportBridgeError(error.code);
    }
    throw error;
  }
}
