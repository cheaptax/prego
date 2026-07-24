import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { Topbar } from "@/components/Topbar";
import { PartnerDashboard } from "@/components/PartnerDashboard";
import { requirePortalPageSession } from "@/lib/auth/portal-page-guard";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("partner.portal");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

export default async function PartnerPage() {
  await requirePortalPageSession("partner");
  const { content } = await loadPublishedCmsPage("partner.portal");
  return (
    <>
      <Topbar />
      <PartnerDashboard content={content} />
      <Footer showPortalLinks={false} />
    </>
  );
}
