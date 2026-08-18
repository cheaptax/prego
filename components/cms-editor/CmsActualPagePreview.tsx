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
import { AuditQuoteGuidePage } from "@/components/AuditQuoteGuidePage";
import { SignupPageRenderer } from "@/components/SignupPageRenderer";
import { CustomerQuotesPage } from "@/components/CustomerQuotesPage";
import { PartnerApplicationForm } from "@/components/PartnerApplicationForm";
import { CmsPageRenderer, type CmsPreviewDevice } from "@/components/cms-editor/CmsPageRenderer";
import { isPortalLoginPageKey } from "@/lib/auth/login-page";
import type { CmsPageKey } from "@/lib/cms/constants";
import { cmsEditableSectionProps } from "@/lib/cms/editable-section";
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
    return <SignupPageRenderer {...shared} />;
  }
  if (renderer === "memberDashboard") {
    return <MyPageDashboard {...shared} />;
  }
  if (renderer === "requestDetail") {
    return (
      <RequestDetailPage
        requestId="preview-request"
        {...shared}
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
    return <AdminDashboard {...shared} />;
  }
  if (renderer === "adminConsole") {
    return <CmsAdminConsole {...shared} />;
  }
  if (pageKey === "event.auditQuoteGuide") {
    return <AuditQuoteGuidePage {...shared} />;
  }
  if (
    pageKey === "member.quotes" ||
    pageKey === "member.quoteDetail"
  ) {
    return (
      <CustomerQuotesPage
        pageKey={pageKey}
        quoteId={pageKey === "member.quoteDetail" ? "preview-quote" : undefined}
        conversionCopy={{ title: "", description: "", actionLabel: "" }}
        {...shared}
      />
    );
  }
  if (pageKey === "partner.apply") {
    return <PartnerApplicationForm {...shared} />;
  }
  if (pageKey === "partner.portal") {
    return (
      <PartnerPortalPreview
        content={content}
        device={device}
        editing={editing}
        selectedSectionId={selectedSectionId}
        onSelectSection={onSelectSection}
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

function PartnerPortalPreview({
  content,
  device,
  editing,
  selectedSectionId,
  onSelectSection,
}: {
  content: CmsPageContent;
  device: CmsPreviewDevice;
  editing: boolean;
  selectedSectionId?: string;
  onSelectSection?: (sectionId: string) => void;
}) {
  return (
    <div className="cms-partner-portal-preview">
      {content.sections.map((section) => {
        if (section.deleted && !editing) return null;
        return section.id === "quoteDocument" ? (
          <PartnerQuoteDocumentPreview
            content={content}
            editing={editing}
            selectedSectionId={selectedSectionId}
            onSelectSection={onSelectSection}
            key={section.id}
          />
        ) : (
          <CmsPageRenderer
            content={{ ...content, sections: [section], messages: {} }}
            device={device}
            editing={editing}
            selectedSectionId={selectedSectionId}
            onSelectSection={onSelectSection}
            key={section.id}
          />
        );
      })}
    </div>
  );
}

function PartnerQuoteDocumentPreview({
  content,
  editing,
  selectedSectionId,
  onSelectSection,
}: {
  content: CmsPageContent;
  editing: boolean;
  selectedSectionId?: string;
  onSelectSection?: (sectionId: string) => void;
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
          {...cmsEditableSectionProps(section, "admin-card quote-document-preview", {
            editing,
            selectedSectionId,
            onSelectSection,
          })}
        >
          <p className="eyebrow">{section.eyebrow}</p>
          <div className="quote-document-preview__brand">
            <div>
              <p className="quote-document-preview__kind">
                {text.documentKindLabel}
              </p>
              <h1>{title}</h1>
            </div>
            <dl className="quote-document-preview__meta">
              <div>
                <dt>{text.issueDateLabel}</dt>
                <dd>2026.07.24</dd>
              </div>
              <div>
                <dt>{text.quoteNumberLabel}</dt>
                <dd>2027-12345678</dd>
              </div>
              <div>
                <dt>{text.customerRefLabel}</dt>
                <dd>가나다농협</dd>
              </div>
              <div>
                <dt>{text.validUntilLabel}</dt>
                <dd>발행일로부터 30일</dd>
              </div>
            </dl>
          </div>
          <section>
            <h2>{text.recipientSectionTitle}</h2>
            <p>
              {text.customerRefLabel}: 가나다농협 김담당 담당자님
            </p>
            <p>
              {text.recipientEmailLabel}: sample@nonghyup.com
            </p>
          </section>
          <section>
            <h2>{text.credentialsTitle || text.supplierSectionTitle}</h2>
            <p>
              <strong>프리고회계법인</strong>
            </p>
            <p>{text.businessNumberLabel}: 123-45-67890</p>
            <p>{text.addressLabel}: 서울특별시 중구 세종대로 1</p>
            <p>{text.supplierContactLabel}: 김담당</p>
            <p>{text.contactLabel}: 02-1234-5678 / quote@example.com</p>
            <p>{text.engagementPartnerLabel}: 홍길동</p>
            <p>
              {text.cpaCountLabel}: 12{text.peopleSuffix}
            </p>
          </section>
          <p>{text.quoteIntro}</p>
          <p>
            {text.itemHeader} · {text.quantityHeader} ·{" "}
            {text.unitPriceHeader} · {text.supplyAmountHeader}
          </p>
          <p>
            <strong>
              {text.totalLabel}: 11,000,000{text.currencySuffix}
            </strong>
          </p>
          <section>
            <h2>{text.comparisonQrTitle}</h2>
            <p>{text.comparisonQrHelp}</p>
          </section>
          <section>
            <h2>{text.evaluationFactsTitle}</h2>
            <p>{text.evaluationFactsHelp}</p>
            <p>
              {text.revenueLabel}: 1,000,000,000{text.currencySuffix}
            </p>
            <p>
              {text.localAuditCountLabel}: 8{text.countSuffix}
            </p>
            <p>
              {text.auditedTypesLabel}: {text.cooperativeTypeLocalAgri}
            </p>
            <p>
              {text.taxExperienceLabel}: {text.yesLabel}
            </p>
            <p>
              {text.subsidyExperienceLabel}: {text.noLabel}
            </p>
          </section>
          <footer>
            {text.footerStatement}
            <br />
            {text.thankYouStatement}
          </footer>
        </article>
      </section>
    </main>
  );
}
