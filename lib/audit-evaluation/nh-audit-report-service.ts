import "server-only";

import { AUDIT_EVALUATION_COLLECTIONS } from "@/lib/audit-evaluation/collections";
import { listExternalManualQuotes } from "@/lib/audit-evaluation/external-manual-quote-repository";
import {
  listPartnerQuotesForEvaluationCase,
  selectNhAuditQuotesForReport,
} from "@/lib/audit-evaluation/inbox-report-bridge";
import {
  buildNhAuditReportEvaluationSnapshot,
  nhAuditReportPreviewFromSnapshot,
  type NhAuditReportEvaluationSnapshot,
} from "@/lib/audit-evaluation/nh-audit-report-snapshot";
import {
  auditEvaluationCaseRecordSchema,
  createAuditEvaluationReportRunId,
} from "@/lib/audit-evaluation/review-repository";
import type {
  AuditEvaluationActor,
  AuditEvaluationCase,
} from "@/lib/audit-evaluation/types";
import { adminDb } from "@/lib/firebase/admin";
import type { PartnerRecord, QuoteRecord } from "@/lib/firebase/schema";
import {
  overlayPartnerQualityDefaultsOnQuote,
  sanitizeNhAuditEvaluationDefaults,
} from "@/lib/quotes/nh-audit-evaluation-defaults";
import {
  resolveCooperativeQuoteSafetyBand,
} from "@/lib/quotes/cooperative-quote-price-master-repository";
import type { CooperativeQuotePartnerPrice } from "@/lib/quotes/cooperative-quote-price-master-types";
import {
  getQuoteAutomationPlanForRequest,
  savePriceAdjustmentEvents,
} from "@/lib/quotes/quote-automation-repository";
import type { QuoteAutomationPartnerPreset } from "@/lib/quotes/quote-automation-types";
import {
  persistSafePriceQuoteRewrites,
  SafePriceQuoteRewriteError,
} from "@/lib/quotes/safe-price-source-rewrite";
import {
  applySafePriceAdjustments,
  externalManualQuoteAsEvaluationQuote,
} from "@/lib/quotes/safe-price-adjustment";

export class NhAuditReportServiceError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "NhAuditReportServiceError";
    this.code = code;
  }
}

