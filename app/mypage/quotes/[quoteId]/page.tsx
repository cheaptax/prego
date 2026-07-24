import type { Metadata } from "next";
import { CustomerQuotesPage } from "@/components/CustomerQuotesPage";
import { Footer } from "@/components/Footer";
import { Topbar } from "@/components/Topbar";
import { requirePortalPageSession } from "@/lib/auth/portal-page-guard";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";
import { getCmsSection } from "@/lib/cms/runtime";
import { cmsPageMetadata } from "@/lib/cms/metadata";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("member.quoteDetail");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

type PageProps = {
  params: Promise<{ quoteId: string }>;
};

export default async function MyQuoteDetailPage({ params }: PageProps) {
  await requirePortalPageSession("customer", {
    allowQuoteOnlyCustomer: true,
  });
  const { quoteId } = await params;
  const [detailBundle, signupBundle] = await Promise.all([
    loadPublishedCmsPage("member.quoteDetail"),
    loadPublishedCmsPage("auth.signup"),
  ]);
  const submitCopy = getCmsSection(
    signupBundle.content,
    "auth.signup",
    "submit",
  );
  return (
    <>
      <Topbar />
      <CustomerQuotesPage
        quoteId={quoteId}
        content={detailBundle.content}
        pageKey="member.quoteDetail"
        conversionCopy={{
          title: submitCopy.text.temporaryConversionTitle,
          description: submitCopy.text.temporaryConversionDescription,
          actionLabel: submitCopy.text.temporaryConversionSubmitLabel,
        }}
      />
      <Footer showPortalLinks={false} />
    </>
  );
}
