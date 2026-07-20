import type { Metadata } from "next";
import { CmsAdminConsole } from "@/components/CmsAdminConsole";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("admin.console");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

export default async function AdminPage() {
  const { content } = await loadPublishedCmsPage("admin.console");
  return (
    <div className="admin-app">
      <CmsAdminConsole content={content} />
    </div>
  );
}