export class NhAuditReportEvaluationService {
  async preview(input: {
    caseId: string;
    confirmationVersion: number;
    weights: unknown;
    actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }>;
    now: string;
  }) {
    const loaded = await this.loadAuthorizedInputs(input);
    const prepared = await this.prepareQuotesForEvaluation({
      ...input,
      ...loaded,
      persistAdjustments: false,
      reportId: createAuditEvaluationReportRunId(
        input.caseId,
        input.confirmationVersion,
      ),
    });
    const snapshot = this.buildSnapshot({
      ...input,
      evaluationCase: loaded.evaluationCase,
      quotes: prepared.quotes,
      reportId: prepared.reportId,
      safePriceMinWon: prepared.safePriceMinWon,
    });
    return nhAuditReportPreviewFromSnapshot(snapshot);
  }

  async createSnapshot(input: {
    caseId: string;
    confirmationVersion: number;
    weights: unknown;
    actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }>;
    now: string;
  }): Promise<NhAuditReportEvaluationSnapshot> {
    const loaded = await this.loadAuthorizedInputs(input);
    const prepared = await this.prepareQuotesForEvaluation({
      ...input,
      ...loaded,
      persistAdjustments: true,
      reportId: createAuditEvaluationReportRunId(
        input.caseId,
        input.confirmationVersion,
      ),
    });
    return this.buildSnapshot({
      ...input,
      evaluationCase: loaded.evaluationCase,
      quotes: prepared.quotes,
      reportId: prepared.reportId,
      safePriceMinWon: prepared.safePriceMinWon,
    });
  }

  private buildSnapshot(input: {
    caseId: string;
    weights: unknown;
    actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }>;
    now: string;
    reportId: string;
    evaluationCase: AuditEvaluationCase;
    quotes: QuoteRecord[];
    safePriceMinWon?: string | null;
  }) {
    try {
      return buildNhAuditReportEvaluationSnapshot({
        reportId: input.reportId,
        evaluationId: input.caseId,
        quoteRequestId: input.evaluationCase.quoteRequestId,
        customerId: input.actor.subjectId,
        quotes: input.quotes,
        weights: input.weights,
        now: input.now,
        safePriceMinWon: input.safePriceMinWon ?? null,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "nh_audit_report_requires_quotes"
      ) {
        throw new NhAuditReportServiceError("quotes_not_found");
      }
      throw new NhAuditReportServiceError("invalid_weights");
    }
  }

  private async prepareQuotesForEvaluation(input: {
    caseId: string;
    now: string;
    reportId: string;
    persistAdjustments: boolean;
    evaluationCase: AuditEvaluationCase;
    quotes: QuoteRecord[];
    weights: unknown;
  }) {
    const externalRecords = await listExternalManualQuotes(input.caseId);
    const [{ presets }, masterBand] = await Promise.all([
      getQuoteAutomationPlanForRequest(input.evaluationCase.quoteRequestId),
      resolveCooperativeQuoteSafetyBand({
        fiscalYear: input.evaluationCase.fiscalYear,
        cooperativeId: input.evaluationCase.cooperativeId,
        cooperativeName: input.evaluationCase.cooperativeNameSnapshot,
      }),
    ]);
    const quotes = await applyPartnerQualityDefaults(
      input.quotes,
      input.now,
    );
    const adjusted = applySafePriceAdjustments({
      caseId: input.caseId,
      quoteRequestId: input.evaluationCase.quoteRequestId,
      reportId: input.reportId,
      partnerQuotes: quotes,
      externalQuotes: externalRecords,
      presets:
        presets.length > 0
          ? presets
          : presetsFromMasterPrices(
              masterBand?.prices ?? [],
              input.evaluationCase.quoteRequestId,
            ),
      cooperativeSafetyBand: masterBand
        ? {
            safePriceMinWon: masterBand.safePriceMinWon,
            safePriceMaxWon: masterBand.safePriceMaxWon,
          }
        : null,
      now: input.now,
      weights: input.weights,
    });
    const sourceRewrite = input.persistAdjustments
      ? await persistSafePriceQuoteRewrites({
          quoteRequestId: input.evaluationCase.quoteRequestId,
          adjustedQuotes: adjusted.quotes,
          events: adjusted.events,
          now: input.now,
        }).catch((error) => {
          if (error instanceof SafePriceQuoteRewriteError) {
            throw new NhAuditReportServiceError("quote_rewrite_failed");
          }
          throw error;
        })
      : adjusted;
    if (input.persistAdjustments) {
      await savePriceAdjustmentEvents(sourceRewrite.events);
    }
    const externalQuotes = externalRecords.map((record) =>
      externalManualQuoteAsEvaluationQuote(record, {
        quoteRequestId: input.evaluationCase.quoteRequestId,
        cooperativeName:
          input.evaluationCase.cooperativeNameSnapshot || "대상 농협",
        fiscalYear: input.evaluationCase.fiscalYear,
        now: input.now,
      })
    );
    return {
      reportId: input.reportId,
      quotes: [...sourceRewrite.quotes, ...externalQuotes],
      safePriceMinWon: adjusted.safePriceMinWon,
    };
  }

  private async loadAuthorizedInputs(input: {
    caseId: string;
    confirmationVersion: number;
    actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }>;
  }) {
    const db = adminDb();
    const caseSnapshot = await db
      .collection(AUDIT_EVALUATION_COLLECTIONS.cases)
      .doc(input.caseId)
      .get();
    if (!caseSnapshot.exists) {
      throw new NhAuditReportServiceError("case_not_found");
    }
    const parsedCase = auditEvaluationCaseRecordSchema.safeParse(
      caseSnapshot.data(),
    );
    if (!parsedCase.success || parsedCase.data.id !== input.caseId) {
      throw new NhAuditReportServiceError("case_not_found");
    }
    const evaluationCase = parsedCase.data;
    if (
      !canCustomerAccessNhAuditReportCase(evaluationCase, input.actor) ||
      evaluationCase.confirmationVersion !== input.confirmationVersion
    ) {
      throw new NhAuditReportServiceError("access_denied");
    }
    const quotes = selectNhAuditQuotesForReport(
      await listPartnerQuotesForEvaluationCase(evaluationCase),
    );
    if (quotes.length === 0) {
      throw new NhAuditReportServiceError("quotes_not_found");
    }
    return { evaluationCase, quotes };
  }
}

