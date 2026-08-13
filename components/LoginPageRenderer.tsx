import { LoginForm } from "@/components/LoginForm";
import { HomePromoFloat } from "@/components/HomePromoFloat";
import { CmsSupplementalSections } from "@/components/cms/CmsSupplementalSections";
import {
  getPortalLoginPageConfig,
  type PortalLoginPageKey,
} from "@/lib/auth/login-page";
import {
  cmsEditableSectionProps,
  type CmsSectionEditingOptions,
} from "@/lib/cms/editable-section";
import { getCmsSection } from "@/lib/cms/runtime";
import type { CmsPageContent } from "@/lib/cms/schemas";

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
} & CmsSectionEditingOptions) {
  const config = getPortalLoginPageConfig(pageKey);
  const hero = getCmsSection(content, pageKey, "hero");
  const form = getCmsSection(content, pageKey, "loginForm");
  const promoFloat = content.sections.find(
    (section) => section.id === "promoFloat",
  );

  const editingOptions = { editing, selectedSectionId, onSelectSection };

  const highlight = hero.text.highlight;
  return (
    <main id={mainId ?? undefined} className="login-page">
      <section className="login-shell">
        <header
          {...cmsEditableSectionProps(hero, "login-head", editingOptions)}
        >
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

        <section
          {...cmsEditableSectionProps(form, "login-card", editingOptions)}
        >
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
      {promoFloat ? (
        <HomePromoFloat
          section={promoFloat}
          editing={editing}
          selectedSectionId={selectedSectionId}
          onSelectSection={onSelectSection}
        />
      ) : null}
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
