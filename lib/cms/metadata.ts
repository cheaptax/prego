import type { Metadata } from "next";
import type { CmsPageContent } from "@/lib/cms/schemas";

export function cmsPageMetadata(
  content: CmsPageContent,
  assetUrls: Record<string, string> = {},
): Metadata {
  const imageId = content.seo.ogImageAssetId;
  const image = imageId ? assetUrls[imageId] : undefined;
  return {
    title: content.seo.title,
    description: content.seo.description,
    robots: content.seo.indexable
      ? { index: true, follow: true }
      : { index: false, follow: false },
    openGraph: image
      ? {
          title: content.seo.title,
          description: content.seo.description,
          images: [{ url: image }],
        }
      : undefined,
  };
}
