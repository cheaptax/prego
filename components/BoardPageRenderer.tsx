import { FaqBoard } from "@/components/FaqBoard";
import { InquiryBoard } from "@/components/InquiryBoard";
import { CmsSupplementalSections } from "@/components/cms/CmsSupplementalSections";
import {
  cmsEditableSectionProps,
  type CmsSectionEditingOptions,
} from "@/lib/cms/editable-section";
import { getCmsSection } from "@/lib/cms/runtime";
import type { CmsPageContent } from "@/lib/cms/schemas";

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
  previewMode?: boolean;
} & CmsSectionEditingOptions) {
  const hero = getCmsSection(content, pageKey, "hero");
  const editingOptions = { editing, selectedSectionId, onSelectSection };

  const highlight = hero.text.highlight;
  return (
    <main id={mainId ?? undefined} className="inquiries-page">
      <section
        {...cmsEditableSectionProps(hero, "inquiries-hero", editingOptions)}
      >
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
      {pageKey === "public.inquiries" ? (
        <InquiryBoard
          content={content}
          previewMode={previewMode}
          {...editingOptions}
        />
      ) : (
        <FaqBoard content={content} {...editingOptions} />
      )}
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
