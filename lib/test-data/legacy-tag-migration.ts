import type { Firestore } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import {
  LEGACY_REVIEW_COLLECTION,
  LEGACY_REVIEW_MANIFEST_COLLECTION,
  LEGACY_TAG_MIGRATION_MAX_DOCUMENTS,
  type LegacyReviewManifest,
  type LegacyReviewRecord,
  type LegacyTagDocumentSnapshot,
  type LegacyTagMigrationPlan,
  type LegacyTagMigrationPlanItem,
  type LegacyTagMigrationRepository,
} from "@/lib/test-data/legacy-review-types";

const INSTITUTION_FIELDS = [
  "institutionId",
  "cooperativeId",
  "nh_org_id",
  "sourceInstitutionId",
] as const;

export class LegacyTagMigrationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "LegacyTagMigrationError";
    this.code = code;
  }
}

export class LegacyTagMigrationService {
  private readonly repository: LegacyTagMigrationRepository;

  constructor(repository: LegacyTagMigrationRepository) {
    this.repository = repository;
  }

  async run(input: {
    reviewManifestId: string;
    institutionId: string;
    documentPaths: string[];
    projectId: string;
    environment: string;
    apply?: boolean;
  }): Promise<LegacyTagMigrationPlan> {
    const documentPaths = Array.from(new Set(input.documentPaths)).sort();
    if (documentPaths.length === 0) {
      throw new LegacyTagMigrationError("explicit_document_paths_required");
    }
    if (documentPaths.length > LEGACY_TAG_MIGRATION_MAX_DOCUMENTS) {
      throw new LegacyTagMigrationError("migration_item_limit_exceeded");
    }
    for (const path of documentPaths) {
      validateDocumentPath(path);
    }
    const manifest = await this.repository.getReviewManifest(
      input.reviewManifestId,
    );
    if (!manifest) {
      throw new LegacyTagMigrationError("review_manifest_not_found");
    }
    validateManifest(manifest, input);
    const [reviews, documents] = await Promise.all([
      this.repository.loadApprovedDocumentReviews(input.reviewManifestId),
      this.repository.loadDocuments(documentPaths),
    ]);
    const reviewByPath = new Map(
      reviews
        .filter(
          (review) =>
            review.targetType === "FIRESTORE_DOCUMENT" &&
            review.decision === "CONFIRMED_TEST" &&
            review.status === "APPROVED" &&
            review.institutionId === input.institutionId &&
            Boolean(review.documentPath),
        )
        .map((review) => [review.documentPath as string, review]),
    );
    const documentByPath = new Map(
      documents.map((document) => [document.documentPath, document]),
    );
    const items = documentPaths.map((path) =>
      planItem(
        input.institutionId,
        path,
        reviewByPath.get(path),
        documentByPath.get(path),
      )
    );
    const plan: LegacyTagMigrationPlan = {
      mode: input.apply ? "APPLY" : "DRY_RUN",
      reviewManifestId: manifest.reviewManifestId,
      institutionId: input.institutionId,
      projectId: input.projectId,
      environment: input.environment,
      totalCount: items.length,
      updateCount: items.filter((item) => item.action === "UPDATE").length,
      noopCount: items.filter((item) => item.action === "NOOP").length,
      blockedCount: items.filter((item) => item.action === "BLOCKED").length,
      items,
    };
    if (input.apply) {
      if (plan.blockedCount > 0) {
        throw new LegacyTagMigrationError("blocked_migration_plan");
      }
      await this.repository.apply(plan);
    }
    return plan;
  }
}

