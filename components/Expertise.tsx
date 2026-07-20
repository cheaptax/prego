import { CmsHighlightedText } from "@/components/cms/CmsHighlightedText";
import type { CmsSection } from "@/lib/cms/schemas";
import { cmsSectionRootProps } from "@/lib/cms/style-runtime";

type Item = {
  illustration: React.ReactNode;
};

const ITEMS: Item[] = [
  {
    illustration: (
      <svg viewBox="0 0 80 80" width="64" height="64" aria-hidden="true">
        <rect x="14" y="10" width="52" height="60" rx="8" fill="#D7E8FF" />
        <rect x="22" y="20" width="36" height="6" rx="2" fill="#3182F6" />
        <rect x="22" y="32" width="28" height="3" rx="1.5" fill="#7DB2FF" />
        <rect x="22" y="40" width="32" height="3" rx="1.5" fill="#7DB2FF" />
        <rect x="22" y="48" width="22" height="3" rx="1.5" fill="#7DB2FF" />
        <circle cx="58" cy="56" r="10" fill="#3182F6" />
        <path
          d="M53 56 L57 60 L63 53"
          stroke="#fff"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    ),
  },
  {
    illustration: (
      <svg viewBox="0 0 80 80" width="64" height="64" aria-hidden="true">
        <rect x="18" y="14" width="44" height="52" rx="6" fill="#D7E8FF" />
        <rect x="26" y="24" width="20" height="4" rx="2" fill="#3182F6" />
        <rect x="26" y="34" width="28" height="3" rx="1.5" fill="#7DB2FF" />
        <rect x="26" y="42" width="22" height="3" rx="1.5" fill="#7DB2FF" />
        <circle cx="56" cy="56" r="14" fill="#FFD43B" />
        <text
          x="56"
          y="61"
          textAnchor="middle"
          fontFamily="'Pretendard Variable', sans-serif"
          fontWeight="800"
          fontSize="14"
          fill="#191F28"
        >
          ₩
        </text>
      </svg>
    ),
  },
  {
    illustration: (
      <svg viewBox="0 0 80 80" width="64" height="64" aria-hidden="true">
        <rect x="10" y="34" width="60" height="36" rx="4" fill="#D7E8FF" />
        <path
          d="M20 34 L30 22 L40 34"
          fill="#3182F6"
          stroke="#3182F6"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <rect x="26" y="46" width="8" height="14" fill="#fff" />
        <path
          d="M50 34 C 48 24, 56 18, 62 22 C 64 28, 58 36, 50 34 Z"
          fill="#00A862"
        />
        <line
          x1="50"
          y1="34"
          x2="62"
          y2="22"
          stroke="#087F5B"
          strokeWidth="1.6"
        />
      </svg>
    ),
  },
  {
    illustration: (
      <svg viewBox="0 0 80 80" width="64" height="64" aria-hidden="true">
        <rect x="14" y="10" width="52" height="60" rx="8" fill="#D7E8FF" />
        <rect x="22" y="20" width="36" height="14" rx="3" fill="#fff" />
        <rect x="22" y="38" width="8" height="8" rx="1.6" fill="#3182F6" />
        <rect x="32" y="38" width="8" height="8" rx="1.6" fill="#7DB2FF" />
        <rect x="42" y="38" width="8" height="8" rx="1.6" fill="#7DB2FF" />
        <rect x="22" y="48" width="8" height="8" rx="1.6" fill="#7DB2FF" />
        <rect x="32" y="48" width="8" height="8" rx="1.6" fill="#3182F6" />
        <rect x="42" y="48" width="8" height="8" rx="1.6" fill="#7DB2FF" />
        <text
          x="40"
          y="30"
          textAnchor="middle"
          fontFamily="'Pretendard Variable', sans-serif"
          fontWeight="800"
          fontSize="9"
          fill="#3182F6"
        >
          %
        </text>
      </svg>
    ),
  },
];

export function Expertise({ section }: { section: CmsSection }) {
  const items = section.items.filter((item) => item.visible && !item.deleted);
  return (
    <section {...cmsSectionRootProps(section, "section")} id="expertise">
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

      <div className="expertise">
        {items.map((item, index) => (
          <article className="expertise__card" key={item.id}>
            <div className="expertise__art">{ITEMS[index]?.illustration}</div>
            <span className="expertise__highlight">{item.value}</span>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
