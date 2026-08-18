"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AuditEvaluationReportDocument } from "@/components/AuditEvaluationReportDocument";
import { trackAuditQuoteEvent } from "@/lib/audit-quote/analytics";
import {
  SAMPLE_AUDIT_REPORT_DOWNLOAD_PATH,
  SAMPLE_AUDIT_REPORT_PREVIEW_SECTION_IDS,
} from "@/lib/audit-quote/sample-audit-report-public";
import type { AuditEvaluationReportViewModel } from "@/lib/audit-evaluation/report-view-model";
import {
  cmsSectionSelectionProps,
  type CmsSectionEditingOptions,
} from "@/lib/cms/editable-section";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";

type Props = CmsSectionEditingOptions & {
  content: CmsPageContent;
  sampleReport?: AuditEvaluationReportViewModel | null;
  mainId?: string | null;
  previewMode?: boolean;
};

type SectionMap = Partial<Record<string, CmsSection>>;

function visibleSections(content: CmsPageContent, editing: boolean) {
  return content.sections.filter((section) => {
    if (section.deleted && !editing) return false;
    if (!section.visible && !editing) return false;
    return true;
  });
}

function sectionsById(content: CmsPageContent, editing: boolean): SectionMap {
  return Object.fromEntries(
    visibleSections(content, editing).map((section) => [section.id, section]),
  );
}

function visibleItems(section?: CmsSection) {
  return section?.items.filter((item) => item.visible && !item.deleted) ?? [];
}

function lineBreaks(text?: string) {
  if (!text) return null;
  return text.split(/\n+/u).map((line, index) => (
    <span key={`${line}-${index}`}>
      {index > 0 ? <br /> : null}
      {line}
    </span>
  ));
}

