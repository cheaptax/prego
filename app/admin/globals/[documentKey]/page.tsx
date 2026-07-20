import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CmsCommonAreaEditor } from "@/components/cms-editor/CmsCommonAreaEditor";
import {
  CMS_PUBLIC_GLOBAL_KEYS,
  type CmsGlobalKey,
} from "@/lib/cms/constants";

export const metadata: Metadata = {
  title: "공통 영역 편집 | 농협지원센터 관리자",
  description: "상단 메뉴, 하단 정보와 고객지원 공통 영역을 편집합니다.",
  robots: { index: false, follow: false },
};

export default async function CmsGlobalEditorPage({
  params,
}: {
  params: Promise<{ documentKey: string }>;
}) {
  const { documentKey } = await params;
  if (
    !(CMS_PUBLIC_GLOBAL_KEYS as readonly string[]).includes(documentKey)
  ) {
    notFound();
  }
  return <CmsCommonAreaEditor documentKey={documentKey as CmsGlobalKey} />;
}
