"use client";

import { FirebaseError } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  PhoneAuthProvider,
  RecaptchaVerifier,
  signInWithCredential,
  updateProfile,
  type Auth,
} from "firebase/auth";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  nonghyupMaster,
  signupDutyOptions,
} from "@/lib/platform";
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
const COOPERATIVE_REQUIRED_MESSAGE = "소속 농협을 선택해 주세요.";
const PHONE_VERIFICATION_TTL_MS = 30 * 60 * 1000;
const PHONE_VERIFICATION_EXPIRED_MESSAGE =
  "휴대폰 인증이 만료되었습니다. 인증번호를 다시 받아 주세요.";
const PHONE_VERIFICATION_RETRY_MESSAGE =
  "회원가입을 완료하지 못해 휴대폰 인증을 다시 진행해 주세요.";
const EMAIL_CHECK_REQUIRED_MESSAGE = "이메일 중복확인을 먼저 진행해 주세요.";
const EMAIL_INVALID_FORMAT_MESSAGE = "이메일 형식이 올바르지 않습니다.";
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

function getSignupErrorMessage(error: unknown) {
  if (!(error instanceof FirebaseError)) {
    if (error instanceof Error) {
      switch (error.message) {
        case "missing_fields":
          return "필수 입력값이 누락되었습니다. 입력 내용을 다시 확인해 주세요.";
        case "invalid_token":
          return "로그인 인증 정보가 만료되었습니다. 새로고침 후 다시 시도해 주세요.";
        case "email_mismatch":
          return "가입 이메일과 인증 이메일이 일치하지 않습니다.";
        case "invalid_cooperative_id":
          return "선택한 농협 정보를 확인할 수 없습니다. 농협명을 다시 검색해 선택해 주세요.";
        case "invalid_phone":
          return "휴대폰 번호는 010-0000-0000 형식으로 입력해 주세요.";
        case "missing_phone_verification":
          return "휴대폰 문자 인증을 먼저 완료해 주세요.";
        case "invalid_phone_verification":
          return "휴대폰 인증 정보가 일치하지 않습니다. 인증번호를 다시 받아 주세요.";
        case "phone_verification_expired":
          return "휴대폰 인증 시간이 만료되었습니다. 인증번호를 다시 받아 주세요.";
        case "phone_account_limit_exceeded":
          return "동일한 휴대폰 번호로는 최대 2개 계정까지만 가입할 수 있습니다.";
        default:
          return `회원가입 저장 중 문제가 발생했습니다: ${error.message}`;
      }
    }
    return "회원가입 저장 중 문제가 발생했습니다. Firebase 설정을 확인해 주세요.";
  }

  switch (error.code) {
    case "auth/email-already-in-use":
      return "이미 가입된 이메일입니다. 로그인해 주세요.";
    case "auth/invalid-email":
      return "이메일 형식이 올바르지 않습니다.";
    case "auth/weak-password":
      return "비밀번호는 6자 이상이어야 합니다.";
    case "auth/invalid-verification-code":
      return "인증번호가 올바르지 않습니다. 문자로 받은 번호를 다시 확인해 주세요.";
    case "auth/code-expired":
      return "인증번호가 만료되었습니다. 인증번호를 다시 받아 주세요.";
    case "auth/invalid-phone-number":
      return "휴대폰 번호는 010-0000-0000 형식으로 입력해 주세요.";
    case "auth/too-many-requests":
      return "인증 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
    case "permission-denied":
      return "Firebase 권한 설정 때문에 저장할 수 없습니다. 보안 규칙을 확인해 주세요.";
    default:
      return "회원가입 저장 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";
  }
}

function getPhoneVerificationErrorMessage(error: unknown) {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/invalid-phone-number":
        return "휴대폰 번호는 010-0000-0000 형식으로 입력해 주세요.";
      case "auth/invalid-verification-code":
        return "인증번호가 올바르지 않습니다. 문자로 받은 번호를 다시 확인해 주세요.";
      case "auth/code-expired":
        return "인증번호가 만료되었습니다. 인증번호를 다시 받아 주세요.";
      case "auth/too-many-requests":
        return "인증 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
      case "auth/quota-exceeded":
        return "문자 인증 발송 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.";
      default:
        return "휴대폰 문자 인증 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";
    }
  }

  return "휴대폰 문자 인증 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";
}

