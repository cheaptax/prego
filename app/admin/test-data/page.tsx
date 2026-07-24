import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TestDataManagement } from "@/components/TestDataManagement";
import { requirePortalPageSession } from "@/lib/auth/portal-page-guard";
import { getPortalAccessDeniedPath } from "@/lib/auth/portal-routes";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("admin.operations");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

export default async function TestDataManagementPage() {
  const account = await requirePortalPageSession("admin");
  if (account.role !== "super_admin") {
    redirect(getPortalAccessDeniedPath("admin"));
  }
  const { content } = await loadPublishedCmsPage("admin.operations");
  return (
    <main id="main" className="admin-app">
      <TestDataManagement content={content} adminEmail={account.email} />
    </main>
  );
}
