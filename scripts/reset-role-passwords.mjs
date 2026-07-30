/**
 * Inventory and reset role-based Firebase Auth passwords without printing them.
 *
 * Dry-run:
 *   node scripts/reset-role-passwords.mjs --expected-project <id>
 *
 * Apply:
 *   ADMIN_ROLE_PASSWORD=... PARTNER_TEST_PASSWORD=... CUSTOMER_TEST_PASSWORD=... \
 *   TEST_PARTNER_EMAILS=a@example.com,b@example.com \
 *   node scripts/reset-role-passwords.mjs --apply --expected-project <id> \
 *     --confirm RESET_ROLE_PASSWORDS_<id>
 */

import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const TEST_CUSTOMER_EMAILS = new Set([
  "cheaptaxworld@gmail.com",
  "cheaptax@naver.com",
  "requiem77k@naver.com",
  "prego.ceo@gmail.com",
  "bsmta1277@gmail.com",
  "bsmta@naver.com",
]);
const PASSWORD_ENV_BY_GROUP = {
  admin: "ADMIN_ROLE_PASSWORD",
  partner: "PARTNER_TEST_PASSWORD",
  customer: "CUSTOMER_TEST_PASSWORD",
};

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;
  const content = readFileSync(".env.local", "utf8");
  for (const line of content.split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (!match || process.env[match[1]]) continue;
    if (
      Object.values(PASSWORD_ENV_BY_GROUP).includes(match[1]) ||
      match[1] === "TEST_PARTNER_EMAILS"
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
    summaryOnly: args.includes("--summary-only"),
    expectedProject: valueAfter("--expected-project"),
    confirmation: valueAfter("--confirm"),
  };
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function configuredPartnerEmails() {
  return new Set(
    (process.env.TEST_PARTNER_EMAILS ?? "")
      .split(",")
      .map(normalizeEmail)
      .filter(Boolean),
  );
}

async function listAllAuthUsers(auth) {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

function resolveGroup(authUser, profile) {
  const claims = authUser.customClaims ?? {};
  if (profile?.role === "admin" || claims.admin === true) return "admin";
  if (profile?.role === "partner" || claims.partner === true) return "partner";
  if (profile?.role === "member") return "customer";
  return "unclassified";
}

function isTestCustomer(email, profile) {
  return TEST_CUSTOMER_EMAILS.has(email) && profile?.role === "member";
}

function targetReason(group, email, profile, partnerEmails) {
  if (group === "admin") return "all_admins";
  if (group === "partner") {
    return partnerEmails.has(email) ? "configured_test_partner" : "";
  }
  if (group === "customer" && isTestCustomer(email, profile)) {
    return "classified_test_customer";
  }
  return "";
}

loadLocalEnv();
const options = parseArgs(process.argv);
const projectId = requiredEnv("FIREBASE_PROJECT_ID");
if (!options.expectedProject || options.expectedProject !== projectId) {
  throw new Error(
    `project_mismatch:expected=${options.expectedProject || "<required>"}:actual=${projectId}`,
  );
}
const requiredConfirmation = `RESET_ROLE_PASSWORDS_${projectId}`;
if (options.apply && options.confirmation !== requiredConfirmation) {
  throw new Error(`confirmation_required:${requiredConfirmation}`);
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
const [authUsers, profileSnapshot, partnerSnapshot] = await Promise.all([
  listAllAuthUsers(auth),
  db.collection("users").get(),
  db.collection("partners").get(),
]);
const profiles = new Map(
  profileSnapshot.docs.map((document) => [document.id, document.data()]),
);
const partnerEmails = configuredPartnerEmails();
const rows = authUsers
  .map((authUser) => {
    const profile = profiles.get(authUser.uid);
    const email = normalizeEmail(authUser.email ?? profile?.email);
    const group = resolveGroup(authUser, profile);
    const reason = targetReason(group, email, profile, partnerEmails);
    return {
      uid: authUser.uid,
      email,
      group,
      status:
        profile?.accountStatus ??
        profile?.status ??
        (authUser.disabled ? "disabled" : "unknown"),
      disabled: authUser.disabled === true,
      target: Boolean(reason),
      reason,
      roleDetail:
        group === "admin"
          ? String(profile?.adminRole ?? "missing")
          : group === "partner"
            ? String(profile?.partnerId ?? "missing")
            : group === "customer"
              ? String(profile?.duty ?? profile?.cooperativeName ?? "missing")
              : "missing",
    };
  })
  .sort(
    (left, right) =>
      left.group.localeCompare(right.group) ||
      left.email.localeCompare(right.email),
  );

console.log(`projectId=${projectId}`);
console.log(`mode=${options.apply ? "apply" : "dry-run"}`);
console.log(`authUsers=${authUsers.length}`);
console.log(`profiles=${profiles.size}`);
console.log(`partners=${partnerSnapshot.size}`);
for (const row of rows.filter(
  (candidate) =>
    !options.summaryOnly ||
    candidate.target ||
    candidate.group === "admin" ||
    candidate.group === "partner" ||
    TEST_CUSTOMER_EMAILS.has(candidate.email),
)) {
  console.log(
    [
      `group=${row.group}`,
      `email=${row.email || "<missing>"}`,
      `uid=${row.uid}`,
      `status=${row.status}`,
      `disabled=${row.disabled}`,
      `target=${row.target}`,
      `reason=${row.reason || "not_selected"}`,
      `detail=${row.roleDetail}`,
    ].join(" "),
  );
}
for (const email of [...TEST_CUSTOMER_EMAILS].sort()) {
  const account = rows.find((row) => row.email === email);
  console.log(
    `configuredTestCustomer=true email=${email} authExists=${Boolean(account)} status=${account?.status ?? "missing"}`,
  );
}

const missingAuthProfiles = [...profiles.entries()]
  .filter(([uid]) => !authUsers.some((user) => user.uid === uid))
  .map(([uid, profile]) => ({
    uid,
    email: normalizeEmail(profile.email),
    role: profile.role ?? "unknown",
  }));
for (const profile of missingAuthProfiles) {
  console.log(
    `missingAuth=true role=${profile.role} email=${profile.email || "<missing>"} uid=${profile.uid}`,
  );
}

const partnerAccountCounts = new Map();
for (const row of rows.filter((candidate) => candidate.group === "partner")) {
  const profile = profiles.get(row.uid);
  const partnerId = String(profile?.partnerId ?? "");
  if (!partnerId) continue;
  partnerAccountCounts.set(
    partnerId,
    (partnerAccountCounts.get(partnerId) ?? 0) + 1,
  );
}
for (const document of partnerSnapshot.docs) {
  const partner = document.data();
  console.log(
    [
      "partnerRecord=true",
      `id=${document.id}`,
      `displayName=${String(partner.displayName ?? partner.name ?? "<missing>")}`,
      `contactEmail=${normalizeEmail(partner.contactEmail) || "<missing>"}`,
      `status=${String(partner.status ?? "unknown")}`,
      `linkedAccounts=${partnerAccountCounts.get(document.id) ?? 0}`,
    ].join(" "),
  );
}

const targets = rows.filter((row) => row.target);
const counts = Object.fromEntries(
  ["admin", "partner", "customer"].map((group) => [
    group,
    targets.filter((row) => row.group === group).length,
  ]),
);
console.log(
  `targets=admin:${counts.admin},partner:${counts.partner},customer:${counts.customer}`,
);

if (!options.apply) {
  console.log("dryRunComplete=true");
  process.exit(0);
}

for (const group of ["admin", "partner", "customer"]) {
  if (counts[group] === 0) continue;
  const password = requiredEnv(PASSWORD_ENV_BY_GROUP[group]);
  if (password.length < 8) {
    throw new Error(`password_too_short:${PASSWORD_ENV_BY_GROUP[group]}`);
  }
}

let updated = 0;
for (const target of targets) {
  const password = requiredEnv(PASSWORD_ENV_BY_GROUP[target.group]);
  await auth.updateUser(target.uid, { password });
  await auth.revokeRefreshTokens(target.uid);
  updated += 1;
  console.log(
    `updated=true group=${target.group} email=${target.email} uid=${target.uid}`,
  );
}
console.log(`updatedCount=${updated}`);
console.log("applyComplete=true");
