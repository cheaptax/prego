import Link from "next/link";
import type { ReactNode } from "react";
import { CmsSupplementalSections } from "@/components/cms/CmsSupplementalSections";
import {
  cmsEditableSectionProps,
  type CmsSectionEditingOptions,
} from "@/lib/cms/editable-section";
import { getCmsKnownSectionIds } from "@/lib/cms/section-lifecycle";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";

type Props = CmsSectionEditingOptions & {
  pageKey:
    | "auth.pendingApproval"
    | "auth.portalAccessDenied"
    | "public.support"
    | "legal.terms"
    | "legal.privacy"
    | "partner.portal"
    | "framework.notFound";
  content: CmsPageContent;
  mainId?: string | null;
  previewMode?: boolean;
  cardActions?: ReactNode;
};

function highlightedTitle(section: CmsSection) {
  const highlight = section.text.highlight;
  return section.title.split(/\n+/).map((line, index) => {
    const start = highlight ? line.indexOf(highlight) : -1;
    return (
      <span key={`${line}-${index}`}>
        {index > 0 ? <br /> : null}
        {start >= 0 ? (
          <>
            {line.slice(0, start)}
            <em>{highlight}</em>
            {line.slice(start + highlight.length)}
          </>
        ) : (
          line
        )}
      </span>
    );
  });
}

export function CmsSimplePage({
  pageKey,
  content,
  mainId = "main",
  editing = false,
  previewMode = false,
  selectedSectionId,
  onSelectSection,
  cardActions,
}: Props) {
  const editingOptions = { editing, selectedSectionId, onSelectSection };
  const knownIds = getCmsKnownSectionIds(pageKey);

  const sections = content.sections.filter(
    (section) =>
      (!section.deleted || editing) &&
      (section.visible || editing) &&
      knownIds.has(section.id),
  );
  const isLoginLayout =
    pageKey === "auth.pendingApproval" ||
    pageKey === "auth.portalAccessDenied" ||
    pageKey === "public.support" ||
    pageKey === "partner.portal" ||
    pageKey === "framework.notFound";

  if (isLoginLayout) {
    const hero = sections[0];
    const card = sections[1] ?? sections[0];
    return (
      <main id={mainId ?? undefined} className="login-page">
        <section className="login-shell">
          {sections.length > 1 && hero ? (
            <header
              {...cmsEditableSectionProps(hero, "login-head", editingOptions)}
            >
              {hero.eyebrow ? (
                <span className="login-head__eyebrow">
                  <span className="dot" aria-hidden="true" />
                  {hero.eyebrow}
                </span>
              ) : null}
              <h1 className="login-head__title">{highlightedTitle(hero)}</h1>
              {hero.description ? (
                <p className="login-head__lede">
                  {hero.description.split(/\n+/).map((line, index) => (
                    <span key={`${line}-${index}`}>
                      {index > 0 ? <br /> : null}
                      {line}
                    </span>
                  ))}
                </p>
              ) : null}
            </header>
          ) : null}
          {card ? (
            <section
              {...cmsEditableSectionProps(
                card,
                pageKey === "framework.notFound"
                  ? "login-card login-card--not-found"
                  : "login-card",
                editingOptions,
              )}
            >
              {card.eyebrow ? (
                <span className="login-card__tag">{card.eyebrow}</span>
              ) : null}
              <h2 className="login-card__title">{card.title}</h2>
              {card.description ? (
                <p className="login-card__lede">{card.description}</p>
              ) : null}
              {cardActions ??
                card.actions.map((action, index) => (
                  <Link
                    className={
                      index === 0
                        ? "login-card__primary"
                        : "login-card__ghost"
                    }
                    href={action.href}
                    key={action.id}
                    onClick={
                      editing || previewMode
                        ? (event) => event.preventDefault()
                        : undefined
                    }
                  >
                    {action.label}
                  </Link>
                ))}
            </section>
          ) : null}
        </section>
        <CmsSupplementalSections
          pageKey={pageKey}
          content={content}
          editing={editing}
          selectedSectionId={selectedSectionId}
          onSelectSection={onSelectSection}
        />
      </main>
    );
  }

  return (
    <main id={mainId ?? undefined} className="policy-page">
      {sections.map((section, index) => (
        <section
          key={section.id}
          {...cmsEditableSectionProps(
            section,
            index === 0 ? "policy-hero" : "policy-section",
            editingOptions,
          )}
        >
          <div className="policy-section__inner">
            {section.eyebrow ? (
              <span className="kicker">{section.eyebrow}</span>
            ) : null}
            {index === 0 ? (
              <h1>{section.title}</h1>
            ) : (
              <h2>{section.title}</h2>
            )}
            {section.description ? <p>{section.description}</p> : null}
            {section.text.effectiveDate ? (
              <time>{section.text.effectiveDate}</time>
            ) : null}
            {section.actions.map((action) => (
              <Link
                className="cta cta--solid"
                href={action.href}
                key={action.id}
                onClick={
                  editing || previewMode
                    ? (event) => event.preventDefault()
                    : undefined
                }
              >
                {action.label}
              </Link>
            ))}
          </div>
        </section>
      ))}
      <CmsSupplementalSections
        pageKey={pageKey}
        content={content}
        editing={editing}
        selectedSectionId={selectedSectionId}
        onSelectSection={onSelectSection}
      />
    </main>
  );
}
