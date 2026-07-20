import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import {
  CMS_GLOBAL_DEFAULTS,
  CMS_PAGE_DEFAULTS,
} from "@/lib/cms/defaults";
import { CMS_PUBLIC_GLOBAL_KEYS } from "@/lib/cms/constants";
import {
  CmsRepositoryError,
  FirestoreCmsRepository,
} from "@/lib/cms/repository";
import { resolvePublishedPage } from "@/lib/cms/resolver";
import { activeCmsMediaAssetIds } from "@/lib/cms/media";
import { CmsMemoryFirestore } from "@/lib/cms/testing/memory-firestore";
import { publishDraftAssetsForPage } from "@/lib/cms/asset-publishing";

describe("CMS full editing lifecycle", () => {
  it("performs the non-developer homepage editing, publish, and rollback story", async () => {
    const db = new CmsMemoryFirestore();
    const repository = new FirestoreCmsRepository(
      db as unknown as Firestore,
    );
    const firstDraft = structuredClone(CMS_PAGE_DEFAULTS.home);
    firstDraft.sections[0].title = "검증용 메인 화면 제목";
    firstDraft.sections[0].style.title.customSizePx = {
      desktop:
        firstDraft.sections[0].style.title.customSizePx?.desktop ?? 56,
      tablet: firstDraft.sections[0].style.title.customSizePx?.tablet,
      mobile: 36,
    };

    const services = firstDraft.sections.find(
      (section) => section.id === "services",
    )!;
    services.items = [
      services.items[1],
      services.items[0],
      ...services.items.slice(2),
    ];
    const faq = firstDraft.sections.find(
      (section) => section.id === "faqPreview",
    )!;
    faq.items.push({
      id: "faqVerification",
      title: "관리자가 FAQ를 추가할 수 있나요?",
      description: "추가한 질문은 게시한 뒤 고객 화면에 표시됩니다.",
      visible: true,
      deleted: false,
    });
    firstDraft.sections[0].media = {
      assetId: "homepageVerificationImage",
      alt: "농협 담당자가 상담 내용을 확인하는 모습",
      aspectRatio: "16:9",
    };

    await repository.saveDraftPage({
      pageKey: "home",
      content: firstDraft,
      expectedVersion: 0,
      actorUid: "admin-one",
    });
    const publicBeforePublish = await resolvePublishedPage(repository, "home");
    assert.equal(publicBeforePublish.source, "default");
    assert.notEqual(
      publicBeforePublish.content.sections[0].title,
      firstDraft.sections[0].title,
    );

    await assert.rejects(
      repository.saveDraftPage({
        pageKey: "home",
        content: firstDraft,
        expectedVersion: 0,
        actorUid: "admin-two",
      }),
      (error: unknown) =>
        error instanceof CmsRepositoryError &&
        error.code === "version_conflict",
    );

    await repository.publishPage("home", 1, "admin-one");
    const firstPublished = await repository.getPublishedPage("home");
    assert.equal(
      firstPublished?.content.sections[0].title,
      "검증용 메인 화면 제목",
    );
    assert.equal(
      firstPublished?.content.sections[0].style.title.customSizePx?.mobile,
      36,
    );
    assert.equal(
      firstPublished?.content.sections
        .find((section) => section.id === "services")
        ?.items[0].id,
      services.items[0].id,
    );
    assert.ok(
      firstPublished?.content.sections
        .find((section) => section.id === "faqPreview")
        ?.items.some((item) => item.id === "faqVerification"),
    );
    assert.deepEqual(
      activeCmsMediaAssetIds(firstPublished!.content.sections),
      ["homepageVerificationImage"],
    );

    const secondDraft = structuredClone(firstPublished!.content);
    secondDraft.sections[0].title = "두 번째 게시 제목";
    secondDraft.sections[0].media!.deleted = true;
    await repository.saveDraftPage({
      pageKey: "home",
      content: secondDraft,
      expectedVersion: 2,
      actorUid: "admin-two",
    });
    assert.deepEqual(activeCmsMediaAssetIds(secondDraft.sections), []);
    secondDraft.sections[0].media!.deleted = false;
    assert.deepEqual(activeCmsMediaAssetIds(secondDraft.sections), [
      "homepageVerificationImage",
    ]);
    secondDraft.sections[0].media!.deleted = true;
    await repository.publishPage("home", 3, "admin-two");

    const revisions = await repository.listPageRevisions("home", 10);
    const firstRevision = revisions.find((revision) => revision.version === 1);
    assert.ok(firstRevision);
    await repository.restorePageRevision(
      "home",
      firstRevision.revisionId,
      4,
      "admin-one",
    );
    assert.equal(
      (await repository.getPublishedPage("home"))?.content.sections[0].title,
      "두 번째 게시 제목",
    );

    const restoredDraft = await repository.getDraftPage("home");
    assert.equal(
      restoredDraft?.content.sections[0].title,
      "검증용 메인 화면 제목",
    );
    await repository.publishPage(
      "home",
      restoredDraft!.version,
      "admin-one",
      "rollback",
    );
    assert.equal(
      (await repository.getPublishedPage("home"))?.content.sections[0].title,
      "검증용 메인 화면 제목",
    );
    assert.ok(
      (await repository.listPageRevisions("home", 10)).some(
        (revision) => revision.revisionAction === "rollback",
      ),
    );
  });

  it("keeps common-area drafts private and rejects stale saves", async () => {
    const repository = new FirestoreCmsRepository(
      new CmsMemoryFirestore() as unknown as Firestore,
    );
    const header = structuredClone(CMS_GLOBAL_DEFAULTS.header);
    header.navigation[0].label = "센터 안내";
    header.navigation[1].deleted = true;

    await repository.saveDraftGlobal({
      documentKey: "header",
      content: header,
      expectedVersion: 0,
      actorUid: "admin-one",
    });
    assert.equal(await repository.getPublishedGlobal("header"), null);
    await assert.rejects(
      repository.saveDraftGlobal({
        documentKey: "header",
        content: header,
        expectedVersion: 0,
        actorUid: "admin-two",
      }),
      (error: unknown) =>
        error instanceof CmsRepositoryError &&
        error.code === "version_conflict",
    );
    await repository.publishGlobal("header", 1, "admin-one");
    assert.equal(
      (await repository.getPublishedGlobal("header"))?.content.navigation[0]
        .label,
      "센터 안내",
    );
    assert.equal(
      (await repository.getPublishedGlobal("header"))?.content.navigation[1]
        .deleted,
      true,
    );
  });

  it("falls back to isolated code defaults for malformed published data", async () => {
    const db = new CmsMemoryFirestore();
    db._set("cmsPublishedPages/home", {
      schemaVersion: 1,
      pageKey: "home",
      route: "/wrong-route",
      content: { unsafe: true },
      version: 99,
      status: "published",
    });
    const resolved = await resolvePublishedPage(
      new FirestoreCmsRepository(db as unknown as Firestore),
      "home",
    );
    assert.equal(resolved.source, "default");
    assert.deepEqual(resolved.content, CMS_PAGE_DEFAULTS.home);
    assert.notEqual(resolved.content, CMS_PAGE_DEFAULTS.home);
  });

  it("loads one page once and four public globals in one batch", async () => {
    const db = new CmsMemoryFirestore();
    const repository = new FirestoreCmsRepository(
      db as unknown as Firestore,
    );
    await repository.getPublishedPage("home");
    await repository.getPublishedGlobals(CMS_PUBLIC_GLOBAL_KEYS);
    assert.equal(db.batchReadCallCount, 1);
    assert.equal(db.documentReadCount, 5);
  });

  it("publishes active images once and keeps deleted images recoverable", async () => {
    const content = structuredClone(CMS_PAGE_DEFAULTS.home);
    content.sections[0].media = {
      assetId: "activeImage",
      alt: "게시할 이미지",
      aspectRatio: "16:9",
    };
    content.sections[1].media = {
      assetId: "deletedImage",
      alt: "보관한 이미지",
      aspectRatio: "4:3",
      deleted: true,
    };
    const savedAssets: Array<Record<string, unknown>> = [];
    const copies: string[][] = [];
    const repository = {
      getDraftPage: async () => ({ version: 7, content }),
      getAssets: async (assetIds: string[]) => {
        assert.deepEqual(assetIds, ["activeImage"]);
        return [
          {
            schemaVersion: 1,
            assetId: "activeImage",
            status: "draft",
            storagePath: "cms/drafts/activeImage/image.png",
            originalFileName: "image.png",
            mimeType: "image/png",
            byteSize: 128,
            width: 16,
            height: 9,
            alt: "게시할 이미지",
            createdAt: "2026-07-21T00:00:00.000Z",
            createdBy: "admin-one",
            updatedAt: "2026-07-21T00:00:00.000Z",
            updatedBy: "admin-one",
          },
        ];
      },
      saveAsset: async (asset: Record<string, unknown>) => {
        savedAssets.push(asset);
      },
    } as unknown as FirestoreCmsRepository;
    const bucket = {
      file: (storagePath: string) => ({
        storagePath,
        copy: async (target: { storagePath: string }) => {
          copies.push([storagePath, target.storagePath]);
        },
      }),
    };

    await publishDraftAssetsForPage(
      "home",
      7,
      "admin-one",
      repository,
      bucket as never,
    );
    assert.deepEqual(copies, [
      [
        "cms/drafts/activeImage/image.png",
        "cms/published/activeImage/image.png",
      ],
    ]);
    assert.equal(savedAssets[0]?.status, "published");
    assert.equal(
      savedAssets[0]?.storagePath,
      "cms/published/activeImage/image.png",
    );
  });
});
