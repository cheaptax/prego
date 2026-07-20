import { cache } from "react";
import {
  CMS_GLOBAL_DEFAULTS,
  CMS_PAGE_DEFAULTS,
} from "@/lib/cms/defaults";
import {
  resolvePublishedGlobals,
  resolvePublishedPage,
} from "@/lib/cms/resolver";
import { FirestoreCmsRepository } from "@/lib/cms/repository";
import type {
  CmsGlobalContent,
  CmsPageContent,
} from "@/lib/cms/schemas";
import {
  CMS_PUBLIC_GLOBAL_KEYS,
  type CmsPageKey,
} from "@/lib/cms/constants";
import { normalizeAuditQuoteCmsContent } from "@/lib/cms/audit-quote-content";
import { normalizeCmsPageContent } from "@/lib/cms/page-content";
import { activeCmsMediaAssetIds } from "@/lib/cms/media";

export type CmsPublicGlobals = Record<
  (typeof CMS_PUBLIC_GLOBAL_KEYS)[number],
  CmsGlobalContent
>;
export type CmsPublicGlobalsBundle = CmsPublicGlobals & {
  assetUrls: Record<string, string>;
};

export type CmsPublishedHome = {
  content: CmsPageContent;
  assetUrls: Record<string, string>;
};

export type CmsPublishedAuditQuote = {
  content: CmsPageContent;
};

export type CmsPublishedPageBundle = {
  content: CmsPageContent;
  assetUrls: Record<string, string>;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function useOfflineE2EDefaults() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.CMS_E2E_OFFLINE === "1"
  );
}

export const loadPublicCmsGlobals = cache(
  async (): Promise<CmsPublicGlobalsBundle> => {
    if (useOfflineE2EDefaults()) {
      return {
        siteIdentity: clone(CMS_GLOBAL_DEFAULTS.siteIdentity),
        header: clone(CMS_GLOBAL_DEFAULTS.header),
        footer: clone(CMS_GLOBAL_DEFAULTS.footer),
        support: clone(CMS_GLOBAL_DEFAULTS.support),
        assetUrls: {},
      };
    }
    try {
      const repository = new FirestoreCmsRepository();
      const resolved = await resolvePublishedGlobals(
        repository,
        CMS_PUBLIC_GLOBAL_KEYS,
      );
      const globals: CmsPublicGlobals = {
        siteIdentity: clone(
          resolved.siteIdentity?.content ?? CMS_GLOBAL_DEFAULTS.siteIdentity,
        ),
        header: clone(resolved.header?.content ?? CMS_GLOBAL_DEFAULTS.header),
        footer: clone(resolved.footer?.content ?? CMS_GLOBAL_DEFAULTS.footer),
        support: clone(resolved.support?.content ?? CMS_GLOBAL_DEFAULTS.support),
      };
      const assetIds = Object.values(globals)
        .flatMap((content) => activeCmsMediaAssetIds(content.sections))
        .filter((value): value is string => Boolean(value));
      const assets = await repository.getAssets(assetIds);
      return {
        ...globals,
        assetUrls: Object.fromEntries(
          assets.flatMap((asset) => {
            if (asset.status !== "published") return [];
            const url = publicStorageUrl(asset.storagePath);
            return url ? [[asset.assetId, url]] : [];
          }),
        ),
      };
    } catch {
      return {
        siteIdentity: clone(CMS_GLOBAL_DEFAULTS.siteIdentity),
        header: clone(CMS_GLOBAL_DEFAULTS.header),
        footer: clone(CMS_GLOBAL_DEFAULTS.footer),
        support: clone(CMS_GLOBAL_DEFAULTS.support),
        assetUrls: {},
      };
    }
  },
);

function publicStorageUrl(storagePath: string) {
  const bucket =
    process.env.FIREBASE_STORAGE_BUCKET?.trim() ??
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
  if (!bucket) return null;
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(storagePath)}?alt=media`;
}

export const loadPublishedHome = cache(
  async (): Promise<CmsPublishedHome> => {
    if (useOfflineE2EDefaults()) {
      return { content: clone(CMS_PAGE_DEFAULTS.home), assetUrls: {} };
    }
    try {
      const repository = new FirestoreCmsRepository();
      const resolved = await resolvePublishedPage(repository, "home");
      const content = clone(resolved.content ?? CMS_PAGE_DEFAULTS.home);
      const assetIds = [
        content.seo.ogImageAssetId,
        ...activeCmsMediaAssetIds(content.sections),
      ].filter((value): value is string => Boolean(value));
      const assets = await repository.getAssets(assetIds);
      return {
        content,
        assetUrls: Object.fromEntries(
          assets.flatMap((asset) => {
            if (asset.status !== "published") return [];
            const url = publicStorageUrl(asset.storagePath);
            return url ? [[asset.assetId, url]] : [];
          }),
        ),
      };
    } catch {
      return { content: clone(CMS_PAGE_DEFAULTS.home), assetUrls: {} };
    }
  },
);

export const loadPublishedAuditQuote = cache(
  async (): Promise<CmsPublishedAuditQuote> => {
    if (useOfflineE2EDefaults()) {
      return {
        content: clone(CMS_PAGE_DEFAULTS["event.auditQuote"]),
      };
    }
    try {
      const repository = new FirestoreCmsRepository();
      const resolved = await resolvePublishedPage(
        repository,
        "event.auditQuote",
      );
      return {
        content: normalizeAuditQuoteCmsContent(
          clone(
            resolved.content ?? CMS_PAGE_DEFAULTS["event.auditQuote"],
          ),
        ),
      };
    } catch {
      return {
        content: clone(CMS_PAGE_DEFAULTS["event.auditQuote"]),
      };
    }
  },
);

export const loadPublishedCmsPage = cache(
  async (pageKey: CmsPageKey): Promise<CmsPublishedPageBundle> => {
    if (useOfflineE2EDefaults()) {
      return {
        content: clone(CMS_PAGE_DEFAULTS[pageKey]),
        assetUrls: {},
      };
    }
    try {
      const repository = new FirestoreCmsRepository();
      const resolved = await resolvePublishedPage(repository, pageKey);
      const content = normalizeCmsPageContent(
        pageKey,
        clone(resolved.content ?? CMS_PAGE_DEFAULTS[pageKey]),
      );
      const assetIds = [
        content.seo.ogImageAssetId,
        ...activeCmsMediaAssetIds(content.sections),
      ].filter((value): value is string => Boolean(value));
      const assets = await repository.getAssets(assetIds);
      return {
        content,
        assetUrls: Object.fromEntries(
          assets.flatMap((asset) => {
            if (asset.status !== "published") return [];
            const url = publicStorageUrl(asset.storagePath);
            return url ? [[asset.assetId, url]] : [];
          }),
        ),
      };
    } catch {
      return {
        content: clone(CMS_PAGE_DEFAULTS[pageKey]),
        assetUrls: {},
      };
    }
  },
);
