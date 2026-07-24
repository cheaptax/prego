/**
 * Reassign every existing Firestore customer member profile to 프레고농협.
 *
 * Default mode is read-only. Apply requires the exact dry-run checksum and
 * production confirmation. Admin and partner profiles are always excluded.
 * Historical requests, quotes, point ledgers, and source wallet balances remain
 * unchanged because they are business-event snapshots, not account affiliation.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  DEMO_COOPERATIVE_COLLECTION,
  PREGO_COOPERATIVE_ID,
  nextDemoSignupStatus,
  parseTestCooperativeMaster,
  toDemoCooperativeSearchItem,
} from "../lib/cooperatives/demo-cooperative.ts";
import { buildSignupRootMetadata } from "../lib/test-data/root-metadata.ts";

const MAX_MEMBER_PROFILES = 300;
const MAX_ORGANIZATIONS = 150;
const MIGRATION_ACTOR = "migration:reassign-members-to-prego-v2";

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/gu, "");
  }
}

function option(args, name) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1]?.trim() : "";
  if (index >= 0 && (!value || value.startsWith("--"))) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function snapshotVersion(snapshot) {
  return snapshot.updateTime?.toDate().toISOString() ?? "";
}

function buildPlan(userSnapshot, organizationSnapshot, masterSnapshot) {
  const master = masterSnapshot.exists
    ? parseTestCooperativeMaster(masterSnapshot.data(), PREGO_COOPERATIVE_ID)
    : null;
  if (!master) throw new Error("prego_test_cooperative_master_missing");
  const members = userSnapshot.docs.filter(
    (document) => document.data().role === "member",
  );
  if (members.length > MAX_MEMBER_PROFILES) {
    throw new Error(`member_limit_exceeded:${members.length}`);
  }
  if (organizationSnapshot.docs.length > MAX_ORGANIZATIONS) {
    throw new Error(
      `organization_limit_exceeded:${organizationSnapshot.docs.length}`,
    );
  }
  const memberUids = new Set(members.map((document) => document.id));
  const activeMembers = members.filter(
    (document) => document.data().status === "active",
  );
  const activeMemberUids = new Set(
    activeMembers.map((document) => document.id),
  );
  const affectedOrganizations = organizationSnapshot.docs.filter((document) => {
    const users = Array.isArray(document.data().users)
      ? document.data().users
      : [];
    return (
      document.id === PREGO_COOPERATIVE_ID ||
      users.some((uid) => memberUids.has(uid))
    );
  });
  const fingerprint = {
    targetMasterVersion: snapshotVersion(masterSnapshot),
    members: members
      .map((document) => ({
        uid: document.id,
        cooperativeId: document.data().cooperativeId ?? null,
        nh_org_id: document.data().nh_org_id ?? null,
        version: snapshotVersion(document),
      }))
      .sort((left, right) => left.uid.localeCompare(right.uid)),
    organizations: affectedOrganizations
      .map((document) => ({
        id: document.id,
        users: Array.isArray(document.data().users)
          ? [...document.data().users].sort()
          : [],
        version: snapshotVersion(document),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
  const targetOrganization = affectedOrganizations.find(
    (document) => document.id === PREGO_COOPERATIVE_ID,
  );
  const currentTargetMemberUids = new Set(
    (Array.isArray(targetOrganization?.data().users)
      ? targetOrganization.data().users
      : []
    ).filter((uid) => memberUids.has(uid)),
  );
  const membershipRepairsNeeded =
    currentTargetMemberUids.size !== activeMemberUids.size ||
    Array.from(activeMemberUids).some(
      (uid) => !currentTargetMemberUids.has(uid),
    );
  return {
    master,
    members,
    memberUids,
    activeMembers,
    activeMemberUids,
    affectedOrganizations,
    checksum: hash(fingerprint),
    alreadyAssigned: members.filter(
      (document) => document.data().cooperativeId === PREGO_COOPERATIVE_ID,
    ).length,
    membershipRepairsNeeded,
    sourceCounts: Object.fromEntries(
      Array.from(
        members.reduce((counts, document) => {
          const source = String(
            document.data().cooperativeName ??
              document.data().cooperativeId ??
              "(미지정)",
          );
          counts.set(source, (counts.get(source) ?? 0) + 1);
          return counts;
        }, new Map()),
      ).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

async function listAuthUsers(auth) {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1_000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

loadLocalEnv();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const checksum = option(args, "--checksum");
const expectedProject = option(args, "--expected-project");
const confirmation = option(args, "--confirm-production");
const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
if (!projectId || expectedProject !== projectId) {
  throw new Error(
    `project_mismatch:expected=${expectedProject || "<required>"}:actual=${projectId || "<missing>"}`,
  );
}
if (
  apply &&
  projectId === "nong-1af31" &&
  confirmation !== "REASSIGN_ALL_MEMBERS_TO_PREGO_nong-1af31"
) {
  throw new Error("production_confirmation_required");
}
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/gu, "\n"),
    }),
  });
}
const db = getFirestore();
const auth = getAuth();
const masterRef = db
  .collection(DEMO_COOPERATIVE_COLLECTION)
  .doc(PREGO_COOPERATIVE_ID);
const [userSnapshot, organizationSnapshot, masterSnapshot, authUsers] =
  await Promise.all([
    db.collection("users").get(),
    db.collection("organizations").get(),
    masterRef.get(),
    listAuthUsers(auth),
  ]);
const plan = buildPlan(userSnapshot, organizationSnapshot, masterSnapshot);
const firestoreUids = new Set(userSnapshot.docs.map((document) => document.id));
const roleCounts = userSnapshot.docs.reduce((counts, document) => {
  const role = String(document.data().role ?? "missing");
  counts[role] = (counts[role] ?? 0) + 1;
  return counts;
}, {});
console.log(
  JSON.stringify(
    {
      mode: apply ? "APPLY" : "DRY_RUN",
      projectId,
      target: {
        cooperativeId: plan.master.cooperativeId,
        cooperativeName: plan.master.cooperativeName,
      },
      memberProfiles: plan.members.length,
      activeMemberProfiles: plan.activeMembers.length,
      alreadyAssigned: plan.alreadyAssigned,
      profilesToUpdate: plan.members.length - plan.alreadyAssigned,
      organizationMembershipRepairNeeded: plan.membershipRepairsNeeded,
      excludedProfileCountsByRole: roleCounts,
      authOnlyAccountsExcluded: authUsers.filter(
        (user) => !firestoreUids.has(user.uid),
      ).length,
      affectedOrganizations: plan.affectedOrganizations.length,
      sourceCounts: plan.sourceCounts,
      walletPolicy: "KEEP_TARGET_AND_SOURCE_WALLETS_UNCHANGED",
      historicalDataPolicy:
        "KEEP_REQUEST_QUOTE_POINT_AND_AUDIT_SNAPSHOTS_UNCHANGED",
      checksum: plan.checksum,
      confirmation:
        `--apply --checksum ${plan.checksum} ` +
        `--expected-project ${projectId} ` +
        `--confirm-production REASSIGN_ALL_MEMBERS_TO_PREGO_${projectId}`,
    },
    null,
    2,
  ),
);
if (!apply) process.exit(0);
if (!checksum || checksum !== plan.checksum) {
  throw new Error("checksum_mismatch");
}

const migrationId = `members-to-prego-${Date.now()}`;
await db.runTransaction(async (transaction) => {
  const [currentUsers, currentOrganizations, currentMaster] = await Promise.all([
    transaction.get(db.collection("users")),
    transaction.get(db.collection("organizations")),
    transaction.get(masterRef),
  ]);
  const currentPlan = buildPlan(
    currentUsers,
    currentOrganizations,
    currentMaster,
  );
  if (currentPlan.checksum !== checksum) {
    throw new Error("dataset_changed_after_dry_run");
  }
  const now = new Date().toISOString();
  const targetSearchItem = toDemoCooperativeSearchItem(currentPlan.master);
  const targetOrganization = currentOrganizations.docs.find(
    (document) => document.id === PREGO_COOPERATIVE_ID,
  );
  const targetOrganizationData = targetOrganization?.data() ?? {};
  const preservedTargetUsers = (
    Array.isArray(targetOrganizationData.users)
      ? targetOrganizationData.users
      : []
  ).filter((uid) => !currentPlan.memberUids.has(uid));
  const backupProfiles = currentPlan.members.map((document) => {
    const data = document.data();
    return {
      uid: document.id,
      cooperativeId: data.cooperativeId ?? null,
      nh_org_id: data.nh_org_id ?? null,
      cooperativeName: data.cooperativeName ?? null,
      manualCooperativeName: data.manualCooperativeName ?? null,
      dataClassification: data.dataClassification ?? null,
      sourceInstitutionId: data.sourceInstitutionId ?? null,
      testScenarioId: data.testScenarioId ?? null,
      testMetadata: data.testMetadata ?? null,
    };
  });
  for (const document of currentPlan.members) {
    const metadata = buildSignupRootMetadata({
      cooperative: targetSearchItem,
      rootEntityId: document.id,
      createdBy: MIGRATION_ACTOR,
      createdAt: now,
    });
    transaction.update(document.ref, {
      cooperativeId: PREGO_COOPERATIVE_ID,
      nh_org_id: PREGO_COOPERATIVE_ID,
      cooperativeName: currentPlan.master.cooperativeName,
      manualCooperativeName: FieldValue.delete(),
      ...metadata,
      updatedAt: now,
    });
  }
  for (const organization of currentPlan.affectedOrganizations) {
    if (organization.id === PREGO_COOPERATIVE_ID) continue;
    const users = Array.isArray(organization.data().users)
      ? organization.data().users
      : [];
    transaction.update(organization.ref, {
      users: users.filter((uid) => !currentPlan.memberUids.has(uid)),
      updatedAt: now,
    });
  }
  const organizationMetadata = buildSignupRootMetadata({
    cooperative: targetSearchItem,
    rootEntityId: PREGO_COOPERATIVE_ID,
    createdBy: MIGRATION_ACTOR,
    createdAt: now,
  });
  transaction.set(
    db.collection("organizations").doc(PREGO_COOPERATIVE_ID),
    {
      cooperativeId: PREGO_COOPERATIVE_ID,
      nh_org_id: PREGO_COOPERATIVE_ID,
      cooperativeName: currentPlan.master.cooperativeName,
      walletBalance: Number(targetOrganizationData.walletBalance ?? 0),
      users: Array.from(
        new Set([
          ...preservedTargetUsers,
          ...currentPlan.activeMembers.map((document) => document.id),
        ]),
      ).sort(),
      ...organizationMetadata,
      createdAt: targetOrganizationData.createdAt ?? now,
      updatedAt: now,
    },
    { merge: true },
  );
  transaction.update(masterRef, {
    signupStatus: nextDemoSignupStatus(
      currentPlan.master.signupStatus,
      "APPROVED",
    ),
    updatedAt: now,
    updatedBy: MIGRATION_ACTOR,
  });
  transaction.create(
    db.collection("memberAffiliationMigrations").doc(migrationId),
    {
      migrationId,
      actor: MIGRATION_ACTOR,
      targetCooperativeId: PREGO_COOPERATIVE_ID,
      memberCount: currentPlan.members.length,
      checksum,
      previousProfiles: backupProfiles,
      status: "APPLIED",
      createdAt: now,
    },
  );
  const auditRef = db.collection("auditLogs").doc();
  transaction.create(auditRef, {
    id: auditRef.id,
    actorUid: MIGRATION_ACTOR,
    actorEmail: "",
    action: "member.bulk_cooperative_reassigned",
    targetType: "organization",
    targetId: PREGO_COOPERATIVE_ID,
    metadata: {
      memberCount: currentPlan.members.length,
      checksum,
      migrationId,
    },
    createdAt: now,
  });
});

const [verifiedUsers, verifiedOrganizations] = await Promise.all([
  db.collection("users").where("role", "==", "member").get(),
  db.collection("organizations").get(),
]);
const remainingMembers = verifiedUsers.docs.filter(
  (document) =>
    document.data().cooperativeId !== PREGO_COOPERATIVE_ID ||
    document.data().nh_org_id !== PREGO_COOPERATIVE_ID,
);
const memberUidSet = new Set(verifiedUsers.docs.map((document) => document.id));
const activeMemberUidSet = new Set(
  verifiedUsers.docs
    .filter((document) => document.data().status === "active")
    .map((document) => document.id),
);
const residualOrganizationLinks = verifiedOrganizations.docs.flatMap(
  (document) =>
    document.id === PREGO_COOPERATIVE_ID
      ? []
      : (Array.isArray(document.data().users) ? document.data().users : [])
          .filter((uid) => memberUidSet.has(uid))
          .map((uid) => `${document.id}:${uid}`),
);
const targetOrganizationUsers = new Set(
  verifiedOrganizations.docs.find(
    (document) => document.id === PREGO_COOPERATIVE_ID,
  )?.data().users ?? [],
);
const missingActiveMemberships = Array.from(activeMemberUidSet).filter(
  (uid) => !targetOrganizationUsers.has(uid),
);
const inactiveTargetMemberships = Array.from(targetOrganizationUsers).filter(
  (uid) => memberUidSet.has(uid) && !activeMemberUidSet.has(uid),
);
if (
  remainingMembers.length ||
  residualOrganizationLinks.length ||
  missingActiveMemberships.length ||
  inactiveTargetMemberships.length
) {
  throw new Error(
    `verification_failed:members=${remainingMembers.length}:organizationLinks=${residualOrganizationLinks.length}:missingActive=${missingActiveMemberships.length}:inactiveTarget=${inactiveTargetMemberships.length}`,
  );
}
console.log(
  `member-affiliation-reassignment-completed:migrationId=${migrationId}`,
);
