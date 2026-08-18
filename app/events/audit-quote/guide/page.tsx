import type { Metadata } from "next";
import { AuditQuoteGuidePage } from "@/components/AuditQuoteGuidePage";
import { Footer } from "@/components/Footer";
import { Topbar } from "@/components/Topbar";
import { createSampleAuditReportViewModel } from "@/lib/audit-quote/sample-audit-report";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("event.auditQuoteGuide");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

export default async function AuditQuoteGuideRoutePage() {
  const { content } = await loadPublishedCmsPage("event.auditQuoteGuide");
  const sampleReport = createSampleAuditReportViewModel();

  return (
    <>
      <Topbar />
      <AuditQuoteGuidePage content={content} sampleReport={sampleReport} />
      <Footer />
    </>
  );
}
