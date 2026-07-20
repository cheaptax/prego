import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { Topbar } from "@/components/Topbar";
import { CmsSimplePage } from "@/components/CmsSimplePage";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("partner.portal");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

export default async function PartnerPage() {
  const { content } = await loadPublishedCmsPage("partner.portal");
  return (
    <>
      <Topbar />
      <CmsSimplePage pageKey="partner.portal" content={content} />
      <Footer />
    </>
  );
}
