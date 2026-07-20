"use client";

import type { CSSProperties, KeyboardEvent } from "react";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";

export type CmsPreviewDevice = "desktop" | "tablet" | "mobile";

const COLOR_VALUES = {
  text: "#172033",
  muted: "#667085",
  primary: "#2f6fed",
  white: "#ffffff",
  surface: "#ffffff",
  softBlue: "#edf4ff",
  softGray: "#f5f7fa",
  softGreen: "#eaf8f1",
  softYellow: "#fff4df",
} as const;

const FONT_VALUES = {
  pretendard: "Pretendard, Inter, sans-serif",
  system: "Arial, sans-serif",
  serif: "Georgia, 'Noto Serif KR', serif",
} as const;

const TITLE_SIZE = {
  small: 26,
  default: 34,
  large: 44,
} as const;

const BODY_SIZE = {
  small: 14,
  default: 16,
  large: 19,
} as const;

const LINE_HEIGHT = {
  compact: 1.3,
  default: 1.55,
  relaxed: 1.8,
} as const;

const SPACING = {
  compact: 28,
  default: 48,
  relaxed: 72,
} as const;

function responsiveValue(
  values: { desktop: number; tablet?: number; mobile?: number } | undefined,
  device: CmsPreviewDevice,
) {
  if (!values) return undefined;
  if (device === "mobile") return values.mobile ?? values.tablet ?? values.desktop;
  if (device === "tablet") return values.tablet ?? values.desktop;
  return values.desktop;
}

function typographyStyle(
  section: CmsSection,
  target: "title" | "body",
  device: CmsPreviewDevice,
): CSSProperties {
  const style = section.style[target];
  const preset = target === "title" ? TITLE_SIZE : BODY_SIZE;
  return {
    color: COLOR_VALUES[style.color],
    fontFamily: FONT_VALUES[style.fontFamily],
    fontSize: responsiveValue(style.customSizePx, device) ?? preset[style.sizePreset],
    fontWeight: Number(style.fontWeight),
    lineHeight:
      responsiveValue(style.customLineHeight, device) ??
      LINE_HEIGHT[style.lineHeightPreset],
    textAlign: style.alignment,
  };
}

function sectionStyle(
  section: CmsSection,
  device: CmsPreviewDevice,
): CSSProperties {
  const style = section.style.container;
  const paddingY =
    responsiveValue(style.customPaddingY, device) ?? SPACING[style.spacing];
  return {
    background: COLOR_VALUES[style.background],
    padding: `${paddingY}px ${device === "mobile" ? 20 : 36}px`,
    border:
      style.border === "none"
        ? "none"
        : style.border === "strong"
          ? "2px solid #9aa4b2"
          : "1px solid #d9dee7",
    borderRadius:
      style.radius === "square" ? 0 : style.radius === "rounded" ? 28 : 14,
    boxShadow:
      style.shadow === "none"
        ? "none"
        : style.shadow === "medium"
          ? "0 18px 42px rgba(23, 32, 51, 0.16)"
          : "0 8px 22px rgba(23, 32, 51, 0.09)",
  };
}

function activateSection(
  event: KeyboardEvent<HTMLElement>,
  sectionId: string,
  onSelect?: (sectionId: string) => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  onSelect?.(sectionId);
}

export function CmsPageRenderer({
  content,
  device,
  selectedSectionId,
  assetUrls,
  editing = false,
  onSelectSection,
}: {
  content: CmsPageContent;
  device: CmsPreviewDevice;
  selectedSectionId?: string;
  assetUrls?: Record<string, string>;
  editing?: boolean;
  onSelectSection?: (sectionId: string) => void;
}) {
  return (
    <main className={`cms-page-renderer is-${device}`}>
      {content.sections.map((section) => {
        if (!section.visible && !editing) return null;
        const Heading = section.headingLevel === 3 ? "h3" : "h2";
        const media = section.media?.deleted ? undefined : section.media;
        const imageUrl = media
          ? assetUrls?.[media.assetId]
          : undefined;
        return (
          <section
            className={[
              "cms-rendered-section",
              selectedSectionId === section.id ? "is-selected" : "",
              !section.visible ? "is-hidden" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            key={section.id}
            style={sectionStyle(section, device)}
            onClick={() => onSelectSection?.(section.id)}
            onKeyDown={(event) =>
              activateSection(event, section.id, onSelectSection)
            }
            tabIndex={editing ? 0 : undefined}
            role={editing ? "button" : undefined}
            aria-label={
              editing ? `${section.title} 영역 편집 설정 열기` : undefined
            }
          >
            {!section.visible ? (
              <span className="cms-rendered-section__hidden">현재 숨긴 영역</span>
            ) : null}
            <div className="cms-rendered-section__copy">
              {section.eyebrow ? (
                <span className="cms-rendered-section__eyebrow">
                  {section.eyebrow}
                </span>
              ) : null}
              <Heading style={typographyStyle(section, "title", device)}>
                {section.title || "제목을 입력해 주세요"}
              </Heading>
              {section.description ? (
                <p style={typographyStyle(section, "body", device)}>
                  {section.description}
                </p>
              ) : null}
              {section.actions.length > 0 ? (
                <div className="cms-rendered-actions">
                  {section.actions.map((action) => (
                    <a
                      className={`is-${action.appearance}`}
                      href={action.href || "#"}
                      key={action.id}
                      onClick={(event) => event.preventDefault()}
                    >
                      {action.label || "버튼 문구"}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
            {media ? (
              imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- authenticated draft Storage URLs are runtime-only.
                <img
                  className={`cms-rendered-section__image is-${media.aspectRatio.replace(":", "-")}`}
                  src={imageUrl}
                  alt={media.alt}
                />
              ) : (
                <div className="cms-rendered-section__image-placeholder" role="status">
                  이미지를 준비하고 있습니다.
                </div>
              )
            ) : null}
            {section.items.some((item) => !item.deleted && item.visible) ? (
              <div className="cms-rendered-items">
                {section.items
                  .filter((item) => !item.deleted && item.visible)
                  .map((item) => (
                    <article key={item.id}>
                      {item.label ? <span>{item.label}</span> : null}
                      <strong>{item.title || "항목 제목"}</strong>
                      {item.description ? <p>{item.description}</p> : null}
                      {item.value ? <em>{item.value}</em> : null}
                    </article>
                  ))}
              </div>
            ) : null}
          </section>
        );
      })}
      {Object.keys(content.messages).length > 0 ? (
        <section className="cms-rendered-messages" aria-label="화면 안내 문구">
          {Object.values(content.messages).map((message, index) => (
            <p key={`${message}-${index}`}>{message}</p>
          ))}
        </section>
      ) : null}
    </main>
  );
}
