import { CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";

export const ADMIN_OPERATION_TAB_IDS = [
  "overview",
  "members",
  "partners",
  "inquiries",
  "auditQuotes",
  "auditEvaluations",
  "points",
  "audit",
] as const;

export type AdminOperationTabId = (typeof ADMIN_OPERATION_TAB_IDS)[number];

const TAB_DESCRIPTIONS: Record<AdminOperationTabId, string> = {
  overview: "overviewDescription",
  members: "membersDescription",
  partners: "partnersDescription",
  inquiries: "inquiriesDescription",
  auditQuotes: "auditQuotesDescription",
  auditEvaluations: "auditEvaluationsDescription",
  points: "pointsDescription",
  audit: "auditDescription",
};

export const ADMIN_REQUEST_STATUS_FILTERS = [
  { id: "all", value: "" },
  { id: "submitted", value: "SUBMITTED" },
  { id: "answered", value: "ANSWERED" },
  { id: "published", value: "ANSWER_PUBLISHED" },
  { id: "followup", value: "FOLLOWUP" },
  { id: "completed", value: "COMPLETED" },
] as const;

export const ADMIN_VISIBILITY_FILTERS = [
  { id: "all", value: "" },
  { id: "public", value: "PUBLIC" },
  { id: "organization", value: "ORG_ONLY" },
  { id: "private", value: "PRIVATE" },
] as const;

export const ADMIN_FAQ_PUBLIC_FILTERS = [
  { id: "all", value: "" },
  { id: "public", value: "public" },
  { id: "private", value: "private" },
] as const;

export const ADMIN_FAQ_DISPLAY_FILTERS = [
  { id: "all", value: "" },
  { id: "published", value: "published" },
  { id: "draft", value: "draft" },
] as const;

export const ADMIN_AUDIT_QUOTE_FILTERS = [
  { id: "all", value: "all" },
  { id: "received", value: "received" },
  { id: "contacting", value: "contacting" },
  { id: "qualified", value: "qualified" },
  { id: "infoComplete", value: "info_complete" },
  { id: "quotesRequested", value: "quotes_requested" },
  { id: "delivered", value: "delivered" },
  { id: "reportDelivered", value: "report_delivered" },
  { id: "closed", value: "closed" },
  { id: "invalid", value: "invalid" },
] as const;

export const ADMIN_FAQ_CATEGORY_IDS = [
  "general",
  "signup",
  "inquiry",
  "points",
  "settlement",
  "other",
] as const;

export const ADMIN_FAQ_CATEGORIES = [
  { id: "general", value: "일반" },
  { id: "signup", value: "회원가입" },
  { id: "inquiry", value: "문의 진행" },
  { id: "points", value: "포인트" },
  { id: "settlement", value: "정산" },
  { id: "other", value: "기타" },
] as const;

function sectionById(content: CmsPageContent, sectionId: string) {
  const fallback = CMS_PAGE_DEFAULTS["admin.operations"].sections.find(
    (section) => section.id === sectionId,
  );
  const current = content.sections.find((section) => section.id === sectionId);
  return { current, fallback };
}

function textValue(
  current: CmsSection | undefined,
  fallback: CmsSection | undefined,
  key: string,
) {
  return current?.text[key]?.trim() || fallback?.text[key] || "";
}

type AdminOperationsSectionCopy = {
  title: string;
  description: string;
  text: (key: string) => string;
  item: (itemId: string) => string;
};

export function createAdminOperationsCopy(content: CmsPageContent) {
  const sectionCache = new Map<string, AdminOperationsSectionCopy>();
  return {
    section(sectionId: string) {
      const cached = sectionCache.get(sectionId);
      if (cached) return cached;
      const { current, fallback } = sectionById(content, sectionId);
      const section = {
        title: current?.title?.trim() || fallback?.title || "",
        description:
          current?.description?.trim() || fallback?.description || "",
        text(key: string) {
          return textValue(current, fallback, key);
        },
        item(itemId: string) {
          const item =
            current?.items.find(
              (candidate) =>
                candidate.id === itemId &&
                candidate.visible &&
                !candidate.deleted,
            ) ?? fallback?.items.find((candidate) => candidate.id === itemId);
          return item?.title ?? itemId;
        },
      };
      sectionCache.set(sectionId, section);
      return section;
    },
    message(key: string) {
      return (
        content.messages[key]?.trim() ||
        CMS_PAGE_DEFAULTS["admin.operations"].messages[key] ||
        ""
      );
    },
    tabs: ADMIN_OPERATION_TAB_IDS.map((id) => {
      const navigation = sectionById(content, "navigation");
      const current = navigation.current?.items.find(
        (item) => item.id === id && item.visible && !item.deleted,
      );
      const fallback = navigation.fallback?.items.find((item) => item.id === id);
      return {
        key: id,
        label: current?.title ?? fallback?.title ?? id,
        description: textValue(
          navigation.current,
          navigation.fallback,
          TAB_DESCRIPTIONS[id],
        ),
      };
    }),
  };
}

export type AdminOperationsCopy = ReturnType<
  typeof createAdminOperationsCopy
>;

export function formatAdminOperationsMessage(
  template: string,
  values: Readonly<Record<string, string | number>>,
) {
  return Object.entries(values).reduce(
    (message, [key, value]) =>
      message.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
