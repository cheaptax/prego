import { HeroArt } from "./HeroArt";
import { ConsultRequestLink } from "./ConsultRequestLink";
import type { CmsSection } from "@/lib/cms/schemas";
import { cmsSectionRootProps } from "@/lib/cms/style-runtime";

export function Hero({
  section,
  imageUrl,
}: {
  section: CmsSection;
  imageUrl?: string;
}) {
  const stats =
    section.groups.find(
      (group) => group.id === "serviceSummary" && group.visible,
    )?.items.filter(
      (item) => item.visible && !item.deleted,
    ) ?? [];
  const [consultAction, servicesAction] = section.actions;
  return (
    <section {...cmsSectionRootProps(section, "hero")}>
      <div className="hero__inner">
        <span className="hero__eyebrow">
          <span className="dot" aria-hidden="true" />
          {section.eyebrow}
        </span>

        <h1 className="hero__title">
          {section.title.split(/\n+/).map((line) => (
            <span className="line" key={line}>{line}</span>
          ))}
          <span className="line">
            <em>{section.text.highlight}</em>
          </span>
        </h1>

        <p className="hero__lede">
          {section.description?.split(/\n+/).map((line, index) => (
            <span key={`${line}-${index}`}>
              {index > 0 ? <br /> : null}
              {line}
            </span>
          ))}
        </p>

        <div className="hero__actions">
          {consultAction ? (
            <ConsultRequestLink className="cta cta--solid">
              {consultAction.label}
            </ConsultRequestLink>
          ) : null}
          {servicesAction ? (
            <a className="cta cta--ghost" href={servicesAction.href}>
              {servicesAction.label}
            </a>
          ) : null}
        </div>
      </div>

      <div className="hero__art">
        {section.media && imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- CMS assets are validated, versioned Firebase Storage files.
          <img
            className="hero__cms-image"
            src={imageUrl}
            alt={section.media.alt}
          />
        ) : (
          <HeroArt />
        )}
      </div>

      <div className="hero__kpi">
        <ul className="hero__stats" aria-label="서비스 요약">
          {stats.map((stat) => (
            <li key={stat.id}>
              <span
                className={`stats__num${stat.id === "marketShare" ? " stats__num--wide" : ""}`}
              >
                {stat.title}
              </span>
              <span className="stats__label">{stat.description}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
