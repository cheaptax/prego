"use client";

import { onAuthStateChanged } from "firebase/auth";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CmsSupplementalSections } from "@/components/cms/CmsSupplementalSections";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { displayQuotedPhone } from "@/lib/members/quoted-cooperative";
import type { QuoteRecord, QuoteRequestRecord } from "@/lib/firebase/schema";
import type { CmsPageKey } from "@/lib/cms/constants";
import {
  cmsEditableSectionProps,
  type CmsSectionEditingOptions,
} from "@/lib/cms/editable-section";
import { getCmsMessage, getCmsSection } from "@/lib/cms/runtime";
import type { CmsPageContent } from "@/lib/cms/schemas";
import type { CustomerQuoteComparisonGroup } from "@/lib/quotes/customer-quote-comparison";
import type { QuoteDocumentCopy } from "@/lib/quotes/quote-document-content";
import {
  quotePartnerCredentialRows,
  quotePartnerEvaluationFactRows,
} from "@/lib/quotes/quote-presentation";

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
  supplierName: "프리고회계법인",
  supplierBusinessRegistrationNumber: "123-45-67890",
  supplierAddress: "서울특별시 중구 세종대로 1",
  supplierContactName: "김담당",
  supplierContactEmail: "quote@example.com",
  supplierContactPhone: "02-1234-5678",
  nhAuditV2: {
    submission: {
      engagementPartnerName: "홍길동",
      proposerType: "ACCOUNTING_FIRM",
      certifiedPublicAccountantCount: 12,
      accountingFirmRevenueWon: "1000000000",
      localNonghyupAuditCount2025: 8,
      auditedNonghyupTypes2025: ["LOCAL_AGRICULTURAL_COOPERATIVE"],
      nonghyupTaxAgencyPerformed2025: true,
      nonghyupSubsidySettlementPerformed2025: false,
    },
  },
} as CustomerQuoteRecord;

const PREVIEW_REQUEST = {
  id: "preview-request",
  subject: "2027년도 외부회계감사 견적",
  customerName: "김농협",
  customerPhone: "010-1234-5678",
  customerEmail: "quote@nonghyup.com",
  cooperativeName: "재경농협",
} as QuoteRequestRecord;

