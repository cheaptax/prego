import type { Auth } from "firebase-admin/auth";
import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";
import { adminAuth, adminDb, adminStorage } from "@/lib/firebase/admin";
import type {
  PurgeJobRecord,
  PurgeOrphanFinding,
  PurgeOrphanVerificationReport,
  PurgeOrphanVerifier,
} from "@/lib/test-data/purge-job-types";
import type { PurgeManifest } from "@/lib/test-data/purge-types";

const UID_REFERENCE_FIELDS: Record<string, string[]> = {
  consultRequests: ["uid", "user_id"],
  answerViews: ["uid"],
  answerRatings: ["uid"],
  quoteRequests: ["customerUid"],
  pointLedger: ["userId"],
  point_transactions: ["user_id"],
  auditLogs: ["actorUid"],
  auditEvaluationCases: ["customerAccessOwner.uid"],
};

export class FirebasePurgeOrphanVerifier implements PurgeOrphanVerifier {
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

  async verify(
    manifest: PurgeManifest,
    job: PurgeJobRecord,
    now: string,
  ): Promise<PurgeOrphanVerificationReport> {
    const findings: PurgeOrphanFinding[] = [];
    const checks: Record<string, number> = {};
    const targetUids = manifest.authUsers
      .filter((item) => item.classification === "CONFIRMED_TEST")
      .map((item) => item.uid);

    const profiles = await this.queryInstitutionCollection(
      "users",
      manifest.institutionId,
    );
    checks.customerProfiles = profiles.length;
    for (const profile of profiles) {
      const uid = profile.id;
      try {
        await this.auth.getUser(uid);
        findings.push(finding(
          "NEW_UNCONFIRMED_DATA",
          profile.ref.path,
          "profile_remains_after_purge",
        ));
      } catch (error) {
        if (authNotFound(error)) {
          findings.push(finding(
            "PROFILE_WITHOUT_AUTH",
            profile.ref.path,
            "profile_exists_auth_missing",
          ));
        } else {
          findings.push(finding(
            "NEW_UNCONFIRMED_DATA",
            profile.ref.path,
            "profile_auth_check_failed",
          ));
        }
      }
    }

    checks.authTargets = targetUids.length;
    for (const uid of targetUids) {
      try {
        await this.auth.getUser(uid);
        const profile = await this.db.collection("users").doc(uid).get();
        findings.push(finding(
          profile.exists ? "NEW_UNCONFIRMED_DATA" : "AUTH_WITHOUT_PROFILE",
          `firebaseAuth/${uid}`,
          profile.exists
            ? "auth_and_profile_remain_after_purge"
            : "auth_exists_profile_missing",
        ));
      } catch (error) {
        if (!authNotFound(error)) {
          findings.push(finding(
            "NEW_UNCONFIRMED_DATA",
            `firebaseAuth/${uid}`,
            "auth_verification_failed",
          ));
        }
      }
    }

    const organization = await this.db
      .collection("organizations")
      .doc(manifest.institutionId)
      .get();
    const memberships = [
      ...(await this.queryInstitutionCollection(
        "memberships",
        manifest.institutionId,
      )),
      ...(await this.queryInstitutionCollection(
        "tenants",
        manifest.institutionId,
      )),
    ];
    checks.membershipsAndTenants = memberships.length;
    for (const membership of memberships) {
      const data = membership.data();
      if (!organization.exists) {
        findings.push(finding(
          "MEMBERSHIP_WITHOUT_ORGANIZATION",
          membership.ref.path,
          "organization_missing",
        ));
      }
      if (
        membership.ref.parent.id === "tenants" &&
        String(data.status ?? "").toLowerCase() === "active"
      ) {
        findings.push(finding(
          "ACTIVE_TENANT_AFTER_RESET",
          membership.ref.path,
          "active_tenant_references_reset_institution",
        ));
      }
    }

    const answerPaths = Object.values(manifest.targetsByCollection)
      .flat()
      .filter((item) => item.collection === "answers")
      .map((item) => item.resourcePath);
    checks.answers = answerPaths.length;
    for (const path of answerPaths) {
      const answer = await this.db.doc(path).get();
      if (!answer.exists) continue;
      const requestId = String(answer.data()?.requestId ?? answer.id);
      const request = await this.db
        .collection("consultRequests")
        .doc(requestId)
        .get();
      if (!request.exists) {
        findings.push(finding(
          "ANSWER_WITHOUT_REQUEST",
          path,
          "request_missing",
        ));
      }
    }

    const [ledger, transactions] = await Promise.all([
      this.queryInstitutionCollection("pointLedger", manifest.institutionId),
      this.queryInstitutionCollection(
        "point_transactions",
        manifest.institutionId,
      ),
    ]);
    checks.pointRows = ledger.length + transactions.length;
    if (
      (ledger.length > 0 || transactions.length > 0) &&
      !organization.exists
    ) {
      findings.push(finding(
        "POINT_BALANCE_MISMATCH",
        `organizations/${manifest.institutionId}`,
        "point_rows_exist_without_wallet",
      ));
    }
    if (
      organization.exists &&
      Number(organization.data()?.walletBalance ?? 0) !== 0 &&
      ledger.length === 0 &&
      transactions.length === 0
    ) {
      findings.push(finding(
        "POINT_BALANCE_MISMATCH",
        organization.ref.path,
        "wallet_exists_without_point_rows",
      ));
    }

    const storageFindings = await this.verifyStorage(manifest);
    checks.storagePrefixes = storagePrefixes(manifest).length;
    findings.push(...storageFindings);

    let uidReferenceCount = 0;
    for (const uid of targetUids) {
      for (const [collection, fields] of Object.entries(UID_REFERENCE_FIELDS)) {
        for (const field of fields) {
          const snapshot = await this.db
            .collection(collection)
            .where(field, "==", uid)
            .limit(2_001)
            .get();
          uidReferenceCount += snapshot.size;
          for (const document of snapshot.docs) {
            findings.push(finding(
              "DELETED_UID_REFERENCE",
              document.ref.path,
              `field_${field}_references_deleted_uid`,
            ));
          }
        }
      }
    }
    checks.deletedUidReferences = uidReferenceCount;

    const uniqueFindings = Array.from(
      new Map(
        findings.map((item) => [
          `${item.type}:${item.resourcePath}:${item.detailCode}`,
          item,
        ]),
      ).values(),
    ).sort((left, right) =>
      `${left.type}:${left.resourcePath}`.localeCompare(
        `${right.type}:${right.resourcePath}`,
      )
    );
    const blockerCount = uniqueFindings.filter(
      (item) => item.severity === "BLOCKER",
    ).length;
    return {
      generatedAt: now,
      checks,
      findings: uniqueFindings,
      blockerCount,
      passed: blockerCount === 0,
    };
  }

