/**
 * Idempotently provisions the approved functional test accounts.
 * Passwords are read only from process environment and are never printed.
 */

import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const ACTOR = "script:provision-functional-test-accounts";
const CUSTOMER_SCENARIOS = [
  {
    email: "cheaptaxworld@gmail.com",
    name: "고객 전체기능 테스트",
    cooperativeId: "demo-prego-nh",
    cooperativeName: "프레고농협",
    testScenarioId: "prego-prelaunch-dummy-v1",
    status: "active",
    duty: "전체 기능",
  },
  {
    email: "cheaptax@naver.com",
    name: "고객 농협분리 테스트",
    cooperativeId: "demo-dunggi-nh",
    cooperativeName: "둥기농협",
    testScenarioId: "dunggi-signup-v1",
    status: "active",
    duty: "농협 분리",
  },
  {
    email: "requiem77k@naver.com",
    name: "고객 승인대기 테스트",
    cooperativeId: "demo-prigo-nh",
    cooperativeName: "프리고농협",
    testScenarioId: "prigo-signup-v1",
    status: "pending_cooperative_review",
    duty: "승인 대기",
  },
  {
    email: "prego.ceo@gmail.com",
    name: "고객 견적함 테스트",
    cooperativeId: "demo-prego-nh",
    cooperativeName: "프레고농협",
    testScenarioId: "prego-prelaunch-dummy-v1",
    status: "temporary_quote_member",
    duty: "견적함 전용",
  },
  {
    email: "bsmta1277@gmail.com",
    name: "고객 견적 요청 테스트",
    cooperativeId: "demo-prego-nh",
    cooperativeName: "프레고농협",
    testScenarioId: "prego-prelaunch-dummy-v1",
    status: "active",
    duty: "견적 요청",
  },
  {
    email: "bsmta@naver.com",
    name: "고객 견적 요청 테스트",
    cooperativeId: "demo-prego-nh",
    cooperativeName: "프레고농협",
    testScenarioId: "prego-prelaunch-dummy-v1",
    status: "active",
    duty: "견적 요청",
  },
];
const TEST_PARTNER_ACCOUNTS = [
  {
    email: "cheaptaxworld1@gmail.com",
  },
  {
    email: "cheaptaxworld2@gmail.com",
    // Secondary login on the same active test partner org.
    linkToContactEmail: "cheaptaxworld1@gmail.com",
    name: "제휴사 테스트 계정 2",
  },
];
const TEST_PARTNER_EMAILS = TEST_PARTNER_ACCOUNTS.map(
  (account) => account.email,
);

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;
  const content = readFileSync(".env.local", "utf8");
  for (const line of content.split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (!match || process.env[match[1]]) continue;
    if (
      match[1] === "CUSTOMER_TEST_PASSWORD" ||
      match[1] === "PARTNER_TEST_PASSWORD"
    ) {
      continue;
    }
    process.env[match[1]] = match[2].replace(/^["']|["']$/gu, "");
  }
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_environment:${name}`);
  return value;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const valueAfter = (flag) => {
    const index = args.indexOf(flag);
    if (index < 0) return "";
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing_argument:${flag}`);
    }
    return value.trim();
  };
  return {
    apply: args.includes("--apply"),
    expectedProject: valueAfter("--expected-project"),
    confirmation: valueAfter("--confirm"),
  };
}

async function authUserByEmail(auth, email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error?.code === "auth/user-not-found") return null;
    throw error;
  }
}

async function uniqueProfileByEmail(db, email) {
  const snapshot = await db
    .collection("users")
    .where("email", "==", email)
    .limit(3)
    .get();
  if (snapshot.size > 1) throw new Error(`duplicate_profile_email:${email}`);
  return snapshot.docs[0] ?? null;
}

function rootMetadata(scenario, uid, now) {
  return {
    dataClassification: "DEMO",
    sourceInstitutionId: scenario.cooperativeId,
    testScenarioId: scenario.testScenarioId,
    testMetadata: {
      scenarioId: scenario.testScenarioId,
      sourceInstitutionId: scenario.cooperativeId,
      origin: "SIGNUP",
      rootEntityId: uid,
      createdBy: ACTOR,
      createdAt: now,
    },
  };
}

