import { SignupForm } from "@/components/SignupForm";
import { getCmsSection } from "@/lib/cms/runtime";
import type { CmsPageContent } from "@/lib/cms/schemas";

export function SignupPageRenderer({
  content,
  mainId = "main",
  previewMode = false,
}: {
  content: CmsPageContent;
  mainId?: string | null;
  previewMode?: boolean;
}) {
  const hero = getCmsSection(content, "auth.signup", "hero");
  const progress = hero.items.filter((item) => item.visible && !item.deleted);
  return (
    <main id={mainId ?? undefined} className="signup-page">
      <section className="signup-shell">
        <header className="signup-head">
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
        <SignupForm content={content} previewMode={previewMode} />
      </section>
    </main>
  );
}
