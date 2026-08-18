import type {
  QuoteScreenLayoutFamily,
  QuoteScreenSectionConfig,
  QuoteScreenSectionId,
  QuoteScreenTheme,
} from "@/lib/quotes/quote-screen-profile";
import {
  DEFAULT_QUOTE_SCREEN_SECTIONS,
  DEFAULT_QUOTE_SCREEN_THEME,
  REQUIRED_QUOTE_SCREEN_SECTION_IDS,
} from "@/lib/quotes/quote-screen-profile";

export type QuotePdfLayout = {
  pagePaddingTop: number;
  pagePaddingHorizontal: number;
  subjectAlign: "left" | "center" | "right";
  brandDirection: "row" | "column";
  metaSide: "right" | "left";
  dense: boolean;
  evaluationPlacement: "afterPrices";
  tableChrome: "banded" | "formal" | "ledger" | "letterhead" | "card";
};

const LAYOUTS: Record<QuoteScreenLayoutFamily, QuotePdfLayout> = {
  classicNavy: {
    pagePaddingTop: 44,
    pagePaddingHorizontal: 32,
    subjectAlign: "left",
    brandDirection: "row",
    metaSide: "right",
    dense: false,
    evaluationPlacement: "afterPrices",
    tableChrome: "banded",
  },
  formalCentered: {
    pagePaddingTop: 48,
    pagePaddingHorizontal: 36,
    subjectAlign: "center",
    brandDirection: "row",
    metaSide: "right",
    dense: false,
    evaluationPlacement: "afterPrices",
    tableChrome: "formal",
  },
  compactLedger: {
    pagePaddingTop: 38,
    pagePaddingHorizontal: 28,
    subjectAlign: "left",
    brandDirection: "row",
    metaSide: "right",
    dense: true,
    evaluationPlacement: "afterPrices",
    tableChrome: "ledger",
  },
  letterheadLeft: {
    pagePaddingTop: 46,
    pagePaddingHorizontal: 36,
    subjectAlign: "left",
    brandDirection: "column",
    metaSide: "left",
    dense: false,
    evaluationPlacement: "afterPrices",
    tableChrome: "letterhead",
  },
  evaluationFirst: {
    pagePaddingTop: 44,
    pagePaddingHorizontal: 32,
    subjectAlign: "center",
    brandDirection: "row",
    metaSide: "right",
    dense: false,
    evaluationPlacement: "afterPrices",
    tableChrome: "card",
  },
};

export function quotePdfLayoutFor(
  layoutFamily: QuoteScreenLayoutFamily | undefined,
) {
  return LAYOUTS[layoutFamily ?? "classicNavy"] ?? LAYOUTS.classicNavy;
}

export function quotePdfTheme(theme: QuoteScreenTheme | undefined) {
  return { ...DEFAULT_QUOTE_SCREEN_THEME, ...(theme ?? {}) };
}

export function normalizePdfSections(
  sections: readonly QuoteScreenSectionConfig[] | undefined,
) {
  const byId = new Map<QuoteScreenSectionId, QuoteScreenSectionConfig>();
  for (const section of sections ?? []) {
    byId.set(section.id, section);
  }
  return DEFAULT_QUOTE_SCREEN_SECTIONS.map((fallback) => {
    const override = byId.get(fallback.id);
    const required = REQUIRED_QUOTE_SCREEN_SECTION_IDS.has(fallback.id);
    return {
      ...fallback,
      ...override,
      visible: required ? true : override?.visible ?? fallback.visible,
      titleOverride: override?.titleOverride?.trim() || undefined,
    };
  }).sort((left, right) => left.order - right.order);
}
