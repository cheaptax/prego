"use client";

import { onAuthStateChanged } from "firebase/auth";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebase/client";
import type { QuoteRecord, QuoteRequestRecord } from "@/lib/firebase/schema";
import type { CmsPageKey } from "@/lib/cms/constants";
import { getCmsMessage, getCmsSection } from "@/lib/cms/runtime";
import type { CmsPageContent } from "@/lib/cms/schemas";

type State = "loading" | "ready" | "denied" | "error";
type CustomerQuoteRecord = QuoteRecord & {
  evaluationCompatibility?: {
    status: "CURRENT" | "RESUBMISSION_REQUIRED";
    missingFields: string[];
  } | null;
};

const PREVIEW_QUOTE = {
  id: "preview-quote",
  quoteRequestId: "preview-request",
  partnerName: "프리고회계법인",
  status: "finalized",
  version: 1,
  totalAmount: 11_000_000,
} as CustomerQuoteRecord;

const PREVIEW_REQUEST = {
  id: "preview-request",
  subject: "2027년도 외부회계감사 견적",
} as QuoteRequestRecord;

export function CustomerQuotesPage({
  quoteId,
  conversionCopy,
  content,
  pageKey,
  previewMode = false,
}: {
  quoteId?: string;
  conversionCopy: {
    title: string;
    description: string;
    actionLabel: string;
  };
  content: CmsPageContent;
  pageKey: Extract<CmsPageKey, "member.quotes" | "member.quoteDetail">;
  previewMode?: boolean;
}) {
  const section = getCmsSection(
    content,
    pageKey,
    pageKey === "member.quotes" ? "hero" : "summary",
  );
  const copy = (key: string) => getCmsMessage(content, pageKey, key);
  const [state, setState] = useState<State>(
    previewMode ? "ready" : "loading",
  );
  const [quotes, setQuotes] = useState<CustomerQuoteRecord[]>(
    previewMode ? [PREVIEW_QUOTE] : [],
  );
  const [quoteRequests, setQuoteRequests] = useState<QuoteRequestRecord[]>(
    previewMode ? [PREVIEW_REQUEST] : [],
  );
  const [message, setMessage] = useState("");
  const [temporaryMember, setTemporaryMember] = useState(false);
  const quoteRequestById = useMemo(
    () => new Map(quoteRequests.map((request) => [request.id, request])),
    [quoteRequests],
  );
  const visibleQuotes = quoteId
    ? quotes.filter((quote) => quote.id === quoteId)
    : quotes;

  useEffect(() => {
    if (previewMode) return undefined;
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (!user) {
        setState("denied");
        return;
      }
      void Promise.resolve()
        .then(async () => {
          const token = await user.getIdToken();
          const response = await fetch("/api/me/quotes", {
            headers: { authorization: `Bearer ${token}` },
          });
          const data = (await response.json()) as {
            ok?: boolean;
            quotes?: CustomerQuoteRecord[];
            quoteRequests?: QuoteRequestRecord[];
            membershipStatus?: string;
          };
          if (!response.ok || !data.ok) throw new Error("quote_load_failed");
          setQuotes(data.quotes ?? []);
          setQuoteRequests(data.quoteRequests ?? []);
          setTemporaryMember(
            data.membershipStatus === "temporary_quote_member",
          );
          setState("ready");
        })
        .catch(() => setState("error"));
    });
    return () => unsubscribe();
  }, [previewMode]);

  const downloadQuote = async (id: string) => {
    if (previewMode) return;
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    setMessage("");
    const token = await user.getIdToken();
    const response = await fetch(`/api/me/quotes/${id}/download`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const data = (await response.json().catch(() => null)) as
      | { ok?: boolean; url?: string }
      | null;
    if (!response.ok || !data?.ok || !data.url) {
      setMessage(copy("downloadFailed"));
      return;
    }
    window.location.assign(data.url);
  };

  if (state === "loading") {
    return <main className="admin-state"><p>{copy("loading")}</p></main>;
  }
  if (state === "denied") {
    return <main className="admin-state"><p>{copy("denied")}</p></main>;
  }
  if (state === "error") {
    return <main className="admin-state"><p>{copy("loadFailed")}</p></main>;
  }

  return (
    <main className="page-shell">
      <section className="section">
        <div className="section-inner">
          <header className="admin-card__head">
            <div>
              {section.eyebrow ? (
                <p className="eyebrow">{section.eyebrow}</p>
              ) : null}
              <h1>{section.title}</h1>
              {section.description ? <p>{section.description}</p> : null}
            </div>
          </header>
          {temporaryMember ? (
            <aside className="admin-toast admin-toast--info" role="status">
              <div>
                <strong>{conversionCopy.title}</strong>
                <p>{conversionCopy.description}</p>
              </div>
              <Link
                className="admin-btn admin-btn--primary"
                href="/signup?complete=1"
              >
                {conversionCopy.actionLabel}
              </Link>
            </aside>
          ) : null}
          {message ? <p className="admin-form__error">{message}</p> : null}
          <div className="admin-grid">
            {visibleQuotes.map((quote) => {
              const request = quoteRequestById.get(quote.quoteRequestId);
              return (
                <article key={quote.id} className="admin-card">
                  <h2>{quote.partnerName}</h2>
                  <p>{request?.subject ?? quote.quoteRequestId}</p>
                  <dl className="admin-detail-list">
                    <div>
                      <dt>{copy("totalLabel")}</dt>
                      <dd>
                        {quote.totalAmount.toLocaleString("ko-KR")}
                        {copy("currencySuffix")}
                      </dd>
                    </div>
                    <div>
                      <dt>{copy("statusLabel")}</dt>
                      <dd>{quoteStatusLabel(quote.status, copy)}</dd>
                    </div>
                    <div>
                      <dt>{copy("versionLabel")}</dt>
                      <dd>v{quote.version}</dd>
                    </div>
                    {quote.auditEvaluation &&
                    quote.evaluationCompatibility?.status !==
                      "RESUBMISSION_REQUIRED" ? (
                      <div>
                        <dt>{copy("evaluationScoreLabel")}</dt>
                        <dd>
                          {(
                            quote.auditEvaluation.score.totalScoreBasisPoints /
                            100
                          ).toFixed(2)}
                          {copy("scoreSuffix")}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  {quote.evaluationCompatibility?.status ===
                  "RESUBMISSION_REQUIRED" ? (
                    <p className="admin-form__error">
                      {copy("resubmissionRequired")}{" "}
                      {copy("resubmissionMissingPrefix")}{" "}
                      {quote.evaluationCompatibility.missingFields.join(", ")}
                    </p>
                  ) : null}
                  {quote.auditEvaluation &&
                  quote.evaluationCompatibility?.status !==
                    "RESUBMISSION_REQUIRED" ? (
                    <details className="admin-form__group">
                      <summary>
                        {quote.auditEvaluation.configName}{" "}
                        {copy("evaluationDetailsSuffix")}
                      </summary>
                      <dl className="admin-detail-list">
                        {quote.auditEvaluation.criteria.map((criterion) => (
                          <div key={criterion.id}>
                            <dt>{criterion.name}</dt>
                            <dd>
                              {(
                                criterion.scoreBasisPoints / 100
                              ).toFixed(2)}
                              {copy("scoreSuffix")} /{" "}
                              {(
                                criterion.weightBasisPoints / 100
                              ).toFixed(2)}
                              {copy("scoreSuffix")}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  ) : null}
                  <button
                    type="button"
                    className="admin-btn admin-btn--primary"
                    onClick={() => void downloadQuote(quote.id)}
                  >
                    {copy("downloadLabel")}
                  </button>
                </article>
              );
            })}
            {visibleQuotes.length === 0 ? (
              <p className="admin-empty">{copy("empty")}</p>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}

function quoteStatusLabel(
  status: QuoteRecord["status"],
  copy: (key: string) => string,
) {
  return copy(
    {
      draft: "statusDraft",
      finalized: "statusFinalized",
      delivered: "statusDelivered",
      void: "statusVoid",
    }[status],
  );
}
