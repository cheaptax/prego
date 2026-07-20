import { CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";

export const ADMIN_CONSOLE_MENU_MAP = [
  { id: "dashboard", value: "dashboard", icon: "⌂" },
  { id: "pages", value: "pages", icon: "▤" },
  { id: "globals", value: "globals", icon: "⌘" },
  { id: "design", value: "design", icon: "◐" },
  { id: "assets", value: "assets", icon: "▧" },
  { id: "history", value: "history", icon: "↺" },
] as const;

export const ADMIN_CONSOLE_PAGE_FILTER_MAP = [
  { id: "filter.all", value: "all" },
  { id: "filter.public", value: "public" },
  { id: "filter.auth", value: "auth" },
  { id: "filter.member", value: "member" },
  { id: "filter.event", value: "event" },
  { id: "filter.admin", value: "admin" },
  { id: "filter.other", value: "other" },
] as const;

export const ADMIN_CONSOLE_MENU_IDS = ADMIN_CONSOLE_MENU_MAP.map(
  ({ id }) => id,
);
export const ADMIN_CONSOLE_PAGE_FILTER_IDS =
  ADMIN_CONSOLE_PAGE_FILTER_MAP.map(({ id }) => id);

export type AdminConsoleMenuKey =
  (typeof ADMIN_CONSOLE_MENU_MAP)[number]["value"];
export type AdminConsolePageFilter =
  (typeof ADMIN_CONSOLE_PAGE_FILTER_MAP)[number]["value"];

function sectionById(content: CmsPageContent, sectionId: string) {
  const fallback = CMS_PAGE_DEFAULTS["admin.console"].sections.find(
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

function itemValue(
  current: CmsSection | undefined,
  fallback: CmsSection | undefined,
  itemId: string,
) {
  const currentItem = current?.items.find(
    (candidate) =>
      candidate.id === itemId &&
      candidate.visible &&
      !candidate.deleted,
  );
  const fallbackItem = fallback?.items.find(
    (candidate) => candidate.id === itemId,
  );
  const item = currentItem ?? fallbackItem;
  return {
    id: itemId,
    title: item?.title?.trim() || fallbackItem?.title || itemId,
    description:
      item?.description?.trim() || fallbackItem?.description || "",
    value: item?.value?.trim() || fallbackItem?.value || "",
  };
}

export function createAdminConsoleCopy(content: CmsPageContent) {
  return {
    section(sectionId: string) {
      const { current, fallback } = sectionById(content, sectionId);
      return {
        title: current?.title?.trim() || fallback?.title || "",
        description:
          current?.description?.trim() || fallback?.description || "",
        text(key: string) {
          return textValue(current, fallback, key);
        },
        item(itemId: string) {
          return itemValue(current, fallback, itemId);
        },
      };
    },
    message(key: string) {
      return (
        content.messages[key]?.trim() ||
        CMS_PAGE_DEFAULTS["admin.console"].messages[key] ||
        ""
      );
    },
    menus: ADMIN_CONSOLE_MENU_MAP.map(({ id, value, icon }) => {
      const navigation = sectionById(content, "navigation");
      return {
        key: value,
        icon,
        ...itemValue(navigation.current, navigation.fallback, id),
      };
    }),
    pageFilters: ADMIN_CONSOLE_PAGE_FILTER_MAP.map(({ id, value }) => {
      const pages = sectionById(content, "pages");
      return {
        id,
        value,
        label: itemValue(pages.current, pages.fallback, id).title,
      };
    }),
  };
}

export type AdminConsoleCopy = ReturnType<typeof createAdminConsoleCopy>;
