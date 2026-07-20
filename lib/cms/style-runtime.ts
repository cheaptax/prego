import type { CSSProperties } from "react";
import type {
  CmsSection,
  CmsTypographyStyle,
} from "@/lib/cms/schemas";

const COLORS = {
  text: "#172033",
  muted: "#667085",
  primary: "#3182f6",
  white: "#ffffff",
  surface: "#ffffff",
  softBlue: "#eaf3ff",
  softGray: "#f5f7fa",
  softGreen: "#eaf8f1",
  softYellow: "#fff4df",
} as const;

const FONTS = {
  pretendard: "'Pretendard Variable', Pretendard, sans-serif",
  system: "Arial, sans-serif",
  serif: "Georgia, 'Noto Serif KR', serif",
} as const;

const LINE_HEIGHT = { compact: 1.3, default: 1.55, relaxed: 1.8 } as const;
const SPACING = { compact: 40, default: 0, relaxed: 88 } as const;

type CmsStyleProperties = CSSProperties & Record<`--cms-${string}`, string>;

function setTypographyVariables(
  style: CmsStyleProperties,
  prefix: "title" | "body",
  typography: CmsTypographyStyle,
) {
  if (typography.customSizePx) {
    style[`--cms-${prefix}-size-desktop`] =
      `${typography.customSizePx.desktop}px`;
    style[`--cms-${prefix}-size-tablet`] =
      `${typography.customSizePx.tablet ?? typography.customSizePx.desktop}px`;
    style[`--cms-${prefix}-size-mobile`] =
      `${typography.customSizePx.mobile ?? typography.customSizePx.tablet ?? typography.customSizePx.desktop}px`;
  }
  if (typography.customLineHeight) {
    style[`--cms-${prefix}-line-desktop`] = String(
      typography.customLineHeight.desktop,
    );
    style[`--cms-${prefix}-line-tablet`] = String(
      typography.customLineHeight.tablet ??
        typography.customLineHeight.desktop,
    );
    style[`--cms-${prefix}-line-mobile`] = String(
      typography.customLineHeight.mobile ??
        typography.customLineHeight.tablet ??
        typography.customLineHeight.desktop,
    );
  } else if (typography.lineHeightPreset !== "default") {
    style[`--cms-${prefix}-line`] = String(
      LINE_HEIGHT[typography.lineHeightPreset],
    );
  }
  if (typography.fontFamily !== "pretendard") {
    style[`--cms-${prefix}-font`] = FONTS[typography.fontFamily];
  }
  const defaultWeight = prefix === "title" ? "700" : "400";
  if (typography.fontWeight !== defaultWeight) {
    style[`--cms-${prefix}-weight`] = typography.fontWeight;
  }
  if (typography.alignment !== "left") {
    style[`--cms-${prefix}-align`] = typography.alignment;
  }
  const defaultColor = prefix === "title" ? "text" : "muted";
  if (typography.color !== defaultColor) {
    style[`--cms-${prefix}-color`] = COLORS[typography.color];
  }
}

export function cmsSectionRootProps(
  section: CmsSection,
  className: string,
): { className: string; style: CmsStyleProperties } {
  const style = {} as CmsStyleProperties;
  const classes = [
    className,
    "cms-public-section",
    `cms-title-${section.style.title.sizePreset}`,
    `cms-body-${section.style.body.sizePreset}`,
  ];
  setTypographyVariables(style, "title", section.style.title);
  setTypographyVariables(style, "body", section.style.body);
  if (section.style.title.customSizePx) classes.push("cms-has-title-size");
  if (
    section.style.title.customLineHeight ||
    section.style.title.lineHeightPreset !== "default"
  ) {
    classes.push("cms-has-title-line");
  }
  if (section.style.title.fontFamily !== "pretendard") {
    classes.push("cms-has-title-font");
  }
  if (section.style.title.fontWeight !== "700") {
    classes.push("cms-has-title-weight");
  }
  if (section.style.title.alignment !== "left") {
    classes.push("cms-has-title-align");
  }
  if (section.style.title.color !== "text") {
    classes.push("cms-has-title-color");
  }
  if (section.style.body.customSizePx) classes.push("cms-has-body-size");
  if (
    section.style.body.customLineHeight ||
    section.style.body.lineHeightPreset !== "default"
  ) {
    classes.push("cms-has-body-line");
  }
  if (section.style.body.fontFamily !== "pretendard") {
    classes.push("cms-has-body-font");
  }
  if (section.style.body.fontWeight !== "400") {
    classes.push("cms-has-body-weight");
  }
  if (section.style.body.alignment !== "left") {
    classes.push("cms-has-body-align");
  }
  if (section.style.body.color !== "muted") {
    classes.push("cms-has-body-color");
  }
  const container = section.style.container;
  if (container.background !== "surface") {
    style.backgroundColor = COLORS[container.background];
  }
  if (container.customPaddingY) {
    classes.push("cms-has-container-padding");
    style["--cms-padding-desktop"] = `${container.customPaddingY.desktop}px`;
    style["--cms-padding-tablet"] =
      `${container.customPaddingY.tablet ?? container.customPaddingY.desktop}px`;
    style["--cms-padding-mobile"] =
      `${container.customPaddingY.mobile ?? container.customPaddingY.tablet ?? container.customPaddingY.desktop}px`;
  } else if (container.spacing !== "default") {
    classes.push("cms-has-container-padding");
    style["--cms-padding-desktop"] = `${SPACING[container.spacing]}px`;
    style["--cms-padding-tablet"] = `${SPACING[container.spacing]}px`;
    style["--cms-padding-mobile"] = `${Math.max(SPACING[container.spacing] - 12, 20)}px`;
  }
  if (container.border !== "none") {
    style.border =
      container.border === "strong"
        ? "2px solid #98a2b3"
        : "1px solid #d0d5dd";
  }
  if (container.radius !== "default") {
    style.borderRadius = container.radius === "square" ? 0 : 28;
  }
  if (container.shadow !== "none") {
    style.boxShadow =
      container.shadow === "medium"
        ? "0 18px 42px rgba(23, 32, 51, 0.16)"
        : "0 8px 22px rgba(23, 32, 51, 0.09)";
  }
  return { className: classes.join(" "), style };
}