loadLocalEnv();
const options = parseArgs(process.argv);
const projectId = requiredEnv("FIREBASE_PROJECT_ID");
if (!options.expectedProject || options.expectedProject !== projectId) {
  throw new Error(
    `project_mismatch:expected=${options.expectedProject || "<required>"}:actual=${projectId}`,
  );
}
const requiredConfirmation = `PROVISION_FUNCTIONAL_TEST_ACCOUNTS_${projectId}`;
if (options.apply && options.confirmation !== requiredConfirmation) {
  throw new Error(`confirmation_required:${requiredConfirmation}`);
}
if (options.apply) {
  for (const name of ["CUSTOMER_TEST_PASSWORD", "PARTNER_TEST_PASSWORD"]) {
    if (requiredEnv(name).length < 8) {
      throw new Error(`password_too_short:${name}`);
    }
  }
}

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId,
      clientEmail: requiredEnv("FIREBASE_CLIENT_EMAIL"),
      privateKey: requiredEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/gu, "\n"),
    }),
  });
}

const auth = getAuth();
const db = getFirestore();
const customerPlans = [];
for (const scenario of CUSTOMER_SCENARIOS) {
  const [authUser, profile] = await Promise.all([
    authUserByEmail(auth, scenario.email),
    uniqueProfileByEmail(db, scenario.email),
  ]);
  if (authUser && profile && authUser.uid !== profile.id) {
    throw new Error(`uid_profile_mismatch:${scenario.email}`);
  }
  if (profile && profile.data().role !== "member") {
    throw new Error(`role_conflict:${scenario.email}`);
  }
  customerPlans.push({ scenario, authUser, profile });
}

const partnerSnapshot = await db.collection("partners").get();
const partnerPlans = [];
for (const account of TEST_PARTNER_ACCOUNTS) {
  const lookupEmail = (
    account.linkToContactEmail ?? account.email
  ).toLowerCase();
  const matches = partnerSnapshot.docs.filter(
    (document) =>
      String(document.data().contactEmail ?? "").trim().toLowerCase() ===
      lookupEmail,
  );
  if (matches.length !== 1) {
    throw new Error(
      `test_partner_match_count:${account.email}:${matches.length}`,
    );
  }
  const partnerDocument = matches[0];
  const partner = partnerDocument.data();
  if (partner.status !== "active") {
    throw new Error(`test_partner_not_active:${account.email}`);
  }
  const [authUser, profile] = await Promise.all([
    authUserByEmail(auth, account.email),
    uniqueProfileByEmail(db, account.email),
  ]);
  if (authUser && profile && authUser.uid !== profile.id) {
    throw new Error(`uid_profile_mismatch:${account.email}`);
  }
  if (
    profile &&
    (profile.data().role !== "partner" ||
      profile.data().partnerId !== partnerDocument.id)
  ) {
    throw new Error(`partner_profile_conflict:${account.email}`);
  }
  partnerPlans.push({
    email: account.email,
    displayNameOverride: account.name,
    partnerDocument,
    partner,
    authUser,
    profile,
  });
}

console.log(`projectId=${projectId}`);
console.log(`mode=${options.apply ? "apply" : "dry-run"}`);
for (const plan of customerPlans) {
  console.log(
    [
      "group=customer",
      `email=${plan.scenario.email}`,
      `scenario=${plan.scenario.duty}`,
      `status=${plan.scenario.status}`,
      `auth=${plan.authUser ? "update" : "create"}`,
      `profile=${plan.profile ? "update" : "create"}`,
    ].join(" "),
  );
}
for (const plan of partnerPlans) {
  console.log(
    [
      "group=partner",
      `email=${plan.email}`,
      `partner=${String(plan.partner.displayName ?? plan.partner.name)}`,
      `auth=${plan.authUser ? "update" : "create"}`,
      `profile=${plan.profile ? "update" : "create"}`,
    ].join(" "),
  );
}
if (!options.apply) {
  console.log("dryRunComplete=true");
  process.exit(0);
}

