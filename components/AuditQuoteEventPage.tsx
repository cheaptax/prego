"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { trackAuditQuoteEvent } from "@/lib/audit-quote/analytics";
import {
  IdempotencyKeySession,
  formatPhoneInput,
  mapAuditQuoteApiError,
  validateAuditQuoteEmail,
  validateAuditQuoteName,
  validateAuditQuotePhone,
} from "@/lib/audit-quote/client-form";
import type { PublicAuditQuoteConfig } from "@/lib/audit-quote/public-types";

type Props = {
  config: PublicAuditQuoteConfig;
};

type FormStatus = "idle" | "submitting" | "success" | "error";

const SUCCESS_MESSAGE =
  "담당자가 확인 후 입력하신 이메일로 다음 절차를 안내드려요.";

const BENEFITS = [
  {
    title: "2곳 이상 견적",
    body: "동일 조건으로 복수 회계법인에 견적을 요청해요.",
  },
  {
    title: "한눈에 비교",
    body: "보수·수임실적·투입인력·일정을 한 표로 정리해요.",
  },
  {
    title: "선정 검토보고서",
    body: "견적서를 올리면 내부 보고용 검토자료를 드려요.",
  },
];

const STEPS = [
  { title: "신청", body: "이메일과 담당자 정보만 남겨 주세요." },
  { title: "견적 요청", body: "프리고가 필수정보를 확인하고 2곳 이상에 요청해요." },
  { title: "비교표 전달", body: "비교 가능한 견적을 이메일로 보내드려요." },
];

const FAQS = [
  {
    q: "신청하면 꼭 계약해야 하나요?",
    a: "아니요. 비교 후에도 계약 의무는 없고, 최종 선정은 우리 농협이 결정해요.",
  },
  {
    q: "가장 저렴한 곳을 추천해 주나요?",
    a: "최저가 추천 서비스가 아니에요. 동일 조건의 비교 가능한 견적을 정리해 드려요.",
  },
  {
    q: "입력한 정보는 어디에 쓰이나요?",
    a: "견적 진행에 필요한 범위에서만 담당 운영자와 견적 대상 회계법인에 전달돼요. 자세한 내용은 개인정보처리방침을 확인해 주세요.",
  },
];