export function CustomerQuotesPage({
  quoteId,
  conversionCopy,
  content,
  pageKey,
  previewMode = false,
  editing = false,
  selectedSectionId,
  onSelectSection,
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
} & CmsSectionEditingOptions) {
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
  const [comparisons, setComparisons] = useState<CustomerQuoteComparisonGroup[]>(
    previewMode
      ? [
          {
            quoteRequestId: "preview-request",
            auditQuoteRequestId: "preview-audit",
            subject: "2027년도 외부회계감사 견적",
            quoteCount: 2,
            canCompare: true,
            entryEnabled: true,
            caseId: "preview-case",
            status: "COMPLETED",
            reportAvailable: true,
            reportWorkspaceReady: true,
            href: "/events/audit-quote/evaluations/preview-case/report",
          },
        ]
      : [],
  );
  const [message, setMessage] = useState("");
  const [temporaryMember, setTemporaryMember] = useState(false);
  const [openingComparisonId, setOpeningComparisonId] = useState<string | null>(
    null,
  );
  const autoOpenedCompare = useRef(false);
  const quoteRequestById = useMemo(
    () => new Map(quoteRequests.map((request) => [request.id, request])),
    [quoteRequests],
  );
  const visibleQuotes = quoteId
    ? quotes.filter((quote) => quote.id === quoteId)
    : quotes;
  const visibleRequests = useMemo(() => {
    const scopedQuotes = quoteId
      ? quotes.filter((quote) => quote.id === quoteId)
      : quotes;
    const requests = quoteId
      ? quoteRequests.filter((request) =>
          scopedQuotes.some((quote) => quote.quoteRequestId === request.id),
        )
      : quoteRequests;
    return [...requests].sort((left, right) =>
      (right.updatedAt || right.createdAt || "").localeCompare(
        left.updatedAt || left.createdAt || "",
      ),
    );
  }, [quoteId, quoteRequests, quotes]);
  const visibleComparisons = quoteId
    ? comparisons.filter((group) =>
        visibleQuotes.some(
          (quote) => quote.quoteRequestId === group.quoteRequestId,
        ),
      )
    : comparisons;

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
            comparisons?: CustomerQuoteComparisonGroup[];
            membershipStatus?: string;
          };
          if (!response.ok || !data.ok) throw new Error("quote_load_failed");
          setQuotes(data.quotes ?? []);
          setQuoteRequests(data.quoteRequests ?? []);
          setComparisons(data.comparisons ?? []);
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

  const openComparison = async (group: CustomerQuoteComparisonGroup) => {
    if (previewMode) return;
    if (!group.canCompare) {
      setMessage(copy("comparisonNeedMoreQuotes"));
      return;
    }
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    setMessage("");
    setOpeningComparisonId(group.quoteRequestId);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/me/quotes/comparison-access", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ quoteRequestId: group.quoteRequestId }),
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        redirectTo?: string;
      } | null;
      if (!response.ok || !data?.ok || !data.redirectTo) {
        if (data?.error === "feature_disabled") {
          setMessage(copy("comparisonFeatureDisabled"));
        } else {
          setMessage(copy("comparisonUnavailable"));
        }
        return;
      }
      window.location.assign(data.redirectTo);
    } catch {
      setMessage(copy("comparisonUnavailable"));
    } finally {
      setOpeningComparisonId(null);
    }
  };

  useEffect(() => {
    if (previewMode || state !== "ready" || autoOpenedCompare.current) return;
    if (typeof window === "undefined") return;
    const compareId = new URLSearchParams(window.location.search)
      .get("compare")
      ?.trim();
    if (!compareId) return;
    const group = comparisons.find((item) => item.quoteRequestId === compareId);
    if (!group) return;
    autoOpenedCompare.current = true;
    void openComparison(group);
  }, [previewMode, state, comparisons]);

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
      <section
        {...cmsEditableSectionProps(section, "section", {
          editing,
          selectedSectionId,
          onSelectSection,
        })}
      >
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
          {visibleRequests.length > 0 ? (
            <section
              className="admin-card admin-card--span-2"
              aria-labelledby="quote-request-info-title"
            >
              <header className="admin-card__head">
                <div>
                  <h2 id="quote-request-info-title">
                    {copy("requestInfoTitle")}
                  </h2>
                  <p>{copy("requestInfoHelp")}</p>
                </div>
              </header>
              <ul className="admin-feed">
                {visibleRequests.map((request) => (
                  <li key={request.id} className="admin-feed__item">
                    <div>
                      {request.subject ? (
                        <strong>{request.subject}</strong>
                      ) : null}
                      <dl className="admin-detail-list">
                        <div>
                          <dt>{copy("requestCooperativeLabel")}</dt>
                          <dd>
                            {request.cooperativeName?.trim() ||
                              copy("missingValue")}
                          </dd>
                        </div>
                        <div>
                          <dt>{copy("requestNameLabel")}</dt>
                          <dd>
                            {request.customerName?.trim() ||
                              copy("missingValue")}
                          </dd>
                        </div>
                        <div>
                          <dt>{copy("requestPhoneLabel")}</dt>
                          <dd>
                            {displayQuotedPhone(request.customerPhone) ||
                              copy("missingValue")}
                          </dd>
                        </div>
                        <div>
                          <dt>{copy("requestEmailLabel")}</dt>
                          <dd>
                            {request.customerEmail?.trim() ||
                              copy("missingValue")}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {message ? <p className="admin-form__error">{message}</p> : null}
          {visibleComparisons.length > 0 ? (
            <section className="admin-card admin-card--span-2" aria-labelledby="quote-comparison-title">
              <header className="admin-card__head">
                <div>
                  <h2 id="quote-comparison-title">
                    {copy("comparisonSectionTitle")}
                  </h2>
                  <p>{copy("comparisonSectionHelp")}</p>
                </div>
              </header>
              <ul className="admin-feed">
                {visibleComparisons.map((group) => (
                  <li key={group.quoteRequestId} className="admin-feed__item">
                    <div>
                      <strong>{group.subject}</strong>
                      <span>
                        {group.cooperativeName
                          ? `${group.cooperativeName} · `
                          : ""}
                        {group.quoteCount}
                        {copy("comparisonQuoteCountSuffix")}
                        {group.fiscalYear ? ` · FY${group.fiscalYear}` : ""}
                      </span>
                      {!group.canCompare ? (
                        <small className="admin-form__hint">
                          {group.entryEnabled
                            ? copy("comparisonNeedMoreQuotes")
                            : copy("comparisonFeatureDisabled")}
                        </small>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="admin-btn admin-btn--primary"
                      disabled={
                        !group.canCompare ||
                        openingComparisonId === group.quoteRequestId
                      }
                      onClick={() => void openComparison(group)}
                    >
                      {openingComparisonId === group.quoteRequestId
                        ? copy("comparisonOpeningLabel")
                        : group.reportAvailable
                          ? copy("comparisonReportReadyLabel")
                          : copy("comparisonOpenLabel")}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <div className="admin-grid">
            {visibleQuotes.map((quote) => {
              const request = quoteRequestById.get(quote.quoteRequestId);
              const factCopy = customerQuoteFactCopy(copy);
              const credentialRows = quotePartnerCredentialRows(
                quote,
                factCopy,
              );
              const evaluationFactRows = quotePartnerEvaluationFactRows(
                quote,
                factCopy,
              );
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
                  {credentialRows.length > 0 ? (
                    <section className="quote-customer-facts">
                      <h3>{copy("credentialsTitle")}</h3>
                      <dl className="admin-detail-list">
                        {credentialRows.map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ) : null}
                  {evaluationFactRows.length > 0 ? (
                    <section className="quote-customer-facts">
                      <h3>{copy("evaluationFactsTitle")}</h3>
                      <dl className="admin-detail-list">
                        {evaluationFactRows.map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ) : null}
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
      <CmsSupplementalSections
        pageKey={pageKey}
        content={content}
        editing={editing}
        selectedSectionId={selectedSectionId}
        onSelectSection={onSelectSection}
      />
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

function customerQuoteFactCopy(
  copy: (key: string) => string,
): Partial<QuoteDocumentCopy> {
  return {
    businessNumberLabel: copy("businessNumberLabel"),
    addressLabel: copy("addressLabel"),
    supplierContactLabel: copy("supplierContactLabel"),
    contactLabel: copy("contactLabel"),
    engagementPartnerLabel: copy("engagementPartnerLabel"),
    proposerTypeLabel: copy("proposerTypeLabel"),
    cpaCountLabel: copy("cpaCountLabel"),
    revenueLabel: copy("revenueLabel"),
    localAuditCountLabel: copy("localAuditCountLabel"),
    recentAuditCountLabel: copy("recentAuditCountLabel"),
    auditedTypesLabel: copy("auditedTypesLabel"),
    taxExperienceLabel: copy("taxExperienceLabel"),
    subsidyExperienceLabel: copy("subsidyExperienceLabel"),
    yesLabel: copy("yesLabel"),
    noLabel: copy("noLabel"),
    missingValue: copy("missingValue"),
    peopleSuffix: copy("peopleSuffix"),
    countSuffix: copy("countSuffix"),
    currencySuffix: copy("currencySuffix"),
  };
}
