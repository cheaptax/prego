import Link from "next/link";
import { HeroArt } from "./HeroArt";
import { ConsultRequestLink } from "./ConsultRequestLink";
import type { CmsLink, CmsSection } from "@/lib/cms/schemas";
import { cmsSectionRootProps } from "@/lib/cms/style-runtime";

function heroActionClassName(appearance: CmsLink["appearance"]) {
  if (appearance === "primary") return "cta cta--solid";
  if (appearance === "secondary") return "cta cta--ghost";
  return "cta cta--text";
}

function HeroAction({ action }: { action: CmsLink }) {
  const className = heroActionClassName(action.appearance);
  const isConsult =
    action.id === "startConsult" || action.href === "/consult";
  if (isConsult) {
    return (
      <ConsultRequestLink className={className}>
        {action.label}
      </ConsultRequestLink>
    );
  }
  if (action.linkType === "internal") {
    return (
      <Link
        className={className}
        href={action.href}
        target={action.openInNewWindow ? "_blank" : undefined}
        rel={action.openInNewWindow ? "noopener noreferrer" : undefined}
      >
        {action.label}
      </Link>
    );
  }
  return (
    <a
      className={className}
      href={action.href}
      target={action.openInNewWindow ? "_blank" : undefined}
      rel={action.openInNewWindow ? "noopener noreferrer" : undefined}
    >
      {action.label}
    </a>
  );
}

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
          {section.actions.map((action) => (
            <HeroAction action={action} key={action.id} />
          ))}
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
