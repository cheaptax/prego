import type { Metadata } from "next";
import { AuditEvaluationStartPage } from "@/components/AuditEvaluationCustomerPage";
import { Footer } from "@/components/Footer";
import { Topbar } from "@/components/Topbar";
import { isAuditEvaluationCustomerEntryOpen } from "@/lib/audit-evaluation/customer-page-access";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage(
    "event.auditQuoteEvaluate",
  );
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

export default async function AuditQuoteEvaluationStartRoute() {
  const { content } = await loadPublishedCmsPage(
    "event.auditQuoteEvaluate",
  );
  return (
    <>
      <Topbar />
      <AuditEvaluationStartPage
        content={content}
        enabled={isAuditEvaluationCustomerEntryOpen()}
      />
      <Footer />
    </>
  );
}
