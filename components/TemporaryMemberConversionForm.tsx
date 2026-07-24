"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { CmsPageContent } from "@/lib/cms/schemas";
import { getCmsSection } from "@/lib/cms/runtime";
import type { CooperativeSearchItem } from "@/lib/cooperatives/demo-cooperative";
import { getFirebaseAuth } from "@/lib/firebase/client";

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
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CooperativeSearchItem[]>([]);
  const [selected, setSelected] = useState<CooperativeSearchItem | null>(null);
  const [position, setPosition] = useState("");
  const [duty, setDuty] = useState("");
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [emailConsent, setEmailConsent] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const [kakaoConsent, setKakaoConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || selected?.cooperative_name === trimmed) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/cooperatives/search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );
        const data = (await response.json()) as {
          ok?: boolean;
          results?: CooperativeSearchItem[];
        };
        setResults(response.ok && data.ok ? (data.results ?? []) : []);
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
  }, [query, selected]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!selected) return setError(messages.cooperativeRequired);
    if (!position.trim()) return setError(messages.positionRequired);
    if (!duty) return setError(messages.dutyRequired);
    if (!terms || !privacy) return setError(messages.consentsRequired);
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
          consents: {
            terms,
            privacy,
            marketing,
            email: emailConsent,
            sms: smsConsent,
            kakao: kakaoConsent,
          },
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
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="conversion-title">
        <header className="auth-panel__head">
          <p className="eyebrow">Full membership</p>
          <h1 id="conversion-title">
            {submitCopy.text.temporaryConversionTitle}
          </h1>
          <p>{submitCopy.text.temporaryConversionDescription}</p>
        </header>
        <form className="auth-form" onSubmit={submit} noValidate>
          <label className="auth-field">
            <span className="auth-field__label">
              {organizationCopy.text.searchLabel}
            </span>
            <input
              className="auth-field__input"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected(null);
                setResults([]);
              }}
              placeholder={organizationCopy.text.searchPlaceholder}
              autoComplete="organization"
            />
          </label>
          {results.length > 0 ? (
            <div
              className="auth-org-results"
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
                  onClick={() => {
                    setSelected(cooperative);
                    setQuery(cooperative.cooperative_name);
                    setResults([]);
                  }}
                >
                  <strong>{cooperative.cooperative_name}</strong>
                  <span>
                    {cooperative.sido} {cooperative.sigungu}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {selected ? (
            <p className="auth-field__success">
              {organizationCopy.text.selectedPrefix}{" "}
              {selected.cooperative_name}
            </p>
          ) : null}
          <label className="auth-field">
            <span className="auth-field__label">
              {workCopy.text.positionLabel}
            </span>
            <input
              className="auth-field__input"
              value={position}
              onChange={(event) => setPosition(event.target.value)}
              placeholder={workCopy.text.positionPlaceholder}
              maxLength={100}
            />
          </label>
          <label className="auth-field">
            <span className="auth-field__label">
              {workCopy.text.dutyLabel}
            </span>
            <select
              className="auth-field__input"
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
          <fieldset className="auth-consent">
            <legend>{consentCopy.title}</legend>
            <label>
              <input
                type="checkbox"
                checked={terms}
                onChange={(event) => setTerms(event.target.checked)}
              />
              <span>{consentCopy.text.termsLabel}</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={privacy}
                onChange={(event) => setPrivacy(event.target.checked)}
              />
              <span>{consentCopy.text.privacyLabel}</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={marketing}
                onChange={(event) => setMarketing(event.target.checked)}
              />
              <span>{consentCopy.text.marketingLabel}</span>
            </label>
            <div className="auth-consent__channels">
              {[
                [consentCopy.text.emailLabel, emailConsent, setEmailConsent],
                [consentCopy.text.smsLabel, smsConsent, setSmsConsent],
                [consentCopy.text.kakaoLabel, kakaoConsent, setKakaoConsent],
              ].map(([label, checked, setter]) => (
                <label key={String(label)}>
                  <input
                    type="checkbox"
                    checked={Boolean(checked)}
                    onChange={(event) =>
                      (setter as (value: boolean) => void)(
                        event.target.checked,
                      )
                    }
                  />
                  <span>{String(label)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {error ? (
            <p className="login-form__error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="auth-submit"
            type="submit"
            disabled={submitting}
          >
            {submitting
              ? submitCopy.text.temporaryConversionSubmittingLabel
              : submitCopy.text.temporaryConversionSubmitLabel}
          </button>
        </form>
      </section>
    </main>
  );
}
