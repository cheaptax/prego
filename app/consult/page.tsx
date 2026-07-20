import type { Metadata } from "next";
import { Topbar } from "@/components/Topbar";
import { Footer } from "@/components/Footer";
import { ConsultPageRenderer } from "@/components/ConsultPageRenderer";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("public.consult");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

export default async function ConsultPage() {
  const { content } = await loadPublishedCmsPage("public.consult");
  return (
    <>
      <Topbar />
      <ConsultPageRenderer content={content} />
      <Footer />
    </>
  );
}