const now = new Date().toISOString();
const customerPassword = requiredEnv("CUSTOMER_TEST_PASSWORD");
for (const plan of customerPlans) {
  const { scenario } = plan;
  const existingUid = plan.authUser?.uid ?? plan.profile?.id;
  const authUser = plan.authUser
    ? await auth.updateUser(plan.authUser.uid, {
        password: customerPassword,
        displayName: scenario.name,
        emailVerified: true,
        disabled: false,
      })
    : await auth.createUser({
        ...(existingUid ? { uid: existingUid } : {}),
        email: scenario.email,
        password: customerPassword,
        displayName: scenario.name,
        emailVerified: true,
        disabled: false,
      });
  const previousClaims = authUser.customClaims ?? {};
  if (previousClaims.admin === true || previousClaims.partner === true) {
    throw new Error(`customer_claim_conflict:${scenario.email}`);
  }
  const previousProfile = plan.profile?.data() ?? {};
  const metadata = rootMetadata(scenario, authUser.uid, now);
  const profile = {
    ...previousProfile,
    uid: authUser.uid,
    name: scenario.name,
    phone: "01063877780",
    email: scenario.email,
    cooperativeId: scenario.cooperativeId,
    nh_org_id: scenario.cooperativeId,
    cooperativeName: scenario.cooperativeName,
    position: "테스트 담당자",
    duty: scenario.duty,
    consents: {
      terms: true,
      privacy: true,
      marketing: false,
      email: false,
      sms: false,
      kakao: false,
    },
    role: "member",
    status: scenario.status,
    ...(scenario.status === "temporary_quote_member"
      ? {
          temporaryMember: {
            source: "audit_quote_request",
            sourceRequestIds: [],
            activatedAt: now,
          },
        }
      : {}),
    ...metadata,
    createdAt: previousProfile.createdAt ?? now,
    updatedAt: now,
  };
  if (scenario.status !== "temporary_quote_member") {
    delete profile.temporaryMember;
  }
  await db.collection("users").doc(authUser.uid).set(profile);
  const organizationRef = db
    .collection("organizations")
    .doc(scenario.cooperativeId);
  const organizationSnapshot = await organizationRef.get();
  const existingOrganization = organizationSnapshot.data() ?? {};
  await organizationRef.set(
      {
        cooperativeId: scenario.cooperativeId,
        nh_org_id: scenario.cooperativeId,
        cooperativeName: scenario.cooperativeName,
        users: FieldValue.arrayUnion(authUser.uid),
        dataClassification: "DEMO",
        sourceInstitutionId: scenario.cooperativeId,
        testScenarioId: scenario.testScenarioId,
        createdAt: existingOrganization.createdAt ?? now,
        updatedAt: now,
        walletBalance: existingOrganization.walletBalance ?? 500000,
      },
      { merge: true },
    );
  await db.collection("testAuthSubjects").doc(authUser.uid).set({
    authUid: authUser.uid,
    primaryUserUid: authUser.uid,
    providerIds: ["password"],
    dataClassification: "DEMO",
    sourceInstitutionId: scenario.cooperativeId,
    testScenarioId: scenario.testScenarioId,
    createdAt: now,
  });
  await auth.revokeRefreshTokens(authUser.uid);
  console.log(
    `provisioned=true group=customer email=${scenario.email} uid=${authUser.uid}`,
  );
}

const partnerPassword = requiredEnv("PARTNER_TEST_PASSWORD");
for (const plan of partnerPlans) {
  const name =
    String(plan.displayNameOverride ?? "").trim() ||
    String(plan.partner.managerName ?? "").trim() ||
    String(plan.partner.displayName ?? plan.partner.name);
  const existingUid = plan.authUser?.uid ?? plan.profile?.id;
  const authUser = plan.authUser
    ? await auth.updateUser(plan.authUser.uid, {
        password: partnerPassword,
        displayName: name,
        emailVerified: true,
        disabled: false,
      })
    : await auth.createUser({
        ...(existingUid ? { uid: existingUid } : {}),
        email: plan.email,
        password: partnerPassword,
        displayName: name,
        emailVerified: true,
        disabled: false,
      });
  const previousClaims = authUser.customClaims ?? {};
  if (previousClaims.admin === true) {
    throw new Error(`partner_claim_conflict:${plan.email}`);
  }
  await auth.setCustomUserClaims(authUser.uid, {
    ...previousClaims,
    partner: true,
    partnerId: plan.partnerDocument.id,
  });
  const previousProfile = plan.profile?.data() ?? {};
  await db
    .collection("users")
    .doc(authUser.uid)
    .set({
      ...previousProfile,
      uid: authUser.uid,
      name,
      phone: String(plan.partner.contactPhone ?? ""),
      email: plan.email,
      position: "제휴 전문가",
      duty: String(plan.partner.displayName ?? plan.partner.name),
      consents: {
        terms: true,
        privacy: true,
        marketing: false,
        email: false,
        sms: false,
        kakao: false,
      },
      role: "partner",
      partnerId: plan.partnerDocument.id,
      accountStatus: "active",
      status: "active",
      createdAt: previousProfile.createdAt ?? now,
      updatedAt: now,
    });
  await auth.revokeRefreshTokens(authUser.uid);
  console.log(
    `provisioned=true group=partner email=${plan.email} uid=${authUser.uid}`,
  );
}
console.log(
  `provisionedCount=${customerPlans.length + partnerPlans.length}`,
);
console.log("applyComplete=true");
