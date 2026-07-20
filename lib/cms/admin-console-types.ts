import type { CmsGlobalKey, CmsPageKey } from "@/lib/cms/constants";

export type CmsAdminSectionSummary = {
  name: string;
  visible: boolean;
  protected: boolean;
  itemCount: number;
};

export type CmsAdminPageStatus =
  | "default"
  | "published"
  | "draft"
  | "needsReview";

export type CmsAdminPageRow = {
  id: CmsPageKey;
  name: string;
  description: string;
  url: string;
  previewUrl: string | null;
  audience: "public" | "member" | "partner" | "admin";
  audienceLabel: string;
  category: "public" | "auth" | "member" | "event" | "admin" | "other";
  categoryLabel: string;
  status: CmsAdminPageStatus;
  statusLabel: string;
  hasUnpublishedChanges: boolean;
  draftVersion: number | null;
  publishedVersion: number | null;
  modifiedBy: string;
  modifiedAt: string | null;
  publishedAt: string | null;
  sections: CmsAdminSectionSummary[];
};

export type CmsAdminCommonAreaRow = {
  id: CmsGlobalKey;
  name: string;
  description: string;
  affectedArea: string;
  status: CmsAdminPageStatus;
  statusLabel: string;
  hasUnpublishedChanges: boolean;
  modifiedBy: string;
  modifiedAt: string | null;
};

export type CmsAdminActivity = {
  id: string;
  action: string;
  target: string;
  actor: string;
  createdAt: string;
  tone: "blue" | "green" | "amber" | "slate";
  published: boolean;
};

export type CmsAdminIssue = {
  id: string;
  severity: "error" | "warning";
  title: string;
  description: string;
  targetMenu: "pages" | "globals" | "design" | "assets" | "history";
};

export type CmsAdminAssetRow = {
  id: string;
  name: string;
  kind: string;
  sizeLabel: string;
  alt: string;
  statusLabel: string;
  updatedAt: string;
  updatedBy: string;
};

export type CmsAdminDesignSummary = {
  palette: "default" | "calmBlue" | "forest" | "highContrast";
  paletteLabel: string;
  textScale: "small" | "default" | "large";
  textScaleLabel: string;
  spacing: "compact" | "default" | "relaxed";
  spacingLabel: string;
  radius: "square" | "default" | "rounded";
  radiusLabel: string;
  alignment: "left" | "center";
  alignmentLabel: string;
  sourceLabel: string;
};

export type CmsAdminOverview = {
  generatedAt: string;
  counts: {
    editablePages: number;
    unpublishedDrafts: number;
    recentlyModified: number;
    recentlyPublished: number;
    reviewRequired: number;
  };
  pages: CmsAdminPageRow[];
  commonAreas: CmsAdminCommonAreaRow[];
  design: CmsAdminDesignSummary;
  assets: CmsAdminAssetRow[];
  recentChanges: CmsAdminActivity[];
  recentPublishes: CmsAdminActivity[];
  issues: CmsAdminIssue[];
};

export type CmsAdminOverviewApiResponse =
  | { ok: true; overview: CmsAdminOverview }
  | { ok: false; error: string };
