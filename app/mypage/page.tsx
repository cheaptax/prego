import type { Metadata } from "next";
import { MyPageDashboard } from "@/components/MyPageDashboard";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("member.mypage");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

type Props = {
  searchParams?: Promise<{
    tab?: string | string[];
  }>;
};

export default async function MyPage({ searchParams }: Props) {
  const params = await searchParams;
  const { content } = await loadPublishedCmsPage("member.mypage");
  return (
    <main id="main" className="admin-app">
      <MyPageDashboard content={content} initialTab={params?.tab} />
    </main>
  );
}
