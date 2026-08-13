import type { QuoteRecord, QuoteRequestRecord } from "@/lib/firebase/schema";
import { isSentPartnerQuote } from "@/lib/quotes/quote-revision";

export type CustomerQuoteComparisonGroup = {
  quoteRequestId: string;
  auditQuoteRequestId: string;
  subject: string;
  cooperativeName?: string;
  fiscalYear?: number;
  quoteCount: number;
  canCompare: boolean;
  entryEnabled: boolean;
  caseId: string | null;
  status: string | null;
  reportAvailable: boolean;
  reportWorkspaceReady: boolean;
  href: string | null;
};

export function buildCustomerQuoteComparisonGroups(input: {
  quoteRequests: readonly QuoteRequestRecord[];
  quotes: readonly QuoteRecord[];
  peeks: ReadonlyMap<
    string,
    {
      entryEnabled: boolean;
      caseId: string | null;
      status: string | null;
      reportAvailable: boolean;
      reportWorkspaceReady?: boolean;
    }
  >;
  minimumQuotes?: number;
}): CustomerQuoteComparisonGroup[] {
  const minimumQuotes = input.minimumQuotes ?? 2;
  const sentByRequest = new Map<string, number>();
  for (const quote of input.quotes) {
    if (!isSentPartnerQuote(quote)) continue;
    sentByRequest.set(
      quote.quoteRequestId,
      (sentByRequest.get(quote.quoteRequestId) ?? 0) + 1,
    );
  }

  return input.quoteRequests
    .filter(
      (request) =>
        request.sourceType === "audit_quote" && Boolean(request.sourceId),
    )
    .map((request) => {
      const quoteCount = sentByRequest.get(request.id) ?? 0;
      const peek = input.peeks.get(request.sourceId) ?? {
        entryEnabled: false,
        caseId: null,
        status: null,
        reportAvailable: false,
        reportWorkspaceReady: false,
      };
      const reportWorkspaceReady =
        peek.reportWorkspaceReady ??
        (peek.reportAvailable ||
          peek.status === "READY" ||
          peek.status === "GENERATING" ||
          peek.status === "COMPLETED");
      const canCompare = peek.entryEnabled && quoteCount >= minimumQuotes;
      const href = canCompare
        ? peek.caseId
          ? comparisonRedirectPath({
              caseId: peek.caseId,
              reportAvailable: peek.reportAvailable,
              reportWorkspaceReady,
            })
          : null
        : null;
      return {
        quoteRequestId: request.id,
        auditQuoteRequestId: request.sourceId,
        subject: request.subject,
        cooperativeName: request.cooperativeName,
        fiscalYear: request.fiscalYear,
        quoteCount,
        canCompare,
        entryEnabled: peek.entryEnabled,
        caseId: peek.caseId,
        status: peek.status,
        reportAvailable: peek.reportAvailable,
        reportWorkspaceReady,
        href,
      };
    })
    .filter((group) => group.quoteCount > 0)
    .sort((left, right) => right.quoteCount - left.quoteCount);
}

export function comparisonRedirectPath(input: {
  caseId: string;
  reportAvailable: boolean;
  reportWorkspaceReady?: boolean;
}) {
  return input.reportAvailable || input.reportWorkspaceReady
    ? `/events/audit-quote/evaluations/${input.caseId}/report`
    : `/events/audit-quote/evaluations/${input.caseId}`;
}
