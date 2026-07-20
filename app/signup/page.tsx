import type { Metadata } from "next";
import { SignupPageRenderer } from "@/components/SignupPageRenderer";
import { Footer } from "@/components/Footer";
import { Topbar } from "@/components/Topbar";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("auth.signup");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

export default async function SignupPage() {
  const { content } = await loadPublishedCmsPage("auth.signup");
  return (
    <>
      <Topbar />
      <SignupPageRenderer content={content} />
      <Footer />
    </>
  );
}
