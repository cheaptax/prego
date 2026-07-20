import {
  type CmsGlobalKey,
  type CmsPageKey,
} from "@/lib/cms/constants";
import {
  CMS_GLOBAL_DEFAULTS,
  CMS_PAGE_DEFAULTS,
} from "@/lib/cms/defaults";
import type {
  CmsGlobalContent,
  CmsPageContent,
  CmsThemeOverrides,
} from "@/lib/cms/schemas";
import type {
  CmsPublishedBundle,
  CmsRepository,
} from "@/lib/cms/repository";

export type CmsResolutionSource = "published" | "default";

export type ResolvedCmsPage = {
  pageKey: CmsPageKey;
  content: CmsPageContent;
  theme?: CmsThemeOverrides;
  version: number;
  source: CmsResolutionSource;
};

export type ResolvedCmsGlobal = {
  documentKey: CmsGlobalKey;
  content: CmsGlobalContent;
  version: number;
  source: CmsResolutionSource;
};

export type ResolvedCmsBundle = {
  page: ResolvedCmsPage;
  globals: Record<CmsGlobalKey, ResolvedCmsGlobal> | Partial<Record<CmsGlobalKey, ResolvedCmsGlobal>>;
};

export type CmsResolverOptions = {
  onFallback?: (event: {
    targetType: "page" | "global" | "bundle";
    targetKey: string;
    reason: "missing" | "invalid_or_unavailable";
  }) => void;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function defaultPage(
  pageKey: CmsPageKey,
  options?: CmsResolverOptions,
  reason: "missing" | "invalid_or_unavailable" = "missing",
): ResolvedCmsPage {
  options?.onFallback?.({ targetType: "page", targetKey: pageKey, reason });
  return {
    pageKey,
    content: clone(CMS_PAGE_DEFAULTS[pageKey]),
    version: 0,
    source: "default",
  };
}

function defaultGlobal(
  documentKey: CmsGlobalKey,
  options?: CmsResolverOptions,
  reason: "missing" | "invalid_or_unavailable" = "missing",
): ResolvedCmsGlobal {
  options?.onFallback?.({ targetType: "global", targetKey: documentKey, reason });
  return {
    documentKey,
    content: clone(CMS_GLOBAL_DEFAULTS[documentKey]),
    version: 0,
    source: "default",
  };
}

export async function resolvePublishedPage(
  repository: CmsRepository,
  pageKey: CmsPageKey,
  options?: CmsResolverOptions,
): Promise<ResolvedCmsPage> {
  try {
    const document = await repository.getPublishedPage(pageKey);
    if (!document) return defaultPage(pageKey, options);
    return {
      pageKey,
      content: document.content,
      theme: document.theme,
      version: document.version,
      source: "published",
    };
  } catch {
    return defaultPage(pageKey, options, "invalid_or_unavailable");
  }
}

export async function resolvePublishedGlobal(
  repository: CmsRepository,
  documentKey: CmsGlobalKey,
  options?: CmsResolverOptions,
): Promise<ResolvedCmsGlobal> {
  try {
    const document = await repository.getPublishedGlobal(documentKey);
    if (!document) return defaultGlobal(documentKey, options);
    return {
      documentKey,
      content: document.content,
      version: document.version,
      source: "published",
    };
  } catch {
    return defaultGlobal(documentKey, options, "invalid_or_unavailable");
  }
}

export async function resolvePublishedGlobals(
  repository: CmsRepository,
  documentKeys: readonly CmsGlobalKey[],
  options?: CmsResolverOptions,
): Promise<Record<CmsGlobalKey, ResolvedCmsGlobal> | Partial<Record<CmsGlobalKey, ResolvedCmsGlobal>>> {
  try {
    const documents = await repository.getPublishedGlobals(documentKeys);
    const globals: Partial<Record<CmsGlobalKey, ResolvedCmsGlobal>> = {};
    for (const documentKey of documentKeys) {
      const document = documents[documentKey];
      globals[documentKey] = document
        ? {
            documentKey,
            content: document.content,
            version: document.version,
            source: "published",
          }
        : defaultGlobal(documentKey, options);
    }
    return globals;
  } catch {
    const globals: Partial<Record<CmsGlobalKey, ResolvedCmsGlobal>> = {};
    for (const documentKey of documentKeys) {
      globals[documentKey] = defaultGlobal(
        documentKey,
        options,
        "invalid_or_unavailable",
      );
    }
    return globals;
  }
}

function resolveBundleResult(
  bundle: CmsPublishedBundle,
  pageKey: CmsPageKey,
  globalKeys: readonly CmsGlobalKey[],
  options?: CmsResolverOptions,
): ResolvedCmsBundle {
  const page = bundle.page
    ? {
        pageKey,
        content: bundle.page.content,
        theme: bundle.page.theme,
        version: bundle.page.version,
        source: "published" as const,
      }
    : defaultPage(pageKey, options);
  const globals: Partial<Record<CmsGlobalKey, ResolvedCmsGlobal>> = {};
  for (const documentKey of globalKeys) {
    const document = bundle.globals[documentKey];
    globals[documentKey] = document
      ? {
          documentKey,
          content: document.content,
          version: document.version,
          source: "published",
        }
      : defaultGlobal(documentKey, options);
  }
  return { page, globals };
}

export async function resolvePublishedBundle(
  repository: CmsRepository,
  pageKey: CmsPageKey,
  globalKeys: readonly CmsGlobalKey[],
  options?: CmsResolverOptions,
): Promise<ResolvedCmsBundle> {
  try {
    const bundle = await repository.getPublishedBundle(pageKey, globalKeys);
    return resolveBundleResult(bundle, pageKey, globalKeys, options);
  } catch {
    options?.onFallback?.({
      targetType: "bundle",
      targetKey: pageKey,
      reason: "invalid_or_unavailable",
    });
    const globals: Partial<Record<CmsGlobalKey, ResolvedCmsGlobal>> = {};
    for (const documentKey of globalKeys) {
      globals[documentKey] = defaultGlobal(
        documentKey,
        options,
        "invalid_or_unavailable",
      );
    }
    return {
      page: defaultPage(pageKey, options, "invalid_or_unavailable"),
      globals,
    };
  }
}