export function nhAuditReportServiceErrorStatus(error: unknown) {
  if (!(error instanceof NhAuditReportServiceError)) return 500;
  if (error.code === "access_denied") return 403;
  if (error.code === "case_not_found") return 404;
  if (error.code === "quotes_not_found") return 409;
  if (error.code === "quote_rewrite_failed") return 409;
  if (error.code === "invalid_weights") return 400;
  return 500;
}

function ownerSubjectId(
  evaluationCase: Pick<AuditEvaluationCase, "customerAccessOwner">,
) {
  return evaluationCase.customerAccessOwner.type === "FIREBASE_UID"
    ? evaluationCase.customerAccessOwner.uid
    : evaluationCase.customerAccessOwner.subjectId;
}

export function canCustomerAccessNhAuditReportCase(
  evaluationCase: Pick<AuditEvaluationCase, "customerAccessOwner">,
  actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }>,
) {
  return ownerSubjectId(evaluationCase) === actor.subjectId;
}

async function applyPartnerQualityDefaults(
  quotes: QuoteRecord[],
  now: string,
) {
  const partnerIds = [
    ...new Set(
      quotes
        .map((quote) => quote.partnerId)
        .filter(
          (partnerId) =>
            Boolean(partnerId) && !partnerId.startsWith("external_"),
        ),
    ),
  ];
  if (partnerIds.length === 0) return quotes;
  const db = adminDb();
  const snapshots = await db.getAll(
    ...partnerIds.map((partnerId) => db.collection("partners").doc(partnerId)),
  );
  const defaultsByPartnerId = new Map(
    snapshots.flatMap((snapshot) => {
      if (!snapshot.exists) return [];
      const partner = snapshot.data() as PartnerRecord;
      const defaults = sanitizeNhAuditEvaluationDefaults(
        partner.nhAuditEvaluationDefaults,
      );
      return defaults ? [[snapshot.id, defaults] as const] : [];
    }),
  );
  return quotes.map((quote) =>
    overlayPartnerQualityDefaultsOnQuote(
      quote,
      defaultsByPartnerId.get(quote.partnerId),
      now,
    ),
  );
}

function presetsFromMasterPrices(
  prices: readonly CooperativeQuotePartnerPrice[],
  quoteRequestId: string,
): QuoteAutomationPartnerPreset[] {
  return prices.map((price) => ({
    id: price.id,
    quoteRequestId,
    auditQuoteRequestId: quoteRequestId,
    assignmentId: "",
    partnerId: price.partnerId,
    partnerName: price.partnerName,
    plannedAuditFeeWon: price.plannedAuditFeeWon,
    expenseBillingMode: price.expenseBillingMode,
    expectedExpenseWon: price.expectedExpenseWon,
    safePriceMinWon: price.safePriceMinWon,
    safePriceMaxWon: price.safePriceMaxWon,
    isPlannedWinner: price.isPlannedWinner,
    locked: price.locked,
    updatedBy: price.updatedBy,
    createdAt: price.createdAt,
    updatedAt: price.updatedAt,
  }));
}
