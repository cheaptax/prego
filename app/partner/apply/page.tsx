import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { PartnerApplicationForm } from "@/components/PartnerApplicationForm";
import { Topbar } from "@/components/Topbar";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("partner.apply");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

export default async function PartnerApplyPage() {
  const { content } = await loadPublishedCmsPage("partner.apply");
  return (
    <>
      <Topbar />
      <PartnerApplicationForm content={content} />
      <Footer />
    </>
  );
}
