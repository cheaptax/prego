"use client";

import { FirebaseError } from "firebase/app";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  setPersistence,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getFirebaseAuth } from "@/lib/firebase/client";
import {
  formatKrMobilePhoneInput,
  KR_MOBILE_PHONE_MAX_INPUT_LENGTH,
  normalizeKrMobilePhone,
} from "@/lib/phone";
import type { CmsPageContent } from "@/lib/cms/schemas";
import { getCmsSection } from "@/lib/cms/runtime";

function getFirebaseMessage(
  error: unknown,
  messages: CmsPageContent["messages"],
) {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/invalid-credential":
      case "auth/user-not-found":
      case "auth/wrong-password":
        return messages.invalidCredentials;
      case "auth/too-many-requests":
        return messages.tooManyRequests;
      case "auth/network-request-failed":
        return messages.networkError;
      default:
        return messages.genericError;
    }
  }

  if (error instanceof Error && error.message) {
    return messages.genericError;
  }

  return messages.genericError;
}

async function getMemberStatus() {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("missing_current_user");
  const idToken = await user.getIdToken();
  const res = await fetch("/api/me/status", {
    headers: { authorization: `Bearer ${idToken}` },
  });
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean;
    status?: string;
    error?: string;
  } | null;
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error ?? "status_check_failed");
  }
  return data.status;
}

