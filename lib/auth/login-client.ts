"use client";

import {
  browserLocalPersistence,
  browserSessionPersistence,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
} from "firebase/auth";
import type {
  AuthenticatedAccountContext,
  PortalSessionResponse,
  PortalType,
} from "@/lib/auth/portal";
import { getFirebaseAuth } from "@/lib/firebase/client";

export type PortalLoginResult =
  | {
      ok: true;
      account: AuthenticatedAccountContext;
      redirectPath: string;
    }
  | {
      ok: false;
      reason: "portal_mismatch";
      redirectPath: string;
    };

export class PortalLoginError extends Error {
  readonly code: "account_unavailable" | "authentication_failed";

  constructor(code: "account_unavailable" | "authentication_failed") {
    super(code);
    this.name = "PortalLoginError";
    this.code = code;
  }
}

async function clearClientAuthentication() {
  try {
    await signOut(getFirebaseAuth());
  } catch {
    // The server session is not issued on this path. A later auth observer can
    // retry the local cleanup without exposing the underlying provider error.
  }
}

export async function loginWithEmailAndPassword(input: {
  email: string;
  password: string;
  rememberMe: boolean;
  expectedPortal: PortalType;
}): Promise<PortalLoginResult> {
  const auth = getFirebaseAuth();
  await setPersistence(
    auth,
    input.rememberMe
      ? browserLocalPersistence
      : browserSessionPersistence,
  );

  const credential = await signInWithEmailAndPassword(
    auth,
    input.email.trim().toLowerCase(),
    input.password,
  );
  const idToken = await credential.user.getIdToken(true);
  let response: Response;
  try {
    response = await fetch("/api/auth/portal-session", {
      method: "POST",
      headers: {
        authorization: `Bearer ${idToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        expectedPortal: input.expectedPortal,
        rememberMe: input.rememberMe,
      }),
    });
  } catch {
    await clearClientAuthentication();
    throw new PortalLoginError("authentication_failed");
  }
  const data = (await response.json().catch(() => null)) as
    | PortalSessionResponse
    | null;

  if (
    response.status === 403 &&
    data &&
    !data.ok &&
    data.error === "portal_mismatch" &&
    data.redirectPath
  ) {
    return {
      ok: false,
      reason: "portal_mismatch",
      redirectPath: data.redirectPath,
    };
  }

  if (
    !response.ok ||
    !data ||
    !data.ok ||
    !data.redirectPath
  ) {
    await clearClientAuthentication();
    if (data && !data.ok && data.error === "account_unavailable") {
      throw new PortalLoginError("account_unavailable");
    }
    throw new PortalLoginError("authentication_failed");
  }

  return {
    ok: true,
    account: data.account,
    redirectPath: data.redirectPath,
  };
}

export async function logoutPortalSession() {
  const auth = getFirebaseAuth();
  let serverError: unknown;

  try {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
    });
    if (!response.ok) {
      serverError = new Error("portal_logout_failed");
    }
  } catch (error) {
    serverError = error;
  }

  try {
    await signOut(auth);
  } catch (clientError) {
    throw clientError;
  }

  if (serverError) throw serverError;
}
