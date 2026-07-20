import type { Metadata } from "next";
import { Topbar } from "@/components/Topbar";
import { Footer } from "@/components/Footer";
import { CmsSimplePage } from "@/components/CmsSimplePage";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("auth.pendingApproval");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

export default async function PendingApprovalPage() {
  const { content } = await loadPublishedCmsPage("auth.pendingApproval");
  return (
    <>
      <Topbar />
      <CmsSimplePage pageKey="auth.pendingApproval" content={content} />
      <Footer />
    </>
  );
}