  private async queryInstitutionCollection(
    collection: string,
    institutionId: string,
  ) {
    const documents = new Map<string, QueryDocumentSnapshot>();
    for (const field of [
      "sourceInstitutionId",
      "institutionId",
      "cooperativeId",
      "nh_org_id",
      "organizationId",
      "tenantId",
    ]) {
      const snapshot = await this.db
        .collection(collection)
        .where(field, "==", institutionId)
        .limit(2_001)
        .get();
      snapshot.docs.forEach((document) =>
        documents.set(document.ref.path, document)
      );
    }
    return Array.from(documents.values());
  }

  private async verifyStorage(manifest: PurgeManifest) {
    const findings: PurgeOrphanFinding[] = [];
    const manifestPaths = new Set(
      manifest.storageObjects.map((item) => item.path),
    );
    for (const candidate of manifest.storageObjects) {
      const bucket = this.storage.bucket(candidate.bucket);
      try {
        await bucket.file(candidate.path).getMetadata();
        findings.push(finding(
          "STORAGE_WITHOUT_METADATA",
          `gs://${bucket.name}/${candidate.path}`,
          "manifest_storage_object_remains",
        ));
      } catch (error) {
        if (!storageNotFound(error)) {
          findings.push(finding(
            "NEW_UNCONFIRMED_DATA",
            `gs://${bucket.name}/${candidate.path}`,
            "storage_verification_failed",
          ));
        }
      }
    }
    for (const { bucketName, prefix } of storagePrefixes(manifest)) {
      const bucket = this.storage.bucket(bucketName);
      try {
        const [files] = await bucket.getFiles({ prefix, maxResults: 501 });
        for (const file of files) {
          if (!manifestPaths.has(file.name)) {
            findings.push(finding(
              "NEW_UNCONFIRMED_DATA",
              `gs://${bucket.name}/${file.name}`,
              "new_storage_object_outside_manifest",
            ));
          }
        }
      } catch {
        findings.push(finding(
          "NEW_UNCONFIRMED_DATA",
          `gs://${bucket.name}/${prefix}`,
          "storage_prefix_verification_failed",
        ));
      }
    }
    return findings;
  }
}

function finding(
  type: PurgeOrphanFinding["type"],
  resourcePath: string,
  detailCode: string,
): PurgeOrphanFinding {
  return {
    type,
    resourcePath,
    severity: "BLOCKER",
    detailCode,
  };
}

function storagePrefixes(manifest: PurgeManifest) {
  const values = new Map<string, { bucketName?: string; prefix: string }>();
  for (const candidate of manifest.storageObjects) {
    const segments = candidate.path.split("/");
    let prefix = segments.slice(0, -1).join("/") + "/";
    if (segments[0] === "business-cards" && segments[1]) {
      prefix = `business-cards/${segments[1]}/`;
    } else if (segments[0] === "consult-attachments" && segments[1]) {
      prefix = `consult-attachments/${segments[1]}/`;
    } else if (segments[0] === "quotes" && segments[1]) {
      prefix = `quotes/${segments[1]}/`;
    } else if (
      segments[0] === "audit-evaluation" &&
      segments[1] &&
      segments[2]
    ) {
      prefix = `audit-evaluation/${segments[1]}/${segments[2]}/`;
    }
    const key = `${candidate.bucket ?? ""}:${prefix}`;
    values.set(key, { bucketName: candidate.bucket, prefix });
  }
  return Array.from(values.values());
}

function authNotFound(error: unknown) {
  return (error as { code?: unknown }).code === "auth/user-not-found";
}

function storageNotFound(error: unknown) {
  const code = (error as { code?: unknown }).code;
  return code === 404 || code === "404";
}
