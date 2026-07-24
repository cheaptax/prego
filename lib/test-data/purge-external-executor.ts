import type { Auth, UserRecord as AuthUserRecord } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";
import { adminAuth, adminDb, adminStorage } from "@/lib/firebase/admin";
import type {
  PurgeExternalExecutor,
  PurgeExternalOperationResult,
} from "@/lib/test-data/purge-job-types";
import type {
  PurgeAuthUserCandidate,
  PurgeManifest,
  PurgeStorageObjectCandidate,
} from "@/lib/test-data/purge-types";

const FORBIDDEN_PROFILE_ROLES = new Set([
  "admin",
  "operator",
  "partner",
  "super_admin",
  "operations_manager",
  "content_manager",
  "partner_manager",
]);

function authNotFound(error: unknown) {
  return (error as { code?: unknown }).code === "auth/user-not-found";
}

function storageNotFound(error: unknown) {
  const code = (error as { code?: unknown }).code;
  return code === 404 || code === "404";
}

function retryableExternalError(error: unknown) {
  const code = String((error as { code?: unknown }).code ?? "");
  return /timeout|deadline|unavailable|internal|too-many-requests|429|5\d\d/i
    .test(code);
}

function failedResult(
  error: unknown,
  fallbackCode: string,
): PurgeExternalOperationResult {
  return {
    status: "FAILED",
    code: String((error as { code?: unknown }).code ?? fallbackCode),
    retryable: retryableExternalError(error),
  };
}

function manifestFirestorePaths(manifest: PurgeManifest) {
  return new Set(
    Object.values(manifest.targetsByCollection)
      .flat()
      .map((item) => item.resourcePath),
  );
}

export class FirebasePurgeExternalExecutor implements PurgeExternalExecutor {
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

  async validateAuthTarget(
    manifest: PurgeManifest,
    uid: string,
  ): Promise<PurgeExternalOperationResult> {
    const candidate = manifest.authUsers.find((item) => item.uid === uid);
    const staticValidation = validateAuthCandidate(manifest, candidate);
    if (staticValidation) return staticValidation;
    try {
      const authUser = await this.auth.getUser(uid);
      const authValidation = validateCurrentAuthUser(candidate!, authUser);
      if (authValidation) return authValidation;
    } catch (error) {
      if (!authNotFound(error)) {
        return failedResult(error, "auth_revalidation_failed");
      }
    }

    const primaryUid = candidate!.primaryUserUid || uid;
    const [profile, registry, linkedOrganizations, linkedPrimaryOrganizations] =
      await Promise.all([
        this.db.collection("users").doc(primaryUid).get(),
        this.db.collection("testAuthSubjects").doc(uid).get(),
        this.db.collection("organizations")
          .where("users", "array-contains", uid).limit(21).get(),
        primaryUid === uid
          ? Promise.resolve(null)
          : this.db.collection("organizations")
              .where("users", "array-contains", primaryUid).limit(21).get(),
      ]);

    if (profile.exists) {
      const data = profile.data() as Record<string, unknown>;
      const role = String(data.adminRole ?? data.role ?? "");
      if (
        FORBIDDEN_PROFILE_ROLES.has(role) ||
        Boolean(data.partnerId) ||
        (data.dataClassification !== "DEMO" &&
          data.dataClassification !== "TEST" &&
          data.testData !== true) ||
        ![data.sourceInstitutionId, data.cooperativeId, data.nh_org_id]
          .filter(Boolean)
          .every((value) => value === manifest.institutionId)
      ) {
        return { status: "BLOCKED", code: "auth_profile_not_test_only" };
      }
    }

    if (registry.exists) {
      const data = registry.data() as Record<string, unknown>;
      if (
        data.sourceInstitutionId !== manifest.institutionId ||
        (data.dataClassification !== "DEMO" &&
          data.dataClassification !== "TEST") ||
        data.primaryUserUid !== primaryUid
      ) {
        return { status: "BLOCKED", code: "auth_registry_mismatch" };
      }
    } else if (!profile.exists) {
      return { status: "BLOCKED", code: "auth_lineage_missing" };
    }

    const organizations = [
      ...linkedOrganizations.docs,
      ...(linkedPrimaryOrganizations?.docs ?? []),
    ];
    if (
      organizations.some(
        (document) =>
          document.id !== manifest.institutionId &&
          document.data().cooperativeId !== manifest.institutionId,
      )
    ) {
      return { status: "BLOCKED", code: "auth_uid_multiple_organizations" };
    }

    const sharedBusinessReferences = await this.findUidBusinessReferences(
      uid,
      primaryUid,
    );
    const allowedPaths = manifestFirestorePaths(manifest);
    if (
      sharedBusinessReferences.some(
        (path) => !allowedPaths.has(path),
      )
    ) {
      return {
        status: "BLOCKED",
        code: "auth_uid_has_unapproved_business_reference",
      };
    }
    return { status: "SUCCESS" };
  }

