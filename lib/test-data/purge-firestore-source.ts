import { createHash } from "node:crypto";
import type {
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import type { Storage } from "firebase-admin/storage";
import {
  DEMO_COOPERATIVE_COLLECTION,
  getTestCooperativeDefinition,
  parseTestCooperativeMaster,
} from "@/lib/cooperatives/demo-cooperative";
import {
  COOPERATIVE_MASTER_COLLECTION,
  COOPERATIVE_MASTER_CONFIG_COLLECTION,
  COOPERATIVE_MASTER_CONFIG_ID,
  parseProductionCooperativeMaster,
} from "@/lib/cooperatives/master";
import { adminAuth, adminDb, adminStorage } from "@/lib/firebase/admin";
import { nonghyupMaster } from "@/lib/platform";
import type {
  PurgeScanDataSource,
  ScanDocument,
  ScanSnapshot,
} from "@/lib/test-data/purge-types";

const QUERY_LIMIT = 2_001;
const SUBCOLLECTION_MAX_DEPTH = 4;

const CUSTOMER_GRAPH_COLLECTIONS = [
  "users",
  "organizations",
  "memberships",
  "tenants",
  "testAuthSubjects",
  "pointLedger",
  "point_transactions",
  "consultRequests",
  "answers",
  "answerViews",
  "answerRatings",
  "partnerAssignments",
  "partnerAnswerDrafts",
  "quoteRequests",
  "quoteAssignments",
  "quotes",
  "quoteEmailDeliveries",
  "auditQuoteRequests",
  "auditQuoteIdempotency",
  "auditQuoteEmailDedup",
  "auditQuoteRateLimits",
  "auditQuoteNotifications",
  "phoneVerificationChallenges",
  "phoneVerificationRateLimits",
  "auditEvaluationCases",
  "auditEvaluationCaseByQuoteRequest",
  "auditEvaluationAccessTokens",
  "auditEvaluationSessions",
  "auditEvaluationUploadIntents",
  "auditEvaluationDocuments",
  "auditEvaluationParsingQueue",
  "auditEvaluationExtractionRuns",
  "auditEvaluationCorrections",
  "auditEvaluationConfirmations",
  "auditEvaluationNormalizedQuotes",
  "auditEvaluationReportRuns",
  "auditEvaluationAuditLogs",
  "auditEvaluationRateLimits",
  "auditLogs",
] as const;

const INSTITUTION_FIELDS = [
  "institutionId",
  "cooperativeId",
  "nh_org_id",
  "sourceInstitutionId",
] as const;

const REQUEST_CHILD_COLLECTIONS = [
  "answers",
  "answerViews",
  "answerRatings",
  "partnerAssignments",
  "partnerAnswerDrafts",
  "pointLedger",
  "point_transactions",
] as const;

const CASE_CHILD_COLLECTIONS = [
  "auditEvaluationAccessTokens",
  "auditEvaluationSessions",
  "auditEvaluationUploadIntents",
  "auditEvaluationDocuments",
  "auditEvaluationParsingQueue",
  "auditEvaluationExtractionRuns",
  "auditEvaluationCorrections",
  "auditEvaluationConfirmations",
  "auditEvaluationNormalizedQuotes",
  "auditEvaluationReportRuns",
  "auditEvaluationAuditLogs",
  "auditEvaluationRateLimits",
] as const;

type AccumulatedDocument = ScanDocument & {
  relationshipSet: Set<string>;
  crossInstitutionSet: Set<string>;
  reference: DocumentReference;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function storagePaths(data: Record<string, unknown>) {
  const paths = [
    data.businessCardPath,
    data.pdfPath,
    data.storagePath,
    data.quarantineStoragePath,
    data.reportStoragePath,
    data.viewModelStoragePath,
  ].filter((value): value is string => typeof value === "string" && Boolean(value));
  if (Array.isArray(data.attachments)) {
    for (const attachment of data.attachments) {
      if (
        attachment &&
        typeof attachment === "object" &&
        typeof (attachment as Record<string, unknown>).path === "string"
      ) {
        paths.push((attachment as Record<string, unknown>).path as string);
      }
    }
  }
  return paths;
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function changeToken(snapshot: DocumentSnapshot) {
  return snapshot.updateTime?.toDate().toISOString() ??
    `exists:${snapshot.exists}`;
}

function crossInstitutionIds(
  data: Record<string, unknown>,
  institutionId: string,
) {
  const values = INSTITUTION_FIELDS
    .map((field) => stringValue(data[field]))
    .filter(Boolean);
  return values.filter((value) => value !== institutionId);
}

export class FirestorePurgeScanDataSource implements PurgeScanDataSource {
  private readonly db: Firestore;
  private readonly auth: Auth;
  private readonly storage: Storage;

  constructor(
    db: Firestore = adminDb(),
    auth: Auth = adminAuth(),
    storage: Storage = adminStorage(),
  ) {
    this.db = db;
    this.auth = auth;
    this.storage = storage;
  }

  async loadSnapshot(institutionId: string): Promise<ScanSnapshot> {
    const warnings = new Set<string>();
    const institution = await this.loadInstitution(institutionId);
    if (!institution) {
      throw new PurgeScanSourceError(
        "unknown_institution",
        `Unknown institution: ${institutionId}`,
      );
    }
    const documents = new Map<string, AccumulatedDocument>();

    const add = (
      snapshot: QueryDocumentSnapshot | DocumentSnapshot,
      relationship: string,
    ) => {
      if (!snapshot.exists) return;
      const data = (snapshot.data() ?? {}) as Record<string, unknown>;
      const path = snapshot.ref.path;
      const existing = documents.get(path);
      if (existing) {
        existing.relationshipSet.add(relationship);
        for (const id of crossInstitutionIds(data, institutionId)) {
          existing.crossInstitutionSet.add(id);
        }
        return;
      }
      const collection = snapshot.ref.parent.id;
      const crossIds = crossInstitutionIds(data, institutionId);
      if (collection === "organizations" && snapshot.id !== institutionId) {
        crossIds.push(snapshot.id);
      }
      documents.set(path, {
        collection,
        id: snapshot.id,
        path,
        data,
        changeToken: changeToken(snapshot),
        relationships: [],
        crossInstitutionIds: [],
        relationshipSet: new Set([relationship]),
        crossInstitutionSet: new Set(
          crossIds,
        ),
        reference: snapshot.ref,
      });
    };

    const query = async (
      collection: string,
      field: string,
      value: string,
      relationship = `${field}:${value}`,
    ) => {
      try {
        const result = await this.db
          .collection(collection)
          .where(field, "==", value)
          .limit(QUERY_LIMIT)
          .get();
        if (result.size >= QUERY_LIMIT) {
          warnings.add(`scan_limit_exceeded:${collection}:${field}`);
        }
        for (const snapshot of result.docs) add(snapshot, relationship);
      } catch {
        warnings.add(`scan_incomplete:${collection}:${field}`);
      }
    };

    const queryArrayContains = async (
      collection: string,
      field: string,
      value: string,
      relationship = `${field}:contains:${value}`,
    ) => {
      try {
        const result = await this.db
          .collection(collection)
          .where(field, "array-contains", value)
          .limit(QUERY_LIMIT)
          .get();
        if (result.size >= QUERY_LIMIT) {
          warnings.add(`scan_limit_exceeded:${collection}:${field}`);
        }
        for (const snapshot of result.docs) add(snapshot, relationship);
      } catch {
        warnings.add(`scan_incomplete:${collection}:${field}`);
      }
    };

    const getById = async (
      collection: string,
      id: string,
      relationship: string,
    ) => {
      try {
        add(await this.db.collection(collection).doc(id).get(), relationship);
      } catch {
        warnings.add(`scan_incomplete:${collection}:document-id`);
      }
    };

    await Promise.all([
      ...CUSTOMER_GRAPH_COLLECTIONS.flatMap((collection) => [
        query(collection, "sourceInstitutionId", institutionId),
        query(collection, "institutionId", institutionId),
        query(collection, "organizationId", institutionId),
        query(collection, "tenantId", institutionId),
        query(collection, "customerId", institutionId),
      ]),
      ...[
        "users",
        "organizations",
        "memberships",
        "tenants",
        "pointLedger",
        "point_transactions",
        "consultRequests",
        "answerViews",
        "quoteRequests",
        "auditEvaluationCases",
      ].flatMap((collection) => [
        query(collection, "cooperativeId", institutionId),
        query(collection, "nh_org_id", institutionId),
      ]),
      getById(
        "organizations",
        institutionId,
        `document-id:${institutionId}`,
      ),
    ]);

    const userIds = new Set(
      Array.from(documents.values()).flatMap((document) => {
        if (document.collection === "users") return [document.id];
        if (document.collection === "testAuthSubjects") {
          return [
            stringValue(document.data.primaryUserUid),
            stringValue(document.data.authUid) || document.id,
          ].filter(Boolean);
        }
        return [];
      }),
    );
    await Promise.all(
      Array.from(userIds).flatMap((uid) => [
        query("consultRequests", "uid", uid, `uid:${uid}`),
        query("consultRequests", "user_id", uid, `user_id:${uid}`),
        query("answerViews", "uid", uid, `uid:${uid}`),
        query("answerRatings", "uid", uid, `uid:${uid}`),
        query("quoteRequests", "customerUid", uid, `customerUid:${uid}`),
        query("auditLogs", "actorUid", uid, `actorUid:${uid}`),
        queryArrayContains("organizations", "users", uid, `memberUid:${uid}`),
      ]),
    );

    const scannedRequestIds = new Set<string>();
    let pendingRequestIds = new Set(
      Array.from(documents.values()).flatMap((document) =>
        document.collection === "consultRequests"
          ? [document.id]
          : [],
      ),
    );
    for (let depth = 0; pendingRequestIds.size > 0 && depth < 20; depth += 1) {
      const current = Array.from(pendingRequestIds);
      current.forEach((requestId) => scannedRequestIds.add(requestId));
      await Promise.all(
        current.flatMap((requestId) => [
          getById("answers", requestId, `answer-of:${requestId}`),
          ...REQUEST_CHILD_COLLECTIONS.map((collection) =>
            query(
              collection,
              "requestId",
              requestId,
              `requestId:${requestId}`,
            )
          ),
          query(
            "pointLedger",
            "related_inquiry_id",
            requestId,
            `related_inquiry_id:${requestId}`,
          ),
          query(
            "point_transactions",
            "related_inquiry_id",
            requestId,
            `related_inquiry_id:${requestId}`,
          ),
          query(
            "consultRequests",
            "parentRequestId",
            requestId,
            `parentRequestId:${requestId}`,
          ),
          query(
            "quoteRequests",
            "sourceId",
            requestId,
            `sourceId:${requestId}`,
          ),
          query(
            "auditLogs",
            "targetId",
            requestId,
            `targetId:${requestId}`,
          ),
        ]),
      );
      pendingRequestIds = new Set(
        Array.from(documents.values())
          .filter(
            (document) =>
              document.collection === "consultRequests" &&
              !scannedRequestIds.has(document.id),
          )
          .map((document) => document.id),
      );
    }
    if (pendingRequestIds.size > 0) {
      warnings.add("scan_incomplete:consultRequest_depth");
    }

    const auditQuoteRequestIds = new Set(
      Array.from(documents.values()).flatMap((document) =>
        document.collection === "auditQuoteRequests"
          ? [stringValue(document.data.requestId) || document.id]
          : [],
      ),
    );
    await Promise.all(
      Array.from(auditQuoteRequestIds).flatMap((requestId) =>
        [
          "auditQuoteIdempotency",
          "auditQuoteEmailDedup",
          "auditQuoteRateLimits",
          "auditQuoteNotifications",
        ].map((collection) =>
          query(
            collection,
            "requestId",
            requestId,
            `requestId:${requestId}`,
          )
        ).concat([
          query(
            "quoteRequests",
            "sourceId",
            requestId,
            `sourceId:${requestId}`,
          ),
        ])
      ),
    );

    const quoteRequestIds = new Set(
      Array.from(documents.values()).flatMap((document) =>
        document.collection === "quoteRequests" ? [document.id] : [],
      ),
    );
    await Promise.all(
      Array.from(quoteRequestIds).flatMap((quoteRequestId) => [
        query(
          "quoteAssignments",
          "quoteRequestId",
          quoteRequestId,
          `quoteRequestId:${quoteRequestId}`,
        ),
        query(
          "quotes",
          "quoteRequestId",
          quoteRequestId,
          `quoteRequestId:${quoteRequestId}`,
        ),
        query(
          "quoteEmailDeliveries",
          "quoteRequestId",
          quoteRequestId,
          `quoteRequestId:${quoteRequestId}`,
        ),
        query(
          "auditEvaluationCases",
          "quoteRequestId",
          quoteRequestId,
          `quoteRequestId:${quoteRequestId}`,
        ),
        query(
          "auditEvaluationCaseByQuoteRequest",
          "quoteRequestId",
          quoteRequestId,
          `quoteRequestId:${quoteRequestId}`,
        ),
      ]),
    );

    const quoteIds = new Set(
      Array.from(documents.values()).flatMap((document) =>
        document.collection === "quotes" ? [document.id] : [],
      ),
    );
    await Promise.all(
      Array.from(quoteIds).map((quoteId) =>
        query(
          "quoteEmailDeliveries",
          "quoteId",
          quoteId,
          `quoteId:${quoteId}`,
        )
      ),
    );

    const mappedCaseIds = new Set(
      Array.from(documents.values()).flatMap((document) =>
        document.collection === "auditEvaluationCaseByQuoteRequest"
          ? [stringValue(document.data.caseId)].filter(Boolean)
          : [],
      ),
    );
    await Promise.all(
      Array.from(mappedCaseIds).map((caseId) =>
        getById("auditEvaluationCases", caseId, `case-mapping:${caseId}`)
      ),
    );

    const caseIds = new Set(
      Array.from(documents.values()).flatMap((document) =>
        document.collection === "auditEvaluationCases"
          ? [document.id]
          : document.collection === "auditEvaluationCaseByQuoteRequest"
            ? [stringValue(document.data.caseId)].filter(Boolean)
            : [],
      ),
    );
    await Promise.all(
      Array.from(caseIds).flatMap((caseId) =>
        CASE_CHILD_COLLECTIONS.map((collection) =>
          query(collection, "caseId", caseId, `caseId:${caseId}`)
        )
      ),
    );

    await this.loadSubcollections(
      Array.from(documents.values()),
      add,
      warnings,
    );

    const knownRequestIds = new Set(
      Array.from(documents.values())
        .filter((document) => document.collection === "consultRequests")
        .map((document) => document.id),
    );
    const knownQuoteRequestIds = new Set(
      Array.from(documents.values())
        .filter((document) => document.collection === "quoteRequests")
        .map((document) => document.id),
    );
    const knownCaseIds = new Set(
      Array.from(documents.values())
        .filter((document) => document.collection === "auditEvaluationCases")
        .map((document) => document.id),
    );

    for (const document of documents.values()) {
      document.relationships = Array.from(document.relationshipSet).sort();
      document.crossInstitutionIds = Array.from(
        document.crossInstitutionSet,
      ).sort();
      const requestId = stringValue(document.data.requestId);
      const quoteRequestId = stringValue(document.data.quoteRequestId);
      const caseId = stringValue(document.data.caseId);
      if (
        requestId &&
        REQUEST_CHILD_COLLECTIONS.includes(
          document.collection as (typeof REQUEST_CHILD_COLLECTIONS)[number],
        ) &&
        !knownRequestIds.has(requestId)
      ) {
        document.brokenReference = true;
      }
      if (
        quoteRequestId &&
        ["quoteAssignments", "quotes", "quoteEmailDeliveries"].includes(
          document.collection,
        ) &&
        !knownQuoteRequestIds.has(quoteRequestId)
      ) {
        document.brokenReference = true;
      }
      if (
        caseId &&
        CASE_CHILD_COLLECTIONS.includes(
          document.collection as (typeof CASE_CHILD_COLLECTIONS)[number],
        ) &&
        !knownCaseIds.has(caseId)
      ) {
        document.brokenReference = true;
      }
    }

    const [approvedTestScenarioIds, seedManifestDocumentPaths, legacyReviews] =
      await Promise.all([
        this.loadApprovedScenarioIds(institutionId, warnings),
        this.loadSeedManifestPaths(institutionId, warnings),
        this.loadLegacyReviewState(institutionId, warnings),
      ]);
    const authUserMetadata = await this.loadAuthMetadata(
      Array.from(userIds),
      warnings,
    );
    const storageObjectMetadata = await this.loadStorageMetadata(
      Array.from(
        new Set(
          Array.from(documents.values()).flatMap((document) =>
            storagePaths(document.data)
          ),
        ),
      ),
      warnings,
    );

    return {
      institution,
      documents: Array.from(documents.values())
        .map((document) => ({
          collection: document.collection,
          id: document.id,
          path: document.path,
          data: document.data,
          changeToken: document.changeToken,
          relationships: document.relationships,
          crossInstitutionIds: document.crossInstitutionIds,
          brokenReference: document.brokenReference,
        }))
        .sort((left, right) => left.path.localeCompare(right.path)),
      approvedTestScenarioIds,
      seedManifestDocumentPaths,
      approvedLegacyDocumentPaths: legacyReviews.approvedPaths,
      legacyReviewDecisionsByPath: legacyReviews.decisionsByPath,
      authUserMetadata,
      storageObjectMetadata,
      warnings: Array.from(warnings).sort(),
    };
  }

  private async loadInstitution(institutionId: string) {
    const configSnapshot = await this.db
      .collection(COOPERATIVE_MASTER_CONFIG_COLLECTION)
      .doc(COOPERATIVE_MASTER_CONFIG_ID)
      .get();
    const usesFirestoreMaster =
      configSnapshot.exists &&
      configSnapshot.data()?.mode === "FIRESTORE" &&
      configSnapshot.data()?.status === "ACTIVE";
    if (usesFirestoreMaster) {
      const snapshot = await this.db
        .collection(COOPERATIVE_MASTER_COLLECTION)
        .doc(institutionId)
        .get();
      const real = snapshot.exists
        ? parseProductionCooperativeMaster(snapshot.data())
        : null;
      if (real) {
        return {
          id: real.cooperativeId,
          name: real.cooperativeName,
          type: real.cooperativeType,
          isDemoInstitution: false,
          masterSource: "REAL_FIRESTORE_MASTER" as const,
          masterPath: snapshot.ref.path,
          masterData: { ...real },
          masterChangeToken: changeToken(snapshot),
        };
      }
    } else {
      const real = nonghyupMaster.find(
        (cooperative) => cooperative.cooperative_id === institutionId,
      );
      if (real) {
        return {
          id: real.cooperative_id,
          name: real.cooperative_name,
          type: real.cooperative_type,
          isDemoInstitution: false,
          masterSource: "REAL_STATIC_MASTER" as const,
          masterPath: `static:nonghyupMaster/${real.cooperative_id}`,
          masterData: { ...real },
          masterChangeToken: hash(real),
        };
      }
    }
    if (!getTestCooperativeDefinition(institutionId)) return null;
    const snapshot = await this.db
      .collection(DEMO_COOPERATIVE_COLLECTION)
      .doc(institutionId)
      .get();
    const master = snapshot.exists
      ? parseTestCooperativeMaster(snapshot.data(), institutionId)
      : null;
    if (!master) return null;
    return {
      id: master.cooperativeId,
      name: master.cooperativeName,
      type: master.cooperativeType,
      isDemoInstitution: true,
      masterSource: "DEMO_FIRESTORE" as const,
      masterPath: snapshot.ref.path,
      masterData: { ...master },
      masterChangeToken: changeToken(snapshot),
    };
  }

  private async loadApprovedScenarioIds(
    institutionId: string,
    warnings: Set<string>,
  ) {
    try {
      const snapshot = await this.db
        .collection("testDataScenarios")
        .where("sourceInstitutionId", "==", institutionId)
        .limit(QUERY_LIMIT)
        .get();
      const now = Date.now();
      return snapshot.docs.flatMap((document) => {
        const data = document.data();
        const expiresAt = stringValue(data.expiresAt);
        return data.status === "APPROVED" &&
            (!expiresAt || Date.parse(expiresAt) > now)
          ? [stringValue(data.scenarioId) || document.id]
          : [];
      });
    } catch {
      warnings.add("scan_incomplete:testDataScenarios");
      return [];
    }
  }

  private async loadSeedManifestPaths(
    institutionId: string,
    warnings: Set<string>,
  ) {
    try {
      const snapshot = await this.db
        .collection("testDataSeedManifests")
        .where("institutionId", "==", institutionId)
        .limit(QUERY_LIMIT)
        .get();
      return snapshot.docs.flatMap((document) => {
        const data = document.data();
        return data.status === "FINALIZED"
          ? stringArray(data.documentPaths)
          : [];
      });
    } catch {
      warnings.add("scan_incomplete:testDataSeedManifests");
      return [];
    }
  }

  private async loadLegacyReviewState(
    institutionId: string,
    warnings: Set<string>,
  ) {
    try {
      const snapshot = await this.db
        .collection("legacyTestDataClassifications")
        .where("institutionId", "==", institutionId)
        .limit(QUERY_LIMIT)
        .get();
      const approvedPaths: string[] = [];
      const decisionsByPath: NonNullable<
        ScanSnapshot["legacyReviewDecisionsByPath"]
      > = {};
      for (const document of snapshot.docs) {
        const data = document.data();
        if (data.status === "APPROVED" && Array.isArray(data.documentPaths)) {
          approvedPaths.push(...stringArray(data.documentPaths));
          continue;
        }
        if (
          data.targetType !== "FIRESTORE_DOCUMENT" ||
          typeof data.documentPath !== "string" ||
          !["CONFIRMED_TEST", "PRESERVE", "UNRESOLVED"].includes(
            String(data.decision ?? ""),
          )
        ) {
          continue;
        }
        decisionsByPath[data.documentPath] = {
          decision: data.decision,
          reviewId: String(data.reviewId ?? document.id),
          reviewedChangeToken:
            typeof data.reviewedChangeToken === "string"
              ? data.reviewedChangeToken
              : undefined,
        };
        if (data.decision === "CONFIRMED_TEST" && data.status === "APPROVED") {
          approvedPaths.push(data.documentPath);
        }
      }
      return {
        approvedPaths: Array.from(new Set(approvedPaths)).sort(),
        decisionsByPath,
      };
    } catch {
      warnings.add("scan_incomplete:legacyTestDataClassifications");
      return { approvedPaths: [], decisionsByPath: {} };
    }
  }

  private async loadAuthMetadata(
    uids: string[],
    warnings: Set<string>,
  ): Promise<ScanSnapshot["authUserMetadata"]> {
    const result: ScanSnapshot["authUserMetadata"] = {};
    for (let index = 0; index < uids.length; index += 100) {
      const chunk = uids.slice(index, index + 100);
      try {
        const response = await this.auth.getUsers(
          chunk.map((uid) => ({ uid })),
        );
        for (const uid of chunk) {
          result[uid] = {
            exists: false,
            providerIds: [],
            changeToken: "AUTH_NOT_FOUND",
          };
        }
        for (const user of response.users) {
          const providerIds = user.providerData
            .map((provider) => provider.providerId)
            .sort();
          const customClaimKeys = Object.entries(user.customClaims ?? {})
            .filter(([, value]) => Boolean(value))
            .map(([key]) => key)
            .sort();
          const change = {
            uid: user.uid,
            disabled: user.disabled,
            providerIds,
            customClaims: user.customClaims ?? {},
            tokensValidAfterTime: user.tokensValidAfterTime,
            creationTime: user.metadata.creationTime,
            lastRefreshTime: user.metadata.lastRefreshTime,
          };
          result[user.uid] = {
            exists: true,
            providerIds,
            disabled: user.disabled,
            customClaimKeys,
            changeToken: hash(change),
          };
        }
      } catch {
        warnings.add("scan_incomplete:firebase-auth");
      }
    }
    return result;
  }

  private async loadStorageMetadata(
    paths: string[],
    warnings: Set<string>,
  ): Promise<ScanSnapshot["storageObjectMetadata"]> {
    const result: ScanSnapshot["storageObjectMetadata"] = {};
    if (paths.length > 500) {
      warnings.add("scan_limit_exceeded:storage-objects");
    }
    let bucket;
    try {
      bucket = this.storage.bucket();
    } catch {
      if (paths.length > 0) warnings.add("scan_incomplete:storage-bucket");
      return result;
    }
    for (const path of paths.slice(0, 501)) {
      try {
        const [metadata] = await bucket.file(path).getMetadata();
        result[path] = {
          exists: true,
          bucket: bucket.name,
          generation: metadata.generation === undefined
            ? undefined
            : String(metadata.generation),
          size: Number(metadata.size || 0),
          contentType: metadata.contentType,
          customMetadata: metadata.metadata
            ? Object.fromEntries(
                Object.entries(metadata.metadata)
                  .filter(
                    (entry): entry is [string, string] =>
                      typeof entry[1] === "string",
                  ),
              )
            : undefined,
        };
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (code === 404 || code === "404") {
          result[path] = {
            exists: false,
            bucket: bucket.name,
            generation: "NOT_FOUND",
          };
        } else {
          warnings.add(`scan_incomplete:storage-object:${hash(path).slice(0, 12)}`);
        }
      }
    }
    return result;
  }

  private async loadSubcollections(
    roots: AccumulatedDocument[],
    add: (
      snapshot: QueryDocumentSnapshot | DocumentSnapshot,
      relationship: string,
    ) => void,
    warnings: Set<string>,
  ) {
    let level = roots;
    for (let depth = 0; depth < SUBCOLLECTION_MAX_DEPTH; depth += 1) {
      const next: AccumulatedDocument[] = [];
      for (const parent of level) {
        try {
          const collections = await parent.reference.listCollections();
          for (const collection of collections) {
            const snapshot = await collection.limit(QUERY_LIMIT).get();
            if (snapshot.size >= QUERY_LIMIT) {
              warnings.add(`scan_limit_exceeded:${collection.path}`);
            }
            for (const child of snapshot.docs) {
              add(child, `subcollection-of:${parent.path}`);
              next.push({
                collection: child.ref.parent.id,
                id: child.id,
                path: child.ref.path,
                data: child.data(),
                changeToken: changeToken(child),
                relationships: [],
                crossInstitutionIds: [],
                relationshipSet: new Set(),
                crossInstitutionSet: new Set(),
                reference: child.ref,
              });
            }
          }
        } catch {
          warnings.add(`scan_incomplete:subcollections:${parent.path}`);
        }
      }
      if (next.length === 0) return;
      level = next;
    }
    if (level.length > 0) warnings.add("scan_incomplete:subcollection_depth");
  }
}

export class PurgeScanSourceError extends Error {
  readonly code: "unknown_institution";

  constructor(
    code: "unknown_institution",
    message: string,
  ) {
    super(message);
    this.name = "PurgeScanSourceError";
    this.code = code;
  }
}
