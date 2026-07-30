"use client";

import {
  CmsPageRenderer,
  type CmsPreviewDevice,
} from "@/components/cms-editor/CmsPageRenderer";
import type { CmsPageKey } from "@/lib/cms/constants";
import type { CmsSectionEditingOptions } from "@/lib/cms/editable-section";
import type { CmsPageContent } from "@/lib/cms/schemas";
import { getCmsSupplementalSections } from "@/lib/cms/section-lifecycle";

export function CmsSupplementalSections({
  pageKey,
  content,
  device = "desktop",
  assetUrls,
  editing = false,
  selectedSectionId,
  onSelectSection,
}: {
  pageKey: CmsPageKey;
  content: CmsPageContent;
  device?: CmsPreviewDevice;
  assetUrls?: Record<string, string>;
} & CmsSectionEditingOptions) {
  const sections = getCmsSupplementalSections(content, pageKey, {
    includeHidden: editing,
    includeDeleted: editing,
  });
  if (sections.length === 0) return null;
  return (
    <CmsPageRenderer
      content={{
        ...content,
        sections,
        messages: {},
      }}
      device={device}
      assetUrls={assetUrls}
      editing={editing}
      selectedSectionId={selectedSectionId}
      onSelectSection={onSelectSection}
    />
  );
}
