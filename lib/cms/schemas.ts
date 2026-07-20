import { z } from "zod";
import {
  CMS_ALLOWED_MIME_TYPES,
  CMS_COLOR_TOKENS,
  CMS_FONT_FAMILIES,
  CMS_GLOBAL_KEYS,
  CMS_MAX_ASSET_BYTES,
  CMS_PAGE_KEYS,
  CMS_SCHEMA_VERSION,
  CMS_SPACING_PRESETS,
  CMS_TEXT_SIZE_PRESETS,
} from "@/lib/cms/constants";

const DANGEROUS_MARKUP =
  /<\s*\/?\s*(script|style|iframe|object|embed|link|meta|base|svg)\b|on[a-z]+\s*=|javascript\s*:|data\s*:\s*text\/html/i;
const SAFE_ID = /^[a-z][a-zA-Z0-9._-]{0,79}$/;
const SAFE_FIELD_KEY = /^[a-z][a-zA-Z0-9._-]{0,79}$/;
const STORAGE_PATH = /^cms\/(drafts|published)\/[a-zA-Z0-9._/-]+$/;

export type CmsTimestamp = string | Date | { toDate(): Date };

export const cmsTimestampSchema = z.union([
  z.string().datetime({ offset: true }),
  z.date(),
  z.custom<{ toDate(): Date }>(
    (value) => {
      if (
        typeof value !== "object" ||
        value === null ||
        !("toDate" in value) ||
        typeof value.toDate !== "function"
      ) {
        return false;
      }
      try {
        return value.toDate() instanceof Date;
      } catch {
        return false;
      }
    },
    "Firestore Timestamp가 필요합니다.",
  ),
]);

export const safePlainTextSchema = z
  .string()
  .max(8_000)
  .refine((value) => !DANGEROUS_MARKUP.test(value), {
    message: "실행 가능한 HTML, CSS 또는 JavaScript 구문은 허용되지 않습니다.",
  });

export const nonEmptyPlainTextSchema = safePlainTextSchema
  .trim()
  .min(1)
  .max(500);

export const cmsStableIdSchema = z.string().regex(SAFE_ID);
export const cmsFieldKeySchema = z.string().regex(SAFE_FIELD_KEY);

export function isSafeCmsHref(value: string) {
  const href = value.trim();
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return false;
  if (href.startsWith("/") && !href.startsWith("//")) return true;
  if (/^#[a-zA-Z][a-zA-Z0-9_-]*$/.test(href)) return true;
  if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(href)) return true;
  if (/^tel:\+?[0-9 ()-]{7,24}$/.test(href)) return true;
  try {
    return new URL(href).protocol === "https:";
  } catch {
    return false;
  }
}

export const cmsLinkSchema = z
  .object({
    id: cmsStableIdSchema,
    label: nonEmptyPlainTextSchema,
    linkType: z.enum(["internal", "external"]).default("internal"),
    href: z.string().max(2_048).refine(isSafeCmsHref, {
      message: "내부 경로, HTTPS, mailto 또는 tel 링크만 사용할 수 있습니다.",
    }),
    appearance: z.enum(["primary", "secondary", "text"]).default("text"),
    openInNewWindow: z.boolean().default(false),
  })
  .strict()
  .superRefine((link, context) => {
    const isInternal =
      (link.href.startsWith("/") && !link.href.startsWith("//")) ||
      link.href.startsWith("#");
    if (link.linkType === "internal" && !isInternal) {
      context.addIssue({
        code: "custom",
        path: ["href"],
        message: "내부 링크는 사이트 안의 화면을 선택해 주세요.",
      });
    }
    if (link.linkType === "external" && isInternal) {
      context.addIssue({
        code: "custom",
        path: ["href"],
        message: "외부 링크에는 HTTPS, 이메일 또는 전화 주소를 입력해 주세요.",
      });
    }
  });

export const cmsNavigationItemSchema = cmsLinkSchema.extend({
  children: z.array(cmsLinkSchema).max(12).default([]),
  deleted: z.boolean().optional(),
});

export const cmsContentItemSchema = z
  .object({
    id: cmsStableIdSchema,
    label: safePlainTextSchema.max(200).optional(),
    title: nonEmptyPlainTextSchema,
    description: safePlainTextSchema.optional(),
    value: safePlainTextSchema.max(500).optional(),
    visible: z.boolean().default(true),
    deleted: z.boolean().default(false),
  })
  .strict();

