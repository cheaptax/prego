import type { Metadata } from "next";
import { AdminDashboard } from "@/components/AdminDashboard";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("admin.operations");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

export default async function AdminOperationsPage() {
  const { content } = await loadPublishedCmsPage("admin.operations");
  return (
    <main id="main" className="admin-app">
      <AdminDashboard content={content} />
    </main>
  );
}
