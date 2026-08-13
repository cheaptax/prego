import type { Metadata } from "next";
import { AdminDashboard } from "@/components/AdminDashboard";
import { requirePortalPageSession } from "@/lib/auth/portal-page-guard";
import { getServerFeatureFlags } from "@/lib/audit-evaluation/feature-flags";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";
import { buildPortalSitemap } from "@/lib/sitemap/portal-sitemap";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("admin.operations");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

export default async function AdminOperationsPage() {
  const account = await requirePortalPageSession("admin");
  const { content } = await loadPublishedCmsPage("admin.operations");
  const auditEvaluationFlags = getServerFeatureFlags().auditEvaluation;
  const auditEvaluationAdminEnabled =
    auditEvaluationFlags.enabled && auditEvaluationFlags.adminEnabled;
  const sitemap = buildPortalSitemap("admin", {
    isSuperAdmin: account.role === "super_admin",
  });
  return (
    <main id="main" className="admin-app">
      <AdminDashboard
        content={content}
        sitemap={sitemap}
        auditEvaluationAdminEnabled={auditEvaluationAdminEnabled}
        canManageTestData={account.role === "super_admin"}
      />
    </main>
  );
}
