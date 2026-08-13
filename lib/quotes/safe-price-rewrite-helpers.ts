import { quoteAutomationPlanLookupIds } from "@/lib/quotes/quote-requests";

/** 평가 건·견적서에 붙은 요청 ID가 달라도 같은 quoteRequests 문서를 찾는다. */
export function quoteRequestIdsForSafePriceRewrite(
  ...ids: Array<string | null | undefined>
) {
  return [
    ...new Set(
      ids
        .filter((id): id is string => Boolean(id?.trim()))
        .flatMap((id) => quoteAutomationPlanLookupIds(id.trim())),
    ),
  ];
}

export function recipientEmailForQuoteRewrite(
  quote: { customerEmail?: string },
  quoteRequest: { customerEmail?: string } | null,
) {
  return (
    quote.customerEmail?.trim() || quoteRequest?.customerEmail?.trim() || ""
  );
}
