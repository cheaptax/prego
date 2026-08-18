import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import type { CmsPageContent } from "@/lib/cms/schemas";
import {
  QUOTE_DOCUMENT_COPY_KEYS,
  quoteDocumentContentFromCms,
  type QuoteDocumentContent,
  type QuoteDocumentCopy,
} from "@/lib/quotes/quote-document-content";

export const PARTNER_QUOTE_SCREEN_PROFILES_COLLECTION =
  "partnerQuoteScreenProfiles";

export const QUOTE_SCREEN_LAYOUT_FAMILIES = [
  "classicNavy",
  "formalCentered",
  "compactLedger",
  "letterheadLeft",
  "evaluationFirst",
] as const;

export type QuoteScreenLayoutFamily =
  (typeof QUOTE_SCREEN_LAYOUT_FAMILIES)[number];

export type QuoteScreenSectionId =
  | "supplierHeader"
  | "recipient"
  | "credentials"
  | "quoteItems"
  | "conditions"
  | "comparisonQr"
  | "evaluationFacts"
  | "quantitativeEvaluation"
  | "acceptance"
  | "footer";

export type QuoteScreenSectionConfig = {
  id: QuoteScreenSectionId;
  visible: boolean;
  order: number;
  titleOverride?: string;
};

export type QuoteScreenTheme = {
  primary: string;
  accent: string;
  ink: string;
  muted: string;
  surface: string;
  subtle: string;
  titleAlignment: "left" | "center" | "right";
  spacing: "compact" | "default" | "relaxed";
};

export type QuoteScreenProfile = {
  layoutFamily: QuoteScreenLayoutFamily;
  sections: QuoteScreenSectionConfig[];
  copy: Partial<Record<keyof QuoteDocumentCopy, string>>;
  theme: QuoteScreenTheme;
  updatedBy: string;
  updatedByEmail?: string;
  updatedAt: string;
};

export type PartnerQuoteScreenProfileRecord = {
  id: string;
  partnerId: string;
  draft?: QuoteScreenProfile;
  published?: QuoteScreenProfile & {
    version: number;
    publishedBy: string;
    publishedByEmail?: string;
    publishedAt: string;
  };
  createdAt: string;
  updatedAt: string;
};

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/u;

export const DEFAULT_QUOTE_SCREEN_THEME: QuoteScreenTheme = {
  primary: "#1B365D",
  accent: "#0f766e",
  ink: "#1A2332",
  muted: "#5B6B7C",
  surface: "#ffffff",
  subtle: "#E8EEF5",
  titleAlignment: "left",
  spacing: "default",
};

export const QUOTE_SCREEN_SECTIONS: Array<{
  id: QuoteScreenSectionId;
  label: string;
  required: boolean;
  defaultOrder: number;
}> = [
  { id: "supplierHeader", label: "공급자 헤더", required: true, defaultOrder: 10 },
  { id: "recipient", label: "수신", required: true, defaultOrder: 20 },
  { id: "credentials", label: "공급자 기본정보", required: false, defaultOrder: 30 },
  { id: "quoteItems", label: "견적 항목과 합계", required: true, defaultOrder: 40 },
  { id: "conditions", label: "조건", required: true, defaultOrder: 50 },
  { id: "evaluationFacts", label: "제휴사 평가정보", required: false, defaultOrder: 60 },
  {
    id: "quantitativeEvaluation",
    label: "정량 평가",
    required: false,
    defaultOrder: 65,
  },
  { id: "comparisonQr", label: "비교 보고서 QR", required: false, defaultOrder: 70 },
  { id: "acceptance", label: "고객 확인란", required: false, defaultOrder: 90 },
  { id: "footer", label: "하단 인사·문의", required: false, defaultOrder: 100 },
];

export const REQUIRED_QUOTE_SCREEN_SECTION_IDS = new Set(
  QUOTE_SCREEN_SECTIONS.filter((section) => section.required).map(
    (section) => section.id,
  ),
);

export const DEFAULT_QUOTE_SCREEN_SECTIONS: QuoteScreenSectionConfig[] =
  QUOTE_SCREEN_SECTIONS.map((section) => ({
    id: section.id,
    visible: section.id !== "acceptance",
    order: section.defaultOrder,
  }));

export function recommendedQuoteLayoutFamily(partner?: {
  name?: string | null;
  displayName?: string | null;
}): QuoteScreenLayoutFamily | undefined {
  const label = `${partner?.displayName ?? ""} ${partner?.name ?? ""}`;
  if (/상지/u.test(label)) return "letterheadLeft";
  return undefined;
}

export function applyRecommendedQuoteLayout<
  T extends { layoutFamily?: QuoteScreenLayoutFamily },
>(documentContent: T, partner?: { name?: string | null; displayName?: string | null }): T {
  if (documentContent.layoutFamily) return documentContent;
  const layoutFamily = recommendedQuoteLayoutFamily(partner);
  if (!layoutFamily) return documentContent;
  return { ...documentContent, layoutFamily };
}

const quoteScreenSectionSchema = z
  .object({
    id: z.enum(
      QUOTE_SCREEN_SECTIONS.map((section) => section.id) as [
        QuoteScreenSectionId,
        ...QuoteScreenSectionId[],
      ],
    ),
    visible: z.boolean(),
    order: z.number().int().min(0).max(1000),
    titleOverride: z.string().trim().max(120).optional(),
  })
  .strict();

