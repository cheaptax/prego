"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { trackAuditQuoteEvent } from "@/lib/audit-quote/analytics";
import {
  AUDIT_QUOTE_REQUEST_ENDPOINT,
  buildAuditQuoteRequestPayload,
} from "@/lib/audit-quote/client-payload";
import {
  IdempotencyKeySession,
  formatPhoneInput,
  validateAuditQuoteEmail,
  validateAuditQuoteFiscalYear,
  validateAuditQuoteName,
  validateAuditQuotePhone,
  validateAuditQuoteTargetCooperative,
} from "@/lib/audit-quote/client-form";
import type { PublicAuditQuoteConfig } from "@/lib/audit-quote/public-types";
import { normalizeAuditQuoteCmsContent } from "@/lib/cms/audit-quote-content";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";
import { cmsSectionRootProps } from "@/lib/cms/style-runtime";

type Props = {
  config: PublicAuditQuoteConfig;
  content: CmsPageContent;
  editing?: boolean;
  previewMode?: boolean;
  mainId?: string | null;
  selectedSectionId?: string;
  onSelectSection?: (sectionId: string) => void;
};

type FormStatus = "idle" | "submitting" | "success" | "error";

function visibleItems(section: CmsSection) {
  return section.items.filter((item) => item.visible && !item.deleted);
}

