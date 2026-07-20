import Link from "next/link";
import { CmsHighlightedText } from "@/components/cms/CmsHighlightedText";
import type { CmsSection } from "@/lib/cms/schemas";
import { cmsSectionRootProps } from "@/lib/cms/style-runtime";

export function CaseStudies({ section }: { section: CmsSection }) {
  const cases = section.items.filter((item) => item.visible && !item.deleted);
  const action = section.actions[0];
  return (
    <section
      {...cmsSectionRootProps(section, "section section--alt")}
      id="cases"
    >
      <div className="section__head">
        <span className="kicker">{section.eyebrow}</span>
        <h2 className="display">
          <CmsHighlightedText
            text={section.title}
            highlight={section.text.highlight}
          />
        </h2>
        <p className="section__lede">
          {section.description}
        </p>
        {action ? (
          <Link className="cta cta--solid case__cta" href={action.href}>
            {action.label}
          </Link>
        ) : null}
      </div>

      <div className="cases cases--scope">
        {cases.map((item) => (
          <article className="case case--scope" key={item.id}>
            <div className="case__body">
              <span className="case__badge">{item.label}</span>
              <h3>{item.title}</h3>
              <p className="case__desc">{item.description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