const quoteScreenThemeSchema = z
  .object({
    primary: z.string().regex(HEX_COLOR_PATTERN),
    accent: z.string().regex(HEX_COLOR_PATTERN),
    ink: z.string().regex(HEX_COLOR_PATTERN),
    muted: z.string().regex(HEX_COLOR_PATTERN),
    surface: z.string().regex(HEX_COLOR_PATTERN),
    subtle: z.string().regex(HEX_COLOR_PATTERN),
    titleAlignment: z.enum(["left", "center", "right"]),
    spacing: z.enum(["compact", "default", "relaxed"]),
  })
  .strict();

const quoteScreenCopySchema = z
  .object(
    Object.fromEntries(
      QUOTE_DOCUMENT_COPY_KEYS.map((key) => [
        key,
        z.string().trim().max(2_000).optional(),
      ]),
    ) as Record<keyof QuoteDocumentCopy, z.ZodOptional<z.ZodString>>,
  )
  .partial();

const quoteScreenProfilePayloadSchema = z
  .object({
    layoutFamily: z.enum(QUOTE_SCREEN_LAYOUT_FAMILIES).default("classicNavy"),
    sections: z.array(quoteScreenSectionSchema).optional(),
    copy: quoteScreenCopySchema.optional(),
    theme: quoteScreenThemeSchema.optional(),
  })
  .strict();

export type QuoteScreenProfilePayload = z.input<
  typeof quoteScreenProfilePayloadSchema
>;

function normalizeSections(
  sections: readonly QuoteScreenSectionConfig[] | undefined,
) {
  const byId = new Map<QuoteScreenSectionId, QuoteScreenSectionConfig>();
  for (const section of sections ?? []) {
    byId.set(section.id, section);
  }
  return DEFAULT_QUOTE_SCREEN_SECTIONS.map((fallback) => {
    const value = byId.get(fallback.id);
    const required = REQUIRED_QUOTE_SCREEN_SECTION_IDS.has(fallback.id);
    return {
      ...fallback,
      ...value,
      visible: required ? true : value?.visible ?? fallback.visible,
      titleOverride: value?.titleOverride?.trim() || undefined,
    };
  }).sort((left, right) => left.order - right.order);
}

export function normalizeQuoteScreenProfile(
  payload: QuoteScreenProfilePayload,
  actor: { uid: string; email?: string },
  now = new Date().toISOString(),
): QuoteScreenProfile {
  const parsed = quoteScreenProfilePayloadSchema.parse(payload);
  return {
    layoutFamily: parsed.layoutFamily ?? "classicNavy",
    sections: normalizeSections(parsed.sections),
    copy: Object.fromEntries(
      Object.entries(parsed.copy ?? {}).filter(([, value]) => value?.trim()),
    ) as Partial<Record<keyof QuoteDocumentCopy, string>>,
    theme: { ...DEFAULT_QUOTE_SCREEN_THEME, ...(parsed.theme ?? {}) },
    updatedBy: actor.uid,
    updatedByEmail: actor.email,
    updatedAt: now,
  };
}

export function quoteScreenProfileToPayload(profile: QuoteScreenProfile) {
  return {
    layoutFamily: profile.layoutFamily,
    sections: profile.sections,
    copy: profile.copy,
    theme: profile.theme,
  };
}

export function mergeQuoteScreenProfile(
  content: CmsPageContent,
  profile?: QuoteScreenProfile | null,
): QuoteDocumentContent {
  const base = quoteDocumentContentFromCms(content);
  if (!profile) return base;
  return {
    ...base,
    copy: {
      ...base.copy,
      ...profile.copy,
    },
    style: {
      ...base.style,
      title: {
        ...base.style.title,
        alignment: profile.theme.titleAlignment,
      },
      container: {
        ...base.style.container,
        spacing: profile.theme.spacing,
      },
    },
    layoutFamily: profile.layoutFamily,
    sections: normalizeSections(profile.sections),
    theme: profile.theme,
  };
}

export function readPartnerQuoteScreenProfile(
  data: DocumentData | undefined,
  id: string,
): PartnerQuoteScreenProfileRecord | null {
  if (!data) return null;
  return {
    id,
    partnerId: String(data.partnerId ?? id),
    draft: data.draft as QuoteScreenProfile | undefined,
    published: data.published as PartnerQuoteScreenProfileRecord["published"],
    createdAt: String(data.createdAt ?? ""),
    updatedAt: String(data.updatedAt ?? ""),
  };
}

export async function getPartnerQuoteScreenProfile(
  db: Firestore,
  partnerId: string,
) {
  const snapshot = await db
    .collection(PARTNER_QUOTE_SCREEN_PROFILES_COLLECTION)
    .doc(partnerId)
    .get();
  return readPartnerQuoteScreenProfile(snapshot.data(), snapshot.id);
}

export async function getPublishedQuoteDocumentContentForPartner(input: {
  db: Firestore;
  partnerId: string;
  cmsContent: CmsPageContent;
  partner?: { name?: string | null; displayName?: string | null };
}) {
  const profile = await getPartnerQuoteScreenProfile(input.db, input.partnerId);
  const merged = mergeQuoteScreenProfile(
    input.cmsContent,
    profile?.published ?? null,
  );
  if (merged.layoutFamily) return merged;
  let partner = input.partner;
  if (!partner) {
    const snapshot = await input.db.collection("partners").doc(input.partnerId).get();
    const data = snapshot.data() as { name?: string; displayName?: string } | undefined;
    partner = {
      name: data?.name,
      displayName: data?.displayName,
    };
  }
  return applyRecommendedQuoteLayout(merged, partner);
}
