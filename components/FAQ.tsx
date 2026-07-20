import Link from "next/link";
import { CmsHighlightedText } from "@/components/cms/CmsHighlightedText";
import type { CmsSection } from "@/lib/cms/schemas";
import { cmsSectionRootProps } from "@/lib/cms/style-runtime";

export function FAQ({ section }: { section: CmsSection }) {
  const items = section.items.filter((item) => item.visible && !item.deleted);
  const action = section.actions[0];
  return (
    <section {...cmsSectionRootProps(section, "section")} id="faq">
      <div className="section__head">
        <span className="kicker">{section.eyebrow}</span>
        <h2 className="display">
          <CmsHighlightedText
            text={section.title}
            highlight={section.text.highlight}
          />
        </h2>
      </div>

      <div className="faq__list-head">
        <strong>{section.text.listTitle}</strong>
        {action ? (
          <Link className="faq__all-link" href={action.href}>
            {action.label}
          </Link>
        ) : null}
      </div>
      <div className="faq">
        {items.map((item, index) => (
          <details className="faq__item" key={item.id} open={index === 0}>
            <summary>
              <span className="faq__meta">
                <span className="faq__category">{item.label}</span>
                <span className="faq__q">{item.title}</span>
              </span>
              <span className="faq__chev" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 18 18">
                  <path
                    d="M5 7 L9 11 L13 7"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </svg>
              </span>
            </summary>
            <div className="faq__a">
              {(item.description ?? "")
                .split(/\n+/)
                .map((paragraph, paragraphIndex) => (
                  <p key={`${item.id}-${paragraphIndex}`}>{paragraph}</p>
                ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
