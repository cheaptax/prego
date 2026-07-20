import type { CmsSection } from "@/lib/cms/schemas";

export function activeCmsMediaAssetIds(
  sections: readonly CmsSection[],
): string[] {
  return sections.flatMap((section) =>
    section.media && !section.media.deleted
      ? [section.media.assetId]
      : [],
  );
}
