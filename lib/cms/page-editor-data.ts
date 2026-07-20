import { CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";
import { normalizeAuditQuoteCmsContent } from "@/lib/cms/audit-quote-content";
import { normalizeCmsPageContent } from "@/lib/cms/page-content";
import { validatePageContentForPublish } from "@/lib/cms/editor-validation";
import {
  CMS_PAGE_PRESENTATION,
  hasPageChanges,
} from "@/lib/cms/admin-console-presentation";
import { CMS_PAGE_ROUTES, type CmsPageKey } from "@/lib/cms/constants";
import type { CmsPageEditorData } from "@/lib/cms/page-editor-types";
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

function auditQuoteLegalCopyChanged(
  content: (typeof CMS_PAGE_DEFAULTS)["event.auditQuote"],
) {
  const defaults = CMS_PAGE_DEFAULTS["event.auditQuote"];
  const intake = content.sections.find(
    (section) => section.id === "intakeForm",
  );
  const defaultIntake = defaults.sections.find(
    (section) => section.id === "intakeForm",
  );
  const legal = content.sections.find(
    (section) => section.id === "legalNotice",
  );
  const defaultLegal = defaults.sections.find(
    (section) => section.id === "legalNotice",
  );
  return (
    intake?.text.privacyConsentLabel !==
      defaultIntake?.text.privacyConsentLabel ||
    intake?.text.privacyConsentLinkLabel !==
      defaultIntake?.text.privacyConsentLinkLabel ||
    intake?.text.freeNotice !== defaultIntake?.text.freeNotice ||
    legal?.text.operatorName !== defaultLegal?.text.operatorName ||
    legal?.description !== defaultLegal?.description
  );
}

function legalPolicyCopyChanged(
  pageKey: "legal.terms" | "legal.privacy",
  content: (typeof CMS_PAGE_DEFAULTS)[typeof pageKey],
) {
  const defaults = CMS_PAGE_DEFAULTS[pageKey];
  return defaults.sections.some((fallback) => {
    const current = content.sections.find(
      (section) => section.id === fallback.id,
    );
    return (
      !current ||
      current.title !== fallback.title ||
      current.description !== fallback.description ||
      JSON.stringify(current.text) !== JSON.stringify(fallback.text)
    );
  });
}

function signupConsentCopyChanged(
  content: (typeof CMS_PAGE_DEFAULTS)["auth.signup"],
) {
  const fallback = CMS_PAGE_DEFAULTS["auth.signup"].sections.find(
    (section) => section.id === "consents",
  );
  const current = content.sections.find(
    (section) => section.id === "consents",
  );
  return (
    !current ||
    current.title !== fallback?.title ||
    JSON.stringify(current.text) !== JSON.stringify(fallback?.text) ||
    JSON.stringify(current.actions) !== JSON.stringify(fallback?.actions)
  );
}

export async function loadCmsPageEditorData(
  pageKey: CmsPageKey,
  repository = new FirestoreCmsRepository(),
): Promise<CmsPageEditorData> {
  const [draft, published, revisions] = await Promise.all([
    repository.getDraftPage(pageKey),
    repository.getPublishedPage(pageKey),
    repository.listPageRevisions(pageKey, 20),
  ]);
  const rawPublishedContent = structuredClone(
    published?.content ?? CMS_PAGE_DEFAULTS[pageKey],
  );
  const publishedContent =
    pageKey === "event.auditQuote"
      ? normalizeAuditQuoteCmsContent(rawPublishedContent)
      : normalizeCmsPageContent(pageKey, rawPublishedContent);
  const rawContent = structuredClone(draft?.content ?? publishedContent);
  const content =
    pageKey === "event.auditQuote"
      ? normalizeAuditQuoteCmsContent(rawContent)
      : normalizeCmsPageContent(pageKey, rawContent);
  const assetIds = [
    content.seo.ogImageAssetId,
    ...content.sections.map((section) => section.media?.assetId),
  ].filter((value): value is string => Boolean(value));
  const assets = await repository.getAssets(assetIds);
  const presentation = CMS_PAGE_PRESENTATION[pageKey];

  return {
    pageKey,
    pageName: presentation.name,
    pageDescription: presentation.description,
    route: published?.route ?? draft?.route ?? CMS_PAGE_ROUTES[pageKey],
    audienceLabel: presentation.audienceLabel,
    content,
    publishedContent,
    theme: draft?.theme ?? published?.theme,
    draftVersion: draft?.version ?? 0,
    basePublishedVersion:
      draft?.basePublishedVersion ?? published?.version ?? 0,
    publishedVersion: published?.version ?? 0,
    hasUnpublishedChanges: hasPageChanges(draft, published),
    updatedAt: toIsoString(draft?.updatedAt),
    revisions: revisions.map((revision) => ({
      id: revision.revisionId,
      version: revision.version,
      action: revision.revisionAction,
      createdAt: toIsoString(revision.createdAt),
      legalCopyChanged:
        pageKey === "event.auditQuote"
          ? auditQuoteLegalCopyChanged(revision.content)
          : pageKey === "legal.terms" || pageKey === "legal.privacy"
            ? legalPolicyCopyChanged(pageKey, revision.content)
            : pageKey === "auth.signup"
              ? signupConsentCopyChanged(revision.content)
              : undefined,
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
    validationIssues: validatePageContentForPublish(content, pageKey),
  };
}
