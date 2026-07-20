export const CMS_SCHEMA_VERSION = 1 as const;

export const CMS_COLLECTIONS = {
  publishedPages: "cmsPublishedPages",
  draftPages: "cmsDraftPages",
  publishedGlobals: "cmsPublishedGlobals",
  draftGlobals: "cmsDraftGlobals",
  pageRevisions: "cmsPageRevisions",
  globalRevisions: "cmsGlobalRevisions",
  auditLogs: "cmsAuditLogs",
  assets: "cmsAssets",
} as const;

export const CMS_PAGE_KEYS = [
  "home",
  "auth.login",
  "auth.signup",
  "auth.pendingApproval",
  "legal.terms",
  "legal.privacy",
  "public.consult",
  "public.inquiries",
  "public.faq",
  "public.support",
  "event.auditQuote",
  "member.mypage",
  "member.requestDetail",
  "partner.portal",
  "admin.console",
  "admin.operations",
  "framework.notFound",
] as const;

export const CMS_GLOBAL_KEYS = [
  "siteIdentity",
  "header",
  "footer",
  "support",
  "defaultSeo",
  "theme",
  "statusMessages",
  "adminPresentation",
] as const;

export const CMS_PUBLIC_GLOBAL_KEYS = [
  "siteIdentity",
  "header",
  "footer",
  "support",
] as const satisfies readonly (typeof CMS_GLOBAL_KEYS)[number][];

export type CmsPageKey = (typeof CMS_PAGE_KEYS)[number];
export type CmsGlobalKey = (typeof CMS_GLOBAL_KEYS)[number];

export const CMS_PAGE_ROUTES: Record<CmsPageKey, string> = {
  home: "/",
  "auth.login": "/login",
  "auth.signup": "/signup",
  "auth.pendingApproval": "/pending-approval",
  "legal.terms": "/terms",
  "legal.privacy": "/privacy",
  "public.consult": "/consult",
  "public.inquiries": "/inquiries",
  "public.faq": "/faq",
  "public.support": "/support",
  "event.auditQuote": "/events/audit-quote",
  "member.mypage": "/mypage",
  "member.requestDetail": "/mypage/requests/[requestId]",
  "partner.portal": "/partner",
  "admin.console": "/admin",
  "admin.operations": "/admin/operations",
  "framework.notFound": "/_not-found",
};

export const CMS_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;
export type CmsAllowedMimeType = (typeof CMS_ALLOWED_MIME_TYPES)[number];

export const CMS_MAX_ASSET_BYTES = 10 * 1024 * 1024;

export const CMS_COLOR_TOKENS = [
  "text",
  "muted",
  "primary",
  "white",
  "surface",
  "softBlue",
  "softGray",
  "softGreen",
  "softYellow",
] as const;

export const CMS_FONT_FAMILIES = [
  "pretendard",
  "system",
  "serif",
] as const;

export const CMS_TEXT_SIZE_PRESETS = ["small", "default", "large"] as const;
export const CMS_SPACING_PRESETS = ["compact", "default", "relaxed"] as const;

export type CmsColorToken = (typeof CMS_COLOR_TOKENS)[number];
