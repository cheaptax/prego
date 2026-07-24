import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import {
  buildLegacyInstitutionReport,
  buildLegacyReviewManifest,
  EMPTY_LEGACY_EVIDENCE_CATALOG,
} from "@/lib/test-data/legacy-candidate-report";
import {
  LEGACY_REVIEW_COLLECTION,
  LEGACY_REVIEW_AUDIT_COLLECTION,
  LEGACY_REVIEW_MANIFEST_COLLECTION,
  LEGACY_REVIEW_MAX_CANDIDATES,
  type LegacyEvidenceCatalog,
  type LegacyEvidenceCode,
  type LegacyReviewCandidate,
  type LegacyReviewDataSource,
  type LegacyReviewDecision,
  type LegacyReviewManifest,
  type LegacyReviewRecord,
  type LegacyReviewStore,
} from "@/lib/test-data/legacy-review-types";
import { FirestorePurgeScanDataSource } from "@/lib/test-data/purge-firestore-source";

export class LegacyReviewError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = "LegacyReviewError";
    this.code = code;
    this.status = status;
  }
}

export class LegacyReviewService {
  private readonly source: LegacyReviewDataSource;
  private readonly store: LegacyReviewStore;
  private readonly evidenceCatalog: LegacyEvidenceCatalog;
  private readonly now: () => string;

  constructor(input: {
    source: LegacyReviewDataSource;
    store: LegacyReviewStore;
    evidenceCatalog?: LegacyEvidenceCatalog;
    now?: () => string;
  }) {
    this.source = input.source;
    this.store = input.store;
    this.evidenceCatalog =
      input.evidenceCatalog ?? EMPTY_LEGACY_EVIDENCE_CATALOG;
    this.now = input.now ?? (() => new Date().toISOString());
  }

  async scan(input: {
    institutionId: string;
    generatedBy: string;
    environment: string;
    projectId: string;
  }) {
    const [snapshot, reviews] = await Promise.all([
      this.source.loadSnapshot(input.institutionId),
      this.source.loadReviews(input.institutionId),
    ]);
    if (snapshot.institution.isDemoInstitution) {
      throw new LegacyReviewError("legacy_review_requires_real_institution");
    }
    const report = buildLegacyInstitutionReport({
      snapshot,
      reviews,
      evidenceCatalog: this.evidenceCatalog,
      now: this.now(),
    });
    if (report.candidates.length > LEGACY_REVIEW_MAX_CANDIDATES) {
      throw new LegacyReviewError("legacy_candidate_limit_exceeded", 409);
    }
    const manifest = buildLegacyReviewManifest({
      report,
      generatedAt: this.now(),
      generatedBy: input.generatedBy,
      environment: input.environment,
      projectId: input.projectId,
    });
    await this.store.saveManifest(manifest, report.candidates);
    return { manifest, report };
  }

  async getReviewManifest(reviewManifestId: string) {
    const manifest = await this.store.getManifest(reviewManifestId);
    if (!manifest) throw new LegacyReviewError("review_manifest_not_found", 404);
    const [candidates, reviews] = await Promise.all([
      this.store.getCandidates(reviewManifestId),
      this.store.loadReviews(manifest.institutionId),
    ]);
    const reviewByResource = new Map(
      reviews.map((review) => [review.resourceKey, review]),
    );
    return {
      manifest,
      candidates: candidates.map((candidate) => {
        const review = reviewByResource.get(candidate.resourceKey);
        return review
          ? {
              ...candidate,
              decision: review.decision,
              reviewId: review.reviewId,
            }
          : candidate;
      }),
    };
  }

