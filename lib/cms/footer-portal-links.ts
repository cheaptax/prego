import type { CmsLink } from "@/lib/cms/schemas";

export const FOOTER_PORTAL_NAVIGATION_LABEL =
  "제휴사 및 운영자 로그인";

export const FOOTER_PORTAL_LINK_DEFAULTS = {
  partnerLogin: {
    id: "partnerLogin",
    label: "제휴사 로그인",
    href: "/partner/login",
    linkType: "internal",
    appearance: "text",
    openInNewWindow: false,
  },
  operatorLogin: {
    id: "operatorLogin",
    label: "운영자 로그인",
    href: "/admin/login",
    linkType: "internal",
    appearance: "text",
    openInNewWindow: false,
  },
} satisfies Record<"partnerLogin" | "operatorLogin", CmsLink>;
