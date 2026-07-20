import { CmsSimplePage } from "@/components/CmsSimplePage";
import { Footer } from "@/components/Footer";
import { Topbar } from "@/components/Topbar";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export default async function NotFound() {
  const { content } = await loadPublishedCmsPage("framework.notFound");
  return (
    <>
      <Topbar />
      <CmsSimplePage pageKey="framework.notFound" content={content} />
      <Footer />
    </>
  );
}