  async disableAuthUser(uid: string): Promise<PurgeExternalOperationResult> {
    try {
      const user = await this.auth.getUser(uid);
      if (!user.disabled) await this.auth.updateUser(uid, { disabled: true });
      return { status: "SUCCESS" };
    } catch (error) {
      if (authNotFound(error)) return { status: "NOT_FOUND" };
      return failedResult(error, "auth_disable_failed");
    }
  }

  async revokeAuthSessions(uid: string): Promise<PurgeExternalOperationResult> {
    try {
      await this.auth.revokeRefreshTokens(uid);
      return { status: "SUCCESS" };
    } catch (error) {
      if (authNotFound(error)) return { status: "NOT_FOUND" };
      return failedResult(error, "auth_revoke_failed");
    }
  }

  async deleteAuthUser(uid: string): Promise<PurgeExternalOperationResult> {
    try {
      await this.auth.deleteUser(uid);
      return { status: "SUCCESS" };
    } catch (error) {
      if (authNotFound(error)) return { status: "NOT_FOUND" };
      return failedResult(error, "auth_delete_failed");
    }
  }

  async validateStorageTarget(
    manifest: PurgeManifest,
    path: string,
  ): Promise<PurgeExternalOperationResult> {
    const candidate = manifest.storageObjects.find((item) => item.path === path);
    const staticValidation = validateStorageCandidate(manifest, candidate);
    if (staticValidation) return staticValidation;
    const bucket = this.storage.bucket(candidate!.bucket);
    try {
      const [metadata] = await bucket.file(path).getMetadata();
      if (
        candidate!.generation &&
        candidate!.generation !== String(metadata.generation)
      ) {
        return { status: "BLOCKED", code: "storage_generation_mismatch" };
      }
      const customMetadata = metadata.metadata ?? {};
      if (
        customMetadata.sourceInstitutionId &&
        customMetadata.sourceInstitutionId !== manifest.institutionId
      ) {
        return { status: "BLOCKED", code: "storage_institution_mismatch" };
      }
      if (
        candidate!.ownerUid &&
        customMetadata.ownerUid &&
        candidate!.ownerUid !== customMetadata.ownerUid
      ) {
        return { status: "BLOCKED", code: "storage_owner_mismatch" };
      }
      return { status: "SUCCESS" };
    } catch (error) {
      if (storageNotFound(error)) return { status: "NOT_FOUND" };
      return failedResult(error, "storage_revalidation_failed");
    }
  }

  async deleteStorageObject(
    manifest: PurgeManifest,
    path: string,
  ): Promise<PurgeExternalOperationResult> {
    const candidate = manifest.storageObjects.find((item) => item.path === path);
    const staticValidation = validateStorageCandidate(manifest, candidate);
    if (staticValidation) return staticValidation;
    const bucket = this.storage.bucket(candidate!.bucket);
    try {
      const generation = candidate!.generation;
      await bucket.file(path).delete(
        generation
          ? { ifGenerationMatch: generation }
          : undefined,
      );
      return { status: "SUCCESS" };
    } catch (error) {
      if (storageNotFound(error)) return { status: "NOT_FOUND" };
      const code = String((error as { code?: unknown }).code ?? "");
      if (code === "412" || /precondition/i.test(code)) {
        return { status: "BLOCKED", code: "storage_generation_mismatch" };
      }
      return failedResult(error, "storage_delete_failed");
    }
  }

