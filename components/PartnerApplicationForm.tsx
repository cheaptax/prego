"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { INQUIRY_SUPPORT_FIELD_OPTIONS } from "@/lib/inquiry-categories";
import {
  getPartnerProfessionLabel,
  PARTNER_PROFESSION_OPTIONS,
} from "@/lib/partner-professions";
import type { PartnerProfession } from "@/lib/firebase/schema";
import { getCmsMessage, getCmsSection } from "@/lib/cms/runtime";
import type { CmsPageContent } from "@/lib/cms/schemas";

type SubmitState = "idle" | "submitting" | "success" | "error";

export function PartnerApplicationForm({
  content,
  previewMode = false,
}: {
  content: CmsPageContent;
  previewMode?: boolean;
}) {
  const hero = getCmsSection(content, "partner.apply", "hero");
  const formCopy = getCmsSection(content, "partner.apply", "form");
  const messageCopy = (key: string) =>
    getCmsMessage(content, "partner.apply", key);
  const [organizationName, setOrganizationName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [profession, setProfession] = useState<PartnerProfession>("OTHER");
  const [fields, setFields] = useState<string[]>([]);
  const [managerName, setManagerName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [businessRegistrationNumber, setBusinessRegistrationNumber] =
    useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [memo, setMemo] = useState("");
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");

  const toggleField = (label: string) => {
    setFields((current) =>
      current.includes(label)
        ? current.filter((field) => field !== label)
        : [...current, label],
    );
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (previewMode) return;
    setState("submitting");
    setMessage("");
    const response = await fetch("/api/partner-applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationName,
        displayName,
        profession,
        partnerType: getPartnerProfessionLabel(profession),
        fields,
        managerName,
        contactEmail,
        contactPhone,
        businessRegistrationNumber,
        businessAddress,
        memo,
        privacyConsent,
        companyWebsite,
      }),
    });
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
    } | null;
    if (!response.ok || !data?.ok) {
      setState("error");
      setMessage(messageCopy("invalid"));
      return;
    }
    setState("success");
    setMessage(messageCopy("success"));
  };

  return (
    <main className="page-shell">
      <section className="hero-section hero-section--compact">
        <div className="section-inner">
          {hero.eyebrow ? <p className="eyebrow">{hero.eyebrow}</p> : null}
          <h1>{hero.title}</h1>
          {hero.description ? (
            <p className="hero-copy">{hero.description}</p>
          ) : null}
          <p className="hero-copy">
            {hero.text.loginPrompt}{" "}
            <Link className="admin-link" href="/login">
              {hero.text.loginLabel}
            </Link>
          </p>
        </div>
      </section>
      <section className="section">
        <div className="section-inner">
          <header className="admin-card__head">
            <div>
              <h2>{formCopy.title}</h2>
              {formCopy.description ? <p>{formCopy.description}</p> : null}
            </div>
          </header>
          <form className="admin-card admin-form" onSubmit={submit}>
            <div className="admin-partner-form-grid">
              <label className="admin-modal__field">
                {formCopy.text.organizationNameLabel}
                <input
                  className="admin-input"
                  value={organizationName}
                  onChange={(event) => setOrganizationName(event.target.value)}
                  required
                />
              </label>
              <label className="admin-modal__field">
                {formCopy.text.displayNameLabel}
                <input
                  className="admin-input"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder={formCopy.text.displayNamePlaceholder}
                />
              </label>
              <label className="admin-modal__field">
                {formCopy.text.professionLabel}
                <select
                  className="admin-input"
                  value={profession}
                  onChange={(event) =>
                    setProfession(event.target.value as PartnerProfession)
                  }
                >
                  {PARTNER_PROFESSION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-modal__field">
                {formCopy.text.managerNameLabel}
                <input
                  className="admin-input"
                  value={managerName}
                  onChange={(event) => setManagerName(event.target.value)}
                  required
                />
              </label>
              <label className="admin-modal__field">
                {formCopy.text.emailLabel}
                <input
                  className="admin-input"
                  type="email"
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                  required
                />
              </label>
              <label className="admin-modal__field">
                {formCopy.text.phoneLabel}
                <input
                  className="admin-input"
                  type="tel"
                  value={contactPhone}
                  onChange={(event) => setContactPhone(event.target.value)}
                />
              </label>
              <label className="admin-modal__field">
                {formCopy.text.businessNumberLabel}
                <input
                  className="admin-input"
                  inputMode="numeric"
                  placeholder={formCopy.text.businessNumberPlaceholder}
                  value={businessRegistrationNumber}
                  onChange={(event) =>
                    setBusinessRegistrationNumber(event.target.value)
                  }
                  required
                />
              </label>
              <label className="admin-modal__field">
                {formCopy.text.businessAddressLabel}
                <input
                  className="admin-input"
                  value={businessAddress}
                  onChange={(event) => setBusinessAddress(event.target.value)}
                  required
                />
              </label>
            </div>
            <fieldset className="admin-modal__field">
              <legend>{formCopy.text.supportFieldsLegend}</legend>
              <div className="admin-checkbox-grid">
                {INQUIRY_SUPPORT_FIELD_OPTIONS.map((option) => (
                  <label key={option.value} className="admin-check-row">
                    <input
                      type="checkbox"
                      checked={fields.includes(option.label)}
                      onChange={() => toggleField(option.label)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="admin-modal__field">
              {formCopy.text.memoLabel}
              <textarea
                className="admin-input admin-input--area"
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                rows={5}
              />
            </label>
            <label className="admin-check-row">
              <input
                type="checkbox"
                checked={privacyConsent}
                onChange={(event) => setPrivacyConsent(event.target.checked)}
                required
              />
              <span>{formCopy.text.privacyConsentLabel}</span>
            </label>
            <label className="sr-only" aria-hidden="true">
              {formCopy.text.honeypotLabel}
              <input
                tabIndex={-1}
                autoComplete="off"
                value={companyWebsite}
                onChange={(event) => setCompanyWebsite(event.target.value)}
              />
            </label>
            {message ? (
              <p
                className={
                  state === "error" ? "admin-form__error" : "admin-form__hint"
                }
                role={state === "error" ? "alert" : "status"}
              >
                {message}
              </p>
            ) : null}
            <div className="admin-modal__actions">
              <button
                type="submit"
                className="admin-btn admin-btn--primary"
                disabled={state === "submitting"}
              >
                {state === "submitting"
                  ? messageCopy("submitting")
                  : messageCopy("submitLabel")}
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
