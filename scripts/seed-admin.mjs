/**
 * Bootstrap / update the Firebase Auth admin user for password login.
 *
 * - Reads ADMIN_EMAIL from env (.env.local allowed).
 * - Reads ADMIN_PASSWORD only from the process environment (never from argv;
 *   .env.local is intentionally not used for ADMIN_PASSWORD).
 * - Never prints passwords or tokens.
 * - Preserves existing UID and merges custom claims (sets admin: true).
 *
 * Usage:
 *   npm run seed:admin -- --dry-run --expected-project <projectId>
 *   npm run seed:admin -- --expected-project <projectId> --confirm-production
 */

import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const MIN_PASSWORD_LENGTH = 8;
const RECOMMENDED_PASSWORD_LENGTH = 12;

function loadLocalEnv(options = { skipPassword: true }) {
  if (!existsSync(".env.local")) return;
  const content = readFileSync(".env.local", "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key]) continue;
    if (options.skipPassword && key === "ADMIN_PASSWORD") continue;
    process.env[key] = match[2].replace(/^["']|["']$/g, "");
  }
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function privateKey() {
  return requiredEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n");
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }

  let expectedProject;
  const expectedIndex = args.indexOf("--expected-project");
  if (expectedIndex >= 0) {
    expectedProject = args[expectedIndex + 1];
    if (!expectedProject || expectedProject.startsWith("--")) {
      throw new Error("--expected-project requires a project ID value");
    }
  }

  return {
    help: false,
    dryRun: args.includes("--dry-run"),
    resetPassword: args.includes("--reset-password"),
    confirmProduction: args.includes("--confirm-production"),
    expectedProject:
      expectedProject?.trim() ||
      process.env.ADMIN_SEED_EXPECTED_PROJECT_ID?.trim() ||
      "",
  };
}

function printHelp() {
  console.log(`Admin Auth seed / migration

Options:
  --dry-run                 Inspect target user/claims; no writes
  --reset-password          Reset an existing Auth user's password
  --expected-project <id>   Must match FIREBASE_PROJECT_ID (or set ADMIN_SEED_EXPECTED_PROJECT_ID)
  --confirm-production      Required for any non-dry-run write
  --help                    Show this help

Environment:
  FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
  ADMIN_EMAIL
  ADMIN_PASSWORD            Required for new users or --reset-password; set in the shell (not .env.local)
                            Minimum ${MIN_PASSWORD_LENGTH} characters (recommend ${RECOMMENDED_PASSWORD_LENGTH}+)

Examples:
  npm run seed:admin -- --dry-run --expected-project nong-1af31
  npm run seed:admin -- --expected-project nong-1af31 --confirm-production
`);
}

loadLocalEnv({ skipPassword: true });

let options;
try {
  options = parseArgs(process.argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

if (options.help) {
  printHelp();
  process.exit(0);
}

const projectId = requiredEnv("FIREBASE_PROJECT_ID");
const adminEmail = requiredEnv("ADMIN_EMAIL").toLowerCase();
const expectedProject = options.expectedProject;

if (!expectedProject) {
  console.error(
    "Missing expected project. Pass --expected-project <id> or set ADMIN_SEED_EXPECTED_PROJECT_ID.",
  );
  process.exit(1);
}

if (expectedProject !== projectId) {
  console.error(
    `Project mismatch: expected=${expectedProject} actual=${projectId}. Aborting.`,
  );
  process.exit(1);
}

console.log(`Target Firebase project ID: ${projectId}`);
console.log(`Mode: ${options.dryRun ? "dry-run (no writes)" : "apply"}`);

if (!options.dryRun && !options.confirmProduction) {
  console.error(
    "Refusing to modify accounts without --confirm-production. Use --dry-run first.",
  );
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId,
      clientEmail: requiredEnv("FIREBASE_CLIENT_EMAIL"),
      privateKey: privateKey(),
    }),
  });
}

const auth = getAuth();
const db = getFirestore();

let existingUser = null;
try {
  existingUser = await auth.getUserByEmail(adminEmail);
} catch (error) {
  const code = error && typeof error === "object" ? error.code : "";
  if (code !== "auth/user-not-found") throw error;
}

let recoverableProfile = null;
if (!existingUser) {
  const profileMatches = await db
    .collection("users")
    .where("email", "==", adminEmail)
    .limit(3)
    .get();
  const adminProfiles = profileMatches.docs.filter(
    (document) => document.data().role === "admin",
  );
  if (adminProfiles.length > 1) {
    console.error(
      "Refusing to recreate the Auth user because multiple admin profiles use ADMIN_EMAIL.",
    );
    process.exit(1);
  }
  recoverableProfile = adminProfiles[0] ?? null;
}