export const cmsContentGroupSchema = z
  .object({
    id: cmsStableIdSchema,
    label: safePlainTextSchema.max(200).optional(),
    title: nonEmptyPlainTextSchema.optional(),
    description: safePlainTextSchema.optional(),
    visible: z.boolean().default(true),
    items: z
      .array(cmsContentItemSchema)
      .max(100)
      .default([])
      .refine(hasUniqueIds, "그룹 안의 목록 항목 ID는 중복될 수 없습니다."),
    actions: z
      .array(cmsLinkSchema)
      .max(12)
      .default([])
      .refine(hasUniqueIds, "그룹 안의 링크 ID는 중복될 수 없습니다."),
  })
  .strict();

export const cmsMediaReferenceSchema = z
  .object({
    assetId: cmsStableIdSchema,
    alt: nonEmptyPlainTextSchema,
    deleted: z.boolean().optional(),
    caption: safePlainTextSchema.max(500).optional(),
    aspectRatio: z.enum(["auto", "1:1", "4:3", "3:2", "16:9"]).default("auto"),
    focalPoint: z
      .object({
        x: z.number().min(0).max(100),
        y: z.number().min(0).max(100),
      })
      .strict()
      .optional(),
  })
  .strict();

function hasUniqueIds(values: ReadonlyArray<{ id: string }>) {
  return new Set(values.map(({ id }) => id)).size === values.length;
}

export const cmsResponsiveNumberSchema = (
  minimum: number,
  maximum: number,
) =>
  z
    .object({
      desktop: z.number().min(minimum).max(maximum),
      tablet: z.number().min(minimum).max(maximum).optional(),
      mobile: z.number().min(minimum).max(maximum).optional(),
    })
    .strict();

export const cmsTypographyStyleSchema = z
  .object({
    fontFamily: z.enum(CMS_FONT_FAMILIES).default("pretendard"),
    sizePreset: z.enum(CMS_TEXT_SIZE_PRESETS).default("default"),
    customSizePx: cmsResponsiveNumberSchema(12, 80).optional(),
    fontWeight: z.enum(["400", "500", "600", "700", "800"]).default("700"),
    lineHeightPreset: z.enum(["compact", "default", "relaxed"]).default("default"),
    customLineHeight: cmsResponsiveNumberSchema(1, 2).optional(),
    alignment: z.enum(["left", "center", "right"]).default("left"),
    color: z.enum(CMS_COLOR_TOKENS).default("text"),
  })
  .strict();

export const cmsContainerStyleSchema = z
  .object({
    background: z.enum(CMS_COLOR_TOKENS).default("surface"),
    spacing: z.enum(CMS_SPACING_PRESETS).default("default"),
    customPaddingY: cmsResponsiveNumberSchema(0, 160).optional(),
    border: z.enum(["none", "subtle", "strong"]).default("none"),
    radius: z.enum(["square", "default", "rounded"]).default("default"),
    shadow: z.enum(["none", "soft", "medium"]).default("none"),
  })
  .strict();

export const cmsCardStyleSchema = z
  .object({
    background: z.enum(CMS_COLOR_TOKENS).default("surface"),
    border: z.enum(["none", "subtle", "strong"]).default("subtle"),
    radius: z.enum(["square", "default", "rounded"]).default("default"),
    shadow: z.enum(["none", "soft", "medium"]).default("soft"),
  })
  .strict();

export const cmsButtonStyleSchema = z
  .object({
    tone: z.enum(["primary", "ink", "outline"]).default("primary"),
    size: z.enum(["compact", "default", "large"]).default("default"),
    radius: z.enum(["square", "default", "rounded"]).default("default"),
  })
  .strict();