function eventSectionClasses(section: CmsSection, baseClassName: string) {
  const root = cmsSectionRootProps(section, baseClassName);
  const card = section.style.card;
  const button = section.style.button;
  return {
    ...root,
    className: [
      root.className,
      card ? `aq-card-bg-${card.background}` : "",
      card ? `aq-card-border-${card.border}` : "",
      card ? `aq-card-radius-${card.radius}` : "",
      card ? `aq-card-shadow-${card.shadow}` : "",
      button ? `aq-button-tone-${button.tone}` : "",
      button ? `aq-button-size-${button.size}` : "",
      button ? `aq-button-radius-${button.radius}` : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export function AuditQuoteEventPage({
  config,
  content,
  editing = false,
  previewMode = false,
  mainId = "main",
  selectedSectionId,
  onSelectSection,
}: Props) {
  const normalizedContent = useMemo(
    () => normalizeAuditQuoteCmsContent(content),
    [content],
  );
  const messages = normalizedContent.messages;
  const [targetCooperativeName, setTargetCooperativeName] = useState("");
  const [fiscalYear, setFiscalYear] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    targetCooperativeName?: string;
    fiscalYear?: string;
    email?: string;
    name?: string;
    phone?: string;
    consent?: string;
  }>({});
  const [formError, setFormError] = useState("");
  const [status, setStatus] = useState<FormStatus>("idle");
  const [publicReference, setPublicReference] = useState("");

  const idempotency = useRef(new IdempotencyKeySession());
  const targetCooperativeRef = useRef<HTMLInputElement | null>(null);
  const fiscalYearRef = useRef<HTMLInputElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const phoneRef = useRef<HTMLInputElement | null>(null);
  const successRef = useRef<HTMLHeadingElement | null>(null);
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  const fieldId = useId();
  const statusId = useId();

  useEffect(() => {
    trackAuditQuoteEvent("audit_quote_page_view", {
      campaign: config.campaign,
      channel: config.channel,
      page_path: config.pagePath,
    });
    if (config.enabled) {
      trackAuditQuoteEvent("audit_quote_form_view", {
        campaign: config.campaign,
        channel: config.channel,
        page_path: config.pagePath,
        placement: "inline",
      });
    }
  }, [config.campaign, config.channel, config.pagePath, config.enabled]);

  function resetForNewSubmission() {
    setTargetCooperativeName("");
    setFiscalYear("");
    setEmail("");
    setName("");
    setPhone("");
    setPrivacyConsent(false);
    setMarketingConsent(false);
    setHoneypot("");
    setFieldErrors({});
    setFormError("");
    setStatus("idle");
    setPublicReference("");
    idempotency.current.clearAfterSuccess();
    window.setTimeout(() => targetCooperativeRef.current?.focus(), 0);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (previewMode) return;
    if (status === "submitting") return;

    setFormError("");

    const targetCooperativeResult =
      validateAuditQuoteTargetCooperative(targetCooperativeName);
    const fiscalYearResult = validateAuditQuoteFiscalYear(fiscalYear);
    const emailResult = validateAuditQuoteEmail(email);
    const nameResult = validateAuditQuoteName(name);
    const phoneResult = validateAuditQuotePhone(phone);
    const nextErrors: typeof fieldErrors = {};
    if (!targetCooperativeResult.ok) {
      nextErrors.targetCooperativeName = targetCooperativeName.trim()
        ? messages.targetCooperativeInvalid
        : messages.targetCooperativeRequired;
    }
    if (!fiscalYearResult.ok) {
      nextErrors.fiscalYear = fiscalYear.trim()
        ? messages.fiscalYearInvalid
        : messages.fiscalYearRequired;
    }
    if (!emailResult.ok) {
      nextErrors.email = email.trim()
        ? messages.emailInvalid
        : messages.emailRequired;
    }
    if (!nameResult.ok) {
      nextErrors.name = name.trim()
        ? messages.nameInvalid
        : messages.nameRequired;
    }
    if (!phoneResult.ok) {
      nextErrors.phone = phone.trim()
        ? messages.phoneInvalid
        : messages.phoneRequired;
    }
    if (!privacyConsent) {
      nextErrors.consent = messages.consentRequired;
    }
    setFieldErrors(nextErrors);

    if (
      !targetCooperativeResult.ok ||
      !fiscalYearResult.ok ||
      !emailResult.ok ||
      !nameResult.ok ||
      !phoneResult.ok ||
      !privacyConsent
    ) {
      setStatus("error");
      const focusTarget = !targetCooperativeResult.ok
        ? targetCooperativeRef
        : !fiscalYearResult.ok
          ? fiscalYearRef
          : !emailResult.ok
            ? emailRef
            : !nameResult.ok
              ? nameRef
              : !phoneResult.ok
                ? phoneRef
                : null;
      window.setTimeout(() => focusTarget?.current?.focus(), 0);
      return;
    }

    const key = idempotency.current.getForAttempt();
    setStatus("submitting");
    trackAuditQuoteEvent("audit_quote_submit_attempt", {
      campaign: config.campaign,
      channel: config.channel,
      page_path: config.pagePath,
    });

    try {
      const res = await fetch(AUDIT_QUOTE_REQUEST_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify(
          buildAuditQuoteRequestPayload(
            {
              email: emailResult.email,
              name: nameResult.name,
              phone: phoneResult.phone,
              targetCooperativeName:
                targetCooperativeResult.targetCooperativeName,
              fiscalYear: fiscalYearResult.fiscalYear,
              marketingConsent,
              companyWebsite: honeypot,
            },
            config,
          ),
        ),
      });

      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        publicReference?: string;
        error?: string;
      } | null;

      if (!res.ok || !data?.ok || !data.publicReference) {
        const code = data?.error ?? "submit_failed";
        trackAuditQuoteEvent("audit_quote_submit_error", {
          campaign: config.campaign,
          channel: config.channel,
          page_path: config.pagePath,
          error_code: code,
        });
        setFormError(
          code === "invalid_email"
            ? messages.emailInvalid
            : code === "invalid_target_cooperative"
              ? messages.targetCooperativeInvalid
              : code === "invalid_fiscal_year"
                ? messages.fiscalYearInvalid
            : code === "invalid_name"
              ? messages.nameInvalid
              : code === "invalid_phone"
                ? messages.phoneInvalid
                : code === "consent_required"
                  ? messages.consentRequired
                  : code === "privacy_version_mismatch"
                    ? messages.privacyVersionMismatch
                    : code === "event_disabled"
                      ? messages.eventDisabled
                      : code === "rate_limited"
                        ? messages.rateLimited
                        : [
                              "origin_not_allowed",
                              "unsupported_media_type",
                              "payload_too_large",
                            ].includes(code)
                          ? messages.requestRejected
                          : messages.genericError,
        );
        setStatus("error");
        window.setTimeout(() => errorRef.current?.focus(), 0);
        return;
      }

      trackAuditQuoteEvent("audit_quote_submit_success", {
        campaign: config.campaign,
        channel: config.channel,
        page_path: config.pagePath,
      });
      setPublicReference(data.publicReference);
      setStatus("success");
      idempotency.current.clearAfterSuccess();
      window.setTimeout(() => successRef.current?.focus(), 0);
    } catch {
      trackAuditQuoteEvent("audit_quote_submit_error", {
        campaign: config.campaign,
        channel: config.channel,
        page_path: config.pagePath,
        error_code: "network",
      });
      setFormError(messages.genericError);
      setStatus("error");
      window.setTimeout(() => errorRef.current?.focus(), 0);
    }
  }

  function sectionProps(section: CmsSection, baseClassName: string) {
    const root = eventSectionClasses(section, baseClassName);
    return {
      ...root,
      className: [
        root.className,
        editing ? "cms-home-edit-section" : "",
        editing && selectedSectionId === section.id ? "is-selected" : "",
        editing && !section.visible ? "is-hidden" : "",
      ]
        .filter(Boolean)
        .join(" "),
      tabIndex: editing ? 0 : undefined,
      "data-cms-section-id": editing ? section.id : undefined,
      onClick: editing ? () => onSelectSection?.(section.id) : undefined,
      onFocus: editing ? () => onSelectSection?.(section.id) : undefined,
    };
  }

  function renderSection(section: CmsSection) {
    if (!section.visible && !editing) return null;

    if (section.id === "hero") {
      const highlight = section.text.highlight;
      return (
        <section key={section.id} {...sectionProps(section, "aq-hero")}>
          {section.eyebrow ? (
            <span className="aq-badge">{section.eyebrow}</span>
          ) : null}
          <h1 className="aq-title">
            {section.title.split(/\n+/).map((line, index) => {
              const highlightIndex = highlight
                ? line.indexOf(highlight)
                : -1;
              return (
                <span className="aq-title__line" key={`${line}-${index}`}>
                  {index > 0 ? <br /> : null}
                  {highlightIndex >= 0 ? (
                    <>
                      {line.slice(0, highlightIndex)}
                      <em>{highlight}</em>
                      {line.slice(highlightIndex + highlight.length)}
                    </>
                  ) : (
                    line
                  )}
                </span>
              );
            })}
          </h1>
          {section.description ? (
            <p className="aq-lede">
              {section.description.split(/\n+/).map((line, index) => (
                <span key={`${line}-${index}`}>
                  {index > 0 ? <br /> : null}
                  {line}
                </span>
              ))}
            </p>
          ) : null}
        </section>
      );
    }

    if (section.id === "intakeForm") {
      const targetCooperativeDescriptions = [
        section.text.targetCooperativeHelp
          ? `${fieldId}-target-cooperative-help`
          : "",
        fieldErrors.targetCooperativeName
          ? `${fieldId}-target-cooperative-error`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      const fiscalYearDescriptions = [
        section.text.fiscalYearHelp ? `${fieldId}-fiscal-year-help` : "",
        fieldErrors.fiscalYear ? `${fieldId}-fiscal-year-error` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const emailDescriptions = [
        section.text.emailHelp ? `${fieldId}-email-help` : "",
        fieldErrors.email ? `${fieldId}-email-error` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const nameDescriptions = [
        section.text.nameHelp ? `${fieldId}-name-help` : "",
        fieldErrors.name ? `${fieldId}-name-error` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const phoneDescriptions = [
        section.text.phoneHelp ? `${fieldId}-phone-help` : "",
        fieldErrors.phone ? `${fieldId}-phone-error` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return (
        <section
          key={section.id}
          {...sectionProps(section, "aq-form-wrap")}
          aria-label={section.text.formAriaLabel}
        >
          {!config.enabled && !previewMode ? (
            <div className="aq-card aq-closed" role="status">
              <strong>{messages.closedTitle}</strong>
              <p>{messages.closedDescription || config.closedMessage}</p>
            </div>
          ) : status === "success" ? (
            <div className="aq-card aq-success" role="status">
              <span className="aq-success__icon" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 28 28">
                  <path
                    d="M6 14.5 L11.5 20 L22 9"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </svg>
              </span>
              <h2 ref={successRef} tabIndex={-1}>
                {messages.successTitle}
              </h2>
              <p>{messages.successDescription}</p>
              <p>{messages.temporaryMemberNotice}</p>
              <p className="aq-field__help">
                {messages.temporaryMemberSecurityNotice}
              </p>
              {publicReference ? (
                <p className="aq-success__ref">
                  {messages.publicReferenceLabel}{" "}
                  <code>{publicReference}</code>
                </p>
              ) : null}
              <button
                type="button"
                className="aq-btn-ghost"
                onClick={resetForNewSubmission}
              >
                {messages.resetLabel}
              </button>
            </div>
          ) : (
            <form className="aq-card aq-form" onSubmit={onSubmit} noValidate>
              {section.text.formTitle ? (
                <h2 className="aq-form__title">{section.text.formTitle}</h2>
              ) : null}
              {section.text.formDescription ? (
                <p className="aq-form__description">
                  {section.text.formDescription}
                </p>
              ) : null}
              <div className="aq-field">
                <label htmlFor={`${fieldId}-target-cooperative`}>
                  {section.text.targetCooperativeLabel}
                </label>
                <input
                  ref={targetCooperativeRef}
                  id={`${fieldId}-target-cooperative`}
                  type="text"
                  name="targetCooperativeName"
                  autoComplete="organization"
                  placeholder={section.text.targetCooperativePlaceholder}
                  value={targetCooperativeName}
                  aria-invalid={Boolean(fieldErrors.targetCooperativeName)}
                  aria-describedby={
                    targetCooperativeDescriptions || undefined
                  }
                  disabled={status === "submitting"}
                  onChange={(event) => {
                    setTargetCooperativeName(event.target.value);
                    if (fieldErrors.targetCooperativeName) {
                      setFieldErrors((prev) => ({
                        ...prev,
                        targetCooperativeName: undefined,
                      }));
                    }
                  }}
                />
                {section.text.targetCooperativeHelp ? (
                  <p
                    id={`${fieldId}-target-cooperative-help`}
                    className="aq-field__help"
                  >
                    {section.text.targetCooperativeHelp}
                  </p>
                ) : null}
                {fieldErrors.targetCooperativeName ? (
                  <p
                    id={`${fieldId}-target-cooperative-error`}
                    className="aq-error"
                    role="alert"
                  >
                    {fieldErrors.targetCooperativeName}
                  </p>
                ) : null}
              </div>

              <div className="aq-field">
                <label htmlFor={`${fieldId}-fiscal-year`}>
                  {section.text.fiscalYearLabel}
                </label>
                <input
                  ref={fiscalYearRef}
                  id={`${fieldId}-fiscal-year`}
                  type="text"
                  name="fiscalYear"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder={section.text.fiscalYearPlaceholder}
                  value={fiscalYear}
                  aria-invalid={Boolean(fieldErrors.fiscalYear)}
                  aria-describedby={fiscalYearDescriptions || undefined}
                  disabled={status === "submitting"}
                  onChange={(event) => {
                    setFiscalYear(event.target.value.replace(/\D/gu, ""));
                    if (fieldErrors.fiscalYear) {
                      setFieldErrors((prev) => ({
                        ...prev,
                        fiscalYear: undefined,
                      }));
                    }
                  }}
                />
                {section.text.fiscalYearHelp ? (
                  <p
                    id={`${fieldId}-fiscal-year-help`}
                    className="aq-field__help"
                  >
                    {section.text.fiscalYearHelp}
                  </p>
                ) : null}
                {fieldErrors.fiscalYear ? (
                  <p
                    id={`${fieldId}-fiscal-year-error`}
                    className="aq-error"
                    role="alert"
                  >
                    {fieldErrors.fiscalYear}
                  </p>
                ) : null}
              </div>

              <div className="aq-field">
                <label htmlFor={`${fieldId}-email`}>
                  {section.text.emailLabel}
                </label>
                <input
                  ref={emailRef}
                  id={`${fieldId}-email`}
                  type="email"
                  name="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder={section.text.emailPlaceholder}
                  value={email}
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby={emailDescriptions || undefined}
                  disabled={status === "submitting"}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (fieldErrors.email) {
                      setFieldErrors((prev) => ({
                        ...prev,
                        email: undefined,
                      }));
                    }
                  }}
                />
                {section.text.emailHelp ? (
                  <p id={`${fieldId}-email-help`} className="aq-field__help">
                    {section.text.emailHelp}
                  </p>
                ) : null}
                {fieldErrors.email ? (
                  <p
                    id={`${fieldId}-email-error`}
                    className="aq-error"
                    role="alert"
                  >
                    {fieldErrors.email}
                  </p>
                ) : null}
              </div>

              <div className="aq-field">
                <label htmlFor={`${fieldId}-name`}>
                  {section.text.nameLabel}
                </label>
                <input
                  ref={nameRef}
                  id={`${fieldId}-name`}
                  type="text"
                  name="name"
                  autoComplete="name"
                  placeholder={section.text.namePlaceholder}
                  value={name}
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={nameDescriptions || undefined}
                  disabled={status === "submitting"}
                  onChange={(event) => {
                    setName(event.target.value);
                    if (fieldErrors.name) {
                      setFieldErrors((prev) => ({
                        ...prev,
                        name: undefined,
                      }));
                    }
                  }}
                />
                {section.text.nameHelp ? (
                  <p id={`${fieldId}-name-help`} className="aq-field__help">
                    {section.text.nameHelp}
                  </p>
                ) : null}
                {fieldErrors.name ? (
                  <p
                    id={`${fieldId}-name-error`}
                    className="aq-error"
                    role="alert"
                  >
                    {fieldErrors.name}
                  </p>
                ) : null}
              </div>

              <div className="aq-field">
                <label htmlFor={`${fieldId}-phone`}>
                  {section.text.phoneLabel}
                </label>
                <input
                  ref={phoneRef}
                  id={`${fieldId}-phone`}
                  type="tel"
                  name="phone"
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder={section.text.phonePlaceholder}
                  value={phone}
                  aria-invalid={Boolean(fieldErrors.phone)}
                  aria-describedby={phoneDescriptions || undefined}
                  disabled={status === "submitting"}
                  onChange={(event) => {
                    setPhone(formatPhoneInput(event.target.value));
                    if (fieldErrors.phone) {
                      setFieldErrors((prev) => ({
                        ...prev,
                        phone: undefined,
                      }));
                    }
                  }}
                />
                {section.text.phoneHelp ? (
                  <p id={`${fieldId}-phone-help`} className="aq-field__help">
                    {section.text.phoneHelp}
                  </p>
                ) : null}
                {fieldErrors.phone ? (
                  <p
                    id={`${fieldId}-phone-error`}
                    className="aq-error"
                    role="alert"
                  >
                    {fieldErrors.phone}
                  </p>
                ) : null}
              </div>

              <div className="aq-honeypot" aria-hidden="true">
                <label htmlFor={`${fieldId}-company-website`}>
                  회사 웹사이트
                  <input
                    id={`${fieldId}-company-website`}
                    tabIndex={-1}
                    autoComplete="off"
                    value={honeypot}
                    onChange={(event) => setHoneypot(event.target.value)}
                  />
                </label>
              </div>

              <div className="aq-consent">
                <label className="aq-consent__row">
                  <input
                    type="checkbox"
                    checked={privacyConsent}
                    disabled={status === "submitting"}
                    aria-invalid={Boolean(fieldErrors.consent)}
                    aria-describedby={
                      fieldErrors.consent
                        ? `${fieldId}-consent-error`
                        : undefined
                    }
                    onChange={(event) => {
                      setPrivacyConsent(event.target.checked);
                      if (fieldErrors.consent) {
                        setFieldErrors((prev) => ({
                          ...prev,
                          consent: undefined,
                        }));
                      }
                    }}
                  />
                  <span>
                    {section.text.privacyConsentLabel}{" "}
                    <Link href={config.privacyPolicyHref} target="_blank">
                      {section.text.privacyConsentLinkLabel}
                    </Link>
                  </span>
                </label>
                {fieldErrors.consent ? (
                  <p
                    id={`${fieldId}-consent-error`}
                    className="aq-error"
                    role="alert"
                  >
                    {fieldErrors.consent}
                  </p>
                ) : null}
                <label className="aq-consent__row">
                  <input
                    type="checkbox"
                    checked={marketingConsent}
                    disabled={status === "submitting"}
                    onChange={(event) =>
                      setMarketingConsent(event.target.checked)
                    }
                  />
                  <span>{section.text.marketingConsentLabel}</span>
                </label>
              </div>

              {formError ? (
                <p
                  ref={errorRef}
                  className="aq-error aq-error--form"
                  role="alert"
                  tabIndex={-1}
                >
                  {formError}
                </p>
              ) : null}

              <button
                type="submit"
                className="aq-submit"
                disabled={status === "submitting"}
                aria-busy={status === "submitting"}
              >
                {status === "submitting"
                  ? messages.submitting
                  : section.text.submitLabel}
              </button>
              <p className="aq-form__note">{section.text.freeNotice}</p>
            </form>
          )}
        </section>
      );
    }

    if (section.id === "benefits") {
      return (
        <section
          key={section.id}
          {...sectionProps(section, "aq-section")}
          aria-label={section.text.ariaLabel}
        >
          <h2 className="aq-section__title">{section.title}</h2>
          <div className="aq-benefits">
            {visibleItems(section).map((item) => (
              <article key={item.id}>
                <h3>{item.title}</h3>
                {item.description ? <p>{item.description}</p> : null}
              </article>
            ))}
          </div>
        </section>
      );
    }

    if (section.id === "steps") {
      return (
        <section
          key={section.id}
          {...sectionProps(section, "aq-section")}
          aria-label={section.text.ariaLabel}
        >
          <h2 className="aq-section__title">{section.title}</h2>
          <ol className="aq-steps">
            {visibleItems(section).map((step, index) => (
              <li key={step.id}>
                <span aria-hidden="true">{index + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  {step.description ? <p>{step.description}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      );
    }

    if (section.id === "faq") {
      return (
        <section
          key={section.id}
          {...sectionProps(section, "aq-section")}
          aria-label={section.text.ariaLabel}
        >
          <h2 className="aq-section__title">{section.title}</h2>
          <div className="aq-faq">
            {visibleItems(section).map((item) => (
              <details key={item.id}>
                <summary>{item.title}</summary>
                {item.description ? <p>{item.description}</p> : null}
              </details>
            ))}
          </div>
        </section>
      );
    }

    if (section.id === "legalNotice") {
      return (
        <section
          key={section.id}
          {...sectionProps(section, "aq-footnote")}
          aria-label={section.text.ariaLabel}
        >
          <p>
            본 서비스는 <strong>{section.text.operatorName}</strong>
            {section.description}
          </p>
        </section>
      );
    }

    return null;
  }

  return (
    <main id={mainId ?? undefined} className="aq-page">
      <p className="sr-only" id={statusId} role="status" aria-live="polite">
        {status === "submitting"
          ? messages.submittingStatus
          : status === "success"
            ? `${messages.successTitle}. ${messages.successDescription}`
            : formError}
      </p>
      {normalizedContent.sections.map(renderSection)}
    </main>
  );
}
