import type { Metadata } from "next";
import { AuditEvaluationCasePage } from "@/components/AuditEvaluationCustomerPage";
import { Footer } from "@/components/Footer";
import { Topbar } from "@/components/Topbar";
import { loadAuditEvaluationCustomerPageState } from "@/lib/audit-evaluation/customer-page-access";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage(
    "event.auditQuoteEvaluation",
  );
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

type Props = {
  params: Promise<{ caseId: string }>;
};

export default async function AuditQuoteEvaluationRoute({
  params,
}: Props) {
  const { caseId } = await params;
  const [{ content }, state] = await Promise.all([
    loadPublishedCmsPage("event.auditQuoteEvaluation"),
    loadAuditEvaluationCustomerPageState(caseId),
  ]);
  return (
    <>
      <Topbar />
      <AuditEvaluationCasePage content={content} state={state} />
      <Footer />
    </>
  );
}
