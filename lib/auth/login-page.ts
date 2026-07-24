import type { PortalType } from "@/lib/auth/portal";
import type { CmsPageKey } from "@/lib/cms/constants";

export type PortalLoginPageKey =
  | "auth.login"
  | "auth.partnerLogin"
  | "auth.adminLogin";

export type PortalLoginPageConfig = {
  expectedPortal: PortalType;
  legacyCrossPortal: boolean;
  showEmailLookup: boolean;
};

export const PORTAL_LOGIN_PAGE_CONFIG: Record<
  PortalLoginPageKey,
  PortalLoginPageConfig
> = {
  "auth.login": {
    expectedPortal: "customer",
    legacyCrossPortal: true,
    showEmailLookup: true,
  },
  "auth.partnerLogin": {
    expectedPortal: "partner",
    legacyCrossPortal: false,
    showEmailLookup: false,
  },
  "auth.adminLogin": {
    expectedPortal: "admin",
    legacyCrossPortal: false,
    showEmailLookup: false,
  },
};

export function isPortalLoginPageKey(
  pageKey: CmsPageKey,
): pageKey is PortalLoginPageKey {
  return pageKey in PORTAL_LOGIN_PAGE_CONFIG;
}

export function getPortalLoginPageConfig(
  pageKey: PortalLoginPageKey,
) {
  return PORTAL_LOGIN_PAGE_CONFIG[pageKey];
}
