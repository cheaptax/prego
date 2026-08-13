"use client";

import { FirebaseError } from "firebase/app";
import {
  PhoneAuthProvider,
  RecaptchaVerifier,
  signInWithCredential,
  type Auth,
} from "firebase/auth";
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
  findExactCooperativeMatch,
  validateAuditQuoteEmail,
  validateAuditQuoteFiscalYear,
  validateAuditQuoteName,
  validateAuditQuotePhone,
  validateAuditQuoteTargetCooperative,
} from "@/lib/audit-quote/client-form";
import type { PublicAuditQuoteConfig } from "@/lib/audit-quote/public-types";
import type { CooperativeSearchItem } from "@/lib/cooperatives/demo-cooperative";
import { getFirebaseAuth } from "@/lib/firebase/client";
import {
  formatKrMobilePhoneInput,
  isValidKrMobilePhone,
  normalizeKrMobilePhone,
  toKrMobilePhoneE164,
} from "@/lib/phone";
import { CmsSupplementalSections } from "@/components/cms/CmsSupplementalSections";
import { normalizeAuditQuoteCmsContent } from "@/lib/cms/audit-quote-content";
import { cmsSectionSelectionProps } from "@/lib/cms/editable-section";
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
type PhoneVerificationStatus =
  | "idle"
  | "sending"
  | "sent"
  | "confirmed"
  | "verified";
type PhoneVerificationProvider = "solapi" | "firebase";

const PHONE_VERIFICATION_TTL_MS = 10 * 60 * 1000;

function visibleItems(section: CmsSection) {
  return section.items.filter((item) => item.visible && !item.deleted);
}

