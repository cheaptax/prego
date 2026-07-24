"use client";

import { BoardPageRenderer } from "@/components/BoardPageRenderer";
import { AdminDashboard } from "@/components/AdminDashboard";
import { CmsAdminConsole } from "@/components/CmsAdminConsole";
import { CmsSimplePage } from "@/components/CmsSimplePage";
import { ConsultPageRenderer } from "@/components/ConsultPageRenderer";
import { LoginPageRenderer } from "@/components/LoginPageRenderer";
import { MyPageDashboard } from "@/components/MyPageDashboard";
import { RequestDetailPage } from "@/components/RequestDetailPage";
import { AuditEvaluationCmsPreview } from "@/components/AuditEvaluationCustomerPage";
import { SignupPageRenderer } from "@/components/SignupPageRenderer";
import { CustomerQuotesPage } from "@/components/CustomerQuotesPage";
import { PartnerApplicationForm } from "@/components/PartnerApplicationForm";
import { CmsPageRenderer, type CmsPreviewDevice } from "@/components/cms-editor/CmsPageRenderer";
import { isPortalLoginPageKey } from "@/lib/auth/login-page";
import type { CmsPageKey } from "@/lib/cms/constants";
import { getCmsFeatureDefinition } from "@/lib/cms/feature-registry";
import type { CmsPageContent } from "@/lib/cms/schemas";
import { getCmsSection } from "@/lib/cms/runtime";
import { applyQuoteTemplate } from "@/lib/quotes/quote-document-content";

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
    return (
      <LoginPageRenderer
        {...shared}
        pageKey={isPortalLoginPageKey(pageKey) ? pageKey : "auth.login"}
      />
    );
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
  if (renderer === "auditEvaluation") {
    return (
      <AuditEvaluationCmsPreview
        pageKey={pageKey}
        content={content}
        editing={editing}
        selectedSectionId={selectedSectionId}
        onSelectSection={onSelectSection}
      />
    );
  }
  if (renderer === "adminOperations") {
    return <AdminDashboard content={content} previewMode />;
  }
  if (renderer === "adminConsole") {
    return <CmsAdminConsole content={content} previewMode />;
  }
  if (
    pageKey === "member.quotes" ||
    pageKey === "member.quoteDetail"
  ) {
    return (
      <CustomerQuotesPage
        content={content}
        pageKey={pageKey}
        quoteId={pageKey === "member.quoteDetail" ? "preview-quote" : undefined}
        conversionCopy={{ title: "", description: "", actionLabel: "" }}
        previewMode
      />
    );
  }
  if (pageKey === "partner.apply") {
    return <PartnerApplicationForm content={content} previewMode />;
  }
  if (pageKey === "partner.portal") {
    return (
      <PartnerQuoteDocumentPreview
        content={content}
        selected={selectedSectionId === "quoteDocument"}
        onSelect={() => onSelectSection?.("quoteDocument")}
      />
    );
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
      pageKey === "auth.portalAccessDenied" ||
      pageKey === "public.support" ||
      pageKey === "legal.terms" ||
      pageKey === "legal.privacy" ||
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

function PartnerQuoteDocumentPreview({
  content,
  selected,
  onSelect,
}: {
  content: CmsPageContent;
  selected: boolean;
  onSelect(): void;
}) {
  const section = getCmsSection(
    content,
    "partner.portal",
    "quoteDocument",
  );
  const text = section.text;
  const title = applyQuoteTemplate(text.auditTitleTemplate, {
    year: 2027,
    cooperativeName: "가나다농협",
    supplierName: "프리고회계법인",
  });
  return (
    <main className="page-shell">
      <section className="section">
        <article
          className={`admin-card cms-home-edit-section${
            selected ? " is-selected" : ""
          }`}
          tabIndex={0}
          onClick={onSelect}
          onFocus={onSelect}
        >
          <p className="eyebrow">{section.eyebrow}</p>
          <h1>{title}</h1>
          <p>
            {text.quoteNumberLabel}: 2027-12345678 /{" "}
            {text.documentVersionLabel}: 1
          </p>
          <hr />
          <h2>{text.recipientSectionTitle}</h2>
          <p>가나다농협 김담당 담당자님</p>
          <p>{text.recipientEmailLabel}: sample@nonghyup.com</p>
          <h2>{text.supplierSectionTitle}</h2>
          <p><strong>프리고회계법인</strong></p>
          <p>{text.businessNumberLabel}: 123-45-67890</p>
          <p>{text.addressLabel}: 서울특별시 중구 세종대로 1</p>
          <p>{text.supplierContactLabel}: 김담당</p>
          <p>{text.contactLabel}: 02-1234-5678 / quote@example.com</p>
          <h2>{text.quoteIntro}</h2>
          <p>
            {text.itemHeader} · {text.quantityHeader} ·{" "}
            {text.unitPriceHeader} · {text.supplyAmountHeader}
          </p>
          <p>
            <strong>{text.totalLabel}: 11,000,000{text.currencySuffix}</strong>
          </p>
          <footer>{text.footerStatement}</footer>
        </article>
      </section>
    </main>
  );
}
