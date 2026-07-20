import type { Metadata } from "next";
import { CmsSimplePage } from "@/components/CmsSimplePage";
import { Footer } from "@/components/Footer";
import { Topbar } from "@/components/Topbar";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("legal.privacy");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

export default async function PrivacyPage() {
  const { content } = await loadPublishedCmsPage("legal.privacy");
  return (
    <>
      <Topbar />
      <CmsSimplePage pageKey="legal.privacy" content={content} />
      <Footer />
    </>
  );
}
