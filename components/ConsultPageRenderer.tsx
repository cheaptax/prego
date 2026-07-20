import { ConsultForm } from "@/components/ConsultForm";
import { ConsultSteps } from "@/components/ConsultSteps";
import { getCmsSection } from "@/lib/cms/runtime";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";
import { cmsSectionRootProps } from "@/lib/cms/style-runtime";

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
  editing?: boolean;
  previewMode?: boolean;
  selectedSectionId?: string;
  onSelectSection?: (sectionId: string) => void;
}) {
  const steps = getCmsSection(content, "public.consult", "steps");
  const hero = getCmsSection(content, "public.consult", "hero");

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

  return (
    <main
      id={mainId ?? undefined}
      className="consult-page consult-page--compact"
    >
      <div {...sectionProps(steps, "consult-steps-cms-root")}>
        <ConsultSteps section={steps} />
      </div>
      <section className="consult-shell">
        <header {...sectionProps(hero, "consult-shell__head")}>
          <span className="consult-shell__eyebrow">
            <span className="dot" aria-hidden="true" />
            {hero.eyebrow}
          </span>
          <h1 className="consult-shell__title">{hero.title}</h1>
        </header>
        <div
          className={
            editing &&
            selectedSectionId &&
            ["categorySelector", "visibilitySelector", "requestFields"].includes(
              selectedSectionId,
            )
              ? "cms-home-edit-section is-selected"
              : undefined
          }
          onClick={
            editing
              ? () => onSelectSection?.("requestFields")
              : undefined
          }
        >
          <ConsultForm content={content} previewMode={previewMode} />
        </div>
      </section>
    </main>
  );
}
