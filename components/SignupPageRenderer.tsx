import { SignupForm } from "@/components/SignupForm";
import { CmsSupplementalSections } from "@/components/cms/CmsSupplementalSections";
import {
  cmsEditableSectionProps,
  type CmsSectionEditingOptions,
} from "@/lib/cms/editable-section";
import { getCmsSection } from "@/lib/cms/runtime";
import type { CmsPageContent } from "@/lib/cms/schemas";

export function SignupPageRenderer({
  content,
  mainId = "main",
  previewMode = false,
  editing = false,
  selectedSectionId,
  onSelectSection,
}: {
  content: CmsPageContent;
  mainId?: string | null;
  previewMode?: boolean;
} & CmsSectionEditingOptions) {
  const hero = getCmsSection(content, "auth.signup", "hero");
  const progress = hero.items.filter((item) => item.visible && !item.deleted);
  const editingOptions = { editing, selectedSectionId, onSelectSection };
  return (
    <main id={mainId ?? undefined} className="signup-page">
      <section className="signup-shell">
        <header
          {...cmsEditableSectionProps(hero, "signup-head", editingOptions)}
        >
          <h1 className="signup-head__title">{hero.title}</h1>
          <p className="signup-head__lede">{hero.description}</p>
          <ol
            className="signup-progress"
            aria-label={hero.text.progressAriaLabel}
          >
            {progress.map((item, index) => (
              <li key={item.id}>
                <span>{index + 1}</span>
                {item.title}
              </li>
            ))}
          </ol>
        </header>
        <SignupForm
          content={content}
          previewMode={previewMode}
          {...editingOptions}
        />
      </section>
      <CmsSupplementalSections
        pageKey="auth.signup"
        content={content}
        editing={editing}
        selectedSectionId={selectedSectionId}
        onSelectSection={onSelectSection}
      />
    </main>
  );
}
