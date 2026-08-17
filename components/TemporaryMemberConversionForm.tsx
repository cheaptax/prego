"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { findExactCooperativeMatch } from "@/lib/audit-quote/client-form";
import type { CmsPageContent } from "@/lib/cms/schemas";
import { getCmsSection } from "@/lib/cms/runtime";
import {
  formatCooperativeSearchSubtitle,
  type CooperativeSearchItem,
} from "@/lib/cooperatives/demo-cooperative";
import { getFirebaseAuth } from "@/lib/firebase/client";
import {
  displayQuotedPhone,
  pickQuotedContact,
  pickQuotedCooperative,
} from "@/lib/members/quoted-cooperative";

function quotedCooperativeItem(
  cooperativeId: string,
  cooperativeName: string,
): CooperativeSearchItem {
  return {
    cooperative_id: cooperativeId,
    cooperative_name: cooperativeName,
    cooperative_type: "지역농협",
    sido: "",
    sigungu: "",
    address: "",
    status: "active",
    signupStatus: "REGISTERED",
    isDemoInstitution: false,
    dataClassification: "PRODUCTION",
    resettable: false,
  };
}

export function TemporaryMemberConversionForm({
  content,
}: {
  content: CmsPageContent;
}) {
  const router = useRouter();
  const organizationCopy = getCmsSection(
    content,
    "auth.signup",
    "organization",
  );
  const workCopy = getCmsSection(content, "auth.signup", "work");
  const consentCopy = getCmsSection(content, "auth.signup", "consents");
  const submitCopy = getCmsSection(content, "auth.signup", "submit");
  const messages = content.messages;
  const termsHref =
    consentCopy.actions.find((action) => action.id === "terms")?.href ||
    "/terms";
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CooperativeSearchItem[]>([]);
  const [selected, setSelected] = useState<CooperativeSearchItem | null>(null);
  const [quotedCooperative, setQuotedCooperative] = useState<{
    cooperativeId: string;
    cooperativeName: string;
  } | null>(null);
  const [quotedContact, setQuotedContact] = useState<{
    customerName: string;
    customerPhone: string;
    customerEmail: string;
  }>({ customerName: "", customerPhone: "", customerEmail: "" });
  const [position, setPosition] = useState("");
  const [duty, setDuty] = useState("");
  const [conversionConsent, setConversionConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingQuote, setLoadingQuote] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadQuotedCooperative() {
      const user = getFirebaseAuth().currentUser;
      if (!user) {
        router.replace("/login");
        return;
      }
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/me/quotes", {
          headers: { authorization: `Bearer ${token}` },
        });
        const data = (await response.json().catch(() => null)) as {
          ok?: boolean;
          quoteRequests?: Array<{
            cooperativeId?: string;
            cooperativeName?: string;
            customerName?: string;
            customerPhone?: string;
            customerEmail?: string;
            updatedAt?: string;
            createdAt?: string;
          }>;
        } | null;
        if (cancelled) return;
        const requests = data?.quoteRequests ?? [];
        const quoted = pickQuotedCooperative(requests);
        const contact = pickQuotedContact(requests);
        setQuotedContact({
          customerName: quoted?.customerName || contact.customerName,
          customerPhone: quoted?.customerPhone || contact.customerPhone,
          customerEmail: quoted?.customerEmail || contact.customerEmail,
        });
        if (quoted) {
          setQuotedCooperative({
            cooperativeId: quoted.cooperativeId,
            cooperativeName: quoted.cooperativeName,
          });
          setSelected(
            quotedCooperativeItem(quoted.cooperativeId, quoted.cooperativeName),
          );
          setQuery(quoted.cooperativeName);
        }
      } catch {
        if (!cancelled) {
          setQuotedCooperative(null);
          setQuotedContact({
            customerName: "",
            customerPhone: "",
            customerEmail: "",
          });
        }
      } finally {
        if (!cancelled) setLoadingQuote(false);
      }
    }
    void loadQuotedCooperative();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const showCooperativeSearch =
    !quotedCooperative ||
    selected?.cooperative_id !== quotedCooperative.cooperativeId ||
    query.trim() !== quotedCooperative.cooperativeName;
  const cooperativeQueryTrimmed = query.trim();

  useEffect(() => {
    if (!showCooperativeSearch || !cooperativeQueryTrimmed) {
      setResults([]);
      return;
    }
    if (selected?.cooperative_name === cooperativeQueryTrimmed) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/cooperatives/search?q=${encodeURIComponent(cooperativeQueryTrimmed)}`,
          { signal: controller.signal },
        );
        const data = (await response.json()) as {
          ok?: boolean;
          results?: CooperativeSearchItem[];
        };
        const nextResults =
          response.ok && data.ok ? (data.results ?? []) : [];
        const exact = findExactCooperativeMatch(
          cooperativeQueryTrimmed,
          nextResults,
        );
        if (exact) {
          setSelected(exact);
          setQuery(exact.cooperative_name);
          setResults([]);
          return;
        }
        setResults(nextResults);
      } catch (searchError) {
        if (
          !(searchError instanceof DOMException) ||
          searchError.name !== "AbortError"
        ) {
          setResults([]);
        }
      }
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    cooperativeQueryTrimmed,
    selected?.cooperative_name,
    showCooperativeSearch,
  ]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!selected) return setError(messages.cooperativeRequired);
    if (!position.trim()) return setError(messages.positionRequired);
    if (!duty) return setError(messages.dutyRequired);
    if (!conversionConsent) {
      return setError(
        submitCopy.text.temporaryConversionConsentRequired ||
          messages.consentsRequired,
      );
    }
    const user = getFirebaseAuth().currentUser;
    if (!user) {
      router.replace("/login");
      return;
    }
    setSubmitting(true);
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/me/temporary-membership/complete", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          cooperativeId: selected.cooperative_id,
          position,
          duty,
          conversionConsent: true,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !data?.ok) {
        setError(
          data?.error === "phone_account_limit_exceeded"
            ? messages.phoneAccountLimit
            : data?.error === "invalid_cooperative"
              ? messages.invalidCooperative
              : data?.error === "consent_required"
                ? submitCopy.text.temporaryConversionConsentRequired ||
                  messages.consentsRequired
                : messages.genericError,
        );
        return;
      }
      const sessionResponse = await fetch("/api/auth/portal-session", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          expectedPortal: "customer",
          rememberMe: true,
        }),
      });
      if (!sessionResponse.ok) throw new Error("session_refresh_failed");
      router.replace("/mypage?membership=converted");
      router.refresh();
    } catch {
      setError(messages.genericError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-shell">
        <header className="login-head">
          <span className="login-head__eyebrow">
            <span className="dot" aria-hidden="true" />
            Full membership
          </span>
          <h1 className="login-head__title">
            {submitCopy.text.temporaryConversionTitle}
          </h1>
          <p className="login-head__lede">
            {submitCopy.text.temporaryConversionDescription}
          </p>
        </header>
        <section className="login-card">
          <span className="login-card__tag">정회원 전환</span>
          <h2 className="login-card__title">소속 정보만 보완하면 됩니다</h2>
          <p className="login-card__lede">
            {submitCopy.text.temporaryConversionHelp ||
              "견적 요청 때 입력한 이름·전화번호와 선택한 농협, 개인정보 동의는 그대로 사용합니다."}
          </p>
          <form className="login-form" onSubmit={submit} noValidate>
            <div className="login-quoted-stack">
              {loadingQuote ? (
                <div className="login-quoted">
                  <span className="login-form__field">
                    <span>
                      {submitCopy.text.temporaryConversionQuotedCooperativeLabel ||
                        "견적 요청 농협"}
                    </span>
                    <strong>불러오는 중...</strong>
                  </span>
                </div>
              ) : quotedCooperative &&
                selected?.cooperative_id === quotedCooperative.cooperativeId ? (
                <div className="login-quoted">
                  <span className="login-form__field">
                    <span>
                      {submitCopy.text.temporaryConversionQuotedCooperativeLabel ||
                        "견적 요청 농협"}
                    </span>
                    <strong>{quotedCooperative.cooperativeName}</strong>
                  </span>
                  <button
                    type="button"
                    className="login-quoted__change"
                    onClick={() => {
                      setSelected(null);
                      setQuery("");
                      setResults([]);
                    }}
                  >
                    변경
                  </button>
                </div>
              ) : (
                <label className="login-form__field">
                  <span>{organizationCopy.text.searchLabel}</span>
                  <input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSelected(null);
                    }}
                    placeholder={organizationCopy.text.searchPlaceholder}
                    autoComplete="organization"
                    disabled={loadingQuote}
                  />
                </label>
              )}
              <div className="login-quoted">
                <span className="login-form__field">
                  <span>
                    {submitCopy.text.temporaryConversionQuotedNameLabel ||
                      "견적 요청 이름"}
                  </span>
                  <strong>
                    {loadingQuote
                      ? "불러오는 중..."
                      : quotedContact.customerName ||
                        submitCopy.text.temporaryConversionQuotedMissingValue ||
                        "미등록"}
                  </strong>
                </span>
              </div>
              <div className="login-quoted">
                <span className="login-form__field">
                  <span>
                    {submitCopy.text.temporaryConversionQuotedPhoneLabel ||
                      "견적 요청 전화번호"}
                  </span>
                  <strong>
                    {loadingQuote
                      ? "불러오는 중..."
                      : displayQuotedPhone(quotedContact.customerPhone) ||
                        submitCopy.text.temporaryConversionQuotedMissingValue ||
                        "미등록"}
                  </strong>
                </span>
              </div>
              <div className="login-quoted">
                <span className="login-form__field">
                  <span>
                    {submitCopy.text.temporaryConversionQuotedEmailLabel ||
                      "견적 요청 이메일"}
                  </span>
                  <strong>
                    {loadingQuote
                      ? "불러오는 중..."
                      : quotedContact.customerEmail ||
                        submitCopy.text.temporaryConversionQuotedMissingValue ||
                        "미등록"}
                  </strong>
                </span>
              </div>
            </div>
            {results.length > 0 ? (
              <div
                className="login-coop-results"
                role="listbox"
                aria-label={organizationCopy.text.resultsAriaLabel}
              >
                {results.map((cooperative) => (
                  <button
                    key={cooperative.cooperative_id}
                    type="button"
                    role="option"
                    aria-selected={
                      selected?.cooperative_id === cooperative.cooperative_id
                    }
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setSelected(cooperative);
                      setQuery(cooperative.cooperative_name);
                      setResults([]);
                    }}
                  >
                    <strong>{cooperative.cooperative_name}</strong>
                    <span>
                      {formatCooperativeSearchSubtitle(
                        cooperative,
                        cooperative.isDemoInstitution ? "테스트" : undefined,
                      )}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {selected &&
            selected.cooperative_id !== quotedCooperative?.cooperativeId ? (
              <p className="login-quoted__selected">
                {organizationCopy.text.selectedPrefix}{" "}
                {selected.cooperative_name}
              </p>
            ) : null}
            <label className="login-form__field">
              <span>{workCopy.text.positionLabel}</span>
              <input
                value={position}
                onChange={(event) => setPosition(event.target.value)}
                placeholder={workCopy.text.positionPlaceholder}
                maxLength={100}
              />
            </label>
            <label className="login-form__field">
              <span>{workCopy.text.dutyLabel}</span>
              <select
                value={duty}
                onChange={(event) => setDuty(event.target.value)}
              >
                <option value="">{workCopy.text.dutyPlaceholder}</option>
                {workCopy.items
                  .filter((item) => item.visible && !item.deleted)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
              </select>
            </label>
            <label className="login-consent">
              <input
                type="checkbox"
                checked={conversionConsent}
                onChange={(event) =>
                  setConversionConsent(event.target.checked)
                }
              />
              <span>
                {submitCopy.text.temporaryConversionConsentLabel ||
                  "정회원 전환에 동의합니다"}
                <em>
                  {submitCopy.text.temporaryConversionConsentHelp ||
                    "이용약관에 동의하며, 견적 요청 시 동의한 개인정보 수집·이용은 그대로 유지됩니다."}{" "}
                  <Link href={termsHref} target="_blank">
                    {submitCopy.text.temporaryConversionConsentLinkLabel ||
                      "이용약관 보기"}
                  </Link>
                </em>
              </span>
            </label>
            {error ? (
              <p className="login-form__error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              className="login-form__submit"
              type="submit"
              disabled={submitting || loadingQuote}
            >
              {submitting
                ? submitCopy.text.temporaryConversionSubmittingLabel
                : submitCopy.text.temporaryConversionSubmitLabel}
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}