  async review(input: {
    reviewManifestId: string;
    candidateId: string;
    decision: LegacyReviewDecision;
    reason: string;
    sourceEvidence: LegacyEvidenceCode[];
    reviewVersion: number;
    reviewedBy: string;
    isSuperAdmin: boolean;
  }) {
    if (input.decision === "CONFIRMED_TEST" && !input.isSuperAdmin) {
      throw new LegacyReviewError("super_admin_required", 403);
    }
    if (
      input.decision === "CONFIRMED_TEST" &&
      input.sourceEvidence.length === 0
    ) {
      throw new LegacyReviewError("confirmed_test_evidence_required");
    }
    const manifest = await this.store.getManifest(input.reviewManifestId);
    if (!manifest) throw new LegacyReviewError("review_manifest_not_found", 404);
    if (manifest.reviewVersion !== input.reviewVersion) {
      throw new LegacyReviewError("review_version_conflict", 409);
    }
    const candidates = await this.store.getCandidates(input.reviewManifestId);
    const candidate = candidates.find(
      (value) => value.candidateId === input.candidateId,
    );
    if (!candidate) throw new LegacyReviewError("review_candidate_not_found", 404);
    if (
      input.sourceEvidence.some(
        (evidence) => !candidate.sourceEvidence.includes(evidence),
      )
    ) {
      throw new LegacyReviewError("review_evidence_not_in_manifest");
    }
    if (
      input.decision === "CONFIRMED_TEST" &&
      (candidate.initialClassification === "PRESERVE" ||
        candidate.initialClassification === "BLOCKED")
    ) {
      throw new LegacyReviewError("preserve_or_blocked_candidate_cannot_confirm");
    }
    const reviewedAt = this.now();
    const review: LegacyReviewRecord = {
      schemaVersion: 1,
      reviewId: reviewId(manifest.institutionId, candidate.resourceKey),
      reviewManifestId: manifest.reviewManifestId,
      candidateId: candidate.candidateId,
      institutionId: manifest.institutionId,
      targetType: candidate.targetType,
      resourceKey: candidate.resourceKey,
      documentPath: candidate.documentPath,
      authUid: candidate.authUid,
      storagePath: candidate.storagePath,
      sourceDocumentPath: candidate.sourceDocumentPath,
      reviewedChangeToken: candidate.changeToken,
      reviewedGeneration: candidate.generation,
      decision: input.decision,
      reason: input.reason.trim(),
      sourceEvidence: Array.from(new Set(input.sourceEvidence)).sort(),
      reviewedBy: input.reviewedBy,
      reviewedAt,
      reviewVersion: manifest.reviewVersion + 1,
      status:
        input.decision === "CONFIRMED_TEST"
          ? "APPROVED"
          : input.decision === "PRESERVE"
            ? "PRESERVED"
            : "UNRESOLVED",
    };
    const currentReviews = await this.source.loadReviews(manifest.institutionId);
    const nextReviews = [
      ...currentReviews.filter((value) => value.reviewId !== review.reviewId),
      review,
    ];
    const snapshot = await this.source.loadSnapshot(manifest.institutionId);
    const nextReport = buildLegacyInstitutionReport({
      snapshot,
      reviews: nextReviews,
      evidenceCatalog: this.evidenceCatalog,
      now: reviewedAt,
    });
    const generated = buildLegacyReviewManifest({
      report: nextReport,
      generatedAt: reviewedAt,
      generatedBy: input.reviewedBy,
      environment: manifest.environment,
      projectId: manifest.projectId,
    });
    const nextManifest: LegacyReviewManifest = {
      ...generated,
      reviewManifestId: manifest.reviewManifestId,
      reviewVersion: manifest.reviewVersion + 1,
    };
    await this.store.saveReview(review, nextManifest);
    return { review, manifest: nextManifest, report: nextReport };
  }
}

export class FirestoreLegacyReviewStore implements LegacyReviewStore {
  private readonly db: Firestore;

  constructor(db: Firestore = adminDb()) {
    this.db = db;
  }