export function LoginForm({
  content,
  previewMode = false,
}: {
  content: CmsPageContent;
  previewMode?: boolean;
}) {
  const router = useRouter();
  const formCopy = getCmsSection(content, "auth.login", "loginForm");
  const recoveryCopy = getCmsSection(content, "auth.login", "recovery");
  const messages = content.messages;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [findName, setFindName] = useState("");
  const [findPhone, setFindPhone] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [autoLogin, setAutoLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting">("idle");
  const [recoveryStatus, setRecoveryStatus] = useState<
    "idle" | "finding-email" | "resetting-password"
  >("idle");
  const [recoveryMode, setRecoveryMode] = useState<"email" | "password" | null>(
    null
  );
  const [error, setError] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (previewMode) return;
    setError("");

    if (!email.trim()) return setError(messages.emailRequired);
    if (!password) return setError(messages.passwordRequired);

    setStatus("submitting");
    const normalizedEmail = email.trim().toLowerCase();

    try {
      const auth = getFirebaseAuth();
      await setPersistence(
        auth,
        autoLogin ? browserLocalPersistence : browserSessionPersistence
      );

      const credential = await signInWithEmailAndPassword(
        auth,
        normalizedEmail,
        password,
      );
      const tokenResult = await credential.user.getIdTokenResult(true);
      if (tokenResult.claims.admin === true) {
        router.push("/admin");
        router.refresh();
        return;
      }

      const memberStatus = await getMemberStatus();
      if (memberStatus !== "active") {
        router.push("/pending-approval");
        router.refresh();
        return;
      }
      router.push("/mypage");
      router.refresh();
    } catch (err) {
      setError(getFirebaseMessage(err, messages));
    } finally {
      setStatus("idle");
    }
  };

  const findEmail = async () => {
    setRecoveryMessage(null);
    if (previewMode) return;
    if (!findName.trim()) {
      setRecoveryMessage({ tone: "error", text: messages.findNameRequired });
      return;
    }
    if (!findPhone.trim()) {
      setRecoveryMessage({ tone: "error", text: messages.findPhoneRequired });
      return;
    }

    setRecoveryStatus("finding-email");
    try {
      const res = await fetch("/api/auth/find-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: findName,
          phone: normalizeKrMobilePhone(findPhone),
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        maskedEmail?: string;
        error?: string;
      } | null;
      if (!res.ok || !data?.ok || !data.maskedEmail) {
        throw new Error(data?.error ?? "find_email_failed");
      }
      setRecoveryMessage({
        tone: "success",
        text: `${messages.findSuccessPrefix} ${data.maskedEmail} ${messages.findSuccessSuffix}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setRecoveryMessage({
        tone: "error",
        text:
          message === "invalid_phone"
            ? messages.findInvalidPhone
            : messages.findNotFound,
      });
    } finally {
      setRecoveryStatus("idle");
    }
  };

  const resetPassword = async () => {
    setRecoveryMessage(null);
    if (previewMode) return;
    const targetEmail = resetEmail.trim().toLowerCase();
    if (!targetEmail) {
      setRecoveryMessage({ tone: "error", text: messages.emailRequired });
      return;
    }

    setRecoveryStatus("resetting-password");
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), targetEmail);
      setRecoveryMessage({
        tone: "success",
        text: messages.resetSuccess,
      });
    } catch (err) {
      setRecoveryMessage({
        tone: "error",
        text:
          err instanceof FirebaseError && err.code === "auth/invalid-email"
            ? messages.resetInvalidEmail
            : messages.resetFailed,
      });
    } finally {
      setRecoveryStatus("idle");
    }
  };

  return (
    <form className="login-form" onSubmit={submit} noValidate>
      <label className="login-form__field">
        <span>{formCopy.text.emailLabel}</span>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={formCopy.text.emailPlaceholder}
        />
      </label>

      <label className="login-form__field">
        <span>{formCopy.text.passwordLabel}</span>
        <span className="login-form__password">
          <input
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={formCopy.text.passwordPlaceholder}
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={
              showPassword
                ? formCopy.text.hidePasswordLabel
                : formCopy.text.showPasswordLabel
            }
            aria-pressed={showPassword}
          >
            {showPassword
              ? formCopy.text.hideLabel
              : formCopy.text.showLabel}
          </button>
        </span>
      </label>

      <div className="login-form__meta">
        <label>
          <input
            type="checkbox"
            checked={autoLogin}
            onChange={(event) => setAutoLogin(event.target.checked)}
          />
          <span>{formCopy.text.autoLoginLabel}</span>
        </label>
        <a
          href={formCopy.actions[0]?.href ?? "/signup"}
          onClick={previewMode ? (event) => event.preventDefault() : undefined}
        >
          {formCopy.text.signupLabel}
        </a>
      </div>

      {error && (
        <p className="login-form__error" role="alert">
          {error}
        </p>
      )}

      <button className="login-form__submit" type="submit" disabled={status === "submitting"}>
        {status === "submitting"
          ? formCopy.text.submittingLabel
          : formCopy.text.submitLabel}
      </button>

      <p className="login-form__hint">
        {formCopy.text.hint}
      </p>

      <div className="login-recovery">
        <div
          className="login-recovery__links"
          aria-label={recoveryCopy.text.ariaLabel}
        >
          <button
            type="button"
            onClick={() => {
              setRecoveryMode((mode) => (mode === "email" ? null : "email"));
              setRecoveryMessage(null);
            }}
          >
            {recoveryCopy.text.findEmailLabel}
          </button>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => {
              setRecoveryMode((mode) =>
                mode === "password" ? null : "password"
              );
              setRecoveryMessage(null);
              setResetEmail(email);
            }}
          >
            {recoveryCopy.text.resetPasswordLabel}
          </button>
        </div>

        {recoveryMode === "email" && (
          <div className="login-recovery__panel">
            <label>
              <span>{recoveryCopy.text.nameLabel}</span>
              <input
                value={findName}
                onChange={(event) => setFindName(event.target.value)}
                placeholder={recoveryCopy.text.namePlaceholder}
              />
            </label>
            <label>
              <span>{recoveryCopy.text.phoneLabel}</span>
              <input
                value={findPhone}
                onChange={(event) =>
                  setFindPhone(formatKrMobilePhoneInput(event.target.value))
                }
                inputMode="tel"
                maxLength={KR_MOBILE_PHONE_MAX_INPUT_LENGTH}
                placeholder={recoveryCopy.text.phonePlaceholder}
              />
            </label>
            <button
              type="button"
              onClick={findEmail}
              disabled={recoveryStatus === "finding-email"}
            >
              {recoveryStatus === "finding-email"
                ? recoveryCopy.text.findingLabel
                : recoveryCopy.text.findSubmitLabel}
            </button>
          </div>
        )}

        {recoveryMode === "password" && (
          <div className="login-recovery__panel">
            <label>
              <span>{recoveryCopy.text.resetEmailLabel}</span>
              <input
                type="email"
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
                placeholder={recoveryCopy.text.resetEmailPlaceholder}
              />
            </label>
            <button
              type="button"
              onClick={resetPassword}
              disabled={recoveryStatus === "resetting-password"}
            >
              {recoveryStatus === "resetting-password"
                ? recoveryCopy.text.resettingLabel
                : recoveryCopy.text.resetSubmitLabel}
            </button>
          </div>
        )}

        {recoveryMessage && (
          <p
            className={`login-recovery__message login-recovery__message--${recoveryMessage.tone}`}
            role="status"
          >
            {recoveryMessage.text}
          </p>
        )}
      </div>
    </form>
  );
}
