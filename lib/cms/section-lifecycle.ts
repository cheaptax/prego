import { CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";
import type { CmsPageKey } from "@/lib/cms/constants";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";

export function getCmsKnownSectionIds(pageKey: CmsPageKey): Set<string> {
  return new Set(CMS_PAGE_DEFAULTS[pageKey].sections.map((section) => section.id));
}

export function isCmsSectionActive(section: CmsSection) {
  return !section.deleted;
}

export function getCmsActiveSections(content: CmsPageContent) {
  return content.sections.filter(isCmsSectionActive);
}

export function getCmsSupplementalSections(
  content: CmsPageContent,
  pageKey: CmsPageKey,
  options: { includeHidden?: boolean; includeDeleted?: boolean } = {},
) {
  const knownIds = getCmsKnownSectionIds(pageKey);
  return content.sections.filter((section) => {
    if (knownIds.has(section.id)) return false;
    if (section.deleted && !options.includeDeleted) return false;
    if (!section.visible && !options.includeHidden) return false;
    return true;
  });
}

export function canSoftDeleteCmsSection(
  content: CmsPageContent,
  sectionId: string,
) {
  const section = content.sections.find((candidate) => candidate.id === sectionId);
  if (!section || section.locked || section.deleted) return false;
  const remaining = content.sections.filter(
    (candidate) => !candidate.deleted && candidate.id !== sectionId,
  );
  return remaining.length > 0;
}