export const cmsSectionStyleSchema = z
  .object({
    title: cmsTypographyStyleSchema.default({
      fontFamily: "pretendard",
      sizePreset: "default",
      fontWeight: "700",
      lineHeightPreset: "default",
      alignment: "left",
      color: "text",
    }),
    body: cmsTypographyStyleSchema.default({
      fontFamily: "pretendard",
      sizePreset: "default",
      fontWeight: "400",
      lineHeightPreset: "default",
      alignment: "left",
      color: "muted",
    }),
    container: cmsContainerStyleSchema.default({
      background: "surface",
      spacing: "default",
      border: "none",
      radius: "default",
      shadow: "none",
    }),
    card: cmsCardStyleSchema.optional(),
    button: cmsButtonStyleSchema.optional(),
  })
  .strict();

export const cmsSectionSchema = z
  .object({
    id: cmsStableIdSchema,
    visible: z.boolean().default(true),
    locked: z.boolean().default(false),
    headingLevel: z.union([z.literal(2), z.literal(3)]).default(2),
    eyebrow: safePlainTextSchema.max(200).optional(),
    title: nonEmptyPlainTextSchema,
    description: safePlainTextSchema.optional(),
    text: z
      .record(cmsFieldKeySchema, safePlainTextSchema.max(2_000))
      .default({}),
    items: z
      .array(cmsContentItemSchema)
      .max(100)
      .default([])
      .refine(hasUniqueIds, "반복 항목 ID는 중복될 수 없습니다."),
    actions: z
      .array(cmsLinkSchema)
      .max(12)
      .default([])
      .refine(hasUniqueIds, "링크 ID는 중복될 수 없습니다."),
    groups: z
      .array(cmsContentGroupSchema)
      .max(20)
      .default([])
      .refine(hasUniqueIds, "콘텐츠 그룹 ID는 중복될 수 없습니다."),
    media: cmsMediaReferenceSchema.optional(),
    style: cmsSectionStyleSchema.default({
      title: {
        fontFamily: "pretendard",
        sizePreset: "default",
        fontWeight: "700",
        lineHeightPreset: "default",
        alignment: "left",
        color: "text",
      },
      body: {
        fontFamily: "pretendard",
        sizePreset: "default",
        fontWeight: "400",
        lineHeightPreset: "default",
        alignment: "left",
        color: "muted",
      },
      container: {
        background: "surface",
        spacing: "default",
        border: "none",
        radius: "default",
        shadow: "none",
      },
    }),
  })
  .strict();

export const cmsSeoSchema = z
  .object({
    title: nonEmptyPlainTextSchema.max(70),
    description: nonEmptyPlainTextSchema.max(180),
    ogImageAssetId: cmsStableIdSchema.optional(),
    indexable: z.boolean().default(true),
  })
  .strict();

export const cmsThemeOverridesSchema = z
  .object({
    palette: z.enum(["default", "calmBlue", "forest", "highContrast"]).optional(),
    textScale: z.enum(["small", "default", "large"]).optional(),
    spacing: z.enum(["compact", "default", "relaxed"]).optional(),
    radius: z.enum(["square", "default", "rounded"]).optional(),
    alignment: z.enum(["left", "center"]).optional(),
  })
  .strict();

export const cmsCommonAreaOverrideSchema = z
  .object({
    hidden: z.boolean().optional(),
    text: z
      .record(cmsFieldKeySchema, safePlainTextSchema.max(1_000))
      .optional(),
    links: z.record(cmsFieldKeySchema, cmsLinkSchema).optional(),
    navigation: z
      .array(cmsNavigationItemSchema)
      .max(30)
      .refine(hasUniqueIds, "내비게이션 ID는 중복될 수 없습니다.")
      .optional(),
  })
  .strict();