  async saveManifest(
    manifest: LegacyReviewManifest,
    candidates: LegacyReviewCandidate[],
  ) {
    const ref = this.db
      .collection(LEGACY_REVIEW_MANIFEST_COLLECTION)
      .doc(manifest.reviewManifestId);
    const existing = await ref.get();
    if (existing.exists) {
      const data = existing.data() as LegacyReviewManifest;
      if (data.checksum !== manifest.checksum) {
        throw new LegacyReviewError("review_manifest_checksum_conflict", 409);
      }
      return;
    }
    for (let index = 0; index < candidates.length; index += 400) {
      const batch = this.db.batch();
      for (const candidate of candidates.slice(index, index + 400)) {
        batch.set(
          ref.collection("candidates").doc(candidate.candidateId),
          withoutUndefined(candidate),
        );
      }
      await batch.commit();
    }
    await ref.create(withoutUndefined(manifest));
  }

  async getManifest(reviewManifestId: string) {
    const snapshot = await this.db
      .collection(LEGACY_REVIEW_MANIFEST_COLLECTION)
      .doc(reviewManifestId)
      .get();
    return snapshot.exists
      ? snapshot.data() as LegacyReviewManifest
      : null;
  }

  async getCandidates(reviewManifestId: string) {
    const snapshot = await this.db
      .collection(LEGACY_REVIEW_MANIFEST_COLLECTION)
      .doc(reviewManifestId)
      .collection("candidates")
      .get();
    return snapshot.docs.map(
      (document) => document.data() as LegacyReviewCandidate,
    );
  }

  async saveReview(
    review: LegacyReviewRecord,
    nextManifest: LegacyReviewManifest,
  ) {
    const manifestRef = this.db
      .collection(LEGACY_REVIEW_MANIFEST_COLLECTION)
      .doc(review.reviewManifestId);
    const reviewRef = this.db
      .collection(LEGACY_REVIEW_COLLECTION)
      .doc(review.reviewId);
    const auditRef = this.db
      .collection(LEGACY_REVIEW_AUDIT_COLLECTION)
      .doc(`${review.reviewId}_v${review.reviewVersion}`);
    await this.db.runTransaction(async (transaction) => {
      const current = await transaction.get(manifestRef);
      if (!current.exists) {
        throw new LegacyReviewError("review_manifest_not_found", 404);
      }
      const currentVersion = Number(current.data()?.reviewVersion ?? 0);
      if (currentVersion + 1 !== nextManifest.reviewVersion) {
        throw new LegacyReviewError("review_version_conflict", 409);
      }
      transaction.set(reviewRef, withoutUndefined(review));
      transaction.create(auditRef, withoutUndefined(review));
      transaction.set(manifestRef, withoutUndefined(nextManifest));
    });
  }

  async loadReviews(institutionId: string) {
    const snapshot = await this.db
      .collection(LEGACY_REVIEW_COLLECTION)
      .where("institutionId", "==", institutionId)
      .limit(LEGACY_REVIEW_MAX_CANDIDATES)
      .get();
    return snapshot.docs.map(
      (document) => document.data() as LegacyReviewRecord,
    );
  }
}

export class FirestoreLegacyReviewDataSource
  extends FirestorePurgeScanDataSource
  implements LegacyReviewDataSource
{
  private readonly reviewStore: LegacyReviewStore;

  constructor(
    reviewStore: LegacyReviewStore = new FirestoreLegacyReviewStore(),
  ) {
    super();
    this.reviewStore = reviewStore;
  }

  loadReviews(institutionId: string) {
    return this.reviewStore.loadReviews(institutionId);
  }
}

export function createRuntimeLegacyReviewService() {
  const store = new FirestoreLegacyReviewStore();
  return new LegacyReviewService({
    source: new FirestoreLegacyReviewDataSource(store),
    store,
  });
}

function reviewId(institutionId: string, resourceKey: string) {
  return `legacy-review-${createHash("sha256")
    .update(`${institutionId}:${resourceKey}`)
    .digest("hex")
    .slice(0, 32)}`;
}
