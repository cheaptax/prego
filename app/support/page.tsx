import type { Metadata } from "next";
import { Topbar } from "@/components/Topbar";
import { Footer } from "@/components/Footer";
import { CmsSimplePage } from "@/components/CmsSimplePage";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("public.support");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

export default async function SupportPage() {
  const { content } = await loadPublishedCmsPage("public.support");
  return (
    <>
      <Topbar />
      <CmsSimplePage pageKey="public.support" content={content} />
      <Footer />
    </>
  );
}
