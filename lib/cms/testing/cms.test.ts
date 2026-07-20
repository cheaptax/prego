import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CMS_GLOBAL_DEFAULTS,
  CMS_PAGE_DEFAULTS,
} from "@/lib/cms/defaults";
import { parsePublishedPage } from "@/lib/cms/migrations";
import type {
  CmsPublishedBundle,
  CmsRepository,
} from "@/lib/cms/repository";
import {
  resolvePublishedBundle,
  resolvePublishedPage,
} from "@/lib/cms/resolver";
import {
  cmsAssetSchema,
  cmsDraftPageSchema,
  cmsGlobalContentSchema,
  cmsPageContentSchema,
  cmsPublishedPageSchema,
  type CmsPublishedPage,
} from "@/lib/cms/schemas";
import { isAdminToken } from "@/lib/firebase/server";

const timestamp = "2026-07-20T12:00:00.000Z";

function publishedHome(
  overrides: Partial<CmsPublishedPage> = {},
): CmsPublishedPage {
  return cmsPublishedPageSchema.parse({
    schemaVersion: 1,
    pageKey: "home",
    route: "/",
    content: CMS_PAGE_DEFAULTS.home,
    version: 1,
    status: "published",
    publishedAt: timestamp,
    ...overrides,
  });
}

describe("CMS runtime schemas", () => {
  it("accepts every code default", () => {
    for (const content of Object.values(CMS_PAGE_DEFAULTS)) {
      assert.equal(cmsPageContentSchema.safeParse(content).success, true);
    }
    for (const content of Object.values(CMS_GLOBAL_DEFAULTS)) {
      assert.equal(cmsGlobalContentSchema.safeParse(content).success, true);
    }
  });

  it("rejects executable markup and unsafe links", () => {
    const content = structuredClone(CMS_PAGE_DEFAULTS.home);
    content.sections[0].description = "<script>alert(1)</script>";
    assert.equal(cmsPageContentSchema.safeParse(content).success, false);

    const unsafeLink = structuredClone(CMS_PAGE_DEFAULTS.home);
    unsafeLink.sections[0].actions[0].href = "javascript:alert(1)";
    assert.equal(cmsPageContentSchema.safeParse(unsafeLink).success, false);
  });

  it("rejects duplicate stable IDs and arbitrary style fields", () => {
    const duplicate = structuredClone(CMS_PAGE_DEFAULTS.home);
    duplicate.sections.push(structuredClone(duplicate.sections[0]));
    assert.equal(cmsPageContentSchema.safeParse(duplicate).success, false);

    const document = {
      ...publishedHome(),
      theme: { palette: "default", rawCss: "body { display:none }" },
    };
    assert.equal(cmsPublishedPageSchema.safeParse(document).success, false);
  });

  it("keeps actor and draft metadata out of public documents", () => {
    const leaked = {
      ...publishedHome(),
      createdBy: "admin-uid",
      internalNote: "not public",
    };
    assert.equal(cmsPublishedPageSchema.safeParse(leaked).success, false);

    const draft = {
      schemaVersion: 1,
      pageKey: "home",
      route: "/",
      content: CMS_PAGE_DEFAULTS.home,
      version: 0,
      basePublishedVersion: 0,
      status: "draft",
      createdAt: timestamp,
      createdBy: "admin-uid",
      updatedAt: timestamp,
      updatedBy: "admin-uid",
    };
    assert.equal(cmsDraftPageSchema.safeParse(draft).success, true);
  });

  it("validates CMS asset path, type, dimensions, and size", () => {
    const valid = {
      schemaVersion: 1,
      assetId: "ahomeHero",
      status: "published",
      storagePath: "cms/published/ahomeHero/hero.webp",
      originalFileName: "hero.webp",
      mimeType: "image/webp",
      byteSize: 1_024,
      width: 1_600,
      height: 900,
      alt: "농협지원센터 상담 안내",
      createdAt: timestamp,
      createdBy: "admin-uid",
      updatedAt: timestamp,
      updatedBy: "admin-uid",
      publishedAt: timestamp,
    };
    assert.equal(cmsAssetSchema.safeParse(valid).success, true);
    assert.equal(
      cmsAssetSchema.safeParse({
        ...valid,
        storagePath: "cms/drafts/ahomeHero/hero.webp",
      }).success,
      false,
    );
    assert.equal(
      cmsAssetSchema.safeParse({ ...valid, mimeType: "image/svg+xml" }).success,
      false,
    );
  });

  it("migrates schema version zero without mutating input", () => {
    const legacy = { ...publishedHome() } as Record<string, unknown>;
    delete legacy.schemaVersion;
    const result = parsePublishedPage(legacy, "home");
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.schemaVersion, 1);
      assert.equal(result.migratedFrom, 0);
    }
    assert.equal("schemaVersion" in legacy, false);
  });
});

describe("CMS resolver fallback", () => {
  it("returns an isolated code default when data is missing", async () => {
    const repository: CmsRepository = {
      getPublishedPage: async () => null,
      getPublishedGlobal: async () => null,
      getPublishedGlobals: async () => ({}),
      getPublishedBundle: async (): Promise<CmsPublishedBundle> => ({
        page: null,
        globals: {},
      }),
    };
    const resolved = await resolvePublishedPage(repository, "home");
    assert.equal(resolved.source, "default");
    assert.equal(resolved.version, 0);
    resolved.content.sections[0].title = "changed in test";
    assert.notEqual(
      resolved.content.sections[0].title,
      CMS_PAGE_DEFAULTS.home.sections[0].title,
    );
  });

  it("falls back without exposing repository errors", async () => {
    const repository: CmsRepository = {
      getPublishedPage: async () => {
        throw new Error("private firestore details");
      },
      getPublishedGlobal: async () => {
        throw new Error("private firestore details");
      },
      getPublishedGlobals: async () => {
        throw new Error("private firestore details");
      },
      getPublishedBundle: async () => {
        throw new Error("private firestore details");
      },
    };
    const fallbackEvents: string[] = [];
    const resolved = await resolvePublishedBundle(
      repository,
      "home",
      ["header", "footer"],
      {
        onFallback: (event) => fallbackEvents.push(`${event.targetType}:${event.targetKey}`),
      },
    );
    assert.equal(resolved.page.source, "default");
    assert.equal(resolved.globals.header?.source, "default");
    assert.equal(resolved.globals.footer?.source, "default");
    assert.ok(fallbackEvents.includes("bundle:home"));
  });

  it("returns a valid published page when available", async () => {
    const published = publishedHome();
    const repository: CmsRepository = {
      getPublishedPage: async () => published,
      getPublishedGlobal: async () => null,
      getPublishedGlobals: async () => ({}),
      getPublishedBundle: async () => ({ page: published, globals: {} }),
    };
    const resolved = await resolvePublishedPage(repository, "home");
    assert.equal(resolved.source, "published");
    assert.equal(resolved.version, 1);
  });
});

describe("CMS administrator authorization", () => {
  it("requires the admin custom claim and ignores email identity", () => {
    assert.equal(
      isAdminToken({ uid: "email-only", email: "admin@example.com" } as never),
      false,
    );
    assert.equal(isAdminToken({ uid: "claimed", admin: true } as never), true);
  });
});
