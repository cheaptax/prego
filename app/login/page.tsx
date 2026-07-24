import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { LoginPageRenderer } from "@/components/LoginPageRenderer";
import { Topbar } from "@/components/Topbar";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("auth.login");
  return {
    ...cmsPageMetadata(bundle.content, bundle.assetUrls),
    robots: { index: false, follow: false },
  };
}

export default async function LoginPage() {
  const { content } = await loadPublishedCmsPage("auth.login");
  return (
    <>
      <Topbar />
      <LoginPageRenderer content={content} pageKey="auth.login" />
      <Footer />
    </>
  );
}
