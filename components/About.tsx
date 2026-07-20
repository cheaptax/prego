import { CmsHighlightedText } from "@/components/cms/CmsHighlightedText";
import type { CmsSection } from "@/lib/cms/schemas";
import { cmsSectionRootProps } from "@/lib/cms/style-runtime";

export function About({ section }: { section: CmsSection }) {
  const introduction = section.groups.find(
    (group) => group.id === "introductionSummary" && group.visible,
  );
  const support = section.groups.find(
    (group) => group.id === "supportPromise" && group.visible,
  );
  const value = section.groups.find(
    (group) => group.id === "customerValue" && group.visible,
  );
  return (
    <section {...cmsSectionRootProps(section, "section")} id="about">
      <div className="about-intro">
        <div className="section__head section__head--about">
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
          <p className="section__lede">
            {section.text.secondaryDescription}
          </p>
        </div>

        <aside
          className="about-intro__panel"
          aria-label={introduction?.label}
        >
          <ul className="about-intro__points">
            {introduction?.items
              .filter((item) => item.visible && !item.deleted)
              .map((item) => (
                <li key={item.id}>
                  <span className="about-intro__icon" aria-hidden="true">
                    {item.value}
                  </span>
                  <span className="about-intro__text">
                    <strong>{item.title}</strong>
                    <span>{item.description}</span>
                  </span>
                </li>
              ))}
          </ul>
        </aside>
      </div>

      <div className="about-grid">
        <article className="about-card about-card--lead">
          <h3>
            {support?.label && support.title?.includes(support.label)
              ? support.title.slice(0, support.title.indexOf(support.label))
              : support?.title}
            {support?.label ? <span>{support.label}</span> : null}
          </h3>
          <p>{support?.description}</p>
          <ul className="about-card__list">
            {support?.items
              .filter((item) => item.visible && !item.deleted)
              .map((item) => <li key={item.id}>{item.title}</li>)}
          </ul>
        </article>

        <aside className="about-card">
          <span className="tag">{value?.label}</span>
          <h3>{value?.title}</h3>

          <dl className="meta-list">
            {value?.items
              .filter((item) => item.visible && !item.deleted)
              .map((item) => (
                <div key={item.id}>
                  <dt>{item.title}</dt>
                  <dd>{item.description}</dd>
                </div>
              ))}
          </dl>
        </aside>
      </div>
    </section>
  );
}
