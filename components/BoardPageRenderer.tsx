import { FaqBoard } from "@/components/FaqBoard";
import { InquiryBoard } from "@/components/InquiryBoard";
import { getCmsSection } from "@/lib/cms/runtime";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";
import { cmsSectionRootProps } from "@/lib/cms/style-runtime";

type BoardPageKey = "public.inquiries" | "public.faq";

export function BoardPageRenderer({
  pageKey,
  content,
  mainId = "main",
  editing = false,
  previewMode = false,
  selectedSectionId,
  onSelectSection,
}: {
  pageKey: BoardPageKey;
  content: CmsPageContent;
  mainId?: string | null;
  editing?: boolean;
  previewMode?: boolean;
  selectedSectionId?: string;
  onSelectSection?: (sectionId: string) => void;
}) {
  const hero = getCmsSection(content, pageKey, "hero");

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
    <main id={mainId ?? undefined} className="inquiries-page">
      <section {...sectionProps(hero, "inquiries-hero")}>
        <span className="kicker">{hero.eyebrow}</span>
        <h1 className="inquiries-hero__title">
          {hero.title.split(/\n+/).map((line, index) => {
            const start = highlight ? line.indexOf(highlight) : -1;
            return (
              <span className="inquiries-hero__line" key={`${line}-${index}`}>
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
        <p>{hero.description}</p>
      </section>
      <div
        className={
          editing && selectedSectionId !== "hero"
            ? "cms-home-edit-section is-selected"
            : undefined
        }
        onClick={
          editing
            ? () =>
                onSelectSection?.(
                  selectedSectionId === "list" ? "list" : "filters",
                )
            : undefined
        }
      >
        {pageKey === "public.inquiries" ? (
          <InquiryBoard content={content} previewMode={previewMode} />
        ) : (
          <FaqBoard content={content} />
        )}
      </div>
    </main>
  );
}
