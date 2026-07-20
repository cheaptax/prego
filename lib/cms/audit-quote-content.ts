import { CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";

const PAGE_KEY = "event.auditQuote" as const;
const REQUIRED_SECTION_IDS = ["intakeForm", "legalNotice"] as const;

export function normalizeAuditQuoteCmsContent(
  input: CmsPageContent,
): CmsPageContent {
  const defaults = CMS_PAGE_DEFAULTS[PAGE_KEY];
  const defaultById = new Map(
    defaults.sections.map((section) => [section.id, section]),
  );
  const seenIds = new Set<string>();

  const mergeSection = (
    fallback: CmsSection,
    current: CmsSection,
  ): CmsSection => {
    const required = (REQUIRED_SECTION_IDS as readonly string[]).includes(
      fallback.id,
    );
    return {
      ...fallback,
      ...current,
      visible: required ? true : current.visible,
      locked: required ? true : current.locked,
      text: { ...fallback.text, ...current.text },
      items:
        fallback.items.length > 0 && current.items.length === 0
          ? structuredClone(fallback.items)
          : current.items,
      actions:
        fallback.actions.length > 0 && current.actions.length === 0
          ? structuredClone(fallback.actions)
          : current.actions,
      groups:
        fallback.groups.length > 0 && current.groups.length === 0
          ? structuredClone(fallback.groups)
          : current.groups,
      style: {
        ...fallback.style,
        ...current.style,
        title: { ...fallback.style.title, ...current.style.title },
        body: { ...fallback.style.body, ...current.style.body },
        container: {
          ...fallback.style.container,
          ...current.style.container,
        },
      },
    };
  };

  const sections = input.sections.map((current): CmsSection => {
    seenIds.add(current.id);
    const fallback = defaultById.get(current.id);
    return fallback ? mergeSection(fallback, current) : current;
  });

  for (const fallback of defaults.sections) {
    if (!seenIds.has(fallback.id)) sections.push(structuredClone(fallback));
  }

  return {
    ...input,
    seo: { ...defaults.seo, ...input.seo },
    sections,
    messages: { ...defaults.messages, ...input.messages },
  };
}
