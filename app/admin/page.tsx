import type { Metadata } from "next";
import { CmsAdminConsole } from "@/components/CmsAdminConsole";
import { requirePortalPageSession } from "@/lib/auth/portal-page-guard";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("admin.console");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

export default async function AdminPage() {
  const account = await requirePortalPageSession("admin");
  const { content } = await loadPublishedCmsPage("admin.console");
  return (
    <div className="admin-app">
      <CmsAdminConsole
        content={content}
        canManageTestData={account.role === "super_admin"}
      />
    </div>
  );
}
