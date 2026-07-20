import { Timestamp } from "firebase-admin/firestore";
import type { CmsGlobalKey, CmsPageKey } from "@/lib/cms/constants";
import { activeCmsMediaAssetIds } from "@/lib/cms/media";
import {
  CmsRepositoryError,
  FirestoreCmsRepository,
} from "@/lib/cms/repository";
import { adminStorage } from "@/lib/firebase/admin";

export async function publishDraftAssetsForPage(
  pageKey: CmsPageKey,
  expectedDraftVersion: number,
  actorUid: string,
  repository = new FirestoreCmsRepository(),
  bucket = adminStorage().bucket(),
) {
  const draft = await repository.getDraftPage(pageKey);
  if (!draft) throw new CmsRepositoryError("draft_not_found");
  if (draft.version !== expectedDraftVersion) {
    throw new CmsRepositoryError("version_conflict");
  }
  const assetIds = [
    draft.content.seo.ogImageAssetId,
    ...activeCmsMediaAssetIds(draft.content.sections),
  ].filter((value): value is string => Boolean(value));
  const assets = await repository.getAssets(assetIds);
  if (assets.length !== new Set(assetIds).size) {
    throw new CmsRepositoryError("validation_failed", "missing_asset");
  }

  for (const asset of assets) {
    if (asset.status === "archived") {
      throw new CmsRepositoryError("validation_failed", "archived_asset");
    }
    if (asset.status === "published") continue;
    const publishedPath = asset.storagePath.replace(
      /^cms\/drafts\//,
      "cms/published/",
    );
    if (publishedPath === asset.storagePath) {
      throw new CmsRepositoryError("invalid_data", "invalid_asset_path");
    }
    await bucket.file(asset.storagePath).copy(bucket.file(publishedPath));
    const now = Timestamp.now();
    await repository.saveAsset(
      {
        ...asset,
        status: "published",
        storagePath: publishedPath,
        publishedAt: now,
        updatedAt: now,
        updatedBy: actorUid,
      },
      actorUid,
    );
  }
}

export async function publishDraftAssetsForGlobal(
  documentKey: CmsGlobalKey,
  expectedDraftVersion: number,
  actorUid: string,
  repository = new FirestoreCmsRepository(),
  bucket = adminStorage().bucket(),
) {
  const draft = await repository.getDraftGlobal(documentKey);
  if (!draft) throw new CmsRepositoryError("draft_not_found");
  if (draft.version !== expectedDraftVersion) {
    throw new CmsRepositoryError("version_conflict");
  }
  const assetIds = activeCmsMediaAssetIds(draft.content.sections);
  const assets = await repository.getAssets(assetIds);
  if (assets.length !== new Set(assetIds).size) {
    throw new CmsRepositoryError("validation_failed", "missing_asset");
  }
  for (const asset of assets) {
    if (asset.status === "archived") {
      throw new CmsRepositoryError("validation_failed", "archived_asset");
    }
    if (asset.status === "published") continue;
    const publishedPath = asset.storagePath.replace(
      /^cms\/drafts\//,
      "cms/published/",
    );
    if (publishedPath === asset.storagePath) {
      throw new CmsRepositoryError("invalid_data", "invalid_asset_path");
    }
    await bucket.file(asset.storagePath).copy(bucket.file(publishedPath));
    const now = Timestamp.now();
    await repository.saveAsset(
      {
        ...asset,
        status: "published",
        storagePath: publishedPath,
        publishedAt: now,
        updatedAt: now,
        updatedBy: actorUid,
      },
      actorUid,
    );
  }
}
