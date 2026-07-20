import { CmsHighlightedText } from "@/components/cms/CmsHighlightedText";
import type { CmsSection } from "@/lib/cms/schemas";
import { cmsSectionRootProps } from "@/lib/cms/style-runtime";

export function Process({ section }: { section: CmsSection }) {
  const steps = section.items.filter((item) => item.visible && !item.deleted);
  return (
    <section
      {...cmsSectionRootProps(section, "quote-band")}
      id="process"
      aria-label={section.text.ariaLabel}
    >
      <figure>
        <blockquote>
          <CmsHighlightedText
            text={section.title}
            highlight={section.text.highlight}
          />
        </blockquote>
        <figcaption>
          {section.eyebrow} <span>{section.text.captionSuffix}</span>
        </figcaption>
      </figure>

      <ol className="steps">
        {steps.map((step) => (
          <li key={step.id}>
            <span>{step.label}</span>
            <h4>{step.title}</h4>
            <p>{step.description}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