export function AuditQuoteEventPage({ config }: Props) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    name?: string;
    phone?: string;
    consent?: string;
  }>({});
  const [formError, setFormError] = useState("");
  const [status, setStatus] = useState<FormStatus>("idle");
  const [publicReference, setPublicReference] = useState("");

  const idempotency = useRef(new IdempotencyKeySession());
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
    window.setTimeout(() => emailRef.current?.focus(), 0);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "submitting") return;

    setFormError("");

    const emailResult = validateAuditQuoteEmail(email);
    const nameResult = validateAuditQuoteName(name);
    const phoneResult = validateAuditQuotePhone(phone);
    const nextErrors: typeof fieldErrors = {};
    if (!emailResult.ok) nextErrors.email = emailResult.error;
    if (!nameResult.ok) nextErrors.name = nameResult.error;
    if (!phoneResult.ok) nextErrors.phone = phoneResult.error;
    if (!privacyConsent) {
      nextErrors.consent = "개인정보 수집·이용에 동의해 주세요.";
    }
    setFieldErrors(nextErrors);

    if (!emailResult.ok || !nameResult.ok || !phoneResult.ok || !privacyConsent) {
      setStatus("error");
      const focusTarget = !emailResult.ok
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
      const res = await fetch("/api/audit-quote/requests", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          email: emailResult.email,
          name: nameResult.name,
          phone: phoneResult.phone,
          privacyConsent: true,
          privacyPolicyVersion: config.privacyPolicyVersion,
          marketingConsent,
          source: {
            campaign: config.campaign,
            channel: config.channel,
          },
          companyWebsite: honeypot,
        }),
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
        setFormError(mapAuditQuoteApiError(code));
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
      setFormError(mapAuditQuoteApiError("network"));
      setStatus("error");
      window.setTimeout(() => errorRef.current?.focus(), 0);
    }
  }

  return (
    <main id="main" className="aq-page">
      <p className="sr-only" id={statusId} role="status" aria-live="polite">
        {status === "submitting"
          ? "견적 요청을 전송하고 있어요."
          : status === "success"
            ? `신청이 완료됐어요. ${SUCCESS_MESSAGE}`
            : formError}
      </p>

      <section className="aq-hero">
        <span className="aq-badge">FY27 회계감사 견적</span>
        <h1 className="aq-title">
          회계법인 견적,
          <br />한 번에 비교하세요
        </h1>
        <p className="aq-lede">
          한 번만 신청하면 동일 조건으로 2곳 이상의
          <br />
          비교 가능한 견적을 받아볼 수 있어요.
        </p>
      </section>

      <section className="aq-form-wrap" aria-label="견적 신청">
        {!config.enabled ? (
          <div className="aq-card aq-closed" role="status">
            <strong>지금은 접수 기간이 아니에요</strong>
            <p>{config.closedMessage}</p>
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
              신청이 완료됐어요
            </h2>
            <p>{SUCCESS_MESSAGE}</p>
            {publicReference && (
              <p className="aq-success__ref">
                접수번호 <code>{publicReference}</code>
              </p>
            )}
            <button type="button" className="aq-btn-ghost" onClick={resetForNewSubmission}>
              다른 담당자로 신청하기
            </button>
          </div>
        ) : (
          <form className="aq-card aq-form" onSubmit={onSubmit} noValidate>
            <div className="aq-field">
              <label htmlFor={`${fieldId}-email`}>농협 이메일</label>
              <input
                ref={emailRef}
                id={`${fieldId}-email`}
                type="email"
                name="email"
                inputMode="email"
                autoComplete="email"
                placeholder="example@nonghyup.com"
                value={email}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={
                  fieldErrors.email ? `${fieldId}-email-error` : undefined
                }
                disabled={status === "submitting"}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (fieldErrors.email) {
                    setFieldErrors((prev) => ({ ...prev, email: undefined }));
                  }
                }}
              />
              {fieldErrors.email && (
                <p id={`${fieldId}-email-error`} className="aq-error" role="alert">
                  {fieldErrors.email}
                </p>
              )}
            </div>

            <div className="aq-field">
              <label htmlFor={`${fieldId}-name`}>담당자 이름</label>
              <input
                ref={nameRef}
                id={`${fieldId}-name`}
                type="text"
                name="name"
                autoComplete="name"
                placeholder="홍길동"
                value={name}
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={
                  fieldErrors.name ? `${fieldId}-name-error` : undefined
                }
                disabled={status === "submitting"}
                onChange={(event) => {
                  setName(event.target.value);
                  if (fieldErrors.name) {
                    setFieldErrors((prev) => ({ ...prev, name: undefined }));
                  }
                }}
              />
              {fieldErrors.name && (
                <p id={`${fieldId}-name-error`} className="aq-error" role="alert">
                  {fieldErrors.name}
                </p>
              )}
            </div>

            <div className="aq-field">
              <label htmlFor={`${fieldId}-phone`}>휴대폰 번호</label>
              <input
                ref={phoneRef}
                id={`${fieldId}-phone`}
                type="tel"
                name="phone"
                inputMode="numeric"
                autoComplete="tel"
                placeholder="010-0000-0000"
                value={phone}
                aria-invalid={Boolean(fieldErrors.phone)}
                aria-describedby={
                  fieldErrors.phone ? `${fieldId}-phone-error` : undefined
                }
                disabled={status === "submitting"}
                onChange={(event) => {
                  setPhone(formatPhoneInput(event.target.value));
                  if (fieldErrors.phone) {
                    setFieldErrors((prev) => ({ ...prev, phone: undefined }));
                  }
                }}
              />
              {fieldErrors.phone && (
                <p id={`${fieldId}-phone-error`} className="aq-error" role="alert">
                  {fieldErrors.phone}
                </p>
              )}
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
                    fieldErrors.consent ? `${fieldId}-consent-error` : undefined
                  }
                  onChange={(event) => {
                    setPrivacyConsent(event.target.checked);
                    if (fieldErrors.consent) {
                      setFieldErrors((prev) => ({ ...prev, consent: undefined }));
                    }
                  }}
                />
                <span>
                  [필수] 개인정보 수집·이용 동의{" "}
                  <Link href={config.privacyPolicyHref} target="_blank">
                    보기
                  </Link>
                </span>
              </label>
              {fieldErrors.consent && (
                <p id={`${fieldId}-consent-error`} className="aq-error" role="alert">
                  {fieldErrors.consent}
                </p>
              )}
              <label className="aq-consent__row">
                <input
                  type="checkbox"
                  checked={marketingConsent}
                  disabled={status === "submitting"}
                  onChange={(event) => setMarketingConsent(event.target.checked)}
                />
                <span>[선택] 이벤트·혜택 정보 수신 동의</span>
              </label>
            </div>

            {formError && (
              <p ref={errorRef} className="aq-error aq-error--form" role="alert" tabIndex={-1}>
                {formError}
              </p>
            )}

            <button
              type="submit"
              className="aq-submit"
              disabled={status === "submitting"}
              aria-busy={status === "submitting"}
            >
              {status === "submitting" ? "접수 중…" : "견적 요청하기"}
            </button>
            <p className="aq-form__note">무료 신청 · 비교 후에도 계약 의무 없음</p>
          </form>
        )}
      </section>

      <section className="aq-section" aria-label="제공 혜택">
        <h2 className="aq-section__title">이런 걸 도와드려요</h2>
        <div className="aq-benefits">
          {BENEFITS.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="aq-section" aria-label="진행 순서">
        <h2 className="aq-section__title">이렇게 진행돼요</h2>
        <ol className="aq-steps">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <span aria-hidden="true">{index + 1}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="aq-section" aria-label="자주 묻는 질문">
        <h2 className="aq-section__title">자주 묻는 질문</h2>
        <div className="aq-faq">
          {FAQS.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="aq-footnote" aria-label="운영 안내">
        <p>
          본 서비스는 <strong>주식회사 프리고</strong>가 운영하는 견적지원
          서비스로, 농협중앙회 공식 서비스가 아닙니다. 감사인의 수임 여부와
          독립성 확인, 감사계획·절차·의견 결정은 각 회계법인이 관련 기준에 따라
          독립적으로 수행하며, 프리고는 감사의견이나 감사결과에 관여하지
          않습니다.
        </p>
      </section>
    </main>
  );
}
