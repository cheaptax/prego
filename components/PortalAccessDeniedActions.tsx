"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { logoutPortalSession } from "@/lib/auth/login-client";

type Props = {
  homePath?: string;
  loginPath: string;
  homeLabel: string;
  loginLabel: string;
  logoutLabel: string;
  logoutFailedMessage: string;
};

export function PortalAccessDeniedActions({
  homePath,
  loginPath,
  homeLabel,
  loginLabel,
  logoutLabel,
  logoutFailedMessage,
}: Props) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutFailed(false);
    try {
      await logoutPortalSession();
      router.replace(loginPath);
      router.refresh();
    } catch {
      setLogoutFailed(true);
      setLoggingOut(false);
    }
  }

  return (
    <>
      <Link
        className="login-card__primary"
        href={homePath ?? loginPath}
      >
        {homePath ? homeLabel : loginLabel}
      </Link>
      <button
        className="login-card__ghost"
        disabled={loggingOut}
        onClick={handleLogout}
        type="button"
      >
        {logoutLabel}
      </button>
      {logoutFailed ? (
        <p className="login-form__error" role="alert">
          {logoutFailedMessage}
        </p>
      ) : null}
    </>
  );
}
