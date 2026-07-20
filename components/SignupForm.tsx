"use client";

import { FirebaseError } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  PhoneAuthProvider,
  RecaptchaVerifier,
  signInWithCredential,
  updateProfile,
  validatePassword,
  type Auth,
  type PasswordValidationStatus,
} from "firebase/auth";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { nonghyupMaster } from "@/lib/platform";
import {
  getFirebaseAuth,
  getFirebaseStorage,
} from "@/lib/firebase/client";
import type { UserRecord } from "@/lib/firebase/schema";
import {
  formatKrMobilePhoneInput,
  isValidKrMobilePhone,
  KR_MOBILE_PHONE_MAX_INPUT_LENGTH,
  normalizeKrMobilePhone,
  toKrMobilePhoneE164,
} from "@/lib/phone";
import type { CmsPageContent } from "@/lib/cms/schemas";
import { getCmsSection } from "@/lib/cms/runtime";

type Cooperative = (typeof nonghyupMaster)[number];

type FormState = {
  name: string;
  phone: string;
  email: string;
  password: string;
  passwordConfirm: string;
  sido: string;
  sigungu: string;
  cooperativeQuery: string;
  cooperativeId: string;
  manualCooperativeName: string;
  position: string;
  duty: string;
  termsConsent: boolean;
  privacyConsent: boolean;
  marketingConsent: boolean;
  emailConsent: boolean;
  smsConsent: boolean;
  kakaoConsent: boolean;
};

type Completion = {
  cooperativeName: string;
  status: "active" | "pending";
  walletBalance: number;
  grantedPoints: number;
};

type FieldErrorKey =
  | "name"
  | "phone"
  | "phoneVerificationCode"
  | "email"
  | "password"
  | "passwordConfirm"
  | "cooperativeId"
  | "position"
  | "duty"
  | "consents"
  | "businessCard";

type FieldErrors = Partial<Record<FieldErrorKey, string>>;
type PhoneVerificationStatus = "idle" | "sending" | "sent" | "confirmed" | "verified";
type EmailCheckStatus = "idle" | "checking" | "available" | "duplicate" | "error";

const INITIAL_FORM: FormState = {
  name: "",
  phone: "",
  email: "",
  password: "",
  passwordConfirm: "",
  sido: "",
  sigungu: "",
  cooperativeQuery: "",
  cooperativeId: "",
  manualCooperativeName: "",
  position: "",
  duty: "",
  termsConsent: false,
  privacyConsent: false,
  marketingConsent: false,
  emailConsent: false,
  smsConsent: false,
  kakaoConsent: false,
};

const MAX_BUSINESS_CARD_SIZE = 10 * 1024 * 1024;
const PASSWORD_MIN_LENGTH = 8;
const PHONE_VERIFICATION_TTL_MS = 30 * 60 * 1000;
const ALLOWED_BUSINESS_CARD_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

function cooperativeDisplay(item: Cooperative) {
  return item.cooperative_name;
}

function safeFileName(name: string) {
  return name.replace(/[^\w.-]+/g, "_");
}

function isValidSignupEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getSignupErrorMessage(
  error: unknown,
  messages: CmsPageContent["messages"],
) {
  if (!(error instanceof FirebaseError)) {
    if (error instanceof Error) {
      switch (error.message) {
        case "missing_fields":
          return messages.missingFields;
        case "invalid_token":
          return messages.invalidToken;
        case "email_mismatch":
          return messages.emailMismatch;
        case "invalid_cooperative_id":
          return messages.invalidCooperative;
        case "invalid_phone":
          return messages.phoneInvalid;
        case "missing_phone_verification":
          return messages.phoneVerificationRequired;
        case "invalid_phone_verification":
          return messages.invalidPhoneVerification;
        case "phone_verification_expired":
          return messages.phoneVerificationExpired;
        case "phone_account_limit_exceeded":
          return messages.phoneAccountLimit;
        default:
          return messages.genericError;
      }
    }
    return messages.genericError;
  }

  switch (error.code) {
    case "auth/email-already-in-use":
      return messages.emailDuplicate;
    case "auth/invalid-email":
      return messages.emailInvalid;
    case "auth/weak-password":
      return messages.passwordMin;
    case "auth/invalid-verification-code":
      return messages.phoneCodeInvalid;
    case "auth/code-expired":
      return messages.phoneCodeExpired;
    case "auth/invalid-phone-number":
      return messages.phoneInvalid;
    case "auth/too-many-requests":
      return messages.phoneTooMany;
    case "permission-denied":
      return messages.permissionError;
    default:
      return messages.genericError;
  }
}

function getPhoneVerificationErrorMessage(
  error: unknown,
  messages: CmsPageContent["messages"],
) {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/invalid-phone-number":
        return messages.phoneInvalid;
      case "auth/invalid-verification-code":
        return messages.phoneCodeInvalid;
      case "auth/code-expired":
        return messages.phoneCodeExpired;
      case "auth/too-many-requests":
        return messages.phoneTooMany;
      case "auth/quota-exceeded":
        return messages.phoneQuota;
      case "auth/unauthorized-domain":
        return messages.phoneUnauthorizedDomain;
      case "auth/operation-not-allowed":
        return messages.phoneDisabled;
      case "auth/captcha-check-failed":
      case "auth/missing-app-credential":
        return messages.phoneCaptcha;
      case "auth/network-request-failed":
        return messages.networkError;
      default:
        return messages.phoneGenericError;
    }
  }

  return messages.phoneGenericError;
}

function getPasswordValidationMessage(
  _status: PasswordValidationStatus,
  messages: CmsPageContent["messages"],
) {
  return messages.passwordPolicyError;
}

