import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AccountContextResolutionError } from "@/lib/auth/account-context";
import {
  getLoginPathForPortal,
  getPortalHomePath,
  getPortalMismatchResult,
  getPostLoginPath,
  type AuthenticatedAccountContext,
  type PortalType,
} from "@/lib/auth/portal";
import { getPortalAccessDeniedPath } from "@/lib/auth/portal-routes";
import { resolveSessionAccountContext } from "@/lib/auth/portal-server";
import { PORTAL_SESSION_COOKIE } from "@/lib/auth/session";

async function readSessionAccount() {
  const cookieStore = await cookies();
  const sessionCookie =
    cookieStore.get(PORTAL_SESSION_COOKIE)?.value ?? "";
  if (!sessionCookie) return null;
  return resolveSessionAccountContext(sessionCookie);
}

export async function requirePortalPageSession(
  expectedPortal: PortalType,
  options?: { allowQuoteOnlyCustomer?: boolean },
): Promise<AuthenticatedAccountContext> {
  let account: AuthenticatedAccountContext | null;
  try {
    account = await readSessionAccount();
  } catch (error) {
    if (error instanceof AccountContextResolutionError) {
      redirect(getPortalAccessDeniedPath(expectedPortal));
    }
    redirect(getLoginPathForPortal(expectedPortal));
  }

  if (!account) {
    redirect(getLoginPathForPortal(expectedPortal));
  }

  const access = getPortalMismatchResult(account, expectedPortal);
  if (access.allowed) {
    if (
      account.customerAccessLevel === "QUOTE_ONLY" &&
      !options?.allowQuoteOnlyCustomer
    ) {
      redirect("/mypage/quotes");
    }
    return account;
  }
  if (access.reason === "approval_pending" && access.redirectPath) {
    redirect(access.redirectPath);
  }
  redirect(getPortalAccessDeniedPath(expectedPortal));
}

export type PortalAccessDeniedNavigation = {
  homePath?: string;
  loginPath: string;
};

export async function getPortalAccessDeniedNavigation(
  requestedPortal: PortalType,
): Promise<PortalAccessDeniedNavigation> {
  try {
    const account = await readSessionAccount();
    if (!account) {
      return {
        loginPath: getLoginPathForPortal(requestedPortal),
      };
    }
    return {
      homePath:
        getPostLoginPath(account) ??
        (account.status === "ACTIVE"
          ? getPortalHomePath(account)
          : undefined),
      loginPath: getLoginPathForPortal(account.defaultPortal),
    };
  } catch {
    return {
      loginPath: getLoginPathForPortal(requestedPortal),
    };
  }
}
