import { NextResponse, type NextRequest } from "next/server";
import { getUnauthenticatedPortalRedirect } from "@/lib/auth/portal-routes";
import { PORTAL_SESSION_COOKIE } from "@/lib/auth/session";

export function proxy(request: NextRequest) {
  const loginPath = getUnauthenticatedPortalRedirect(
    request.nextUrl.pathname,
  );
  if (!loginPath || request.cookies.has(PORTAL_SESSION_COOKIE)) {
    return NextResponse.next();
  }

  const destination = request.nextUrl.clone();
  destination.pathname = loginPath;
  destination.search = "";
  return NextResponse.redirect(destination);
}

export const config = {
  matcher: [
    "/mypage/:path*",
    "/partner/:path*",
    "/admin/:path*",
  ],
};
