import type { CmsGlobalKey } from "@/lib/cms/constants";
import type { CmsPublicGlobals } from "@/lib/cms/public-content";
import type {
  CmsGlobalContent,
  CmsPageContent,
} from "@/lib/cms/schemas";
import type { CmsPageEditorAsset } from "@/lib/cms/page-editor-types";

export type CmsGlobalEditorRevision = {
  id: string;
  version: number;
  action: "publish" | "rollback";
  createdAt: string | null;
};

export type CmsGlobalEditorData = {
  documentKey: CmsGlobalKey;
  name: string;
  description: string;
  affectedArea: string;
  content: CmsGlobalContent;
  publishedContent: CmsGlobalContent;
  draftVersion: number;
  basePublishedVersion: number;
  publishedVersion: number;
  hasUnpublishedChanges: boolean;
  updatedAt: string | null;
  revisions: CmsGlobalEditorRevision[];
  assets: CmsPageEditorAsset[];
  previewPageContent: CmsPageContent;
  previewGlobals: CmsPublicGlobals;
};

export type CmsGlobalEditorApiResponse =
  | { ok: true; editor: CmsGlobalEditorData }
  | {
      ok: false;
      error:
        | "missing_token"
        | "permission_denied"
        | "common_area_not_found"
        | "version_conflict"
        | "invalid_request"
        | "invalid_data"
        | "validation_failed"
        | "editor_unavailable";
    };
