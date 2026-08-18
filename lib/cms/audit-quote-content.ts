import { CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";

const PAGE_KEY = "event.auditQuote" as const;
const REQUIRED_SECTION_IDS = ["intakeForm", "legalNotice"] as const;
const STALE_FISCAL_YEAR_HELP = new Set([
  "회계감사 대상 사업연도 4자리를 입력해 주세요.",
  "이번 접수는 2027년도로 고정되어 있으며 변경할 수 없습니다.",
  "농협법 개정에 따라 2026년말 기준 자산총액 500억원 이상 농협은 2027년도의 재무제표에 대한 외부회계감사를 수감해야 합니다",
  "농협법 개정에 따라 2026년말 기준 자산총액 500억원 이상 농협은 2027년도의 재무제표에 대한 외부회계감사를 수감해야 합니다.",
]);

const STALE_REGULATION_NOTES = new Set([
  "농업협동조합법 시행령 입법예고 기준.",
]);

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
    const mergedText = { ...fallback.text, ...current.text };
    if (
      fallback.id === "intakeForm" &&
      STALE_FISCAL_YEAR_HELP.has(mergedText.fiscalYearHelp ?? "")
    ) {
      mergedText.fiscalYearHelp = fallback.text.fiscalYearHelp;
    }
    if (
      fallback.id === "legalNotice" &&
      STALE_REGULATION_NOTES.has(mergedText.regulationNote ?? "")
    ) {
      mergedText.regulationNote = fallback.text.regulationNote;
    }
    return {
      ...fallback,
      ...current,
      visible: required ? true : current.visible,
      locked: required ? true : current.locked,
      text: mergedText,
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

  const sections = input.sections.flatMap((current): CmsSection[] => {
    if (current.id === "faq") return [];
    seenIds.add(current.id);
    const fallback = defaultById.get(current.id);
    return [fallback ? mergeSection(fallback, current) : current];
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
