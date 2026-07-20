import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { RequestDetailPage } from "@/components/RequestDetailPage";
import { Topbar } from "@/components/Topbar";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("member.requestDetail");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

type Props = {
  params: Promise<{ requestId: string }>;
};

export default async function MyRequestDetail({ params }: Props) {
  const { requestId } = await params;
  const { content } = await loadPublishedCmsPage("member.requestDetail");

  return (
    <>
      <Topbar />
      <main id="main" className="request-detail-page">
        <RequestDetailPage requestId={requestId} content={content} />
      </main>
      <Footer />
    </>
  );
}