const DUTY_VALUES: Record<string, string> = {
  accounting: "회계",
  tax: "세무",
  general: "총무",
  hr: "인사",
  audit: "감사",
  member: "조합원 관리",
  other: "기타",
};

export function SignupForm({
  content,
  previewMode = false,
}: {
  content: CmsPageContent;
  previewMode?: boolean;
}) {
  const router = useRouter();
  const identityCopy = getCmsSection(content, "auth.signup", "identity");
  const organizationCopy = getCmsSection(
    content,
    "auth.signup",
    "organization",
  );
  const workCopy = getCmsSection(content, "auth.signup", "work");
  const cardCopy = getCmsSection(content, "auth.signup", "businessCard");
  const consentsCopy = getCmsSection(content, "auth.signup", "consents");
  const benefitsCopy = getCmsSection(content, "auth.signup", "benefits");
  const submitCopy = getCmsSection(content, "auth.signup", "submit");
  const messages = content.messages;
  const termsAction = consentsCopy.actions.find(
    (action) => action.id === "terms",
  );
  const privacyAction = consentsCopy.actions.find(
    (action) => action.id === "privacy",
  );
  const dutyOptions = workCopy.items.flatMap((item) => {
    const value = DUTY_VALUES[item.id];
    return value && item.visible && !item.deleted
      ? [{ value, label: item.title }]
      : [];
  });
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [businessCard, setBusinessCard] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [phoneVerificationId, setPhoneVerificationId] = useState("");
  const [phoneVerificationPhone, setPhoneVerificationPhone] = useState("");
  const [phoneVerificationCode, setPhoneVerificationCode] = useState("");
  const [phoneVerificationStatus, setPhoneVerificationStatus] =
    useState<PhoneVerificationStatus>("idle");
  const [phoneVerificationExpiresAt, setPhoneVerificationExpiresAt] =
    useState<number | null>(null);
  const [emailCheckStatus, setEmailCheckStatus] =
    useState<EmailCheckStatus>("idle");
  const [emailCheckedValue, setEmailCheckedValue] = useState("");
  const businessCardInputRef = useRef<HTMLInputElement>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => {
    return () => {
      recaptchaVerifierRef.current?.clear();
      recaptchaVerifierRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (phoneVerificationStatus !== "confirmed" || !phoneVerificationExpiresAt) {
      return;
    }

    const expireVerification = () => {
      setPhoneVerificationId("");
      setPhoneVerificationPhone("");
      setPhoneVerificationCode("");
      setPhoneVerificationStatus("idle");
      setPhoneVerificationExpiresAt(null);
      setFieldErrors((prev) => ({
        ...prev,
        phoneVerificationCode: messages.phoneVerificationExpired,
      }));
    };

    const remainingTime = phoneVerificationExpiresAt - Date.now();
    if (remainingTime <= 0) {
      expireVerification();
      return;
    }

    const timerId = window.setTimeout(expireVerification, remainingTime);
    return () => window.clearTimeout(timerId);
  }, [
    messages.phoneVerificationExpired,
    phoneVerificationExpiresAt,
    phoneVerificationStatus,
  ]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} ${cardCopy.text.bytesUnit}`;
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} ${cardCopy.text.kilobytesUnit}`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} ${cardCopy.text.megabytesUnit}`;
  };

  const consentKeys: (keyof FormState)[] = [
    "termsConsent",
    "privacyConsent",
    "marketingConsent",
    "emailConsent",
    "smsConsent",
    "kakaoConsent",
  ];
  const consentValues = consentKeys.map((key) => form[key] as boolean);
  const allConsent = consentValues.every(Boolean);
  const partialConsent = !allConsent && consentValues.some(Boolean);

  const toggleAllConsent = (next: boolean) => {
    setForm((prev) => ({
      ...prev,
      termsConsent: next,
      privacyConsent: next,
      marketingConsent: next,
      emailConsent: next,
      smsConsent: next,
      kakaoConsent: next,
    }));
    setError("");
    setFieldErrors((prev) => {
      const nextErrors = { ...prev };
      delete nextErrors.consents;
      return nextErrors;
    });
  };

  const cooperativeQueryTrimmed = form.cooperativeQuery.trim();
  const showCooperativeSuggestions = cooperativeQueryTrimmed.length > 0;

  const filteredCooperatives = useMemo(() => {
    if (!showCooperativeSuggestions) return [];
    const query = cooperativeQueryTrimmed.toLowerCase();
    return nonghyupMaster
      .filter(
        (item) =>
          item.cooperative_name.toLowerCase().includes(query) ||
          `${item.sido} ${item.sigungu}`.toLowerCase().includes(query)
      )
      .slice(0, 10);
  }, [
    showCooperativeSuggestions,
    cooperativeQueryTrimmed,
  ]);

  const selectedCooperative = useMemo(
    () => nonghyupMaster.find((item) => item.cooperative_id === form.cooperativeId),
    [form.cooperativeId]
  );

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError("");
    setFieldErrors((prev) => {
      const nextErrors = { ...prev };
      if (key in nextErrors) {
        delete nextErrors[key as keyof FieldErrors];
      }
      if (key === "termsConsent" || key === "privacyConsent") {
        delete nextErrors.consents;
      }
      if (key === "cooperativeQuery") {
        delete nextErrors.cooperativeId;
      }
      return nextErrors;
    });
  };

  const updatePassword = (value: string) => {
    setForm((prev) => ({ ...prev, password: value }));
    setError("");
    setFieldErrors((prev) => {
      const nextErrors = { ...prev };
      if (value && value.length < PASSWORD_MIN_LENGTH) {
        nextErrors.password = messages.passwordMin;
      } else {
        delete nextErrors.password;
      }
      if (form.passwordConfirm && value !== form.passwordConfirm) {
        nextErrors.passwordConfirm = messages.passwordMismatch;
      } else {
        delete nextErrors.passwordConfirm;
      }
      return nextErrors;
    });
  };

  const updatePasswordConfirm = (value: string) => {
    setForm((prev) => ({ ...prev, passwordConfirm: value }));
    setError("");
    setFieldErrors((prev) => {
      const nextErrors = { ...prev };
      if (value && form.password && value !== form.password) {
        nextErrors.passwordConfirm = messages.passwordMismatch;
      } else {
        delete nextErrors.passwordConfirm;
      }
      return nextErrors;
    });
  };

  const updateEmail = (value: string) => {
    setForm((prev) => ({ ...prev, email: value }));
    setError("");
    const nextEmail = value.trim().toLowerCase();
    if (nextEmail !== emailCheckedValue) {
      setEmailCheckStatus("idle");
      setEmailCheckedValue("");
    }
    setFieldErrors((prev) => {
      const nextErrors = { ...prev };
      if (nextEmail && !isValidSignupEmail(nextEmail)) {
        nextErrors.email = messages.emailInvalid;
      } else {
        delete nextErrors.email;
      }
      return nextErrors;
    });
  };

  const checkEmailAvailability = async () => {
    if (previewMode) return false;
    const email = form.email.trim().toLowerCase();
    if (!email) {
      setFieldErrors((prev) => ({
        ...prev,
        email: messages.emailRequired,
      }));
      setEmailCheckStatus("idle");
      setEmailCheckedValue("");
      return false;
    }
    if (!isValidSignupEmail(email)) {
      setFieldErrors((prev) => ({
        ...prev,
        email: messages.emailInvalid,
      }));
      setEmailCheckStatus("idle");
      setEmailCheckedValue("");
      return false;
    }
    if (emailCheckStatus === "available" && emailCheckedValue === email) {
      return true;
    }

    setEmailCheckStatus("checking");
    setFieldErrors((prev) => {
      const nextErrors = { ...prev };
      delete nextErrors.email;
      return nextErrors;
    });

    try {
      const res = await fetch("/api/auth/check-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; available?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "email_check_failed");
      }
      if (!data.available) {
        setEmailCheckStatus("duplicate");
        setEmailCheckedValue(email);
        setFieldErrors((prev) => ({
          ...prev,
          email: messages.emailDuplicate,
        }));
        return false;
      }
      setEmailCheckStatus("available");
      setEmailCheckedValue(email);
      return true;
    } catch {
      setEmailCheckStatus("error");
      setEmailCheckedValue("");
      setFieldErrors((prev) => ({
        ...prev,
        email: messages.emailCheckError,
      }));
      return false;
    }
  };

  const updatePosition = (value: string) => {
    setForm((prev) => ({ ...prev, position: value }));
    setError("");
    setFieldErrors((prev) => {
      const nextErrors = { ...prev };

      if (value.trim() && !form.cooperativeId) {
        nextErrors.position = messages.cooperativeRequired;
        nextErrors.cooperativeId = messages.cooperativeRequired;
      } else {
        delete nextErrors.position;
      }

      return nextErrors;
    });
  };

  const clearRecaptchaVerifier = () => {
    recaptchaVerifierRef.current?.clear();
    recaptchaVerifierRef.current = null;
  };

  const getRecaptchaVerifier = (auth: Auth) => {
    if (!recaptchaVerifierRef.current) {
      recaptchaVerifierRef.current = new RecaptchaVerifier(
        auth,
        "signup-phone-recaptcha",
        {
          size: "invisible",
          "expired-callback": () => {
            setPhoneVerificationId("");
            setPhoneVerificationPhone("");
            setPhoneVerificationCode("");
            setPhoneVerificationStatus("idle");
          },
        }
      );
    }
    return recaptchaVerifierRef.current;
  };

  const updatePhone = (value: string) => {
    const nextPhone = formatKrMobilePhoneInput(value);
    const nextNormalizedPhone = normalizeKrMobilePhone(nextPhone);
    update("phone", nextPhone);
    if (phoneVerificationPhone && phoneVerificationPhone !== nextNormalizedPhone) {
      setPhoneVerificationId("");
      setPhoneVerificationPhone("");
      setPhoneVerificationCode("");
      setPhoneVerificationStatus("idle");
      setPhoneVerificationExpiresAt(null);
    }
    setFieldErrors((prev) => {
      const nextErrors = { ...prev };
      delete nextErrors.phoneVerificationCode;
      return nextErrors;
    });
  };

  const sendPhoneVerificationCode = async () => {
    if (previewMode) return;
    if (!form.name.trim()) {
      setFieldErrors((prev) => ({
        ...prev,
        name: messages.nameRequired,
      }));
      return;
    }

    const normalizedPhone = normalizeKrMobilePhone(form.phone);
    if (!isValidKrMobilePhone(normalizedPhone)) {
      setFieldErrors((prev) => ({
        ...prev,
        phone: messages.phoneInvalid,
      }));
      return;
    }

    const phoneNumber = toKrMobilePhoneE164(normalizedPhone);
    if (!phoneNumber) {
      setFieldErrors((prev) => ({
        ...prev,
        phone: messages.phoneInvalid,
      }));
      return;
    }

    setError("");
    setPhoneVerificationStatus("sending");
    setFieldErrors((prev) => {
      const nextErrors = { ...prev };
      delete nextErrors.phone;
      delete nextErrors.phoneVerificationCode;
      return nextErrors;
    });

    try {
      const auth = getFirebaseAuth();
      auth.languageCode = "ko";
      const phoneProvider = new PhoneAuthProvider(auth);
      const verificationId = await phoneProvider.verifyPhoneNumber(
        phoneNumber,
        getRecaptchaVerifier(auth)
      );
      setPhoneVerificationId(verificationId);
      setPhoneVerificationPhone(normalizedPhone);
      setPhoneVerificationCode("");
      setPhoneVerificationStatus("sent");
      setPhoneVerificationExpiresAt(null);
      setError("");
    } catch (err) {
      clearRecaptchaVerifier();
      setPhoneVerificationId("");
      setPhoneVerificationPhone("");
      setPhoneVerificationStatus("idle");
      setPhoneVerificationExpiresAt(null);
      setFieldErrors((prev) => ({
        ...prev,
        phoneVerificationCode: getPhoneVerificationErrorMessage(err, messages),
      }));
    }
  };

  const confirmPhoneVerificationCode = () => {
    if (previewMode) return;
    const trimmed = phoneVerificationCode.trim();
    if (!phoneVerificationId) {
      setFieldErrors((prev) => ({
        ...prev,
        phoneVerificationCode: messages.phoneReceiveFirst,
      }));
      return;
    }
    if (trimmed.length !== 6) {
      setFieldErrors((prev) => ({
        ...prev,
        phoneVerificationCode: messages.phoneCodeSixDigits,
      }));
      return;
    }
    setFieldErrors((prev) => {
      const nextErrors = { ...prev };
      delete nextErrors.phoneVerificationCode;
      return nextErrors;
    });
    setPhoneVerificationStatus("confirmed");
    setPhoneVerificationExpiresAt(Date.now() + PHONE_VERIFICATION_TTL_MS);
  };

  const selectCooperative = (item: Cooperative) => {
    setForm((prev) => ({
      ...prev,
      sido: item.sido,
      sigungu: `${item.sido} ${item.sigungu}`,
      cooperativeQuery: item.cooperative_name,
      cooperativeId: item.cooperative_id,
      manualCooperativeName: "",
    }));
    setError("");
    setFieldErrors((prev) => {
      const nextErrors = { ...prev };
      delete nextErrors.cooperativeId;
      if (nextErrors.position === messages.cooperativeRequired) {
        delete nextErrors.position;
      }
      return nextErrors;
    });
  };

  const handleBusinessCardChange = (file: File | null) => {
    if (!file) {
      setBusinessCard(null);
      return;
    }

    if (!ALLOWED_BUSINESS_CARD_TYPES.has(file.type)) {
      setBusinessCard(null);
      if (businessCardInputRef.current) businessCardInputRef.current.value = "";
      setError(messages.businessCardType);
      setFieldErrors((prev) => ({
        ...prev,
        businessCard: messages.businessCardType,
      }));
      return;
    }

    if (file.size > MAX_BUSINESS_CARD_SIZE) {
      setBusinessCard(null);
      if (businessCardInputRef.current) businessCardInputRef.current.value = "";
      setError(messages.businessCardSize);
      setFieldErrors((prev) => ({
        ...prev,
        businessCard: messages.businessCardSize,
      }));
      return;
    }

    setBusinessCard(file);
    setError("");
    setFieldErrors((prev) => {
      const nextErrors = { ...prev };
      delete nextErrors.businessCard;
      return nextErrors;
    });
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (previewMode) return;

    const nextFieldErrors: FieldErrors = {};
    const normalizedPhone = normalizeKrMobilePhone(form.phone);
    const normalizedEmail = form.email.trim().toLowerCase();
    if (!form.name.trim()) nextFieldErrors.name = messages.nameRequired;
    if (!form.phone.trim()) {
      nextFieldErrors.phone = messages.phoneRequired;
    } else if (!isValidKrMobilePhone(normalizedPhone)) {
      nextFieldErrors.phone = messages.phoneInvalid;
    }
    if (isValidKrMobilePhone(normalizedPhone)) {
      if (!phoneVerificationId || phoneVerificationPhone !== normalizedPhone) {
        nextFieldErrors.phoneVerificationCode =
          messages.phoneVerificationRequired;
      } else if (!phoneVerificationCode.trim()) {
        nextFieldErrors.phoneVerificationCode = messages.phoneCodeRequired;
      } else if (phoneVerificationStatus !== "confirmed") {
        nextFieldErrors.phoneVerificationCode = messages.phoneConfirmRequired;
      } else if (
        !phoneVerificationExpiresAt ||
        Date.now() >= phoneVerificationExpiresAt
      ) {
        nextFieldErrors.phoneVerificationCode =
          messages.phoneVerificationExpired;
      }
    }
    if (!normalizedEmail) {
      nextFieldErrors.email = messages.emailRequired;
    } else if (!isValidSignupEmail(normalizedEmail)) {
      nextFieldErrors.email = messages.emailInvalid;
    } else if (
      emailCheckStatus !== "available" ||
      emailCheckedValue !== normalizedEmail
    ) {
      nextFieldErrors.email = messages.emailCheckRequired;
    }
    if (!form.password) {
      nextFieldErrors.password = messages.passwordRequired;
    } else if (form.password.length < PASSWORD_MIN_LENGTH) {
      nextFieldErrors.password = messages.passwordMin;
    }
    if (!form.passwordConfirm) {
      nextFieldErrors.passwordConfirm = messages.passwordConfirmRequired;
    } else if (form.password !== form.passwordConfirm) {
      nextFieldErrors.passwordConfirm = messages.passwordMismatch;
    }
    if (!form.cooperativeId) {
      nextFieldErrors.cooperativeId = messages.cooperativeRequired;
    }
    if (!form.position.trim()) {
      nextFieldErrors.position = messages.positionRequired;
    } else if (!form.cooperativeId) {
      nextFieldErrors.position = messages.cooperativeRequired;
    }
    if (!form.duty) nextFieldErrors.duty = messages.dutyRequired;
    if (!form.termsConsent || !form.privacyConsent) {
      nextFieldErrors.consents = messages.consentsRequired;
    }
    if (Object.keys(nextFieldErrors).length > 0) {
      if (
        nextFieldErrors.phoneVerificationCode ===
        messages.phoneVerificationExpired
      ) {
        setPhoneVerificationId("");
        setPhoneVerificationPhone("");
        setPhoneVerificationCode("");
        setPhoneVerificationStatus("idle");
        setPhoneVerificationExpiresAt(null);
      }
      setFieldErrors(nextFieldErrors);
      setError("");
      return;
    }

    setSubmitting(true);
    setError("");
    setFieldErrors({});
    let phoneCredentialConsumed = false;

    try {
      const auth = getFirebaseAuth();
      const storage = getFirebaseStorage();

      const passwordStatus = await validatePassword(auth, form.password);
      if (!passwordStatus.isValid) {
        setFieldErrors((prev) => ({
          ...prev,
          password: getPasswordValidationMessage(passwordStatus, messages),
        }));
        return;
      }

      let phoneVerificationIdToken = "";
      try {
        const phoneCredential = PhoneAuthProvider.credential(
          phoneVerificationId,
          phoneVerificationCode.trim()
        );
        const phoneUserCredential = await signInWithCredential(auth, phoneCredential);
        phoneVerificationIdToken = await phoneUserCredential.user.getIdToken(true);
        phoneCredentialConsumed = true;
        setPhoneVerificationStatus("verified");
      } catch (phoneError) {
        setPhoneVerificationId("");
        setPhoneVerificationPhone("");
        setPhoneVerificationCode("");
        setPhoneVerificationStatus("idle");
        setPhoneVerificationExpiresAt(null);
        setFieldErrors((prev) => ({
          ...prev,
          phoneVerificationCode: getPhoneVerificationErrorMessage(
            phoneError,
            messages,
          ),
        }));
        throw phoneError;
      }

      const credential = await createUserWithEmailAndPassword(
        auth,
        form.email.trim(),
        form.password
      );
      const userId = credential.user.uid;
      await updateProfile(credential.user, { displayName: form.name.trim() });

      let businessCardUrl: string | undefined;
      let businessCardPath: string | undefined;

      if (businessCard) {
        businessCardPath = `business-cards/${userId}/${Date.now()}-${safeFileName(
          businessCard.name,
        )}`;
        try {
          const cardRef = ref(storage, businessCardPath);
          await uploadBytes(cardRef, businessCard, { contentType: businessCard.type });
          try {
            businessCardUrl = await getDownloadURL(cardRef);
          } catch (urlError) {
            console.error("Business card URL fetch failed; path will be resolved on server.", urlError);
          }
        } catch (uploadError) {
          console.error("Business card upload failed; continuing signup.", uploadError);
          businessCardPath = undefined;
          businessCardUrl = undefined;
        }
      }

      const idToken = await credential.user.getIdToken();
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idToken,
          name: form.name,
          phone: normalizedPhone,
          phoneVerificationIdToken,
          email: form.email,
          cooperativeId: selectedCooperative?.cooperative_id,
          manualCooperativeName: form.manualCooperativeName,
          position: form.position,
          duty: form.duty,
          businessCardUrl,
          businessCardPath,
          consents: {
            terms: form.termsConsent,
            privacy: form.privacyConsent,
            marketing: form.marketingConsent,
            email: form.emailConsent,
            sms: form.smsConsent,
            kakao: form.kakaoConsent,
          } satisfies UserRecord["consents"],
        }),
      });

      let data: {
        ok?: boolean;
        completion?: Completion;
        error?: string;
      } = {};
      try {
        data = (await res.json()) as typeof data;
      } catch {
        throw new Error(`signup_api_invalid_response_${res.status}`);
      }
      if (!res.ok || !data.completion) {
        throw new Error(data.error ?? "signup_api_failed");
      }

      router.push("/login");
      router.refresh();
    } catch (err) {
      if (phoneCredentialConsumed) {
        setPhoneVerificationId("");
        setPhoneVerificationPhone("");
        setPhoneVerificationCode("");
        setPhoneVerificationStatus("idle");
        setPhoneVerificationExpiresAt(null);
        setFieldErrors((prev) => ({
          ...prev,
          phoneVerificationCode: messages.phoneVerificationRetry,
        }));
      }
      setError(getSignupErrorMessage(err, messages));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
        <section className="auth-stage">
          <h2>{identityCopy.title}</h2>
          <div className="auth-grid">
            <label className="auth-field">
              <span className="auth-field__label">{identityCopy.text.nameLabel}</span>
              <input
                className={`auth-field__input${fieldErrors.name ? " is-invalid" : ""}`}
                autoComplete="name"
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
                placeholder={identityCopy.text.namePlaceholder}
                aria-invalid={Boolean(fieldErrors.name)}
              />
              {fieldErrors.name && (
                <span className="auth-field__error">{fieldErrors.name}</span>
              )}
            </label>
            <label className="auth-field">
              <span className="auth-field__label">{identityCopy.text.phoneLabel}</span>
              <input
                className={`auth-field__input${fieldErrors.phone ? " is-invalid" : ""}`}
                autoComplete="tel"
                inputMode="tel"
                maxLength={KR_MOBILE_PHONE_MAX_INPUT_LENGTH}
                value={form.phone}
                onChange={(event) => updatePhone(event.target.value)}
                placeholder={identityCopy.text.phonePlaceholder}
                aria-invalid={Boolean(fieldErrors.phone)}
              />
              {fieldErrors.phone && (
                <span className="auth-field__error">{fieldErrors.phone}</span>
              )}
            </label>
            <div className="auth-field">
              <div
                className={`auth-phone-codebox${
                  phoneVerificationStatus === "sent" ||
                  phoneVerificationStatus === "confirmed"
                    ? " is-open"
                    : ""
                }${phoneVerificationStatus === "confirmed" ? " is-confirmed" : ""}`}
                aria-hidden={
                  phoneVerificationStatus !== "sent" &&
                  phoneVerificationStatus !== "confirmed"
                }
              >
                <div className="auth-phone-codebox__inner">
                  {phoneVerificationStatus === "confirmed" ? (
                    <div className="auth-phone-confirmed">
                      <span className="auth-phone-confirmed__check" aria-hidden="true">
                        ✓
                      </span>
                      <span className="auth-phone-confirmed__text">
                        {identityCopy.text.verifiedNotice}
                      </span>
                    </div>
                  ) : (
                    <div className="auth-phone-codeinput">
                      <input
                        className={`auth-field__input${fieldErrors.phoneVerificationCode ? " is-invalid" : ""}`}
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        maxLength={6}
                        value={phoneVerificationCode}
                        onChange={(event) => {
                          const nextCode = event.target.value
                            .replace(/[^\d]/g, "")
                            .slice(0, 6);
                          setPhoneVerificationCode(nextCode);
                          setFieldErrors((prev) => {
                            const nextErrors = { ...prev };
                            delete nextErrors.phoneVerificationCode;
                            return nextErrors;
                          });
                        }}
                        placeholder={identityCopy.text.verificationCodePlaceholder}
                        disabled={!phoneVerificationId}
                        aria-invalid={Boolean(fieldErrors.phoneVerificationCode)}
                        aria-label={identityCopy.text.verificationCodePlaceholder}
                      />
                      <button
                        type="button"
                        className="auth-phone-codeinput__confirm"
                        onClick={confirmPhoneVerificationCode}
                        disabled={
                          submitting ||
                          !phoneVerificationId ||
                          phoneVerificationCode.trim().length !== 6
                        }
                      >
                        {identityCopy.text.verifyCodeLabel}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {phoneVerificationStatus !== "confirmed" && (
                <button
                  type="button"
                  className="auth-phone-send"
                  onClick={sendPhoneVerificationCode}
                  disabled={submitting || phoneVerificationStatus === "sending"}
                >
                  {phoneVerificationStatus === "sending"
                    ? identityCopy.text.sendingLabel
                    : phoneVerificationId &&
                        phoneVerificationPhone === normalizeKrMobilePhone(form.phone)
                      ? identityCopy.text.resendLabel
                      : identityCopy.text.sendLabel}
                </button>
              )}
              {phoneVerificationStatus === "idle" && (
                <span className="auth-field__hint">
                  {identityCopy.text.phoneLimitHelp}
                </span>
              )}
              {phoneVerificationStatus === "sent" && (
                <span className="auth-field__hint">
                  {identityCopy.text.codeSentHelp}
                </span>
              )}
              {fieldErrors.phoneVerificationCode && (
                <span className="auth-field__error">
                  {fieldErrors.phoneVerificationCode}
                </span>
              )}
              <span id="signup-phone-recaptcha" className="auth-phone-recaptcha" />
            </div>
            <label className="auth-field">
              <span className="auth-field__label">{identityCopy.text.emailLabel}</span>
              <span className="auth-email-check">
                <input
                  className={`auth-field__input${fieldErrors.email ? " is-invalid" : ""}`}
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(event) => updateEmail(event.target.value)}
                  onBlur={() => {
                    if (form.email.trim()) void checkEmailAvailability();
                  }}
                  placeholder={identityCopy.text.emailPlaceholder}
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby="signup-email-status"
                />
                <button
                  type="button"
                  className="auth-email-check__button"
                  onClick={() => void checkEmailAvailability()}
                  disabled={submitting || emailCheckStatus === "checking"}
                >
                  {emailCheckStatus === "checking"
                    ? identityCopy.text.checkingEmailLabel
                    : identityCopy.text.checkEmailLabel}
                </button>
              </span>
              {fieldErrors.email && (
                <span className="auth-field__error" id="signup-email-status">
                  {fieldErrors.email}
                </span>
              )}
              {!fieldErrors.email &&
                emailCheckStatus === "available" &&
                emailCheckedValue === form.email.trim().toLowerCase() && (
                  <span className="auth-field__success" id="signup-email-status">
                    {identityCopy.text.emailAvailable}
                  </span>
              )}
            </label>
            <label className="auth-field">
              <span className="auth-field__label">{identityCopy.text.passwordLabel}</span>
              <span className="auth-field__inputbox">
                <input
                  className={`auth-field__input auth-field__input--with-action${fieldErrors.password ? " is-invalid" : ""}`}
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) => updatePassword(event.target.value)}
                  placeholder={identityCopy.text.passwordPlaceholder}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby="signup-password-requirements"
                  minLength={PASSWORD_MIN_LENGTH}
                />
                <button
                  type="button"
                  className="auth-field__action"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={
                    showPassword
                      ? identityCopy.text.hidePasswordLabel
                      : identityCopy.text.showPasswordLabel
                  }
                  aria-pressed={showPassword}
                >
                  <PasswordIcon visible={showPassword} />
                </button>
              </span>
              {fieldErrors.password && (
                <span className="auth-field__error">{fieldErrors.password}</span>
              )}
              <span className="auth-field__hint" id="signup-password-requirements">
                {messages.passwordMin}
              </span>
            </label>
            <label className="auth-field">
              <span className="auth-field__label">
                {identityCopy.text.passwordConfirmLabel}
              </span>
              <span className="auth-field__inputbox">
                <input
                  className={`auth-field__input auth-field__input--with-action${fieldErrors.passwordConfirm ? " is-invalid" : ""}`}
                  type={showPasswordConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  value={form.passwordConfirm}
                  onChange={(event) => updatePasswordConfirm(event.target.value)}
                  placeholder={identityCopy.text.passwordConfirmPlaceholder}
                  aria-invalid={Boolean(fieldErrors.passwordConfirm)}
                />
                <button
                  type="button"
                  className="auth-field__action"
                  onClick={() => setShowPasswordConfirm((prev) => !prev)}
                  aria-label={
                    showPasswordConfirm
                      ? identityCopy.text.hidePasswordLabel
                      : identityCopy.text.showPasswordLabel
                  }
                  aria-pressed={showPasswordConfirm}
                >
                  <PasswordIcon visible={showPasswordConfirm} />
                </button>
              </span>
              {fieldErrors.passwordConfirm && (
                <span className="auth-field__error">{fieldErrors.passwordConfirm}</span>
              )}
            </label>
          </div>
        </section>

        <section className="auth-stage">
          <h2>{organizationCopy.title}</h2>
          <div className="auth-grid">
            <label className="auth-field auth-field--wide">
              <span className="auth-field__label">
                {organizationCopy.text.searchLabel}
              </span>
              <input
                className={`auth-field__input${fieldErrors.cooperativeId ? " is-invalid" : ""}`}
                value={form.cooperativeQuery}
                onChange={(event) => {
                  update("cooperativeQuery", event.target.value);
                  setForm((prev) => ({ ...prev, cooperativeId: "" }));
                }}
                placeholder={organizationCopy.text.searchPlaceholder}
                aria-invalid={Boolean(fieldErrors.cooperativeId)}
              />
              {fieldErrors.cooperativeId && (
                <span className="auth-field__error">{fieldErrors.cooperativeId}</span>
              )}
            </label>
          </div>

          {showCooperativeSuggestions && (
            filteredCooperatives.length > 0 ? (
              <div
                className="signup-coop-results"
                aria-label={organizationCopy.text.resultsAriaLabel}
              >
                {filteredCooperatives.map((item) => (
                  <button
                    type="button"
                    key={item.cooperative_id}
                    className={
                      item.cooperative_id === form.cooperativeId
                        ? "is-selected"
                        : undefined
                    }
                    onClick={() => selectCooperative(item)}
                  >
                    <strong>{item.cooperative_name}</strong>
                    <span>{item.cooperative_type}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="signup-coop-empty" role="status">
                {organizationCopy.text.emptyPrefix}
                <strong>{cooperativeQueryTrimmed}</strong>
                {organizationCopy.text.emptySuffix}
              </p>
            )
          )}

          {selectedCooperative && (
            <p className="auth-selected">
              {organizationCopy.text.selectedPrefix}{" "}
              <strong>{cooperativeDisplay(selectedCooperative)}</strong>
            </p>
          )}
        </section>

        <section className="auth-stage">
          <h2>{workCopy.title}</h2>
          <div className="auth-grid">
            <label className="auth-field">
              <span className="auth-field__label">{workCopy.text.positionLabel}</span>
              <input
                className={`auth-field__input${fieldErrors.position ? " is-invalid" : ""}`}
                value={form.position}
                onChange={(event) => updatePosition(event.target.value)}
                placeholder={workCopy.text.positionPlaceholder}
                aria-invalid={Boolean(fieldErrors.position)}
              />
              {fieldErrors.position && (
                <span className="auth-field__error">{fieldErrors.position}</span>
              )}
            </label>
            <label className="auth-field">
              <span className="auth-field__label">{workCopy.text.dutyLabel}</span>
              <select
                className={`auth-field__input${fieldErrors.duty ? " is-invalid" : ""}`}
                value={form.duty}
                onChange={(event) => update("duty", event.target.value)}
                aria-invalid={Boolean(fieldErrors.duty)}
              >
                <option value="">{workCopy.text.dutyPlaceholder}</option>
                {dutyOptions.map((duty) => (
                  <option key={duty.value} value={duty.value}>
                    {duty.label}
                  </option>
                ))}
              </select>
              {fieldErrors.duty && (
                <span className="auth-field__error">{fieldErrors.duty}</span>
              )}
            </label>
          </div>
          <div className="auth-field">
            <span className="auth-field__label">{cardCopy.title}</span>
            <input
              ref={businessCardInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.pdf"
              className="auth-file__input"
              aria-label={cardCopy.title}
              onChange={(event) => handleBusinessCardChange(event.target.files?.[0] ?? null)}
            />
            {businessCard ? (
              <div className="auth-file auth-file--filled">
                <span className="auth-file__thumb" aria-hidden="true">
                  <FileIcon />
                </span>
                <div className="auth-file__meta">
                  <strong>{businessCard.name}</strong>
                  <span>{formatFileSize(businessCard.size)}</span>
                </div>
                <div className="auth-file__actions">
                  <button
                    type="button"
                    className="auth-file__btn"
                    onClick={() => businessCardInputRef.current?.click()}
                  >
                    {cardCopy.text.changeLabel}
                  </button>
                  <button
                    type="button"
                    className="auth-file__btn auth-file__btn--ghost"
                    onClick={() => {
                      setBusinessCard(null);
                      if (businessCardInputRef.current) {
                        businessCardInputRef.current.value = "";
                      }
                    }}
                  >
                    {cardCopy.text.deleteLabel}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="auth-file"
                onClick={() => businessCardInputRef.current?.click()}
              >
                <span className="auth-file__icon" aria-hidden="true">
                  <UploadIcon />
                </span>
                <span className="auth-file__text">
                  <strong>{cardCopy.text.uploadTitle}</strong>
                  <span>{cardCopy.text.uploadHelp}</span>
                </span>
                <span className="auth-file__cta">{cardCopy.text.selectLabel}</span>
              </button>
            )}
            <span className="auth-field__hint">{cardCopy.description}</span>
            {fieldErrors.businessCard && (
              <span className="auth-field__error">{fieldErrors.businessCard}</span>
            )}
          </div>
        </section>

        <section className="auth-stage">
          <h2>{consentsCopy.title}</h2>

          <label className="auth-check auth-check--all">
            <input
              type="checkbox"
              checked={allConsent}
              ref={(node) => {
                if (node) node.indeterminate = !allConsent && partialConsent;
              }}
              onChange={(event) => toggleAllConsent(event.target.checked)}
            />
            <span>
              <strong>{consentsCopy.text.allLabel}</strong>
              <em>{consentsCopy.text.allHelp}</em>
            </span>
          </label>

          <div className="auth-consent-list">
            <div className="auth-check auth-check--row">
              <label className="auth-check__control">
                <input
                  type="checkbox"
                  checked={form.termsConsent}
                  onChange={(event) => update("termsConsent", event.target.checked)}
                />
                <span>
                  <em className="auth-check__tag auth-check__tag--required">
                    {consentsCopy.text.requiredBadge}
                  </em>
                  {consentsCopy.text.termsLabel}
                </span>
              </label>
              <Link
                className="auth-check__more"
                href={termsAction?.href ?? "/terms"}
                onClick={previewMode ? (event) => event.preventDefault() : undefined}
              >
                {consentsCopy.text.termsLinkLabel}
              </Link>
            </div>
            <div className="auth-check auth-check--row">
              <label className="auth-check__control">
                <input
                  type="checkbox"
                  checked={form.privacyConsent}
                  onChange={(event) => update("privacyConsent", event.target.checked)}
                />
                <span>
                  <em className="auth-check__tag auth-check__tag--required">
                    {consentsCopy.text.requiredBadge}
                  </em>
                  {consentsCopy.text.privacyLabel}
                </span>
              </label>
              <Link
                className="auth-check__more"
                href={privacyAction?.href ?? "/privacy"}
                onClick={previewMode ? (event) => event.preventDefault() : undefined}
              >
                {consentsCopy.text.privacyLinkLabel}
              </Link>
            </div>
          </div>

          <fieldset className="auth-consent-card">
            <legend>
              <span className="auth-check__tag auth-check__tag--optional">
                {consentsCopy.text.optionalBadge}
              </span>
              {consentsCopy.text.marketingTitle}
            </legend>
            <p className="auth-consent-card__lede">
              {consentsCopy.text.marketingHelp}
            </p>
            <div className="auth-consent-card__items">
              {(
                [
                  ["marketingConsent", consentsCopy.text.marketingLabel],
                  ["emailConsent", consentsCopy.text.emailLabel],
                  ["smsConsent", consentsCopy.text.smsLabel],
                  ["kakaoConsent", consentsCopy.text.kakaoLabel],
                ] as const
              ).map(([key, label]) => (
                <label className="auth-check auth-check--inline" key={key}>
                  <input
                    type="checkbox"
                    checked={form[key] as boolean}
                    onChange={(event) => update(key, event.target.checked)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {fieldErrors.consents && (
            <p className="auth-field__error" role="alert">
              {fieldErrors.consents}
            </p>
          )}
        </section>

        <div className="auth-points-panel">
          <strong>{benefitsCopy.title}</strong>
          <ul>
            {benefitsCopy.items
              .filter((item) => item.visible && !item.deleted)
              .map((item) => (
                <li key={item.id}>{item.title}</li>
              ))}
          </ul>
        </div>

        {error && (
          <p className="form__error" role="alert">
            {error}
          </p>
        )}

        <button className="cta cta--solid cta--block" type="submit" disabled={submitting}>
          {submitting
            ? submitCopy.text.submittingLabel
            : submitCopy.text.submitLabel}
        </button>
    </form>
  );
}

function PasswordIcon({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M3 10.5C4.4 7.7 6.9 6 10 6c3.1 0 5.6 1.7 7 4.5-1.4 2.8-3.9 4.5-7 4.5-3.1 0-5.6-1.7-7-4.5Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="10" cy="10.5" r="2.3" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3.2 10.5c.6-1.2 1.5-2.2 2.5-3M9 6.1c.3 0 .7-.1 1-.1 3.1 0 5.6 1.7 7 4.5-.5 1-1.2 1.9-2 2.6M11.4 13.7c-.5.2-.9.3-1.4.3-3.1 0-5.6-1.7-7-4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M3.5 3.5L16.5 16.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 16V5M12 5l-4 4M12 5l4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 16v2.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V16"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
