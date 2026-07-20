"use client";

import { BoardPageRenderer } from "@/components/BoardPageRenderer";
import { AdminDashboard } from "@/components/AdminDashboard";
import { CmsAdminConsole } from "@/components/CmsAdminConsole";
import { CmsSimplePage } from "@/components/CmsSimplePage";
import { ConsultPageRenderer } from "@/components/ConsultPageRenderer";
import { LoginPageRenderer } from "@/components/LoginPageRenderer";
import { MyPageDashboard } from "@/components/MyPageDashboard";
import { RequestDetailPage } from "@/components/RequestDetailPage";
import { SignupPageRenderer } from "@/components/SignupPageRenderer";
import { CmsPageRenderer, type CmsPreviewDevice } from "@/components/cms-editor/CmsPageRenderer";
import type { CmsPageKey } from "@/lib/cms/constants";
import { getCmsFeatureDefinition } from "@/lib/cms/feature-registry";
import type { CmsPageContent } from "@/lib/cms/schemas";

export function CmsActualPagePreview({
  pageKey,
  content,
  device,
  assetUrls,
  editing = false,
  selectedSectionId,
  onSelectSection,
}: {
  pageKey: CmsPageKey;
  content: CmsPageContent;
  device: CmsPreviewDevice;
  assetUrls?: Record<string, string>;
  editing?: boolean;
  selectedSectionId?: string;
  onSelectSection?: (sectionId: string) => void;
}) {
  const shared = {
    content,
    mainId: null,
    editing,
    previewMode: true,
    selectedSectionId,
    onSelectSection,
  };
  const renderer = getCmsFeatureDefinition(pageKey).previewRenderer;

  if (renderer === "login") {
    return <LoginPageRenderer {...shared} />;
  }
  if (renderer === "signup") {
    return (
      <SignupPageRenderer
        content={content}
        mainId={null}
        previewMode
      />
    );
  }
  if (renderer === "memberDashboard") {
    return <MyPageDashboard content={content} previewMode />;
  }
  if (renderer === "requestDetail") {
    return (
      <RequestDetailPage
        requestId="preview-request"
        content={content}
        previewMode
      />
    );
  }
  if (renderer === "adminOperations") {
    return <AdminDashboard content={content} previewMode />;
  }
  if (renderer === "adminConsole") {
    return <CmsAdminConsole content={content} previewMode />;
  }
  if (renderer === "consult") {
    return <ConsultPageRenderer {...shared} />;
  }
  if (
    (renderer === "inquiryBoard" || renderer === "faqBoard") &&
    (pageKey === "public.inquiries" || pageKey === "public.faq")
  ) {
    return <BoardPageRenderer {...shared} pageKey={pageKey} />;
  }
  if (
    renderer === "simple" &&
    (pageKey === "auth.pendingApproval" ||
      pageKey === "public.support" ||
      pageKey === "legal.terms" ||
      pageKey === "legal.privacy" ||
      pageKey === "partner.portal" ||
      pageKey === "framework.notFound")
  ) {
    return (
      <CmsSimplePage
        pageKey={pageKey}
        content={content}
        mainId={null}
        previewMode
        editing={editing}
        selectedSectionId={selectedSectionId}
        onSelectSection={onSelectSection}
      />
    );
  }
  return (
    <CmsPageRenderer
      content={content}
      device={device}
      selectedSectionId={selectedSectionId}
      assetUrls={assetUrls}
      editing={editing}
      onSelectSection={onSelectSection}
    />
  );
}
