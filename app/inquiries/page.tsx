import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { BoardPageRenderer } from "@/components/BoardPageRenderer";
import { Topbar } from "@/components/Topbar";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("public.inquiries");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

export default async function InquiriesPage() {
  const { content } = await loadPublishedCmsPage("public.inquiries");
  return (
    <>
      <Topbar />
      <BoardPageRenderer pageKey="public.inquiries" content={content} />
      <Footer />
    </>
  );
}
