/**
 * Read-only pre-deploy check: admin Auth user exists with admin: true claim
 * and an active Firestore admin profile.
 * Never reads or prints passwords.
 *
 * Usage:
 *   npm run check:admin-ready -- --expected-project <projectId>
 */

import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;
  const content = readFileSync(".env.local", "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    if (match[1] === "ADMIN_PASSWORD") continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let expectedProject;
  const expectedIndex = args.indexOf("--expected-project");
  if (expectedIndex >= 0) {
    expectedProject = args[expectedIndex + 1];
    if (!expectedProject || expectedProject.startsWith("--")) {
      throw new Error("--expected-project requires a project ID value");
    }
  }
  return {
    help: args.includes("--help") || args.includes("-h"),
    expectedProject:
      expectedProject?.trim() ||
      process.env.ADMIN_SEED_EXPECTED_PROJECT_ID?.trim() ||
      "",
  };
}

loadLocalEnv();

const options = parseArgs(process.argv);
if (options.help) {
  console.log(`Read-only admin readiness check

Options:
  --expected-project <id>   Must match FIREBASE_PROJECT_ID
  --help

Exit codes:
  0  admin user ready (exists, not disabled, admin claim true, active profile)
  1  not ready or configuration error
`);
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

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId,
      clientEmail: requiredEnv("FIREBASE_CLIENT_EMAIL"),
      privateKey: requiredEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    }),
  });
}

const auth = getAuth();
const db = getFirestore();

let user;
try {
  user = await auth.getUserByEmail(adminEmail);
} catch (error) {
  const code = error && typeof error === "object" ? error.code : "";
  if (code === "auth/user-not-found") {
    console.error("NOT READY: admin user does not exist.");
    console.error(`projectId=${projectId}`);
    console.error(`email=${adminEmail}`);
    process.exit(1);
  }
  throw error;
}

const claims = user.customClaims ?? {};
const adminClaim = claims.admin === true;
const userDoc = await db.collection("users").doc(user.uid).get();
const role = userDoc.exists ? userDoc.data()?.role : undefined;
const status = userDoc.exists ? userDoc.data()?.status : undefined;
const accountStatus = userDoc.exists
  ? userDoc.data()?.accountStatus ?? status
  : undefined;
const adminRole = userDoc.exists ? userDoc.data()?.adminRole : undefined;

console.log(`projectId=${projectId}`);
console.log(`disabled=${user.disabled === true}`);
console.log(`adminClaim=${adminClaim}`);
console.log(`firestoreRole=${role ?? "(missing)"}`);
console.log(`firestoreAdminRole=${adminRole ?? "(missing)"}`);
console.log(`firestoreAccountStatus=${accountStatus ?? "(missing)"}`);
console.log(`firestoreStatus=${status ?? "(missing)"}`);

const ready =
  user.disabled !== true &&
  adminClaim === true &&
  role === "admin" &&
  accountStatus === "active" &&
  adminRole === "super_admin";

if (!ready) {
  console.error(
    "NOT READY: enable the user, ensure custom claim admin:true, and ensure users/{uid} has role=admin, explicit adminRole=super_admin, and accountStatus/status=active.",
  );
  process.exit(1);
}

console.log("READY: admin Auth user is prepared for password login + active admin profile.");
process.exit(0);
