import type { Firestore } from "firebase-admin/firestore";
import {
  CMS_COLLECTIONS,
  CMS_GLOBAL_KEYS,
  CMS_PAGE_KEYS,
  type CmsGlobalKey,
  type CmsPageKey,
} from "@/lib/cms/constants";
import {
  CMS_GLOBAL_DEFAULTS,
  CMS_PAGE_DEFAULTS,
} from "@/lib/cms/defaults";
import {
  parseDraftGlobal,
  parseDraftPage,
  parsePublishedGlobal,
  parsePublishedPage,
} from "@/lib/cms/migrations";
import {
  cmsAssetSchema,
  cmsAuditLogSchema,
  type CmsAsset,
  type CmsAuditLog,
  type CmsDraftGlobal,
  type CmsDraftPage,
  type CmsPublishedGlobal,
  type CmsPublishedPage,
  type CmsTimestamp,
} from "@/lib/cms/schemas";
import {
  CMS_AUDIT_ACTION_LABELS,
  CMS_DESIGN_LABELS,
  CMS_GLOBAL_PRESENTATION,
  hasGlobalChanges,
  hasPageChanges,
} from "@/lib/cms/admin-console-presentation";
import { CMS_FEATURE_REGISTRY } from "@/lib/cms/feature-registry";
import type {
  CmsAdminActivity,
  CmsAdminCommonAreaRow,
  CmsAdminDesignSummary,
  CmsAdminIssue,
  CmsAdminOverview,
  CmsAdminPageRow,
  CmsAdminPageStatus,
} from "@/lib/cms/admin-console-types";

type ParsedAudit = CmsAuditLog & { id: string };