export class FirestoreLegacyTagMigrationRepository
  implements LegacyTagMigrationRepository
{
  private readonly db: Firestore;

  constructor(db: Firestore = adminDb()) {
    this.db = db;
  }

  async getReviewManifest(reviewManifestId: string) {
    const snapshot = await this.db
      .collection(LEGACY_REVIEW_MANIFEST_COLLECTION)
      .doc(reviewManifestId)
      .get();
    return snapshot.exists
      ? snapshot.data() as LegacyReviewManifest
      : null;
  }

  async loadApprovedDocumentReviews(reviewManifestId: string) {
    const snapshot = await this.db
      .collection(LEGACY_REVIEW_COLLECTION)
      .where("reviewManifestId", "==", reviewManifestId)
      .get();
    return snapshot.docs.map(
      (document) => document.data() as LegacyReviewRecord,
    );
  }

  async loadDocuments(documentPaths: string[]) {
    return Promise.all(
      documentPaths.map(async (documentPath) => {
        const snapshot = await this.db.doc(documentPath).get();
        return {
          documentPath,
          exists: snapshot.exists,
          changeToken: snapshot.updateTime?.toDate().toISOString(),
          data: (snapshot.data() ?? {}) as Record<string, unknown>,
        };
      }),
    );
  }

  async apply(plan: LegacyTagMigrationPlan) {
    for (const item of plan.items) {
      if (item.action === "NOOP") continue;
      await this.db.runTransaction(async (transaction) => {
        const reference = this.db.doc(item.documentPath);
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) {
          throw new LegacyTagMigrationError("document_not_found_during_apply");
        }
        const current = snapshot.data() as Record<string, unknown>;
        if (
          current.dataClassification === "PRODUCTION" ||
          crossInstitutionValues(current, plan.institutionId).length > 0
        ) {
          throw new LegacyTagMigrationError("document_changed_during_apply");
        }
        transaction.update(reference, item.after);
      });
    }
  }
}

function validateManifest(
  manifest: LegacyReviewManifest,
  input: {
    institutionId: string;
    projectId: string;
    environment: string;
  },
) {
  if (manifest.status !== "READY") {
    throw new LegacyTagMigrationError("approved_ready_manifest_required");
  }
  if (manifest.institutionId !== input.institutionId) {
    throw new LegacyTagMigrationError("cross_institution_manifest");
  }
  if (manifest.projectId !== input.projectId) {
    throw new LegacyTagMigrationError("review_manifest_project_mismatch");
  }
  if (manifest.environment !== input.environment) {
    throw new LegacyTagMigrationError("review_manifest_environment_mismatch");
  }
}

function planItem(
  institutionId: string,
  documentPath: string,
  review: LegacyReviewRecord | undefined,
  document: LegacyTagDocumentSnapshot | undefined,
): LegacyTagMigrationPlanItem {
  const before = {
    dataClassification: document?.data.dataClassification,
    testData: document?.data.testData,
    legacyReviewId: document?.data.legacyReviewId,
    reviewedAt: document?.data.reviewedAt,
    reviewedBy: document?.data.reviewedBy,
  };
  const after = {
    dataClassification: "LEGACY_TEST" as const,
    testData: true as const,
    legacyReviewId: review?.reviewId ?? "",
    reviewedAt: review?.reviewedAt ?? "",
    reviewedBy: review?.reviewedBy ?? "",
  };
  const blockedReason =
    !review
      ? "approved_exact_review_required"
      : !document?.exists
        ? "document_not_found"
        : document.data.dataClassification === "PRODUCTION"
          ? "explicit_production_document"
          : review.reviewedChangeToken &&
              document.changeToken !== review.reviewedChangeToken
            ? "reviewed_document_changed"
            : crossInstitutionValues(document.data, institutionId).length > 0
              ? "cross_institution_document"
              : undefined;
  if (blockedReason) {
    return {
      reviewId: review?.reviewId ?? "",
      documentPath,
      action: "BLOCKED",
      before,
      after,
      blockedReason,
    };
  }
  const isNoop = Object.entries(after).every(
    ([key, value]) => document?.data[key] === value,
  );
  return {
    reviewId: review?.reviewId ?? "",
    documentPath,
    action: isNoop ? "NOOP" : "UPDATE",
    before,
    after,
  };
}

function validateDocumentPath(path: string) {
  const segments = path.split("/").filter(Boolean);
  if (
    segments.length < 2 ||
    segments.length % 2 !== 0 ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new LegacyTagMigrationError("invalid_document_path");
  }
  if (
    path.startsWith("demoCooperativeMaster/") ||
    path.startsWith("static:nonghyupMaster/")
  ) {
    throw new LegacyTagMigrationError("master_document_tagging_forbidden");
  }
}

function crossInstitutionValues(
  data: Record<string, unknown>,
  institutionId: string,
) {
  return INSTITUTION_FIELDS
    .map((field) => data[field])
    .filter(
      (value): value is string =>
        typeof value === "string" &&
        Boolean(value) &&
        value !== institutionId,
    );
}
