import type { Metadata } from "next";
import { CmsSimplePage } from "@/components/CmsSimplePage";
import { Footer } from "@/components/Footer";
import { Topbar } from "@/components/Topbar";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("legal.terms");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

export default async function TermsPage() {
  const { content } = await loadPublishedCmsPage("legal.terms");
  return (
    <>
      <Topbar />
      <CmsSimplePage pageKey="legal.terms" content={content} />
      <Footer />
    </>
  );
}