let adminPassword = "";
const requiresPassword =
  !options.dryRun && (!existingUser || options.resetPassword);
if (requiresPassword) {
  adminPassword = process.env.ADMIN_PASSWORD ?? "";
  if (!adminPassword) {
    console.error(
      "ADMIN_PASSWORD must be set in the shell when creating a user or using --reset-password. It is not loaded from .env.local.",
    );
    process.exit(1);
  }
  if (adminPassword.length < MIN_PASSWORD_LENGTH) {
    console.error(
      `ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
    process.exit(1);
  }
  if (adminPassword.length < RECOMMENDED_PASSWORD_LENGTH) {
    console.warn(
      `Warning: ADMIN_PASSWORD is shorter than the recommended ${RECOMMENDED_PASSWORD_LENGTH} characters.`,
    );
  }
}

if (options.dryRun) {
  if (!existingUser) {
    console.log(
      recoverableProfile
        ? "Dry-run result: Auth user does not exist (would recreate it with the existing Firestore profile UID)."
        : "Dry-run result: user does not exist (would create on apply).",
    );
    console.log(`projectId=${projectId}`);
    process.exit(0);
  }

  const claims = existingUser.customClaims ?? {};
  console.log(
    `Dry-run result: user exists (would preserve password${options.resetPassword ? " except requested reset" : ""}, role, and merge admin claim).`,
  );
  console.log(`projectId=${projectId}`);
  console.log(`disabled=${existingUser.disabled === true}`);
  console.log(`adminClaim=${claims.admin === true}`);
  const profile = await db.collection("users").doc(existingUser.uid).get();
  console.log(
    `firestoreAdminRole=${profile.data()?.adminRole ?? "(missing: would set super_admin on apply)"}`,
  );
  process.exit(0);
}

let user;
let created = false;

if (existingUser) {
  user = existingUser;
  const authUpdate = {
    emailVerified: true,
    displayName: user.displayName || "관리자",
    disabled: false,
  };
  if (options.resetPassword) authUpdate.password = adminPassword;
  await auth.updateUser(user.uid, authUpdate);
} else {
  created = true;
  user = await auth.createUser({
    ...(recoverableProfile ? { uid: recoverableProfile.id } : {}),
    email: adminEmail,
    password: adminPassword,
    emailVerified: true,
    displayName: "관리자",
    disabled: false,
  });
}

const previousClaims = user.customClaims ?? {};
const nextClaims = { ...previousClaims, admin: true };
const claimsAlreadyAdmin = previousClaims.admin === true;
const claimsUnchanged =
  claimsAlreadyAdmin &&
  JSON.stringify(previousClaims) === JSON.stringify(nextClaims);

if (!claimsUnchanged) {
  await auth.setCustomUserClaims(user.uid, nextClaims);
}

const profileRef = db.collection("users").doc(user.uid);
const profileSnapshot = await profileRef.get();
const previousProfile = profileSnapshot.data() ?? {};
const validAdminRoles = new Set([
  "super_admin",
  "operations_manager",
  "partner_manager",
  "cms_editor",
  "read_only",
]);
const preservedAdminRole = validAdminRoles.has(previousProfile.adminRole)
  ? previousProfile.adminRole
  : "super_admin";
const now = new Date().toISOString();
await profileRef.set(
  {
    uid: user.uid,
    email: adminEmail,
    name: previousProfile.name || user.displayName || "관리자",
    role: "admin",
    adminRole: preservedAdminRole,
    adminCapabilityAllow: Array.isArray(previousProfile.adminCapabilityAllow)
      ? previousProfile.adminCapabilityAllow
      : [],
    adminCapabilityDeny: Array.isArray(previousProfile.adminCapabilityDeny)
      ? previousProfile.adminCapabilityDeny
      : [],
    accountStatus: "active",
    status: "active",
    createdAt: previousProfile.createdAt || now,
    updatedAt: now,
  },
  { merge: true },
);

const refreshed = await auth.getUser(user.uid);
const finalClaims = refreshed.customClaims ?? {};

console.log("Admin seed completed.");
console.log(`projectId=${projectId}`);
console.log(`created=${created}`);
console.log(`passwordReset=${created || options.resetPassword}`);
console.log(`adminRole=${preservedAdminRole}`);
console.log(`adminClaim=${finalClaims.admin === true}`);
console.log(
  "Unset ADMIN_PASSWORD from this shell after storing it in a password manager.",
);
