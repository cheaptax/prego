import { LoginForm } from "@/components/LoginForm";
import {
  getPortalLoginPageConfig,
  type PortalLoginPageKey,
} from "@/lib/auth/login-page";
import { getCmsSection } from "@/lib/cms/runtime";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";
import { cmsSectionRootProps } from "@/lib/cms/style-runtime";

export function LoginPageRenderer({
  content,
  pageKey = "auth.login",
  mainId = "main",
  editing = false,
  previewMode = false,
  selectedSectionId,
  onSelectSection,
}: {
  content: CmsPageContent;
  pageKey?: PortalLoginPageKey;
  mainId?: string | null;
  editing?: boolean;
  previewMode?: boolean;
  selectedSectionId?: string;
  onSelectSection?: (sectionId: string) => void;
}) {
  const config = getPortalLoginPageConfig(pageKey);
  const hero = getCmsSection(content, pageKey, "hero");
  const form = getCmsSection(content, pageKey, "loginForm");

  function sectionProps(section: CmsSection, className: string) {
    const root = cmsSectionRootProps(section, className);
    return {
      ...root,
      className: [
        root.className,
        editing ? "cms-home-edit-section" : "",
        selectedSectionId === section.id ? "is-selected" : "",
      ]
        .filter(Boolean)
        .join(" "),
      tabIndex: editing ? 0 : undefined,
      onClick: editing ? () => onSelectSection?.(section.id) : undefined,
      onFocus: editing ? () => onSelectSection?.(section.id) : undefined,
    };
  }

  const highlight = hero.text.highlight;
  return (
    <main id={mainId ?? undefined} className="login-page">
      <section className="login-shell">
        <header {...sectionProps(hero, "login-head")}>
          <span className="login-head__eyebrow">
            <span className="dot" aria-hidden="true" />
            {hero.eyebrow}
          </span>
          <h1 className="login-head__title">
            {hero.title.split(/\n+/).map((line, index) => {
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
            })}
          </h1>
          <p className="login-head__lede">{hero.description}</p>
        </header>

        <section {...sectionProps(form, "login-card")}>
          <span className="login-card__tag">{form.eyebrow}</span>
          <h2 className="login-card__title">{form.title}</h2>
          <p className="login-card__lede">{form.description}</p>
          <LoginForm
            content={content}
            pageKey={pageKey}
            expectedPortal={config.expectedPortal}
            legacyCrossPortal={config.legacyCrossPortal}
            showEmailLookup={config.showEmailLookup}
            previewMode={previewMode}
          />
        </section>
      </section>
    </main>
  );
}
