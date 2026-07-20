import type {
  CmsAsset,
  CmsPageContent,
  CmsThemeOverrides,
} from "@/lib/cms/schemas";
import type { CmsPageKey } from "@/lib/cms/constants";
import type { CmsEditorValidationIssue } from "@/lib/cms/editor-validation";

export type CmsPageEditorRevision = {
  id: string;
  version: number;
  action: "publish" | "rollback";
  createdAt: string | null;
  legalCopyChanged?: boolean;
};

export type CmsPageEditorAsset = Pick<
  CmsAsset,
  | "assetId"
  | "status"
  | "storagePath"
  | "originalFileName"
  | "mimeType"
  | "byteSize"
  | "width"
  | "height"
  | "alt"
>;

export type CmsPageEditorData = {
  pageKey: CmsPageKey;
  pageName: string;
  pageDescription: string;
  route: string;
  audienceLabel: string;
  content: CmsPageContent;
  publishedContent: CmsPageContent;
  theme?: CmsThemeOverrides;
  draftVersion: number;
  basePublishedVersion: number;
  publishedVersion: number;
  hasUnpublishedChanges: boolean;
  updatedAt: string | null;
  revisions: CmsPageEditorRevision[];
  assets: CmsPageEditorAsset[];
  validationIssues: CmsEditorValidationIssue[];
};

export type CmsPageEditorApiResponse =
  | { ok: true; editor: CmsPageEditorData }
  | {
      ok: false;
      error:
        | "missing_token"
        | "permission_denied"
        | "page_not_found"
        | "version_conflict"
        | "invalid_request"
        | "editor_unavailable";
    };
