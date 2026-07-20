import type { CmsSection } from "@/lib/cms/schemas";

function StepIcon({ name }: { name: "edit" | "eye" | "link" | "check" }) {
  const common = {
    viewBox: "0 0 24 24",
    width: 16,
    height: 16,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "edit":
      return (
        <svg {...common}>
          <path d="M4 20h4l10-10-4-4L4 16v4z" />
          <path d="M14 6l4 4" />
        </svg>
      );
    case "eye":
      return (
        <svg {...common}>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "link":
      return (
        <svg {...common}>
          <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
          <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="M5 12.5 L10 17.5 L19.5 8" />
        </svg>
      );
  }
}

const STEP_ICONS: Record<string, "edit" | "eye" | "link" | "check"> = {
  register: "edit",
  review: "eye",
  followup: "link",
  connection: "check",
};

export function ConsultSteps({ section }: { section: CmsSection }) {
  const steps = section.items.filter((item) => item.visible && !item.deleted);
  return (
    <section
      className="consult-steps"
      aria-label={section.text.ariaLabel}
    >
      <div className="consult-steps__inner">
        <span className="consult-steps__kicker">{section.eyebrow}</span>
        <ol className="consult-steps__list">
          {steps.map((step, idx) => (
            <li key={step.id} className="consult-steps__item">
              <span className="consult-steps__no" aria-hidden="true">
                <StepIcon name={STEP_ICONS[step.id] ?? "check"} />
              </span>
              <div className="consult-steps__body">
                <span className="consult-steps__index">
                  {section.text.stepPrefix}{" "}
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <h4>{step.title}</h4>
                {step.description ? <p>{step.description}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