function toIso(value: CmsTimestamp | undefined) {
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

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${Math.round(bytes / 1_024)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

function assetKind(mimeType: CmsAsset["mimeType"]) {
  if (mimeType === "application/pdf") return "PDF 문서";
  if (mimeType === "image/gif") return "움직이는 이미지";
  return "이미지";
}

function statusFor(
  invalid: boolean,
  hasChanges: boolean,
  hasPublished: boolean,
): { status: CmsAdminPageStatus; statusLabel: string } {
  if (invalid) return { status: "needsReview", statusLabel: "확인 필요" };
  if (hasChanges) return { status: "draft", statusLabel: "게시 전 변경 있음" };
  if (hasPublished) return { status: "published", statusLabel: "게시됨" };
  return { status: "default", statusLabel: "기본 내용 사용" };
}

function targetName(audit: CmsAuditLog, assets: Map<string, CmsAsset>) {
  if (audit.targetType === "page") {
    return (
      CMS_FEATURE_REGISTRY[audit.targetKey as CmsPageKey]?.userFacingName ??
      "화면"
    );
  }
  if (audit.targetType === "global") {
    return CMS_GLOBAL_PRESENTATION[audit.targetKey as CmsGlobalKey]?.name ?? "공통 영역";
  }
  return assets.get(audit.targetKey)?.originalFileName ?? "이미지·파일";
}

function activityTone(action: string): CmsAdminActivity["tone"] {
  if (action === "published") return "green";
  if (action === "revision.restored") return "amber";
  if (action.startsWith("asset.")) return "slate";
  return "blue";
}

function isWithinDays(value: string, days: number) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp <= days * 86_400_000;
}

export async function loadCmsAdminOverview(
  db: Firestore,
): Promise<CmsAdminOverview> {
  const [
    publishedPagesSnapshot,
    draftPagesSnapshot,
    publishedGlobalsSnapshot,
    draftGlobalsSnapshot,
    auditSnapshot,
    assetSnapshot,
  ] = await Promise.all([
    db.collection(CMS_COLLECTIONS.publishedPages).get(),
    db.collection(CMS_COLLECTIONS.draftPages).get(),
    db.collection(CMS_COLLECTIONS.publishedGlobals).get(),
    db.collection(CMS_COLLECTIONS.draftGlobals).get(),
    db.collection(CMS_COLLECTIONS.auditLogs).orderBy("createdAt", "desc").limit(80).get(),
    db.collection(CMS_COLLECTIONS.assets).orderBy("updatedAt", "desc").limit(100).get(),
  ]);

  const rawPublishedPages = new Map(
    publishedPagesSnapshot.docs.map((document) => [document.id, document.data()]),
  );
  const rawDraftPages = new Map(
    draftPagesSnapshot.docs.map((document) => [document.id, document.data()]),
  );
  const rawPublishedGlobals = new Map(
    publishedGlobalsSnapshot.docs.map((document) => [document.id, document.data()]),
  );
  const rawDraftGlobals = new Map(
    draftGlobalsSnapshot.docs.map((document) => [document.id, document.data()]),
  );

  const issues: CmsAdminIssue[] = [];
  const publishedPages = new Map<CmsPageKey, CmsPublishedPage>();
  const draftPages = new Map<CmsPageKey, CmsDraftPage>();
  const invalidPages = new Set<CmsPageKey>();
  const publishedGlobals = new Map<CmsGlobalKey, CmsPublishedGlobal>();
  const draftGlobals = new Map<CmsGlobalKey, CmsDraftGlobal>();
  const invalidGlobals = new Set<CmsGlobalKey>();

  for (const pageKey of CMS_PAGE_KEYS) {
    const rawPublished = rawPublishedPages.get(pageKey);
    const rawDraft = rawDraftPages.get(pageKey);
    if (rawPublished) {
      const parsed = parsePublishedPage(rawPublished, pageKey);
      if (parsed.success) {
        publishedPages.set(pageKey, parsed.data);
      } else {
        invalidPages.add(pageKey);
        issues.push({
          id: `published-page-${pageKey}`,
          severity: "error",
          title: `${CMS_FEATURE_REGISTRY[pageKey].userFacingName} 게시 내용을 확인해 주세요.`,
          description: "저장된 게시 내용을 안전하게 읽을 수 없어 기본 내용을 표시하고 있습니다.",
          targetMenu: "pages",
        });
      }
    }
    if (rawDraft) {
      const parsed = parseDraftPage(rawDraft, pageKey);
      if (parsed.success) {
        draftPages.set(pageKey, parsed.data);
      } else {
        invalidPages.add(pageKey);
        issues.push({
          id: `draft-page-${pageKey}`,
          severity: "error",
          title: `${CMS_FEATURE_REGISTRY[pageKey].userFacingName} 초안을 확인해 주세요.`,
          description: "초안에 잘못된 값이 있어 편집 화면에서 확인이 필요합니다.",
          targetMenu: "pages",
        });
      }
    }
  }

  for (const documentKey of CMS_GLOBAL_KEYS) {
    const rawPublished = rawPublishedGlobals.get(documentKey);
    const rawDraft = rawDraftGlobals.get(documentKey);
    if (rawPublished) {
      const parsed = parsePublishedGlobal(rawPublished, documentKey);
      if (parsed.success) {
        publishedGlobals.set(documentKey, parsed.data);
      } else {
        invalidGlobals.add(documentKey);
        issues.push({
          id: `published-global-${documentKey}`,
          severity: "error",
          title: `${CMS_GLOBAL_PRESENTATION[documentKey].name} 게시 내용을 확인해 주세요.`,
          description: "저장된 공통 내용을 안전하게 읽을 수 없어 기본값을 사용합니다.",
          targetMenu: "globals",
        });
      }
    }
    if (rawDraft) {
      const parsed = parseDraftGlobal(rawDraft, documentKey);
      if (parsed.success) {
        draftGlobals.set(documentKey, parsed.data);
      } else {
        invalidGlobals.add(documentKey);
        issues.push({
          id: `draft-global-${documentKey}`,
          severity: "error",
          title: `${CMS_GLOBAL_PRESENTATION[documentKey].name} 초안을 확인해 주세요.`,
          description: "초안에 잘못된 값이 있어 편집 화면에서 확인이 필요합니다.",
          targetMenu: "globals",
        });
      }
    }
  }

  const assets = new Map<string, CmsAsset>();
  for (const document of assetSnapshot.docs) {
    const parsed = cmsAssetSchema.safeParse(document.data());
    if (parsed.success) {
      assets.set(document.id, parsed.data);
    } else {
      issues.push({
        id: `asset-${document.id}`,
        severity: "error",
        title: "이미지·파일 정보를 확인해 주세요.",
        description: "파일 정보에 누락되거나 허용되지 않은 값이 있습니다.",
        targetMenu: "assets",
      });
    }
  }

  const audits: ParsedAudit[] = [];
  for (const document of auditSnapshot.docs) {
    const parsed = cmsAuditLogSchema.safeParse(document.data());
    if (parsed.success) audits.push({ ...parsed.data, id: document.id });
  }

  const actorUids = new Set<string>();
  for (const draft of draftPages.values()) actorUids.add(draft.updatedBy);
  for (const draft of draftGlobals.values()) actorUids.add(draft.updatedBy);
  for (const asset of assets.values()) actorUids.add(asset.updatedBy);
  for (const audit of audits) actorUids.add(audit.actorUid);

  const actorNames = new Map<string, string>();
  if (actorUids.size > 0) {
    const userRefs = [...actorUids].map((uid) => db.collection("users").doc(uid));
    const userSnapshots = await db.getAll(...userRefs);
    userSnapshots.forEach((snapshot, index) => {
      const name = snapshot.data()?.name;
      actorNames.set(
        [...actorUids][index],
        typeof name === "string" && name.trim() ? name.trim() : "관리자",
      );
    });
  }

  const latestAuditByTarget = new Map<string, ParsedAudit>();
  for (const audit of audits) {
    const key = `${audit.targetType}:${audit.targetKey}`;
    if (!latestAuditByTarget.has(key)) latestAuditByTarget.set(key, audit);
  }

  const pages: CmsAdminPageRow[] = CMS_PAGE_KEYS.map((pageKey) => {
    const definition = CMS_FEATURE_REGISTRY[pageKey];
    const published = publishedPages.get(pageKey) ?? null;
    const draft = draftPages.get(pageKey) ?? null;
    const hasChanges = hasPageChanges(draft, published);
    const invalid = invalidPages.has(pageKey);
    const status = statusFor(invalid, hasChanges, Boolean(published));
    const content = draft?.content ?? published?.content ?? CMS_PAGE_DEFAULTS[pageKey];
    const latestAudit = latestAuditByTarget.get(`page:${pageKey}`);
    const modifiedAt =
      toIso(draft?.updatedAt) ??
      toIso(latestAudit?.createdAt) ??
      toIso(published?.publishedAt);
    const modifiedActor = draft?.updatedBy ?? latestAudit?.actorUid;

    if (
      draft &&
      published &&
      draft.basePublishedVersion !== published.version &&
      hasChanges
    ) {
      issues.push({
        id: `version-page-${pageKey}`,
        severity: "warning",
        title: `${definition.userFacingName} 초안이 이전 게시본을 기준으로 합니다.`,
        description: "다른 관리자의 게시 내용을 확인한 뒤 편집을 계속해 주세요.",
        targetMenu: "pages",
      });
    }

    return {
      id: pageKey,
      ...definition.adminMenu.presentation,
      url: definition.route,
      ...status,
      hasUnpublishedChanges: hasChanges,
      draftVersion: draft?.version ?? null,
      publishedVersion: published?.version ?? null,
      modifiedBy: modifiedActor
        ? actorNames.get(modifiedActor) ?? "관리자"
        : "수정 기록 없음",
      modifiedAt,
      publishedAt: toIso(published?.publishedAt),
      sections: content.sections.map((section) => ({
        name: section.title,
        visible: section.visible,
        protected: section.locked,
        itemCount: section.items.length,
      })),
    };
  });

  const commonAreas: CmsAdminCommonAreaRow[] = CMS_GLOBAL_KEYS.map(
    (documentKey) => {
      const published = publishedGlobals.get(documentKey) ?? null;
      const draft = draftGlobals.get(documentKey) ?? null;
      const hasChanges = hasGlobalChanges(draft, published);
      const status = statusFor(
        invalidGlobals.has(documentKey),
        hasChanges,
        Boolean(published),
      );
      const latestAudit = latestAuditByTarget.get(`global:${documentKey}`);
      const modifiedActor = draft?.updatedBy ?? latestAudit?.actorUid;
      return {
        id: documentKey,
        ...CMS_GLOBAL_PRESENTATION[documentKey],
        ...status,
        hasUnpublishedChanges: hasChanges,
        modifiedBy: modifiedActor
          ? actorNames.get(modifiedActor) ?? "관리자"
          : "수정 기록 없음",
        modifiedAt:
          toIso(draft?.updatedAt) ??
          toIso(latestAudit?.createdAt) ??
          toIso(published?.publishedAt),
      };
    },
  );

  const themeDraft = draftGlobals.get("theme");
  const themePublished = publishedGlobals.get("theme");
  const themeHasChanges = hasGlobalChanges(themeDraft ?? null, themePublished ?? null);
  const selectedTheme =
    themeDraft?.content.theme ??
    themePublished?.content.theme ??
    CMS_GLOBAL_DEFAULTS.theme.theme ?? {
      palette: "default",
      textScale: "default",
      spacing: "default",
      radius: "default",
      alignment: "left",
    };
  const palette = selectedTheme.palette ?? "default";
  const textScale = selectedTheme.textScale ?? "default";
  const spacing = selectedTheme.spacing ?? "default";
  const radius = selectedTheme.radius ?? "default";
  const alignment = selectedTheme.alignment ?? "left";
  const design: CmsAdminDesignSummary = {
    palette,
    paletteLabel: CMS_DESIGN_LABELS.palette[palette],
    textScale,
    textScaleLabel: CMS_DESIGN_LABELS.textScale[textScale],
    spacing,
    spacingLabel: CMS_DESIGN_LABELS.spacing[spacing],
    radius,
    radiusLabel: CMS_DESIGN_LABELS.radius[radius],
    alignment,
    alignmentLabel: CMS_DESIGN_LABELS.alignment[alignment],
    sourceLabel: themeHasChanges
      ? "게시 전 설정"
      : themePublished
        ? "게시된 설정"
        : "기본 설정",
  };

  const assetRows = [...assets.values()].map((asset) => ({
    id: asset.assetId,
    name: asset.originalFileName,
    kind: assetKind(asset.mimeType),
    sizeLabel: formatBytes(asset.byteSize),
    alt: asset.alt,
    statusLabel:
      asset.status === "published"
        ? "사용 중"
        : asset.status === "archived"
          ? "보관됨"
          : "게시 전",
    updatedAt: toIso(asset.updatedAt) ?? new Date(0).toISOString(),
    updatedBy: actorNames.get(asset.updatedBy) ?? "관리자",
  }));

  const activities: CmsAdminActivity[] = audits
    .map((audit) => {
      const createdAt = toIso(audit.createdAt);
      if (!createdAt) return null;
      return {
        id: audit.id,
        action: CMS_AUDIT_ACTION_LABELS[audit.action] ?? "내용을 변경했습니다.",
        target: targetName(audit, assets),
        actor: actorNames.get(audit.actorUid) ?? "관리자",
        createdAt,
        tone: activityTone(audit.action),
        published: audit.action === "published",
      } satisfies CmsAdminActivity;
    })
    .filter((activity): activity is CmsAdminActivity => activity !== null);

  issues.push({
    id: "partner-access-review",
    severity: "warning",
    title: "협력 전문가 화면의 접근 범위를 확인해 주세요.",
    description: "협력 전문가 전용 기능을 공개하기 전에 별도 권한 설정이 필요합니다.",
    targetMenu: "pages",
  });

  const recentChanges = activities.filter((activity) => !activity.published).slice(0, 8);
  const recentPublishes = activities.filter((activity) => activity.published).slice(0, 8);

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      editablePages: pages.length,
      unpublishedDrafts:
        pages.filter((page) => page.hasUnpublishedChanges).length +
        commonAreas.filter((area) => area.hasUnpublishedChanges).length,
      recentlyModified: recentChanges.filter((activity) =>
        isWithinDays(activity.createdAt, 7),
      ).length,
      recentlyPublished: recentPublishes.filter((activity) =>
        isWithinDays(activity.createdAt, 7),
      ).length,
      reviewRequired: issues.length,
    },
    pages,
    commonAreas,
    design,
    assets: assetRows,
    recentChanges,
    recentPublishes,
    issues,
  };
}