  private async findUidBusinessReferences(uid: string, primaryUid: string) {
    const uids = Array.from(new Set([uid, primaryUid]));
    const paths = new Set<string>();
    for (const targetUid of uids) {
      const snapshots = await Promise.all([
        this.db.collection("quoteRequests")
          .where("customerUid", "==", targetUid).limit(2_001).get(),
        this.db.collection("consultRequests")
          .where("uid", "==", targetUid).limit(2_001).get(),
        this.db.collection("pointLedger")
          .where("userId", "==", targetUid).limit(2_001).get(),
        this.db.collection("point_transactions")
          .where("user_id", "==", targetUid).limit(2_001).get(),
        this.db.collection("auditEvaluationCases")
          .where("customerAccessOwner.uid", "==", targetUid).limit(2_001).get(),
      ]);
      snapshots.flatMap((snapshot) => snapshot.docs)
        .forEach((document) => paths.add(document.ref.path));
    }
    return Array.from(paths);
  }
}

function validateAuthCandidate(
  manifest: PurgeManifest,
  candidate: PurgeAuthUserCandidate | undefined,
): PurgeExternalOperationResult | null {
  if (!candidate || candidate.classification !== "CONFIRMED_TEST") {
    return { status: "BLOCKED", code: "auth_uid_not_confirmed_in_manifest" };
  }
  if (
    candidate.reviewStatus !== "APPROVED" ||
    candidate.profileClassification !== "CONFIRMED_TEST" ||
    candidate.sourceInstitutionId !== manifest.institutionId
  ) {
    return { status: "BLOCKED", code: "auth_uid_not_approved_test_profile" };
  }
  if (
    candidate.profileRole &&
    FORBIDDEN_PROFILE_ROLES.has(candidate.profileRole)
  ) {
    return { status: "BLOCKED", code: "auth_uid_operator_role" };
  }
  if (
    (candidate.customClaimKeys ?? []).some((key) =>
      /admin|operator|partner/i.test(key)
    )
  ) {
    return { status: "BLOCKED", code: "auth_uid_operator_claim" };
  }
  if (
    (candidate.linkedInstitutionIds ?? []).some(
      (institutionId) => institutionId !== manifest.institutionId,
    )
  ) {
    return { status: "BLOCKED", code: "auth_uid_multiple_organizations" };
  }
  return null;
}

function validateCurrentAuthUser(
  candidate: PurgeAuthUserCandidate,
  user: AuthUserRecord,
): PurgeExternalOperationResult | null {
  const providerIds = user.providerData
    .map((provider) => provider.providerId)
    .sort();
  if (
    JSON.stringify(providerIds) !==
      JSON.stringify([...candidate.providerIds].sort())
  ) {
    return { status: "BLOCKED", code: "auth_provider_changed" };
  }
  if (
    Object.entries(user.customClaims ?? {}).some(
      ([key, value]) =>
        Boolean(value) && /admin|operator|partner/i.test(key),
    )
  ) {
    return { status: "BLOCKED", code: "auth_uid_operator_claim" };
  }
  return null;
}

function validateStorageCandidate(
  manifest: PurgeManifest,
  candidate: PurgeStorageObjectCandidate | undefined,
): PurgeExternalOperationResult | null {
  if (!candidate || candidate.classification !== "CONFIRMED_TEST") {
    return { status: "BLOCKED", code: "storage_path_not_confirmed_in_manifest" };
  }
  if (!candidate.path || candidate.path.includes("..")) {
    return { status: "BLOCKED", code: "storage_path_invalid" };
  }
  if ((candidate.sharedReferenceCount ?? 0) > 1) {
    return { status: "BLOCKED", code: "storage_object_shared" };
  }
  if (
    candidate.sourceInstitutionId &&
    candidate.sourceInstitutionId !== manifest.institutionId
  ) {
    return { status: "BLOCKED", code: "storage_institution_mismatch" };
  }
  if (!candidate.generation && candidate.exists !== false) {
    return { status: "BLOCKED", code: "storage_generation_missing" };
  }
  return null;
}
