import type { Metadata } from "next";
import { HomePageRenderer } from "@/components/HomePageRenderer";
import { loadPublishedHome } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const { content } = await loadPublishedHome();
  return {
    title: content.seo.title,
    description: content.seo.description,
    robots: content.seo.indexable
      ? { index: true, follow: true }
      : { index: false, follow: false },
  };
}

export default async function HomePage() {
  const { content, assetUrls } = await loadPublishedHome();
  return <HomePageRenderer content={content} assetUrls={assetUrls} />;
}
