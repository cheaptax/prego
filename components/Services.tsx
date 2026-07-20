import { CmsHighlightedText } from "@/components/cms/CmsHighlightedText";
import type { CmsSection } from "@/lib/cms/schemas";
import { cmsSectionRootProps } from "@/lib/cms/style-runtime";
import type { ServiceIconName } from "@/lib/platform";
import { ConsultRequestLink } from "./ConsultRequestLink";
import { ServiceIcon } from "./ServiceIcon";

const SERVICE_ICONS = new Set<ServiceIconName>([
  "tax",
  "audit",
  "subsidy",
  "ledger",
  "shield",
  "feasibility",
  "valuation",
  "control",
  "refund",
  "investigation",
  "structure",
]);

export function Services({ section }: { section: CmsSection }) {
  const services = section.items.filter((item) => item.visible && !item.deleted);
  const bonus = section.groups.find(
    (group) => group.id === "multiFieldRequest" && group.visible,
  );
  const bonusAction = bonus?.actions[0];
  return (
    <section {...cmsSectionRootProps(section, "section")} id="services">
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
      </div>

      <ol className="services">
        {services.map((service) => {
          const icon =
            service.value && SERVICE_ICONS.has(service.value as ServiceIconName)
              ? (service.value as ServiceIconName)
              : "tax";
          return (
          <li className="svc" key={service.id}>
            <span className="svc__icon" aria-hidden="true">
              <ServiceIcon name={icon} />
            </span>
            <div className="svc__body">
              <h3>{service.title}</h3>
              <p>{service.description}</p>
            </div>
          </li>
          );
        })}
      </ol>

      <aside className="bonus">
        <div className="bonus__badge">{bonus?.label}</div>
        <div className="bonus__body">
          <h3>{bonus?.title}</h3>
        </div>
        {bonusAction ? (
          <ConsultRequestLink className="bonus__link">
            {bonusAction.label} <span aria-hidden="true">→</span>
          </ConsultRequestLink>
        ) : null}
      </aside>
    </section>
  );
}