function renderFootnoteReference(text: string, href?: string) {
  const markerMatch = text.match(/^(.*?)(\(\*\))(.*)$/u);
  if (!markerMatch) return text;
  const [, before, marker, after] = markerMatch;
  const mark = href ? (
    <a
      className="aq-ref-mark"
      href={`#${href}`}
      aria-label="관련 주석 보기"
    >
      {marker}
    </a>
  ) : (
    <span className="aq-ref-mark" aria-hidden="true">
      {marker}
    </span>
  );
  return (
    <>
      {before}
      {mark}
      {after}
    </>
  );
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
  const [targetCooperativeQuery, setTargetCooperativeQuery] = useState("");
  const [selectedCooperative, setSelectedCooperative] =
    useState<CooperativeSearchItem | null>(null);
  const [cooperativeSearch, setCooperativeSearch] = useState<{
    query: string;
    results: CooperativeSearchItem[];
    failed?: boolean;
  } | null>(null);
  const fiscalYear = String(config.fixedFiscalYear);
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
    phoneVerificationCode?: string;
    consent?: string;
  }>({});
  const [formError, setFormError] = useState("");
  const [status, setStatus] = useState<FormStatus>("idle");
  const [publicReference, setPublicReference] = useState("");
  const [phoneVerificationId, setPhoneVerificationId] = useState("");
  const [phoneVerificationPhone, setPhoneVerificationPhone] = useState("");
  const [phoneVerificationCode, setPhoneVerificationCode] = useState("");
  const [phoneVerificationStatus, setPhoneVerificationStatus] =
    useState<PhoneVerificationStatus>("idle");
  const [phoneVerificationExpiresAt, setPhoneVerificationExpiresAt] =
    useState<number | null>(null);
  const [phoneVerificationProvider, setPhoneVerificationProvider] =
    useState<PhoneVerificationProvider | null>(null);
  const [phoneVerificationLocalDelivery, setPhoneVerificationLocalDelivery] =
    useState(false);

  const idempotency = useRef(new IdempotencyKeySession());
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);
  const targetCooperativeRef = useRef<HTMLInputElement | null>(null);
  const fiscalYearRef = useRef<HTMLInputElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const phoneRef = useRef<HTMLInputElement | null>(null);
  const successRef = useRef<HTMLHeadingElement | null>(null);
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  const fieldId = useId();
  const statusId = useId();

  function message(key: string, fallback: string) {
    return normalizedContent.messages[key] || fallback;
  }

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

  useEffect(() => {
    return () => {
      const verifier = recaptchaVerifierRef.current;
      recaptchaVerifierRef.current = null;
      try {
        verifier?.clear();
      } catch {
        // Recaptcha may already be torn down.
      }
    };
  }, []);

  useEffect(() => {
    if (phoneVerificationStatus !== "confirmed" || !phoneVerificationExpiresAt) {
      return;
    }
    const remainingMs = phoneVerificationExpiresAt - Date.now();
    const expire = () => {
      resetPhoneVerification();
      setFieldErrors((prev) => ({
        ...prev,
        phoneVerificationCode: message(
          "phoneVerificationExpired",
          "휴대폰 인증이 만료되었습니다. 인증번호를 다시 받아 주세요.",
        ),
      }));
    };
    if (remainingMs <= 0) {
      expire();
      return;
    }
    const timerId = window.setTimeout(expire, remainingMs);
    return () => window.clearTimeout(timerId);
  }, [phoneVerificationExpiresAt, phoneVerificationStatus]);

  function resetForNewSubmission() {
    setTargetCooperativeQuery("");
    setSelectedCooperative(null);
    setCooperativeSearch(null);
    setEmail("");
    setName("");
    setPhone("");
    resetPhoneVerification();
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

  function resetPhoneVerification() {
    const verifier = recaptchaVerifierRef.current;
    recaptchaVerifierRef.current = null;
    try {
      verifier?.clear();
    } catch {
      // Recaptcha may already be torn down.
    }
    setPhoneVerificationId("");
    setPhoneVerificationPhone("");
    setPhoneVerificationCode("");
    setPhoneVerificationStatus("idle");
    setPhoneVerificationExpiresAt(null);
    setPhoneVerificationProvider(null);
    setPhoneVerificationLocalDelivery(false);
  }

  function getRecaptchaVerifier(auth: Auth) {
    if (!recaptchaVerifierRef.current) {
      recaptchaVerifierRef.current = new RecaptchaVerifier(
        auth,
        "audit-quote-phone-recaptcha",
        {
          size: "invisible",
          "expired-callback": () => {
            recaptchaVerifierRef.current = null;
            setPhoneVerificationId("");
            setPhoneVerificationPhone("");
            setPhoneVerificationCode("");
            setPhoneVerificationStatus("idle");
            setPhoneVerificationExpiresAt(null);
            setPhoneVerificationProvider(null);
          },
        },
      );
    }
    return recaptchaVerifierRef.current;
  }

  function getPhoneVerificationErrorMessage(codeOrError: string | unknown) {
    const code =
      typeof codeOrError === "string"
        ? codeOrError
        : codeOrError instanceof FirebaseError
          ? codeOrError.code
          : "sms_send_failed";
    switch (code) {
      case "invalid_phone":
      case "auth/invalid-phone-number":
        return messages.phoneInvalid;
      case "invalid_phone_verification":
      case "auth/invalid-verification-code":
        return message("phoneCodeInvalid", "인증번호가 올바르지 않습니다.");
      case "phone_verification_expired":
      case "auth/code-expired":
        return message(
          "phoneCodeExpired",
          "인증번호가 만료되었습니다. 인증번호를 다시 받아 주세요.",
        );
      case "rate_limited":
      case "auth/too-many-requests":
        return message(
          "phoneTooMany",
          "인증 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
        );
      case "sms_not_configured":
      case "sms_send_failed":
      case "auth/quota-exceeded":
      case "auth/captcha-check-failed":
      case "auth/missing-app-credential":
      case "auth/invalid-app-credential":
      case "auth/argument-error":
        return message(
          "phoneGenericError",
          "휴대폰 문자 인증을 잠시 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        );
      case "auth/unauthorized-domain":
        return message(
          "phoneUnauthorizedDomain",
          "현재 접속한 주소가 휴대폰 인증 허용 도메인에 등록되지 않았습니다. 관리자에게 문의해 주세요.",
        );
      default:
        return message(
          "phoneGenericError",
          "휴대폰 문자 인증 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
        );
    }
  }

  async function sendPhoneVerificationCodeViaFirebase(normalizedPhone: string) {
    const phoneNumber = toKrMobilePhoneE164(normalizedPhone);
    if (!phoneNumber) {
      resetPhoneVerification();
      setFieldErrors((prev) => ({ ...prev, phone: messages.phoneInvalid }));
      return;
    }
    const auth = getFirebaseAuth();
    auth.languageCode = "ko";
    auth.settings.appVerificationDisabledForTesting = false;
    const phoneProvider = new PhoneAuthProvider(auth);
    const verificationId = await phoneProvider.verifyPhoneNumber(
      phoneNumber,
      getRecaptchaVerifier(auth),
    );
    setPhoneVerificationProvider("firebase");
    setPhoneVerificationId(verificationId);
    setPhoneVerificationPhone(normalizedPhone);
    setPhoneVerificationCode("");
    setPhoneVerificationStatus("sent");
    setPhoneVerificationExpiresAt(null);
    setPhoneVerificationLocalDelivery(false);
  }

  async function sendPhoneVerificationCode() {
    if (previewMode) return;
    const normalizedPhone = normalizeKrMobilePhone(phone);
    if (!isValidKrMobilePhone(normalizedPhone)) {
      setFieldErrors((prev) => ({ ...prev, phone: messages.phoneInvalid }));
      return;
    }
    setFormError("");
    setPhoneVerificationStatus("sending");
    setFieldErrors((prev) => ({
      ...prev,
      phone: undefined,
      phoneVerificationCode: undefined,
    }));
    try {
      const response = await fetch("/api/phone-verification/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone: normalizedPhone,
          purpose: "audit_quote",
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        localCode?: string;
      } | null;
      if (response.ok && data?.ok) {
        const localCode =
          typeof data.localCode === "string" && /^\d{6}$/.test(data.localCode)
            ? data.localCode
            : "";
        setPhoneVerificationProvider("solapi");
        setPhoneVerificationId("sent");
        setPhoneVerificationPhone(normalizedPhone);
        setPhoneVerificationCode(localCode);
        setPhoneVerificationStatus("sent");
        setPhoneVerificationExpiresAt(null);
        setPhoneVerificationLocalDelivery(Boolean(localCode));
        return;
      }
      if (data?.error !== "sms_not_configured") {
        resetPhoneVerification();
        setFieldErrors((prev) => ({
          ...prev,
          phoneVerificationCode: getPhoneVerificationErrorMessage(
            data?.error ?? "sms_send_failed",
          ),
        }));
        return;
      }
    } catch {
      resetPhoneVerification();
      setFieldErrors((prev) => ({
        ...prev,
        phoneVerificationCode: getPhoneVerificationErrorMessage("sms_send_failed"),
      }));
      return;
    }

    try {
      await sendPhoneVerificationCodeViaFirebase(normalizedPhone);
    } catch (error) {
      resetPhoneVerification();
      setFieldErrors((prev) => ({
        ...prev,
        phoneVerificationCode: getPhoneVerificationErrorMessage(error),
      }));
    }
  }

  async function confirmPhoneVerificationCode() {
    if (previewMode) return;
    const trimmed = phoneVerificationCode.trim();
    if (!phoneVerificationId) {
      setFieldErrors((prev) => ({
        ...prev,
        phoneVerificationCode: message(
          "phoneReceiveFirst",
          "먼저 '인증번호 받기'로 인증번호를 받아 주세요.",
        ),
      }));
      return;
    }
    if (trimmed.length !== 6) {
      setFieldErrors((prev) => ({
        ...prev,
        phoneVerificationCode: message(
          "phoneCodeSixDigits",
          "문자로 받은 6자리 인증번호를 입력해 주세요.",
        ),
      }));
      return;
    }
    setFieldErrors((prev) => ({
      ...prev,
      phoneVerificationCode: undefined,
    }));
    if (phoneVerificationProvider === "firebase") {
      setPhoneVerificationStatus("confirmed");
      setPhoneVerificationExpiresAt(Date.now() + PHONE_VERIFICATION_TTL_MS);
      return;
    }
    try {
      const response = await fetch("/api/phone-verification/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone: phoneVerificationPhone || normalizeKrMobilePhone(phone),
          purpose: "audit_quote",
          code: trimmed,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        token?: string;
        error?: string;
      } | null;
      if (!response.ok || !data?.ok || !data.token) {
        setFieldErrors((prev) => ({
          ...prev,
          phoneVerificationCode: getPhoneVerificationErrorMessage(
            data?.error ?? "invalid_phone_verification",
          ),
        }));
        return;
      }
      setPhoneVerificationId(data.token);
      setPhoneVerificationStatus("confirmed");
      setPhoneVerificationExpiresAt(Date.now() + PHONE_VERIFICATION_TTL_MS);
    } catch {
      setFieldErrors((prev) => ({
        ...prev,
        phoneVerificationCode: getPhoneVerificationErrorMessage("sms_send_failed"),
      }));
    }
  }

  const cooperativeQueryTrimmed = targetCooperativeQuery.trim();
  const showCooperativeSuggestions =
    cooperativeQueryTrimmed.length > 0 &&
    selectedCooperative?.cooperative_name !== cooperativeQueryTrimmed;

  useEffect(() => {
    if (!showCooperativeSuggestions) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/cooperatives/search?q=${encodeURIComponent(cooperativeQueryTrimmed)}`,
          { signal: controller.signal },
        );
        const payload = (await response.json()) as {
          ok?: boolean;
          results?: CooperativeSearchItem[];
        };
        if (response.ok && payload.ok && Array.isArray(payload.results)) {
          const exactMatch = findExactCooperativeMatch(
            cooperativeQueryTrimmed,
            payload.results,
          );
          if (exactMatch) {
            applySelectedCooperative(exactMatch);
            return;
          }
          setCooperativeSearch({
            query: cooperativeQueryTrimmed,
            results: payload.results,
          });
        } else {
          setCooperativeSearch({
            query: cooperativeQueryTrimmed,
            results: [],
            failed: true,
          });
        }
      } catch (searchError) {
        if (
          !(searchError instanceof DOMException) ||
          searchError.name !== "AbortError"
        ) {
          setCooperativeSearch({
            query: cooperativeQueryTrimmed,
            results: [],
            failed: true,
          });
        }
      }
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cooperativeQueryTrimmed, showCooperativeSuggestions]);

  const currentCooperativeSearch =
    cooperativeSearch?.query === cooperativeQueryTrimmed
      ? cooperativeSearch
      : null;
  const filteredCooperatives = currentCooperativeSearch?.results ?? [];

  async function resolveSelectedCooperative() {
    if (selectedCooperative) return selectedCooperative;
    const fromVisibleResults = findExactCooperativeMatch(
      targetCooperativeQuery,
      filteredCooperatives,
    );
    if (fromVisibleResults) return fromVisibleResults;
    const query = targetCooperativeQuery.trim();
    if (!query) return null;
    try {
      const response = await fetch(
        `/api/cooperatives/search?q=${encodeURIComponent(query)}`,
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        results?: CooperativeSearchItem[];
      };
      if (response.ok && payload.ok && Array.isArray(payload.results)) {
        return findExactCooperativeMatch(query, payload.results);
      }
    } catch {
      return null;
    }
    return null;
  }

  function applySelectedCooperative(item: CooperativeSearchItem) {
    setSelectedCooperative(item);
    setTargetCooperativeQuery(item.cooperative_name);
    setCooperativeSearch(null);
    setFieldErrors((prev) => ({
      ...prev,
      targetCooperativeName: undefined,
    }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (previewMode) return;
    if (status === "submitting") return;

    setFormError("");

    const resolvedCooperative = await resolveSelectedCooperative();
    if (resolvedCooperative && !selectedCooperative) {
      applySelectedCooperative(resolvedCooperative);
    }
    const targetCooperativeResult = resolvedCooperative
      ? validateAuditQuoteTargetCooperative(resolvedCooperative.cooperative_name)
      : { ok: false as const, error: "required" };
    const fiscalYearResult = validateAuditQuoteFiscalYear(fiscalYear);
    const emailResult = validateAuditQuoteEmail(email);
    const nameResult = validateAuditQuoteName(name);
    const phoneResult = validateAuditQuotePhone(phone);
    const nextErrors: typeof fieldErrors = {};
    if (!resolvedCooperative || !targetCooperativeResult.ok) {
      nextErrors.targetCooperativeName = resolvedCooperative
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
    const normalizedPhone = normalizeKrMobilePhone(phone);
    if (phoneResult.ok) {
      if (!phoneVerificationId || phoneVerificationPhone !== normalizedPhone) {
        nextErrors.phoneVerificationCode = message(
          "phoneVerificationRequired",
          "휴대폰 문자 인증을 먼저 진행해 주세요.",
        );
      } else if (!phoneVerificationCode.trim()) {
        nextErrors.phoneVerificationCode = message(
          "phoneCodeRequired",
          "문자로 받은 인증번호를 입력해 주세요.",
        );
      } else if (phoneVerificationStatus !== "confirmed") {
        nextErrors.phoneVerificationCode = message(
          "phoneConfirmRequired",
          "휴대폰 인증 확인을 완료해 주세요.",
        );
      } else if (
        !phoneVerificationExpiresAt ||
        Date.now() >= phoneVerificationExpiresAt
      ) {
        nextErrors.phoneVerificationCode = message(
          "phoneVerificationExpired",
          "휴대폰 인증이 만료되었습니다. 인증번호를 다시 받아 주세요.",
        );
      }
    }
    if (!privacyConsent) {
      nextErrors.consent = messages.consentRequired;
    }
    setFieldErrors(nextErrors);

    if (
      !resolvedCooperative ||
      !targetCooperativeResult.ok ||
      !fiscalYearResult.ok ||
      !emailResult.ok ||
      !nameResult.ok ||
      !phoneResult.ok ||
      Boolean(nextErrors.phoneVerificationCode) ||
      !privacyConsent
    ) {
      setStatus("error");
      const focusTarget =
        !resolvedCooperative || !targetCooperativeResult.ok
          ? targetCooperativeRef
          : !fiscalYearResult.ok
            ? fiscalYearRef
            : !emailResult.ok
              ? emailRef
              : !nameResult.ok
                ? nameRef
                : !phoneResult.ok
                  ? phoneRef
                  : nextErrors.phoneVerificationCode
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
      if (phoneVerificationStatus !== "confirmed" || !phoneVerificationId) {
        setFieldErrors((prev) => ({
          ...prev,
          phoneVerificationCode: message(
            "phoneVerificationRequired",
            "휴대폰 문자 인증을 먼저 진행해 주세요.",
          ),
        }));
        setStatus("error");
        window.setTimeout(() => phoneRef.current?.focus(), 0);
        return;
      }
      let phoneVerificationIdToken = phoneVerificationId;
      if (
        phoneVerificationProvider === "firebase" ||
        !phoneVerificationId.startsWith("pv1.")
      ) {
        try {
          const auth = getFirebaseAuth();
          const phoneCredential = PhoneAuthProvider.credential(
            phoneVerificationId,
            phoneVerificationCode.trim(),
          );
          const phoneUserCredential = await signInWithCredential(
            auth,
            phoneCredential,
          );
          phoneVerificationIdToken = await phoneUserCredential.user.getIdToken(
            true,
          );
        } catch (phoneError) {
          resetPhoneVerification();
          setFieldErrors((prev) => ({
            ...prev,
            phoneVerificationCode:
              getPhoneVerificationErrorMessage(phoneError),
          }));
          setStatus("error");
          window.setTimeout(() => phoneRef.current?.focus(), 0);
          return;
        }
      }
      setPhoneVerificationStatus("verified");
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
              phoneVerificationIdToken,
              targetCooperativeId: resolvedCooperative.cooperative_id,
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
        if (
          code === "invalid_phone_verification" ||
          code === "phone_verification_expired" ||
          code === "missing_phone_verification"
        ) {
          resetPhoneVerification();
          setFieldErrors((prev) => ({
            ...prev,
            phoneVerificationCode: message(
              "phoneVerificationRetry",
              "휴대폰 인증을 다시 진행해 주세요.",
            ),
          }));
        }
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
                : code === "missing_phone_verification"
                  ? message(
                      "phoneVerificationRequired",
                      "휴대폰 문자 인증을 먼저 진행해 주세요.",
                    )
                  : code === "invalid_phone_verification"
                    ? message(
                        "invalidPhoneVerification",
                        "휴대폰 인증 정보가 올바르지 않습니다.",
                      )
                    : code === "phone_verification_expired"
                      ? message(
                          "phoneVerificationExpired",
                          "휴대폰 인증이 만료되었습니다. 인증번호를 다시 받아 주세요.",
                        )
                      : code === "phone_quote_limit_exceeded"
                        ? "해당 휴대폰 번호로는 견적요청을 최대 5번까지만 할 수 있습니다."
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
      resetPhoneVerification();
      setFieldErrors((prev) => ({
        ...prev,
        phoneVerificationCode: message(
          "phoneVerificationRetry",
          "휴대폰 인증을 다시 진행해 주세요.",
        ),
      }));
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
      ...cmsSectionSelectionProps(section, root.className, {
        editing,
        selectedSectionId,
        onSelectSection,
      }),
    };
  }

  function renderSection(section: CmsSection) {
    if (section.deleted && !editing) return null;
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
                  name="targetCooperativeQuery"
                  autoComplete="off"
                  placeholder={section.text.targetCooperativePlaceholder}
                  value={targetCooperativeQuery}
                  aria-invalid={Boolean(fieldErrors.targetCooperativeName)}
                  aria-describedby={
                    targetCooperativeDescriptions || undefined
                  }
                  disabled={status === "submitting"}
                  onChange={(event) => {
                    setTargetCooperativeQuery(event.target.value);
                    setSelectedCooperative(null);
                    if (fieldErrors.targetCooperativeName) {
                      setFieldErrors((prev) => ({
                        ...prev,
                        targetCooperativeName: undefined,
                      }));
                    }
                  }}
                  onBlur={() => {
                    if (selectedCooperative) return;
                    const exactMatch = findExactCooperativeMatch(
                      targetCooperativeQuery,
                      filteredCooperatives,
                    );
                    if (exactMatch) applySelectedCooperative(exactMatch);
                  }}
                />
                {showCooperativeSuggestions ? (
                  !currentCooperativeSearch ? (
                    <p className="aq-field__help" role="status">
                      농협을 검색하는 중…
                    </p>
                  ) : currentCooperativeSearch.failed ? (
                    <p className="aq-error" role="alert">
                      농협 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.
                    </p>
                  ) : filteredCooperatives.length > 0 ? (
                    <div
                      className="aq-coop-results"
                      role="listbox"
                      aria-label="농협 검색 결과"
                    >
                      {filteredCooperatives.map((item) => (
                        <button
                          type="button"
                          key={item.cooperative_id}
                          className={
                            item.cooperative_id ===
                            selectedCooperative?.cooperative_id
                              ? "is-selected"
                              : undefined
                          }
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => applySelectedCooperative(item)}
                        >
                          <strong>{item.cooperative_name}</strong>
                          <span>
                            {item.cooperative_type}
                            {item.isDemoInstitution ? " · 테스트" : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="aq-field__help" role="status">
                      &ldquo;{cooperativeQueryTrimmed}&rdquo;(으)로 검색된 농협이
                      없습니다. 마스터 목록에 있는 농협명으로 다시 검색해 주세요.
                    </p>
                  )
                ) : null}
                {selectedCooperative ? (
                  <p className="aq-field__help">
                    선택됨: <strong>{selectedCooperative.cooperative_name}</strong>
                  </p>
                ) : section.text.targetCooperativeHelp ? (
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
                  placeholder={section.text.fiscalYearPlaceholder || fiscalYear}
                  value={fiscalYear}
                  readOnly
                  aria-readonly="true"
                  aria-invalid={Boolean(fieldErrors.fiscalYear)}
                  aria-describedby={fiscalYearDescriptions || undefined}
                  disabled={status === "submitting"}
                />
                {section.text.fiscalYearHelp ? (
                  <p
                    id={`${fieldId}-fiscal-year-help`}
                    className="aq-field__help"
                  >
                    {renderFootnoteReference(
                      section.text.fiscalYearHelp,
                      "aq-regulation-footnote",
                    )}
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
                    const nextPhone = formatKrMobilePhoneInput(
                      event.target.value,
                    );
                    const nextNormalizedPhone =
                      normalizeKrMobilePhone(nextPhone);
                    setPhone(nextPhone);
                    if (
                      phoneVerificationPhone &&
                      phoneVerificationPhone !== nextNormalizedPhone
                    ) {
                      resetPhoneVerification();
                    }
                    if (fieldErrors.phone) {
                      setFieldErrors((prev) => ({
                        ...prev,
                        phone: undefined,
                        phoneVerificationCode: undefined,
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
                <div className="auth-phone-verification">
                  {phoneVerificationStatus === "confirmed" ||
                  phoneVerificationStatus === "verified" ? (
                    <p className="auth-field__success" role="status">
                      인증이 완료되었습니다. 인증은 30분간 유지됩니다.
                    </p>
                  ) : phoneVerificationId ? (
                    <div className="auth-phone-codeinput">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={phoneVerificationCode}
                        onChange={(event) => {
                          setPhoneVerificationCode(
                            event.target.value.replace(/\D/gu, "").slice(0, 6),
                          );
                          if (fieldErrors.phoneVerificationCode) {
                            setFieldErrors((prev) => ({
                              ...prev,
                              phoneVerificationCode: undefined,
                            }));
                          }
                        }}
                        placeholder="인증번호 6자리"
                        disabled={status === "submitting"}
                        aria-invalid={Boolean(fieldErrors.phoneVerificationCode)}
                      />
                      <button
                        type="button"
                        className="aq-phone-send aq-phone-send--confirm"
                        onClick={() => void confirmPhoneVerificationCode()}
                        disabled={
                          status === "submitting" ||
                          !phoneVerificationId ||
                          phoneVerificationCode.trim().length !== 6
                        }
                      >
                        인증 확인
                      </button>
                    </div>
                  ) : null}
                  {phoneVerificationStatus !== "confirmed" &&
                    phoneVerificationStatus !== "verified" && (
                      <button
                        type="button"
                        className="aq-phone-send"
                        onClick={() => void sendPhoneVerificationCode()}
                        disabled={
                          status === "submitting" ||
                          phoneVerificationStatus === "sending"
                        }
                      >
                        {phoneVerificationStatus === "sending"
                          ? "발송 중..."
                          : phoneVerificationId &&
                              phoneVerificationPhone ===
                                normalizeKrMobilePhone(phone)
                            ? "인증번호 재발송"
                            : "인증번호 받기"}
                      </button>
                    )}
                  {phoneVerificationStatus === "idle" ? (
                    <span className="auth-field__hint">
                      {section.text.phoneVerifyHelp ||
                        "농협 담당자님의 휴대폰 문자 인증후 견적 요청이 가능합니다."}
                    </span>
                  ) : null}
                  {phoneVerificationStatus === "sent" ? (
                    <span className="auth-field__hint">
                      {phoneVerificationLocalDelivery
                        ? "로컬 환경에서는 문자를 보내지 않고 인증번호를 자동 입력합니다. 인증 확인을 눌러 주세요."
                        : "문자로 받은 6자리 인증번호를 입력해 주세요."}
                    </span>
                  ) : null}
                  {fieldErrors.phoneVerificationCode ? (
                    <p className="aq-error" role="alert">
                      {fieldErrors.phoneVerificationCode}
                    </p>
                  ) : null}
                  <span
                    id="audit-quote-phone-recaptcha"
                    className="auth-phone-recaptcha"
                  />
                </div>
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
      const regulationItems = visibleItems(section);
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
          {section.text.regulationNote || regulationItems.length > 0 ? (
            <div
              className="aq-footnote__notes"
              id="aq-regulation-footnote"
            >
              {section.text.regulationNote ? (
                <p className="aq-footnote__notes-title">
                  {renderFootnoteReference(section.text.regulationNote)}
                </p>
              ) : null}
              {regulationItems.length > 0 ? (
                <ul>
                  {regulationItems.map((item) => (
                    <li key={item.id}>{item.title}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
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
      <CmsSupplementalSections
        pageKey="event.auditQuote"
        content={normalizedContent}
        editing={editing}
        selectedSectionId={selectedSectionId}
        onSelectSection={onSelectSection}
      />
    </main>
  );
}
