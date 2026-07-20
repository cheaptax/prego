import type { Metadata } from "next";
import { BoardPageRenderer } from "@/components/BoardPageRenderer";
import { Footer } from "@/components/Footer";
import { Topbar } from "@/components/Topbar";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("public.faq");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

export default async function FaqPage() {
  const { content } = await loadPublishedCmsPage("public.faq");
  return (
    <>
      <Topbar />
      <BoardPageRenderer pageKey="public.faq" content={content} />
      <Footer />
    </>
  );
}