export const cmsPageContentSchema = z
  .object({
    seo: cmsSeoSchema,
    sections: z
      .array(cmsSectionSchema)
      .min(1)
      .max(50)
      .refine(hasUniqueIds, "섹션 ID는 중복될 수 없습니다."),
    messages: z.record(cmsFieldKeySchema, safePlainTextSchema.max(500)).default({}),
    commonOverrides: z
      .object({
        siteIdentity: cmsCommonAreaOverrideSchema.optional(),
        header: cmsCommonAreaOverrideSchema.optional(),
        footer: cmsCommonAreaOverrideSchema.optional(),
        support: cmsCommonAreaOverrideSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const cmsGlobalContentSchema = z
  .object({
    text: z.record(cmsFieldKeySchema, safePlainTextSchema.max(1_000)).default({}),
    links: z.record(cmsFieldKeySchema, cmsLinkSchema).default({}),
    navigation: z
      .array(cmsNavigationItemSchema)
      .max(30)
      .default([])
      .refine(hasUniqueIds, "내비게이션 ID는 중복될 수 없습니다."),
    sections: z
      .array(cmsSectionSchema)
      .max(20)
      .default([])
      .refine(hasUniqueIds, "공통 섹션 ID는 중복될 수 없습니다."),
    theme: cmsThemeOverridesSchema.optional(),
  })
  .strict();

const pageKeySchema = z.enum(CMS_PAGE_KEYS);
const globalKeySchema = z.enum(CMS_GLOBAL_KEYS);

const publishedPageBaseSchema = z
  .object({
    schemaVersion: z.literal(CMS_SCHEMA_VERSION),
    pageKey: pageKeySchema,
    route: z.string().startsWith("/").max(300),
    content: cmsPageContentSchema,
    theme: cmsThemeOverridesSchema.optional(),
    version: z.number().int().positive(),
    status: z.literal("published"),
    publishedAt: cmsTimestampSchema,
  })
  .strict();

const draftPageBaseSchema = z
  .object({
    schemaVersion: z.literal(CMS_SCHEMA_VERSION),
    pageKey: pageKeySchema,
    route: z.string().startsWith("/").max(300),
    content: cmsPageContentSchema,
    theme: cmsThemeOverridesSchema.optional(),
    version: z.number().int().nonnegative(),
    basePublishedVersion: z.number().int().nonnegative(),
    status: z.literal("draft"),
    internalNote: safePlainTextSchema.max(1_000).optional(),
    createdAt: cmsTimestampSchema,
    createdBy: z.string().min(1).max(128),
    updatedAt: cmsTimestampSchema,
    updatedBy: z.string().min(1).max(128),
  })
  .strict();

const publishedGlobalBaseSchema = z
  .object({
    schemaVersion: z.literal(CMS_SCHEMA_VERSION),
    documentKey: globalKeySchema,
    content: cmsGlobalContentSchema,
    version: z.number().int().positive(),
    status: z.literal("published"),
    publishedAt: cmsTimestampSchema,
  })
  .strict();

const draftGlobalBaseSchema = z
  .object({
    schemaVersion: z.literal(CMS_SCHEMA_VERSION),
    documentKey: globalKeySchema,
    content: cmsGlobalContentSchema,
    version: z.number().int().nonnegative(),
    basePublishedVersion: z.number().int().nonnegative(),
    status: z.literal("draft"),
    internalNote: safePlainTextSchema.max(1_000).optional(),
    createdAt: cmsTimestampSchema,
    createdBy: z.string().min(1).max(128),
    updatedAt: cmsTimestampSchema,
    updatedBy: z.string().min(1).max(128),
  })
  .strict();

export const cmsPublishedPageSchema = publishedPageBaseSchema;
export const cmsDraftPageSchema = draftPageBaseSchema;
export const cmsPublishedGlobalSchema = publishedGlobalBaseSchema;
export const cmsDraftGlobalSchema = draftGlobalBaseSchema;

export const cmsPageRevisionSchema = publishedPageBaseSchema
  .extend({
    revisionId: cmsStableIdSchema,
    revisionAction: z.enum(["publish", "rollback"]),
    createdAt: cmsTimestampSchema,
    createdBy: z.string().min(1).max(128),
  })
  .strict();

export const cmsGlobalRevisionSchema = publishedGlobalBaseSchema
  .extend({
    revisionId: cmsStableIdSchema,
    revisionAction: z.enum(["publish", "rollback"]),
    createdAt: cmsTimestampSchema,
    createdBy: z.string().min(1).max(128),
  })
  .strict();

export const cmsAuditLogSchema = z
  .object({
    schemaVersion: z.literal(CMS_SCHEMA_VERSION),
    targetType: z.enum(["page", "global", "asset"]),
    targetKey: z.string().min(1).max(128),
    action: z.enum([
      "draft.created",
      "draft.updated",
      "published",
      "revision.restored",
      "asset.created",
      "asset.updated",
      "asset.archived",
    ]),
    fromVersion: z.number().int().nonnegative().optional(),
    toVersion: z.number().int().nonnegative().optional(),
    actorUid: z.string().min(1).max(128),
    createdAt: cmsTimestampSchema,
    metadata: z
      .record(
        cmsFieldKeySchema,
        z.union([safePlainTextSchema.max(500), z.number(), z.boolean()]),
      )
      .default({}),
  })
  .strict();

export const cmsAssetSchema = z
  .object({
    schemaVersion: z.literal(CMS_SCHEMA_VERSION),
    assetId: cmsStableIdSchema,
    status: z.enum(["draft", "published", "archived"]),
    storagePath: z.string().regex(STORAGE_PATH).max(500),
    originalFileName: safePlainTextSchema.max(255),
    mimeType: z.enum(CMS_ALLOWED_MIME_TYPES),
    byteSize: z.number().int().positive().max(CMS_MAX_ASSET_BYTES),
    width: z.number().int().positive().max(20_000).optional(),
    height: z.number().int().positive().max(20_000).optional(),
    alt: nonEmptyPlainTextSchema,
    focalPoint: z
      .object({
        x: z.number().min(0).max(100),
        y: z.number().min(0).max(100),
      })
      .strict()
      .optional(),
    createdAt: cmsTimestampSchema,
    createdBy: z.string().min(1).max(128),
    updatedAt: cmsTimestampSchema,
    updatedBy: z.string().min(1).max(128),
    publishedAt: cmsTimestampSchema.optional(),
  })
  .strict()
  .superRefine((asset, context) => {
    const expectedPrefix = asset.status === "published"
      ? "cms/published/"
      : asset.status === "draft"
        ? "cms/drafts/"
        : null;
    if (expectedPrefix && !asset.storagePath.startsWith(expectedPrefix)) {
      context.addIssue({
        code: "custom",
        path: ["storagePath"],
        message: `상태가 ${asset.status}인 파일 경로는 ${expectedPrefix}로 시작해야 합니다.`,
      });
    }
    if (asset.status === "published" && !asset.publishedAt) {
      context.addIssue({
        code: "custom",
        path: ["publishedAt"],
        message: "게시된 미디어에는 게시 시각이 필요합니다.",
      });
    }
    if (
      asset.mimeType.startsWith("image/") &&
      (!asset.width || !asset.height)
    ) {
      context.addIssue({
        code: "custom",
        path: ["width"],
        message: "이미지는 너비와 높이가 필요합니다.",
      });
    }
  });

export type CmsLink = z.infer<typeof cmsLinkSchema>;
export type CmsNavigationItem = z.infer<typeof cmsNavigationItemSchema>;
export type CmsContentItem = z.infer<typeof cmsContentItemSchema>;
export type CmsContentGroup = z.infer<typeof cmsContentGroupSchema>;
export type CmsMediaReference = z.infer<typeof cmsMediaReferenceSchema>;
export type CmsTypographyStyle = z.infer<typeof cmsTypographyStyleSchema>;
export type CmsContainerStyle = z.infer<typeof cmsContainerStyleSchema>;
export type CmsCardStyle = z.infer<typeof cmsCardStyleSchema>;
export type CmsButtonStyle = z.infer<typeof cmsButtonStyleSchema>;
export type CmsSectionStyle = z.infer<typeof cmsSectionStyleSchema>;
export type CmsSection = z.infer<typeof cmsSectionSchema>;
export type CmsPageContent = z.infer<typeof cmsPageContentSchema>;
export type CmsGlobalContent = z.infer<typeof cmsGlobalContentSchema>;
export type CmsThemeOverrides = z.infer<typeof cmsThemeOverridesSchema>;
export type CmsPublishedPage = z.infer<typeof cmsPublishedPageSchema>;
export type CmsDraftPage = z.infer<typeof cmsDraftPageSchema>;
export type CmsPublishedGlobal = z.infer<typeof cmsPublishedGlobalSchema>;
export type CmsDraftGlobal = z.infer<typeof cmsDraftGlobalSchema>;
export type CmsPageRevision = z.infer<typeof cmsPageRevisionSchema>;
export type CmsGlobalRevision = z.infer<typeof cmsGlobalRevisionSchema>;
export type CmsAuditLog = z.infer<typeof cmsAuditLogSchema>;
export type CmsAsset = z.infer<typeof cmsAssetSchema>;
