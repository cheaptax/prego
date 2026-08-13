import { getAppBaseUrl } from "@/lib/email/resend";
import type { QuoteRecord, QuoteRequestRecord } from "@/lib/firebase/schema";

export const QUOTE_COMPARISON_INBOX_PATH = "/mypage/quotes";

export function quoteComparisonReportPath(input: {
  quoteRequestId?: string | null;
  sourceType?: QuoteRequestRecord["sourceType"] | null;
}) {
  const quoteRequestId = input.quoteRequestId?.trim();
  if (input.sourceType === "audit_quote" && quoteRequestId) {
    return `${QUOTE_COMPARISON_INBOX_PATH}?compare=${encodeURIComponent(quoteRequestId)}`;
  }
  return QUOTE_COMPARISON_INBOX_PATH;
}

export function quoteComparisonReportUrl(input: {
  quote?: Pick<QuoteRecord, "quoteRequestId">;
  quoteRequest?: Pick<QuoteRequestRecord, "id" | "sourceType">;
}) {
  return `${getAppBaseUrl()}${quoteComparisonReportPath({
    quoteRequestId: input.quoteRequest?.id || input.quote?.quoteRequestId,
    sourceType: input.quoteRequest?.sourceType,
  })}`;
}
