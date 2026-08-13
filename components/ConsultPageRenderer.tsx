import { ConsultForm } from "@/components/ConsultForm";
import { ConsultSteps } from "@/components/ConsultSteps";
import { CmsSupplementalSections } from "@/components/cms/CmsSupplementalSections";
import {
  cmsEditableSectionProps,
  type CmsSectionEditingOptions,
} from "@/lib/cms/editable-section";
import { getCmsSection } from "@/lib/cms/runtime";
import type { CmsPageContent } from "@/lib/cms/schemas";

export function ConsultPageRenderer({
  content,
  mainId = "main",
  editing = false,
  previewMode = false,
  selectedSectionId,
  onSelectSection,
}: {
  content: CmsPageContent;
  mainId?: string | null;
  previewMode?: boolean;
} & CmsSectionEditingOptions) {
  const steps = getCmsSection(content, "public.consult", "steps");
  const hero = getCmsSection(content, "public.consult", "hero");
  const editingOptions = { editing, selectedSectionId, onSelectSection };

  return (
    <main
      id={mainId ?? undefined}
      className="consult-page consult-page--compact"
    >
      <div
        {...cmsEditableSectionProps(
          steps,
          "consult-steps-cms-root",
          editingOptions,
        )}
      >
        <ConsultSteps section={steps} />
      </div>
      <section className="consult-shell">
        <header
          {...cmsEditableSectionProps(
            hero,
            "consult-shell__head",
            editingOptions,
          )}
        >
          <span className="consult-shell__eyebrow">
            <span className="dot" aria-hidden="true" />
            {hero.eyebrow}
          </span>
          <h1 className="consult-shell__title">{hero.title}</h1>
        </header>
        <ConsultForm
          content={content}
          previewMode={previewMode}
          {...editingOptions}
        />
      </section>
      <CmsSupplementalSections
        pageKey="public.consult"
        content={content}
        editing={editing}
        selectedSectionId={selectedSectionId}
        onSelectSection={onSelectSection}
      />
    </main>
  );
}
