import { randomUUID } from "node:crypto";
import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import {
  CMS_COLLECTIONS,
  CMS_PAGE_ROUTES,
  CMS_SCHEMA_VERSION,
  type CmsGlobalKey,
  type CmsPageKey,
} from "@/lib/cms/constants";
import { validatePageIdentity } from "@/lib/cms/defaults";
import {
  normalizePageContentForPublish,
  validatePageContentForPublish,
} from "@/lib/cms/editor-validation";
import {
  parseDraftGlobal,
  parseDraftPage,
  parsePublishedGlobal,
  parsePublishedPage,
} from "@/lib/cms/migrations";
import {
  cmsAssetSchema,
  cmsAuditLogSchema,
  cmsGlobalContentSchema,
  cmsGlobalRevisionSchema,
  cmsPageContentSchema,
  cmsPageRevisionSchema,
  cmsThemeOverridesSchema,
  type CmsAsset,
  type CmsDraftGlobal,
  type CmsDraftPage,
  type CmsGlobalContent,
  type CmsGlobalRevision,
  type CmsPageContent,
  type CmsPageRevision,
  type CmsPublishedGlobal,
  type CmsPublishedPage,
  type CmsThemeOverrides,
} from "@/lib/cms/schemas";
import { adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";

export class CmsRepositoryError extends Error {
  public readonly code:
    | "invalid_data"
    | "validation_failed"
    | "version_conflict"
    | "draft_not_found"
    | "revision_not_found";

  constructor(
    code: CmsRepositoryError["code"],
    message: string = code,
  ) {
    super(message);
    this.code = code;
    this.name = "CmsRepositoryError";
  }
}

export type CmsPublishedBundle = {
  page: CmsPublishedPage | null;
  globals: Partial<Record<CmsGlobalKey, CmsPublishedGlobal>>;
};

export interface CmsRepository {
  getPublishedPage(pageKey: CmsPageKey): Promise<CmsPublishedPage | null>;
  getPublishedGlobal(documentKey: CmsGlobalKey): Promise<CmsPublishedGlobal | null>;
  getPublishedGlobals(
    documentKeys: readonly CmsGlobalKey[],
  ): Promise<Partial<Record<CmsGlobalKey, CmsPublishedGlobal>>>;
  getPublishedBundle(
    pageKey: CmsPageKey,
    globalKeys: readonly CmsGlobalKey[],
  ): Promise<CmsPublishedBundle>;
}

export type CmsDraftPageInput = {
  pageKey: CmsPageKey;
  content: CmsPageContent;
  theme?: CmsThemeOverrides;
  internalNote?: string;
  expectedVersion: number;
  actorUid: string;
};

export type CmsDraftGlobalInput = {
  documentKey: CmsGlobalKey;
  content: CmsGlobalContent;
  internalNote?: string;
  expectedVersion: number;
  actorUid: string;
};

function createId(prefix: "r" | "a") {
  return `${prefix}${Date.now()}_${randomUUID().replaceAll("-", "")}`;
}

function requireActorUid(actorUid: string) {
  const normalized = actorUid.trim();
  if (!normalized || normalized.length > 128) {
    throw new CmsRepositoryError("invalid_data", "invalid_actor_uid");
  }
  return normalized;
}

function parseOrThrow<T>(
  result:
    | { success: true; data: T }
    | { success: false; error: string; details?: unknown },
) {
  if (!result.success) {
    throw new CmsRepositoryError("invalid_data", result.error);
  }
  return result.data;
}

export class FirestoreCmsRepository implements CmsRepository {
  private readonly db: Firestore;

  constructor(db: Firestore = adminDb()) {
    this.db = db;
  }

  async getPublishedPage(pageKey: CmsPageKey) {
    const snapshot = await this.db
      .collection(CMS_COLLECTIONS.publishedPages)
      .doc(pageKey)
      .get();
    if (!snapshot.exists) return null;
    return parseOrThrow(parsePublishedPage(snapshot.data(), pageKey));
  }

  async getPublishedGlobal(documentKey: CmsGlobalKey) {
    const snapshot = await this.db
      .collection(CMS_COLLECTIONS.publishedGlobals)
      .doc(documentKey)
      .get();
    if (!snapshot.exists) return null;
    return parseOrThrow(parsePublishedGlobal(snapshot.data(), documentKey));
  }

  async getPublishedGlobals(documentKeys: readonly CmsGlobalKey[]) {
    const uniqueKeys = [...new Set(documentKeys)];
    if (uniqueKeys.length === 0) return {};
    const refs = uniqueKeys.map((documentKey) =>
      this.db.collection(CMS_COLLECTIONS.publishedGlobals).doc(documentKey),
    );
    const snapshots = await this.db.getAll(...refs);
    const globals: Partial<Record<CmsGlobalKey, CmsPublishedGlobal>> = {};
    snapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return;
      const documentKey = uniqueKeys[index];
      globals[documentKey] = parseOrThrow(
        parsePublishedGlobal(snapshot.data(), documentKey),
      );
    });
    return globals;
  }

  async getPublishedBundle(
    pageKey: CmsPageKey,
    globalKeys: readonly CmsGlobalKey[],
  ): Promise<CmsPublishedBundle> {
    const uniqueGlobalKeys = [...new Set(globalKeys)];
    const refs = [
      this.db.collection(CMS_COLLECTIONS.publishedPages).doc(pageKey),
      ...uniqueGlobalKeys.map((documentKey) =>
        this.db.collection(CMS_COLLECTIONS.publishedGlobals).doc(documentKey),
      ),
    ];
    const [pageSnapshot, ...globalSnapshots] = await this.db.getAll(...refs);
    const page = pageSnapshot.exists
      ? parseOrThrow(parsePublishedPage(pageSnapshot.data(), pageKey))
      : null;
    const globals: Partial<Record<CmsGlobalKey, CmsPublishedGlobal>> = {};
    globalSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return;
      const documentKey = uniqueGlobalKeys[index];
      globals[documentKey] = parseOrThrow(
        parsePublishedGlobal(snapshot.data(), documentKey),
      );
    });
    return { page, globals };
  }

  async getDraftPage(pageKey: CmsPageKey): Promise<CmsDraftPage | null> {
    const snapshot = await this.db
      .collection(CMS_COLLECTIONS.draftPages)
      .doc(pageKey)
      .get();
    return snapshot.exists
      ? parseOrThrow(parseDraftPage(snapshot.data(), pageKey))
      : null;
  }

  async getDraftGlobal(
    documentKey: CmsGlobalKey,
  ): Promise<CmsDraftGlobal | null> {
    const snapshot = await this.db
      .collection(CMS_COLLECTIONS.draftGlobals)
      .doc(documentKey)
      .get();
    return snapshot.exists
      ? parseOrThrow(parseDraftGlobal(snapshot.data(), documentKey))
      : null;
  }

  async saveDraftPage(input: CmsDraftPageInput) {
    const actorUid = requireActorUid(input.actorUid);
    const content = cmsPageContentSchema.parse(input.content);
    const theme = input.theme
      ? cmsThemeOverridesSchema.parse(input.theme)
      : undefined;
    const identity = validatePageIdentity(
      input.pageKey,
      CMS_PAGE_ROUTES[input.pageKey],
      content,
    );
    if (!identity.success) {
      throw new CmsRepositoryError("invalid_data", identity.reason);
    }
    const draftRef = this.db
      .collection(CMS_COLLECTIONS.draftPages)
      .doc(input.pageKey);
    const publishedRef = this.db
      .collection(CMS_COLLECTIONS.publishedPages)
      .doc(input.pageKey);
    await this.db.runTransaction(async (transaction) => {
      const [draftSnapshot, publishedSnapshot] = await Promise.all([
        transaction.get(draftRef),
        transaction.get(publishedRef),
      ]);
      const current = draftSnapshot.exists
        ? parseOrThrow(parseDraftPage(draftSnapshot.data(), input.pageKey))
        : null;
      const currentPublished = publishedSnapshot.exists
        ? parseOrThrow(
            parsePublishedPage(publishedSnapshot.data(), input.pageKey),
          )
        : null;
      const currentVersion = current?.version ?? 0;
      if (currentVersion !== input.expectedVersion) {
        throw new CmsRepositoryError("version_conflict");
      }
      const nextVersion = currentVersion + 1;
      const now = Timestamp.now();
      const next = {
        schemaVersion: CMS_SCHEMA_VERSION,
        pageKey: input.pageKey,
        route: CMS_PAGE_ROUTES[input.pageKey],
        content,
        theme,
        version: nextVersion,
        basePublishedVersion:
          current?.basePublishedVersion ?? currentPublished?.version ?? 0,
        status: "draft" as const,
        internalNote: input.internalNote,
        createdAt: current?.createdAt ?? now,
        createdBy: current?.createdBy ?? actorUid,
        updatedAt: now,
        updatedBy: actorUid,
      };
      const parsed = parseDraftPage(next, input.pageKey);
      if (!parsed.success) {
        throw new CmsRepositoryError("invalid_data", parsed.error);
      }
      transaction.set(draftRef, withoutUndefined({
        ...parsed.data,
        createdAt: current?.createdAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }));
      this.writeAudit(transaction, {
        targetType: "page",
        targetKey: input.pageKey,
        action: current ? "draft.updated" : "draft.created",
        fromVersion: currentVersion,
        toVersion: nextVersion,
        actorUid,
      });
    });
  }

  async saveDraftGlobal(input: CmsDraftGlobalInput) {
    const actorUid = requireActorUid(input.actorUid);
    const content = cmsGlobalContentSchema.parse(input.content);
    const draftRef = this.db
      .collection(CMS_COLLECTIONS.draftGlobals)
      .doc(input.documentKey);
    const publishedRef = this.db
      .collection(CMS_COLLECTIONS.publishedGlobals)
      .doc(input.documentKey);
    await this.db.runTransaction(async (transaction) => {
      const [draftSnapshot, publishedSnapshot] = await Promise.all([
        transaction.get(draftRef),
        transaction.get(publishedRef),
      ]);
      const current = draftSnapshot.exists
        ? parseOrThrow(
            parseDraftGlobal(draftSnapshot.data(), input.documentKey),
          )
        : null;
      const currentPublished = publishedSnapshot.exists
        ? parseOrThrow(
            parsePublishedGlobal(publishedSnapshot.data(), input.documentKey),
          )
        : null;
      const currentVersion = current?.version ?? 0;
      if (currentVersion !== input.expectedVersion) {
        throw new CmsRepositoryError("version_conflict");
      }
      const nextVersion = currentVersion + 1;
      const now = Timestamp.now();
      const next = {
        schemaVersion: CMS_SCHEMA_VERSION,
        documentKey: input.documentKey,
        content,
        version: nextVersion,
        basePublishedVersion:
          current?.basePublishedVersion ?? currentPublished?.version ?? 0,
        status: "draft" as const,
        internalNote: input.internalNote,
        createdAt: current?.createdAt ?? now,
        createdBy: current?.createdBy ?? actorUid,
        updatedAt: now,
        updatedBy: actorUid,
      };
      const parsed = parseDraftGlobal(next, input.documentKey);
      if (!parsed.success) {
        throw new CmsRepositoryError("invalid_data", parsed.error);
      }
      transaction.set(draftRef, withoutUndefined({
        ...parsed.data,
        createdAt: current?.createdAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }));
      this.writeAudit(transaction, {
        targetType: "global",
        targetKey: input.documentKey,
        action: current ? "draft.updated" : "draft.created",
        fromVersion: currentVersion,
        toVersion: nextVersion,
        actorUid,
      });
    });
  }

  async publishPage(
    pageKey: CmsPageKey,
    expectedDraftVersion: number,
    actorUidValue: string,
    revisionAction: "publish" | "rollback" = "publish",
  ) {
    const actorUid = requireActorUid(actorUidValue);
    const draftRef = this.db.collection(CMS_COLLECTIONS.draftPages).doc(pageKey);
    const publishedRef = this.db
      .collection(CMS_COLLECTIONS.publishedPages)
      .doc(pageKey);
    await this.db.runTransaction(async (transaction) => {
      const [draftSnapshot, publishedSnapshot] = await Promise.all([
        transaction.get(draftRef),
        transaction.get(publishedRef),
      ]);
      if (!draftSnapshot.exists) throw new CmsRepositoryError("draft_not_found");
      const draft = parseOrThrow(parseDraftPage(draftSnapshot.data(), pageKey));
      if (draft.version !== expectedDraftVersion) {
        throw new CmsRepositoryError("version_conflict");
      }
      const currentPublished = publishedSnapshot.exists
        ? parseOrThrow(parsePublishedPage(publishedSnapshot.data(), pageKey))
        : null;
      const nextPublishedVersion = (currentPublished?.version ?? 0) + 1;
      const now = Timestamp.now();
      const validationIssues = validatePageContentForPublish(
        draft.content,
        pageKey,
      );
      if (validationIssues.some((issue) => issue.severity === "error")) {
        throw new CmsRepositoryError("validation_failed");
      }
      const publishedContent = normalizePageContentForPublish(draft.content);
      const published = parseOrThrow(
        parsePublishedPage(
          {
            schemaVersion: CMS_SCHEMA_VERSION,
            pageKey,
            route: CMS_PAGE_ROUTES[pageKey],
            content: publishedContent,
            theme: draft.theme,
            version: nextPublishedVersion,
            status: "published",
            publishedAt: now,
          },
          pageKey,
        ),
      );
      const revisionId = createId("r");
      const revision = cmsPageRevisionSchema.parse({
        ...published,
        revisionId,
        revisionAction,
        createdAt: now,
        createdBy: actorUid,
      });
      transaction.set(publishedRef, withoutUndefined({
        ...published,
        publishedAt: FieldValue.serverTimestamp(),
      }));
      transaction.set(
        this.db
          .collection(CMS_COLLECTIONS.pageRevisions)
          .doc(pageKey)
          .collection("revisions")
          .doc(revisionId),
        withoutUndefined({
          ...revision,
          publishedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        }),
      );
      transaction.update(draftRef, {
        version: draft.version + 1,
        basePublishedVersion: nextPublishedVersion,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      });
      this.writeAudit(transaction, {
        targetType: "page",
        targetKey: pageKey,
        action: "published",
        fromVersion: currentPublished?.version ?? 0,
        toVersion: nextPublishedVersion,
        actorUid,
        metadata: { revisionId },
      });
    });
  }

  async publishGlobal(
    documentKey: CmsGlobalKey,
    expectedDraftVersion: number,
    actorUidValue: string,
    revisionAction: "publish" | "rollback" = "publish",
  ) {
    const actorUid = requireActorUid(actorUidValue);
    const draftRef = this.db
      .collection(CMS_COLLECTIONS.draftGlobals)
      .doc(documentKey);
    const publishedRef = this.db
      .collection(CMS_COLLECTIONS.publishedGlobals)
      .doc(documentKey);
    await this.db.runTransaction(async (transaction) => {
      const [draftSnapshot, publishedSnapshot] = await Promise.all([
        transaction.get(draftRef),
        transaction.get(publishedRef),
      ]);
      if (!draftSnapshot.exists) throw new CmsRepositoryError("draft_not_found");
      const draft = parseOrThrow(
        parseDraftGlobal(draftSnapshot.data(), documentKey),
      );
      if (draft.version !== expectedDraftVersion) {
        throw new CmsRepositoryError("version_conflict");
      }
      const currentPublished = publishedSnapshot.exists
        ? parseOrThrow(
            parsePublishedGlobal(publishedSnapshot.data(), documentKey),
          )
        : null;
      const nextPublishedVersion = (currentPublished?.version ?? 0) + 1;
      const now = Timestamp.now();
      const published = parseOrThrow(
        parsePublishedGlobal(
          {
            schemaVersion: CMS_SCHEMA_VERSION,
            documentKey,
            content: draft.content,
            version: nextPublishedVersion,
            status: "published",
            publishedAt: now,
          },
          documentKey,
        ),
      );
      const revisionId = createId("r");
      const revision = cmsGlobalRevisionSchema.parse({
        ...published,
        revisionId,
        revisionAction,
        createdAt: now,
        createdBy: actorUid,
      });
      transaction.set(publishedRef, withoutUndefined({
        ...published,
        publishedAt: FieldValue.serverTimestamp(),
      }));
      transaction.set(
        this.db
          .collection(CMS_COLLECTIONS.globalRevisions)
          .doc(documentKey)
          .collection("revisions")
          .doc(revisionId),
        withoutUndefined({
          ...revision,
          publishedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        }),
      );
      transaction.update(draftRef, {
        version: draft.version + 1,
        basePublishedVersion: nextPublishedVersion,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      });
      this.writeAudit(transaction, {
        targetType: "global",
        targetKey: documentKey,
        action: "published",
        fromVersion: currentPublished?.version ?? 0,
        toVersion: nextPublishedVersion,
        actorUid,
        metadata: { revisionId },
      });
    });
  }

  async listPageRevisions(
    pageKey: CmsPageKey,
    limit = 50,
  ): Promise<CmsPageRevision[]> {
    const snapshot = await this.db
      .collection(CMS_COLLECTIONS.pageRevisions)
      .doc(pageKey)
      .collection("revisions")
      .orderBy("version", "desc")
      .limit(Math.min(Math.max(limit, 1), 100))
      .get();
    return snapshot.docs.map((document) =>
      cmsPageRevisionSchema.parse(document.data()),
    );
  }

  async listGlobalRevisions(
    documentKey: CmsGlobalKey,
    limit = 50,
  ): Promise<CmsGlobalRevision[]> {
    const snapshot = await this.db
      .collection(CMS_COLLECTIONS.globalRevisions)
      .doc(documentKey)
      .collection("revisions")
      .orderBy("version", "desc")
      .limit(Math.min(Math.max(limit, 1), 100))
      .get();
    return snapshot.docs.map((document) =>
      cmsGlobalRevisionSchema.parse(document.data()),
    );
  }

  async restorePageRevision(
    pageKey: CmsPageKey,
    revisionId: string,
    expectedDraftVersion: number,
    actorUidValue: string,
  ) {
    const actorUid = requireActorUid(actorUidValue);
    const revisionRef = this.db
      .collection(CMS_COLLECTIONS.pageRevisions)
      .doc(pageKey)
      .collection("revisions")
      .doc(revisionId);
    const draftRef = this.db.collection(CMS_COLLECTIONS.draftPages).doc(pageKey);
    await this.db.runTransaction(async (transaction) => {
      const [revisionSnapshot, draftSnapshot] = await Promise.all([
        transaction.get(revisionRef),
        transaction.get(draftRef),
      ]);
      if (!revisionSnapshot.exists) {
        throw new CmsRepositoryError("revision_not_found");
      }
      const revision = cmsPageRevisionSchema.parse(revisionSnapshot.data());
      const draft = draftSnapshot.exists
        ? parseOrThrow(parseDraftPage(draftSnapshot.data(), pageKey))
        : null;
      if ((draft?.version ?? 0) !== expectedDraftVersion) {
        throw new CmsRepositoryError("version_conflict");
      }
      const nextVersion = (draft?.version ?? 0) + 1;
      transaction.set(draftRef, {
        schemaVersion: CMS_SCHEMA_VERSION,
        pageKey,
        route: CMS_PAGE_ROUTES[pageKey],
        content: revision.content,
        ...(revision.theme ? { theme: revision.theme } : {}),
        version: nextVersion,
        basePublishedVersion: draft?.basePublishedVersion ?? revision.version,
        status: "draft",
        internalNote: `revision:${revisionId}`,
        createdAt: draft?.createdAt ?? FieldValue.serverTimestamp(),
        createdBy: draft?.createdBy ?? actorUid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      });
      this.writeAudit(transaction, {
        targetType: "page",
        targetKey: pageKey,
        action: "revision.restored",
        fromVersion: draft?.version ?? 0,
        toVersion: nextVersion,
        actorUid,
        metadata: { revisionId },
      });
    });
  }

  async restoreGlobalRevision(
    documentKey: CmsGlobalKey,
    revisionId: string,
    expectedDraftVersion: number,
    actorUidValue: string,
  ) {
    const actorUid = requireActorUid(actorUidValue);
    const revisionRef = this.db
      .collection(CMS_COLLECTIONS.globalRevisions)
      .doc(documentKey)
      .collection("revisions")
      .doc(revisionId);
    const draftRef = this.db
      .collection(CMS_COLLECTIONS.draftGlobals)
      .doc(documentKey);
    await this.db.runTransaction(async (transaction) => {
      const [revisionSnapshot, draftSnapshot] = await Promise.all([
        transaction.get(revisionRef),
        transaction.get(draftRef),
      ]);
      if (!revisionSnapshot.exists) {
        throw new CmsRepositoryError("revision_not_found");
      }
      const revision = cmsGlobalRevisionSchema.parse(revisionSnapshot.data());
      const draft = draftSnapshot.exists
        ? parseOrThrow(parseDraftGlobal(draftSnapshot.data(), documentKey))
        : null;
      if ((draft?.version ?? 0) !== expectedDraftVersion) {
        throw new CmsRepositoryError("version_conflict");
      }
      const nextVersion = (draft?.version ?? 0) + 1;
      transaction.set(draftRef, {
        schemaVersion: CMS_SCHEMA_VERSION,
        documentKey,
        content: revision.content,
        version: nextVersion,
        basePublishedVersion: draft?.basePublishedVersion ?? revision.version,
        status: "draft",
        internalNote: `revision:${revisionId}`,
        createdAt: draft?.createdAt ?? FieldValue.serverTimestamp(),
        createdBy: draft?.createdBy ?? actorUid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      });
      this.writeAudit(transaction, {
        targetType: "global",
        targetKey: documentKey,
        action: "revision.restored",
        fromVersion: draft?.version ?? 0,
        toVersion: nextVersion,
        actorUid,
        metadata: { revisionId },
      });
    });
  }

  async getAsset(assetId: string): Promise<CmsAsset | null> {
    const snapshot = await this.db
      .collection(CMS_COLLECTIONS.assets)
      .doc(assetId)
      .get();
    return snapshot.exists ? cmsAssetSchema.parse(snapshot.data()) : null;
  }

  async getAssets(assetIds: readonly string[]): Promise<CmsAsset[]> {
    const uniqueAssetIds = [...new Set(assetIds)].slice(0, 100);
    if (uniqueAssetIds.length === 0) return [];
    const refs = uniqueAssetIds.map((assetId) =>
      this.db.collection(CMS_COLLECTIONS.assets).doc(assetId),
    );
    const snapshots = await this.db.getAll(...refs);
    return snapshots.flatMap((snapshot) =>
      snapshot.exists ? [cmsAssetSchema.parse(snapshot.data())] : [],
    );
  }

  async saveAsset(asset: CmsAsset, actorUidValue: string) {
    const actorUid = requireActorUid(actorUidValue);
    const parsed = cmsAssetSchema.parse({ ...asset, updatedBy: actorUid });
    const ref = this.db.collection(CMS_COLLECTIONS.assets).doc(parsed.assetId);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const current = snapshot.exists
        ? cmsAssetSchema.parse(snapshot.data())
        : null;
      transaction.set(ref, withoutUndefined({
        ...parsed,
        createdAt: current?.createdAt ?? FieldValue.serverTimestamp(),
        createdBy: current?.createdBy ?? actorUid,
        updatedAt: FieldValue.serverTimestamp(),
      }));
      this.writeAudit(transaction, {
        targetType: "asset",
        targetKey: parsed.assetId,
        action: current ? "asset.updated" : "asset.created",
        actorUid,
        metadata: { status: parsed.status },
      });
    });
  }

  private writeAudit(
    transaction: Transaction,
    input: Omit<DocumentData, "schemaVersion" | "createdAt">,
  ) {
    const parsed = cmsAuditLogSchema.parse({
      schemaVersion: CMS_SCHEMA_VERSION,
      ...input,
      createdAt: Timestamp.now(),
    });
    transaction.set(
      this.db.collection(CMS_COLLECTIONS.auditLogs).doc(createId("a")),
      withoutUndefined({
        ...parsed,
        createdAt: FieldValue.serverTimestamp(),
      }),
    );
  }
}
