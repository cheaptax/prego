import { CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";
import type { CmsPageKey } from "@/lib/cms/constants";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";

export function getCmsSection(
  content: CmsPageContent,
  pageKey: CmsPageKey,
  sectionId: string,
): CmsSection {
  const section =
    content.sections.find((candidate) => candidate.id === sectionId) ??
    CMS_PAGE_DEFAULTS[pageKey].sections.find(
      (candidate) => candidate.id === sectionId,
    );
  if (!section) {
    throw new Error(`missing_cms_section:${pageKey}:${sectionId}`);
  }
  return section;
}

export function getCmsMessage(
  content: CmsPageContent,
  pageKey: CmsPageKey,
  key: string,
) {
  return (
    content.messages[key] ??
    CMS_PAGE_DEFAULTS[pageKey].messages[key] ??
    ""
  );
}
