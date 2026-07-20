export type AuditQuoteAnalyticsEvent =
  | "audit_quote_page_view"
  | "audit_quote_cta_click"
  | "audit_quote_form_view"
  | "audit_quote_submit_attempt"
  | "audit_quote_submit_success"
  | "audit_quote_submit_error";

const ALLOWED_KEYS = new Set([
  "campaign",
  "channel",
  "page_path",
  "error_code",
  "placement",
]);

type GtagFn = (...args: unknown[]) => void;

function getTracker(): GtagFn | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    gtag?: GtagFn;
    dataLayer?: unknown[];
  };
  if (typeof w.gtag === "function") return w.gtag.bind(w);
  return null;
}

export function trackAuditQuoteEvent(
  name: AuditQuoteAnalyticsEvent,
  params: Record<string, string | number | boolean | undefined> = {}
) {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    if (value === undefined) continue;
    safe[key] = value;
  }

  const gtag = getTracker();
  if (!gtag) return;
  gtag("event", name, safe);
}
