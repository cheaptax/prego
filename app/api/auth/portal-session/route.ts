import { NextResponse } from "next/server";
import { AccountContextResolutionError } from "@/lib/auth/account-context";
import {
  getPortalHomePath,
  getPortalMismatchResult,
  isPortalType,
  type PortalSessionResponse,
} from "@/lib/auth/portal";
import { resolveAccountContext } from "@/lib/auth/portal-server";
import {
  PORTAL_PERSISTENT_SESSION_DURATION_MS,
  PORTAL_SESSION_COOKIE,
  PORTAL_SESSION_DURATION_MS,
} from "@/lib/auth/session";
import { adminAuth } from "@/lib/firebase/admin";
import {
  AdminAuthorizationError,
  getBearerToken,
} from "@/lib/firebase/server";

export const runtime = "nodejs";

function json(
  body: PortalSessionResponse,
  init?: { status?: number },
) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      "cache-control": "no-store",
    },
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      expectedPortal?: unknown;
      rememberMe?: unknown;
    } | null;
    if (
      !body ||
      !isPortalType(body.expectedPortal) ||
      typeof body.rememberMe !== "boolean"
    ) {
      return json(
        { ok: false, error: "invalid_request" },
        { status: 400 },
      );
    }

    const account = await resolveAccountContext(req);
    const access = getPortalMismatchResult(
      account,
      body.expectedPortal,
    );

    if (access.reason === "account_unavailable") {
      return json(
        { ok: false, error: "account_unavailable" },
        { status: 403 },
      );
    }

    const idToken = getBearerToken(req);
    const expiresIn = body.rememberMe
      ? PORTAL_PERSISTENT_SESSION_DURATION_MS
      : PORTAL_SESSION_DURATION_MS;
    const sessionCookie = await adminAuth().createSessionCookie(
      idToken,
      { expiresIn },
    );

    const response =
      access.reason === "portal_mismatch"
        ? json(
            {
              ok: false,
              error: "portal_mismatch",
              redirectPath: access.redirectPath ?? undefined,
            },
            { status: 403 },
          )
        : json({
            ok: true,
            account,
            redirectPath:
              access.redirectPath ??
              getPortalHomePath(account),
          });

    response.cookies.set({
      name: PORTAL_SESSION_COOKIE,
      value: sessionCookie,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      ...(body.rememberMe
        ? { maxAge: Math.floor(expiresIn / 1000) }
        : {}),
    });
    return response;
  } catch (error) {
    if (error instanceof AdminAuthorizationError) {
      return json(
        { ok: false, error: "authentication_failed" },
        { status: error.status },
      );
    }
    if (error instanceof AccountContextResolutionError) {
      return json(
        { ok: false, error: "account_unavailable" },
        { status: 403 },
      );
    }
    return json(
      { ok: false, error: "authentication_failed" },
      { status: 500 },
    );
  }
}