function sectionProps(
  section: CmsSection,
  className: string,
  editingOptions: CmsSectionEditingOptions,
) {
  const selectionProps = cmsSectionSelectionProps(
    section,
    className,
    editingOptions,
  );
  return {
    ...selectionProps,
    className: [
      selectionProps.className,
      !section.visible ? "is-hidden" : "",
      section.deleted ? "is-deleted" : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

function trackCta(placement: string) {
  trackAuditQuoteEvent("audit_quote_cta_click", {
    campaign: "fy27-audit-quote",
    channel: "guide",
    page_path: "/events/audit-quote/guide",
    placement,
  });
}

function CtaLink({
  action,
  className,
  placement,
  children,
}: {
  action?: CmsSection["actions"][number];
  className: string;
  placement: string;
  children?: ReactNode;
}) {
  if (!action) return null;
  return (
    <Link
      className={className}
      href={action.href}
      onClick={() => trackCta(placement)}
    >
      {children ?? action.label}
    </Link>
  );
}

function useSampleReport(
  provided?: AuditEvaluationReportViewModel | null,
) {
  const [viewModel, setViewModel] =
    useState<AuditEvaluationReportViewModel | null>(provided ?? null);

  useEffect(() => {
    if (provided) {
      setViewModel(provided);
      return;
    }
    let cancelled = false;
    void fetch(`${SAMPLE_AUDIT_REPORT_DOWNLOAD_PATH}?format=json`)
      .then((response) => response.json())
      .then((payload: { ok?: boolean; viewModel?: AuditEvaluationReportViewModel }) => {
        if (!cancelled && payload.ok && payload.viewModel) {
          setViewModel(payload.viewModel);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [provided]);

  return viewModel;
}

export function AuditQuoteGuidePage({
  content,
  sampleReport = null,
  mainId = "main",
  editing = false,
  previewMode = false,
  selectedSectionId,
  onSelectSection,
}: Props) {
  const sections = sectionsById(content, editing);
  const editingOptions = { editing, selectedSectionId, onSelectSection };
  const hero = sections.hero;
  const mandate = sections.mandate;
  const pain = sections.pain;
  const hassleFree = sections.hassleFree;
  const steps = sections.steps;
  const benefits = sections.benefits;
  const faq = sections.faq;
  const cta = sections.cta;
  const legalNotice = sections.legalNotice;
  const heroPrimary = hero?.actions.find((action) => action.id === "apply");
  const heroSecondary = hero?.actions.find((action) => action.id === "learnFlow");
  const sampleDownload = hassleFree?.actions.find(
    (action) => action.id === "sample",
  );
  const bottomCta = cta?.actions.find((action) => action.id === "apply");
  const reportViewModel = useSampleReport(sampleReport);

  return (
    <main
      id={mainId ?? undefined}
      className={["aq-guide", previewMode ? "aq-guide--preview" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      {hero ? (
        <section {...sectionProps(hero, "aq-guide-hero", editingOptions)}>
          <div className="aq-guide-hero__copy">
            {hero.eyebrow ? (
              <p className="aq-guide-eyebrow">{hero.eyebrow}</p>
            ) : null}
            {hero.text.badge ? (
              <p className="aq-guide-hero__badge">{hero.text.badge}</p>
            ) : null}
            <h1>{lineBreaks(hero.title)}</h1>
            {hero.description ? <p>{hero.description}</p> : null}
            <div className="aq-guide-hero__actions">
              <CtaLink
                action={heroPrimary}
                className="cta cta--solid"
                placement="hero"
              />
              <CtaLink
                action={heroSecondary}
                className="cta cta--ghost"
                placement="hero-secondary"
              />
            </div>
            {hero.text.primaryCtaHelp ? (
              <p className="aq-guide-hero__help">{hero.text.primaryCtaHelp}</p>
            ) : null}
          </div>
          <div className="aq-guide-hero__panel" aria-hidden="true">
            <span>2027</span>
            <strong>감사인 선임 준비</strong>
            <p>견적 수집 · 외부 견적 반영 · 검토보고서</p>
          </div>
        </section>
      ) : null}

      {mandate ? (
        <section
          {...sectionProps(
            mandate,
            "aq-guide-section aq-guide-section--mandate",
            editingOptions,
          )}
          aria-label={mandate.text.ariaLabel}
        >
          <div className="aq-guide-section__head">
            {mandate.eyebrow ? (
              <p className="aq-guide-eyebrow">{mandate.eyebrow}</p>
            ) : null}
            <h2>{lineBreaks(mandate.title)}</h2>
            {mandate.description ? <p>{mandate.description}</p> : null}
          </div>
          <ol className="aq-guide-timeline">
            {visibleItems(mandate).map((item) => (
              <li key={item.id}>
                {item.value ? <span>{item.value}</span> : null}
                <strong>{item.title}</strong>
                {item.description ? <p>{item.description}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {pain ? (
        <section
          {...sectionProps(
            pain,
            "aq-guide-section aq-guide-section--pain",
            editingOptions,
          )}
          aria-label={pain.text.ariaLabel}
        >
          <div className="aq-guide-section__head">
            {pain.eyebrow ? (
              <p className="aq-guide-eyebrow">{pain.eyebrow}</p>
            ) : null}
            <h2>{lineBreaks(pain.title)}</h2>
            {pain.description ? <p>{pain.description}</p> : null}
          </div>
          <div className="aq-guide-pain-grid">
            {visibleItems(pain).map((item) => (
              <article key={item.id}>
                <span aria-hidden="true">✓</span>
                <h3>{item.title}</h3>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {hassleFree ? (
        <section
          id="hassle-free"
          {...sectionProps(
            hassleFree,
            "aq-guide-section aq-guide-section--hassle",
            editingOptions,
          )}
          aria-label={hassleFree.text.ariaLabel}
        >
          <div className="aq-guide-section__head">
            {hassleFree.eyebrow ? (
              <p className="aq-guide-eyebrow">{hassleFree.eyebrow}</p>
            ) : null}
            <h2>{lineBreaks(hassleFree.title)}</h2>
            {hassleFree.description ? <p>{hassleFree.description}</p> : null}
          </div>
          <div className="aq-guide-feature-list">
            {visibleItems(hassleFree).map((item) => (
              <article key={item.id}>
                <h3>{item.title}</h3>
                {item.description ? <p>{item.description}</p> : null}
              </article>
            ))}
          </div>
          <figure className="aq-guide-report">
            <div className="aq-guide-report__bar">
              <strong>{hassleFree.text.reportLabel}</strong>
              <a
                className="cta cta--ghost"
                href={sampleDownload?.href ?? SAMPLE_AUDIT_REPORT_DOWNLOAD_PATH}
                onClick={() => trackCta("sample-report")}
              >
                {hassleFree.text.sampleDownloadLabel ?? sampleDownload?.label}
              </a>
            </div>
            <div className="aq-guide-report__frame">
              {reportViewModel ? (
                <AuditEvaluationReportDocument
                  viewModel={reportViewModel}
                  sectionIds={SAMPLE_AUDIT_REPORT_PREVIEW_SECTION_IDS}
                />
              ) : (
                <p className="aq-guide-report__loading">
                  검토보고서 예시를 준비하고 있습니다.
                </p>
              )}
            </div>
            {hassleFree.text.tableCaption ? (
              <figcaption>{hassleFree.text.tableCaption}</figcaption>
            ) : null}
          </figure>
        </section>
      ) : null}

      {steps ? (
        <section
          {...sectionProps(steps, "aq-guide-section", editingOptions)}
          aria-label={steps.text.ariaLabel}
        >
          <div className="aq-guide-section__head">
            {steps.eyebrow ? (
              <p className="aq-guide-eyebrow">{steps.eyebrow}</p>
            ) : null}
            <h2>{lineBreaks(steps.title)}</h2>
          </div>
          <ol className="aq-guide-steps">
            {visibleItems(steps).map((item) => (
              <li key={item.id}>
                {item.value ? <span>{item.value}</span> : null}
                <strong>{item.title}</strong>
                {item.description ? <p>{item.description}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {benefits ? (
        <section
          {...sectionProps(
            benefits,
            "aq-guide-section aq-guide-section--benefits",
            editingOptions,
          )}
          aria-label={benefits.text.ariaLabel}
        >
          <div className="aq-guide-section__head">
            {benefits.eyebrow ? (
              <p className="aq-guide-eyebrow">{benefits.eyebrow}</p>
            ) : null}
            <h2>{lineBreaks(benefits.title)}</h2>
          </div>
          <div className="aq-guide-benefits">
            {visibleItems(benefits).map((item) => (
              <article key={item.id}>
                <h3>{item.title}</h3>
                {item.description ? <p>{item.description}</p> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {faq ? (
        <section
          {...sectionProps(
            faq,
            "aq-guide-section aq-guide-section--faq",
            editingOptions,
          )}
          aria-label={faq.text.ariaLabel}
        >
          <div className="aq-guide-section__head">
            <h2>{lineBreaks(faq.title)}</h2>
          </div>
          <div className="aq-guide-faq">
            {visibleItems(faq).map((item) => (
              <details key={item.id}>
                <summary>{item.title}</summary>
                {item.description ? <p>{lineBreaks(item.description)}</p> : null}
              </details>
            ))}
          </div>
        </section>
      ) : null}

      {cta ? (
        <section {...sectionProps(cta, "aq-guide-cta", editingOptions)}>
          <div>
            {cta.eyebrow ? (
              <p className="aq-guide-eyebrow">{cta.eyebrow}</p>
            ) : null}
            <h2>{lineBreaks(cta.title)}</h2>
            {cta.description ? <p>{cta.description}</p> : null}
            {cta.text.ctaHelp ? <small>{cta.text.ctaHelp}</small> : null}
          </div>
          <CtaLink
            action={bottomCta}
            className="cta cta--solid"
            placement="bottom"
          />
        </section>
      ) : null}

      {legalNotice ? (
        <section
          {...sectionProps(legalNotice, "aq-guide-legal", editingOptions)}
          aria-label={legalNotice.text.ariaLabel}
        >
          <h2>{legalNotice.title}</h2>
          <p>
            <strong>{legalNotice.text.operatorName}</strong>
            {legalNotice.description}
          </p>
          <ul>
            {visibleItems(legalNotice).map((item) => (
              <li key={item.id}>{item.title}</li>
            ))}
          </ul>
          {legalNotice.text.regulationNote ? (
            <p className="aq-guide-legal__note">
              {legalNotice.text.regulationNote}
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
