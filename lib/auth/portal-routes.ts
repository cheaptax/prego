import {
  getLoginPathForPortal,
  type PortalType,
} from "@/lib/auth/portal";

export const PORTAL_ACCESS_DENIED_PATH = "/portal-access-denied";

const PUBLIC_PORTAL_PATHS = new Set([
  "/partner/login",
  "/partner/apply",
  "/admin/login",
]);

function isPathWithin(pathname: string, root: string) {
  return pathname === root || pathname.startsWith(`${root}/`);
}

export function getProtectedPortalForPath(
  pathname: string,
): PortalType | null {
  if (isPathWithin(pathname, "/mypage")) return "customer";
  if (
    isPathWithin(pathname, "/partner") &&
    !PUBLIC_PORTAL_PATHS.has(pathname)
  ) {
    return "partner";
  }
  if (
    isPathWithin(pathname, "/admin") &&
    !PUBLIC_PORTAL_PATHS.has(pathname)
  ) {
    return "admin";
  }
  return null;
}

export function getUnauthenticatedPortalRedirect(pathname: string) {
  const portal = getProtectedPortalForPath(pathname);
  return portal ? getLoginPathForPortal(portal) : null;
}

export function getPortalAccessDeniedPath(portal: PortalType) {
  return `${PORTAL_ACCESS_DENIED_PATH}?portal=${portal}`;
}
