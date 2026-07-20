import { CMS_GLOBAL_PRESENTATION, hasGlobalChanges } from "@/lib/cms/admin-console-presentation";
import { CMS_GLOBAL_DEFAULTS, CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";
import {
  CMS_PUBLIC_GLOBAL_KEYS,
  type CmsGlobalKey,
} from "@/lib/cms/constants";
import type { CmsGlobalEditorData } from "@/lib/cms/global-editor-types";
import type { CmsPublicGlobals } from "@/lib/cms/public-content";
import { FirestoreCmsRepository } from "@/lib/cms/repository";
import type { CmsTimestamp } from "@/lib/cms/schemas";

function toIsoString(value: CmsTimestamp | undefined) {
  if (!value) return null;
  try {
    const date =
      typeof value === "string"
        ? new Date(value)
        : value instanceof Date
          ? value
          : value.toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
}

export async function loadCmsGlobalEditorData(
  documentKey: CmsGlobalKey,
  repository = new FirestoreCmsRepository(),
): Promise<CmsGlobalEditorData> {
  const [
    draft,
    published,
    revisions,
    homeDraft,
    homePublished,
    publishedGlobals,
    ...globalDrafts
  ] = await Promise.all([
    repository.getDraftGlobal(documentKey),
    repository.getPublishedGlobal(documentKey),
    repository.listGlobalRevisions(documentKey, 20),
    repository.getDraftPage("home"),
    repository.getPublishedPage("home"),
    repository.getPublishedGlobals(CMS_PUBLIC_GLOBAL_KEYS),
    ...CMS_PUBLIC_GLOBAL_KEYS.map((key) => repository.getDraftGlobal(key)),
  ]);
  const publishedContent = structuredClone(
    published?.content ?? CMS_GLOBAL_DEFAULTS[documentKey],
  );
  const content = structuredClone(draft?.content ?? publishedContent);
  const previewGlobals = Object.fromEntries(
    CMS_PUBLIC_GLOBAL_KEYS.map((key, index) => [
      key,
      structuredClone(
        key === documentKey
          ? content
          : globalDrafts[index]?.content ??
              publishedGlobals[key]?.content ??
              CMS_GLOBAL_DEFAULTS[key],
      ),
    ]),
  ) as CmsPublicGlobals;
  const assetIds = [
    ...content.sections.map((section) => section.media?.assetId),
  ].filter((value): value is string => Boolean(value));
  const assets = await repository.getAssets(assetIds);
  const presentation = CMS_GLOBAL_PRESENTATION[documentKey];

  return {
    documentKey,
    name: presentation.name,
    description: presentation.description,
    affectedArea: presentation.affectedArea,
    content,
    publishedContent,
    draftVersion: draft?.version ?? 0,
    basePublishedVersion:
      draft?.basePublishedVersion ?? published?.version ?? 0,
    publishedVersion: published?.version ?? 0,
    hasUnpublishedChanges: hasGlobalChanges(draft, published),
    updatedAt: toIsoString(draft?.updatedAt),
    revisions: revisions.map((revision) => ({
      id: revision.revisionId,
      version: revision.version,
      action: revision.revisionAction,
      createdAt: toIsoString(revision.createdAt),
    })),
    assets: assets.map((asset) => ({
      assetId: asset.assetId,
      status: asset.status,
      storagePath: asset.storagePath,
      originalFileName: asset.originalFileName,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      width: asset.width,
      height: asset.height,
      alt: asset.alt,
    })),
    previewPageContent: structuredClone(
      homeDraft?.content ?? homePublished?.content ?? CMS_PAGE_DEFAULTS.home,
    ),
    previewGlobals,
  };
}
