import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CmsPageEditor } from "@/components/cms-editor/CmsPageEditor";
import { requirePortalPageSession } from "@/lib/auth/portal-page-guard";
import { CMS_PAGE_KEYS, type CmsPageKey } from "@/lib/cms/constants";

export const metadata: Metadata = {
  title: "페이지 편집 | 농협지원센터 콘텐츠 관리",
  robots: { index: false, follow: false },
};

function isCmsPageKey(value: string): value is CmsPageKey {
  return (CMS_PAGE_KEYS as readonly string[]).includes(value);
}

export default async function CmsPageEditorPage({
  params,
}: {
  params: Promise<{ pageKey: string }>;
}) {
  await requirePortalPageSession("admin");
  const { pageKey } = await params;
  if (!isCmsPageKey(pageKey)) notFound();
  return <CmsPageEditor pageKey={pageKey} />;
}
