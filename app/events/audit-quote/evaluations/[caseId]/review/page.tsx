import type { Metadata } from "next";
import { AuditEvaluationReviewPage } from "@/components/AuditEvaluationCustomerPage";
import { Footer } from "@/components/Footer";
import { Topbar } from "@/components/Topbar";
import { loadAuditEvaluationCustomerPageState } from "@/lib/audit-evaluation/customer-page-access";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage(
    "event.auditQuoteEvaluationReview",
  );
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

type Props = {
  params: Promise<{ caseId: string }>;
};

export default async function AuditQuoteEvaluationReviewRoute({
  params,
}: Props) {
  const { caseId } = await params;
  const [{ content }, state] = await Promise.all([
    loadPublishedCmsPage("event.auditQuoteEvaluationReview"),
    loadAuditEvaluationCustomerPageState(caseId),
  ]);
  return (
    <>
      <Topbar />
      <AuditEvaluationReviewPage content={content} state={state} />
      <Footer />
    </>
  );
}
