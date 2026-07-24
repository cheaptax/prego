import Link from "next/link";
import type { ReactNode } from "react";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";
import { cmsSectionRootProps } from "@/lib/cms/style-runtime";

type Props = {
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
  editing?: boolean;
  previewMode?: boolean;
  selectedSectionId?: string;
  onSelectSection?: (sectionId: string) => void;
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
  function sectionProps(section: CmsSection, className: string) {
    const root = cmsSectionRootProps(section, className);
    return {
      ...root,
      className: [
        root.className,
        editing ? "cms-home-edit-section" : "",
        editing && selectedSectionId === section.id ? "is-selected" : "",
        editing && !section.visible ? "is-hidden" : "",
      ]
        .filter(Boolean)
        .join(" "),
      tabIndex: editing ? 0 : undefined,
      onClick: editing ? () => onSelectSection?.(section.id) : undefined,
      onFocus: editing ? () => onSelectSection?.(section.id) : undefined,
    };
  }

  const sections = content.sections.filter(
    (section) => section.visible || editing,
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
          {sections.length > 1 ? (
            <header {...sectionProps(hero, "login-head")}>
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
          <section
            {...sectionProps(
              card,
              pageKey === "framework.notFound"
                ? "login-card login-card--not-found"
                : "login-card",
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
        </section>
      </main>
    );
  }

  return (
    <main id={mainId ?? undefined} className="policy-page">
      {sections.map((section, index) => (
        <section
          key={section.id}
          {...sectionProps(
            section,
            index === 0 ? "policy-hero" : "policy-section",
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
    </main>
  );
}
