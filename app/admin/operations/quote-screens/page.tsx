import type { Metadata } from "next";
import { QuoteScreenTemplateWorkspace } from "@/components/admin/QuoteScreenTemplateWorkspace";
import { requirePortalPageSession } from "@/lib/auth/portal-page-guard";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("admin.operations");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

export default async function AdminQuoteScreensPage() {
  await requirePortalPageSession("admin");
  const { content } = await loadPublishedCmsPage("admin.operations");
  return (
    <main id="main" className="admin-app">
      <QuoteScreenTemplateWorkspace content={content} />
    </main>
  );
}