export function SignupForm() {
  const router = useRouter();
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
        phoneVerificationCode: PHONE_VERIFICATION_EXPIRED_MESSAGE,
      }));
    };

    const remainingTime = phoneVerificationExpiresAt - Date.now();
    if (remainingTime <= 0) {
      expireVerification();
      return;
    }

    const timerId = window.setTimeout(expireVerification, remainingTime);
    return () => window.clearTimeout(timerId);
  }, [phoneVerificationExpiresAt, phoneVerificationStatus]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
      delete nextErrors.password;
      if (form.passwordConfirm && value !== form.passwordConfirm) {
        nextErrors.passwordConfirm = "비밀번호가 일치하지 않습니다.";
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
        nextErrors.passwordConfirm = "비밀번호가 일치하지 않습니다.";
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
        nextErrors.email = EMAIL_INVALID_FORMAT_MESSAGE;
      } else {
        delete nextErrors.email;
      }
      return nextErrors;
    });
  };

  const checkEmailAvailability = async () => {
    const email = form.email.trim().toLowerCase();
    if (!email) {
      setFieldErrors((prev) => ({
        ...prev,
        email: "농협 이메일을 입력해 주세요.",
      }));
      setEmailCheckStatus("idle");
      setEmailCheckedValue("");
      return false;
    }
    if (!isValidSignupEmail(email)) {
      setFieldErrors((prev) => ({
        ...prev,
        email: EMAIL_INVALID_FORMAT_MESSAGE,
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
          email: "이미 가입된 이메일입니다. 로그인해 주세요.",
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
        email: "이메일 중복확인 중 문제가 발생했습니다. 다시 시도해 주세요.",
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
        nextErrors.position = COOPERATIVE_REQUIRED_MESSAGE;
        nextErrors.cooperativeId = COOPERATIVE_REQUIRED_MESSAGE;
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
    if (!form.name.trim()) {
      setFieldErrors((prev) => ({
        ...prev,
        name: "이름을 입력해 주세요.",
      }));
      return;
    }

    const normalizedPhone = normalizeKrMobilePhone(form.phone);
    if (!isValidKrMobilePhone(normalizedPhone)) {
      setFieldErrors((prev) => ({
        ...prev,
        phone: "휴대폰 번호는 010-0000-0000 형식으로 입력해 주세요.",
      }));
      return;
    }

    const phoneNumber = toKrMobilePhoneE164(normalizedPhone);
    if (!phoneNumber) {
      setFieldErrors((prev) => ({
        ...prev,
        phone: "휴대폰 번호는 010-0000-0000 형식으로 입력해 주세요.",
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
        phoneVerificationCode: getPhoneVerificationErrorMessage(err),
      }));
    }
  };

  const confirmPhoneVerificationCode = () => {
    const trimmed = phoneVerificationCode.trim();
    if (!phoneVerificationId) {
      setFieldErrors((prev) => ({
        ...prev,
        phoneVerificationCode: "먼저 '인증번호 받기'로 인증번호를 받아 주세요.",
      }));
      return;
    }
    if (trimmed.length !== 6) {
      setFieldErrors((prev) => ({
        ...prev,
        phoneVerificationCode: "문자로 받은 6자리 인증번호를 입력해 주세요.",
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
      if (nextErrors.position === COOPERATIVE_REQUIRED_MESSAGE) {
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
      setError("명함 파일은 JPG, PNG, PDF 형식만 첨부할 수 있습니다.");
      setFieldErrors((prev) => ({
        ...prev,
        businessCard: "명함 파일은 JPG, PNG, PDF 형식만 첨부할 수 있습니다.",
      }));
      return;
    }

    if (file.size > MAX_BUSINESS_CARD_SIZE) {
      setBusinessCard(null);
      if (businessCardInputRef.current) businessCardInputRef.current.value = "";
      setError("명함 파일은 최대 10MB까지 첨부할 수 있습니다.");
      setFieldErrors((prev) => ({
        ...prev,
        businessCard: "명함 파일은 최대 10MB까지 첨부할 수 있습니다.",
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

    const nextFieldErrors: FieldErrors = {};
    const normalizedPhone = normalizeKrMobilePhone(form.phone);
    const normalizedEmail = form.email.trim().toLowerCase();
    if (!form.name.trim()) nextFieldErrors.name = "이름을 입력해 주세요.";
    if (!form.phone.trim()) {
      nextFieldErrors.phone = "휴대폰 번호를 입력해 주세요.";
    } else if (!isValidKrMobilePhone(normalizedPhone)) {
      nextFieldErrors.phone = "휴대폰 번호는 010-0000-0000 형식으로 입력해 주세요.";
    }
    if (isValidKrMobilePhone(normalizedPhone)) {
      if (!phoneVerificationId || phoneVerificationPhone !== normalizedPhone) {
        nextFieldErrors.phoneVerificationCode = "휴대폰 문자 인증을 먼저 진행해 주세요.";
      } else if (!phoneVerificationCode.trim()) {
        nextFieldErrors.phoneVerificationCode = "문자로 받은 인증번호를 입력해 주세요.";
      } else if (phoneVerificationStatus !== "confirmed") {
        nextFieldErrors.phoneVerificationCode = "휴대폰 인증 확인을 완료해 주세요.";
      } else if (
        !phoneVerificationExpiresAt ||
        Date.now() >= phoneVerificationExpiresAt
      ) {
        nextFieldErrors.phoneVerificationCode = PHONE_VERIFICATION_EXPIRED_MESSAGE;
      }
    }
    if (!normalizedEmail) {
      nextFieldErrors.email = "농협 이메일을 입력해 주세요.";
    } else if (!isValidSignupEmail(normalizedEmail)) {
      nextFieldErrors.email = EMAIL_INVALID_FORMAT_MESSAGE;
    } else if (
      emailCheckStatus !== "available" ||
      emailCheckedValue !== normalizedEmail
    ) {
      nextFieldErrors.email = EMAIL_CHECK_REQUIRED_MESSAGE;
    }
    if (!form.password) {
      nextFieldErrors.password = "비밀번호를 입력해 주세요.";
    } else if (form.password.length < 8) {
      nextFieldErrors.password = "비밀번호는 8자 이상 입력해 주세요.";
    }
    if (!form.passwordConfirm) {
      nextFieldErrors.passwordConfirm = "비밀번호 확인을 입력해 주세요.";
    } else if (form.password !== form.passwordConfirm) {
      nextFieldErrors.passwordConfirm = "비밀번호가 일치하지 않습니다.";
    }
    if (!form.cooperativeId) {
      nextFieldErrors.cooperativeId = COOPERATIVE_REQUIRED_MESSAGE;
    }
    if (!form.position.trim()) {
      nextFieldErrors.position = "직책을 입력해 주세요.";
    } else if (!form.cooperativeId) {
      nextFieldErrors.position = COOPERATIVE_REQUIRED_MESSAGE;
    }
    if (!form.duty) nextFieldErrors.duty = "담당업무를 선택해 주세요.";
    if (!form.termsConsent || !form.privacyConsent) {
      nextFieldErrors.consents = "필수 약관과 개인정보 수집·이용에 동의해 주세요.";
    }
    if (Object.keys(nextFieldErrors).length > 0) {
      if (nextFieldErrors.phoneVerificationCode === PHONE_VERIFICATION_EXPIRED_MESSAGE) {
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
          phoneVerificationCode: getPhoneVerificationErrorMessage(phoneError),
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
          phoneVerificationCode: PHONE_VERIFICATION_RETRY_MESSAGE,
        }));
      }
      setError(getSignupErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
        <section className="auth-stage">
          <h2>기본 정보 입력</h2>
          <div className="auth-grid">
            <label className="auth-field">
              <span className="auth-field__label">이름</span>
              <input
                className={`auth-field__input${fieldErrors.name ? " is-invalid" : ""}`}
                autoComplete="name"
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
                placeholder="이름을 입력하세요"
                aria-invalid={Boolean(fieldErrors.name)}
              />
              {fieldErrors.name && (
                <span className="auth-field__error">{fieldErrors.name}</span>
              )}
            </label>
            <label className="auth-field">
              <span className="auth-field__label">휴대폰 번호</span>
              <input
                className={`auth-field__input${fieldErrors.phone ? " is-invalid" : ""}`}
                autoComplete="tel"
                inputMode="tel"
                maxLength={KR_MOBILE_PHONE_MAX_INPUT_LENGTH}
                value={form.phone}
                onChange={(event) => updatePhone(event.target.value)}
                placeholder="010-0000-0000"
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
                        인증이 완료되었습니다. 인증은 30분간 유지됩니다
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
                        placeholder="인증번호 6자리"
                        disabled={!phoneVerificationId}
                        aria-invalid={Boolean(fieldErrors.phoneVerificationCode)}
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
                        인증 확인
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
                    ? "발송 중..."
                    : phoneVerificationId &&
                        phoneVerificationPhone === normalizeKrMobilePhone(form.phone)
                      ? "인증번호 재발송"
                      : "인증번호 받기"}
                </button>
              )}
              {phoneVerificationStatus === "idle" && (
                <span className="auth-field__hint">
                  동일한 휴대폰 번호로는 최대 2개 계정까지만 가입할 수 있습니다.
                </span>
              )}
              {phoneVerificationStatus === "sent" && (
                <span className="auth-field__hint">
                  입력하신 번호로 인증번호가 발송되었어요. 받은 6자리 숫자를 입력해
                  주세요.
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
              <span className="auth-field__label">농협 이메일</span>
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
                  placeholder="예: name@nonghyup.com"
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby="signup-email-status"
                />
                <button
                  type="button"
                  className="auth-email-check__button"
                  onClick={() => void checkEmailAvailability()}
                  disabled={submitting || emailCheckStatus === "checking"}
                >
                  {emailCheckStatus === "checking" ? "확인 중..." : "중복확인"}
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
                    사용 가능한 이메일입니다.
                  </span>
              )}
            </label>
            <label className="auth-field">
              <span className="auth-field__label">비밀번호</span>
              <span className="auth-field__inputbox">
                <input
                  className={`auth-field__input auth-field__input--with-action${fieldErrors.password ? " is-invalid" : ""}`}
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) => updatePassword(event.target.value)}
                  placeholder="8자 이상 입력하세요"
                  aria-invalid={Boolean(fieldErrors.password)}
                />
                <button
                  type="button"
                  className="auth-field__action"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                  aria-pressed={showPassword}
                >
                  <PasswordIcon visible={showPassword} />
                </button>
              </span>
              {fieldErrors.password && (
                <span className="auth-field__error">{fieldErrors.password}</span>
              )}
            </label>
            <label className="auth-field">
              <span className="auth-field__label">비밀번호 확인</span>
              <span className="auth-field__inputbox">
                <input
                  className={`auth-field__input auth-field__input--with-action${fieldErrors.passwordConfirm ? " is-invalid" : ""}`}
                  type={showPasswordConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  value={form.passwordConfirm}
                  onChange={(event) => updatePasswordConfirm(event.target.value)}
                  placeholder="비밀번호를 한 번 더 입력하세요"
                  aria-invalid={Boolean(fieldErrors.passwordConfirm)}
                />
                <button
                  type="button"
                  className="auth-field__action"
                  onClick={() => setShowPasswordConfirm((prev) => !prev)}
                  aria-label={showPasswordConfirm ? "비밀번호 숨기기" : "비밀번호 보기"}
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
          <h2>소속 농협 선택</h2>
          <div className="auth-grid">
            <label className="auth-field auth-field--wide">
              <span className="auth-field__label">농협명 검색</span>
              <input
                className={`auth-field__input${fieldErrors.cooperativeId ? " is-invalid" : ""}`}
                value={form.cooperativeQuery}
                onChange={(event) => {
                  update("cooperativeQuery", event.target.value);
                  setForm((prev) => ({ ...prev, cooperativeId: "" }));
                }}
                placeholder="예: 상주농협, 서울중앙농협"
                aria-invalid={Boolean(fieldErrors.cooperativeId)}
              />
              {fieldErrors.cooperativeId && (
                <span className="auth-field__error">{fieldErrors.cooperativeId}</span>
              )}
            </label>
          </div>

          {showCooperativeSuggestions && (
            filteredCooperatives.length > 0 ? (
              <div className="signup-coop-results" aria-label="농협 검색 결과">
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
                <strong>{cooperativeQueryTrimmed}</strong>(으)로 검색된 농협이
                없습니다. 마스터 목록에 있는 농협명으로 다시 검색해 주세요.
              </p>
            )
          )}

          {selectedCooperative && (
            <p className="auth-selected">
              선택한 농협: <strong>{cooperativeDisplay(selectedCooperative)}</strong>
            </p>
          )}
        </section>

        <section className="auth-stage">
          <h2>담당자 정보 입력</h2>
          <div className="auth-grid">
            <label className="auth-field">
              <span className="auth-field__label">직책</span>
              <input
                className={`auth-field__input${fieldErrors.position ? " is-invalid" : ""}`}
                value={form.position}
                onChange={(event) => updatePosition(event.target.value)}
                placeholder="예: 과장, 팀장"
                aria-invalid={Boolean(fieldErrors.position)}
              />
              {fieldErrors.position && (
                <span className="auth-field__error">{fieldErrors.position}</span>
              )}
            </label>
            <label className="auth-field">
              <span className="auth-field__label">담당업무</span>
              <select
                className={`auth-field__input${fieldErrors.duty ? " is-invalid" : ""}`}
                value={form.duty}
                onChange={(event) => update("duty", event.target.value)}
                aria-invalid={Boolean(fieldErrors.duty)}
              >
                <option value="">담당업무 선택</option>
                {signupDutyOptions.map((duty) => (
                  <option key={duty} value={duty}>
                    {duty}
                  </option>
                ))}
              </select>
              {fieldErrors.duty && (
                <span className="auth-field__error">{fieldErrors.duty}</span>
              )}
            </label>
          </div>
          <div className="auth-field">
            <span className="auth-field__label">명함 첨부</span>
            <input
              ref={businessCardInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.pdf"
              className="auth-file__input"
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
                    변경
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
                    삭제
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
                  <strong>명함 이미지를 업로드하세요</strong>
                  <span>JPG, PNG, PDF · 최대 10MB</span>
                </span>
                <span className="auth-file__cta">파일 선택</span>
              </button>
            )}
            <span className="auth-field__hint">직원 인증 및 관리자 승인 시 확인합니다.</span>
            {fieldErrors.businessCard && (
              <span className="auth-field__error">{fieldErrors.businessCard}</span>
            )}
          </div>
        </section>

        <section className="auth-stage">
          <h2>약관 및 동의</h2>

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
              <strong>전체 동의</strong>
              <em>필수 및 선택 항목에 모두 동의합니다.</em>
            </span>
          </label>

          <div className="auth-consent-list">
            <label className="auth-check auth-check--row">
              <input
                type="checkbox"
                checked={form.termsConsent}
                onChange={(event) => update("termsConsent", event.target.checked)}
              />
              <span>
                <em className="auth-check__tag auth-check__tag--required">필수</em>
                이용약관 동의
              </span>
              <span className="auth-check__more" aria-hidden="true">보기</span>
            </label>
            <label className="auth-check auth-check--row">
              <input
                type="checkbox"
                checked={form.privacyConsent}
                onChange={(event) => update("privacyConsent", event.target.checked)}
              />
              <span>
                <em className="auth-check__tag auth-check__tag--required">필수</em>
                개인정보 수집·이용 동의
              </span>
              <span className="auth-check__more" aria-hidden="true">보기</span>
            </label>
          </div>

          <fieldset className="auth-consent-card">
            <legend>
              <span className="auth-check__tag auth-check__tag--optional">선택</span>
              마케팅 및 수신 동의
            </legend>
            <p className="auth-consent-card__lede">
              아래 항목은 가입 후 마이페이지에서 언제든 변경할 수 있어요.
            </p>
            <div className="auth-consent-card__items">
              {(
                [
                  ["marketingConsent", "마케팅 정보 수신"],
                  ["emailConsent", "이메일 수신"],
                  ["smsConsent", "문자/SMS 수신"],
                  ["kakaoConsent", "카카오톡 수신"],
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
          <strong>가입 혜택</strong>
          <ul>
            <li>농협 최초 가입 시 전문 상담에 사용할 수 있는 100,000P를 지급합니다.</li>
            <li>이후 임직원 1인당 10,000P를 지급합니다.</li>
          </ul>
        </div>

        {error && (
          <p className="form__error" role="alert">
            {error}
          </p>
        )}

        <button className="cta cta--solid cta--block" type="submit" disabled={submitting}>
          {submitting ? "가입 신청 저장 중..." : "가입 신청 완료"}
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
