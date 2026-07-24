"use client";

import {
  browserLocalPersistence,
  setPersistence,
  signInWithCustomToken,
  validatePassword,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { CmsPageContent } from "@/lib/cms/schemas";
import { getCmsSection } from "@/lib/cms/runtime";
import { getFirebaseAuth } from "@/lib/firebase/client";

export function TemporaryAccountActivationForm({
  content,
  token,
}: {
  content: CmsPageContent;
  token: string;
}) {
  const router = useRouter();
  const identityCopy = getCmsSection(content, "auth.signup", "identity");
  const submitCopy = getCmsSection(content, "auth.signup", "submit");
  const messages = content.messages;
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setError("");
    if (password.length < 8) {
      setError(messages.passwordMin);
      return;
    }
    if (password !== confirmation) {
      setError(messages.passwordMismatch);
      return;
    }
    setSubmitting(true);
    try {
      const auth = getFirebaseAuth();
      const policy = await validatePassword(auth, password);
      if (!policy.isValid) {
        setError(messages.passwordPolicyError);
        return;
      }
      const response = await fetch("/api/auth/temporary-account/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        customToken?: string;
        quoteId?: string;
        error?: string;
      } | null;
      if (!response.ok || !data?.ok || !data.customToken) {
        setError(
          data?.error === "invalid_or_expired_activation"
            ? messages.temporaryActivationInvalid
            : messages.temporaryActivationFailed,
        );
        return;
      }
      await setPersistence(auth, browserLocalPersistence);
      const credential = await signInWithCustomToken(auth, data.customToken);
      const idToken = await credential.user.getIdToken(true);
      const sessionResponse = await fetch("/api/auth/portal-session", {
        method: "POST",
        headers: {
          authorization: `Bearer ${idToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          expectedPortal: "customer",
          rememberMe: true,
        }),
      });
      if (!sessionResponse.ok) {
        setError(messages.temporaryActivationFailed);
        return;
      }
      router.replace(
        data.quoteId
          ? `/mypage/quotes/${encodeURIComponent(data.quoteId)}`
          : "/mypage/quotes",
      );
      router.refresh();
    } catch {
      setError(messages.temporaryActivationFailed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="temporary-account-title">
        <header className="auth-panel__head">
          <p className="eyebrow">Quote account</p>
          <h1 id="temporary-account-title">
            {submitCopy.text.temporaryActivationTitle}
          </h1>
          <p>{submitCopy.text.temporaryActivationDescription}</p>
        </header>
        <form className="auth-form" onSubmit={submit} noValidate>
          <label className="auth-field">
            <span className="auth-field__label">
              {identityCopy.text.passwordLabel}
            </span>
            <span className="auth-field__inputbox">
              <input
                className="auth-field__input auth-field__input--with-action"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={identityCopy.text.passwordPlaceholder}
              />
              <button
                type="button"
                className="auth-field__action"
                onClick={() => setShowPassword((value) => !value)}
                aria-pressed={showPassword}
              >
                {showPassword
                  ? identityCopy.text.hidePasswordLabel
                  : identityCopy.text.showPasswordLabel}
              </button>
            </span>
          </label>
          <label className="auth-field">
            <span className="auth-field__label">
              {identityCopy.text.passwordConfirmLabel}
            </span>
            <input
              className="auth-field__input"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              minLength={8}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={identityCopy.text.passwordConfirmPlaceholder}
            />
          </label>
          {error ? (
            <p className="login-form__error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            className="auth-submit"
            disabled={submitting}
          >
            {submitting
              ? submitCopy.text.temporaryActivationSubmittingLabel
              : submitCopy.text.temporaryActivationSubmitLabel}
          </button>
        </form>
      </section>
    </main>
  );
}
