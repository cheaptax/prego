/**
 * Dry-run-first RBAC backfill for existing admin profiles.
 *
 * Default mode only reports admins missing adminRole. Apply mode requires an
 * explicit UID-to-role JSON map and --confirm-production; it never guesses a
 * role or changes passwords, emails, status, or custom claims.
 */

import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
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
  const roleMapIndex = args.indexOf("--role-map");
  const expectedProjectIndex = args.indexOf("--expected-project");
  const expectedProject =
    expectedProjectIndex >= 0 ? args[expectedProjectIndex + 1] : undefined;
  if (
    expectedProjectIndex >= 0 &&
    (!expectedProject || expectedProject.startsWith("--"))
  ) {
    throw new Error("--expected-project requires a project ID value.");
  }
  if (
    roleMapIndex >= 0 &&
    (!args[roleMapIndex + 1] || args[roleMapIndex + 1].startsWith("--"))
  ) {
    throw new Error("--role-map requires a JSON file path.");
  }
  return {
    help: args.includes("--help") || args.includes("-h"),
    apply: args.includes("--apply"),
    confirmProduction: args.includes("--confirm-production"),
    roleMapPath: roleMapIndex >= 0 ? args[roleMapIndex + 1] : undefined,
    expectedProject:
      expectedProject?.trim() ||
      process.env.FIREBASE_MIGRATION_EXPECTED_PROJECT_ID?.trim() ||
      "",
  };
}

const ADMIN_ROLES = new Set([
  "super_admin",
  "operations_manager",
  "partner_manager",
  "cms_editor",
  "read_only",
]);

function loadRoleMap(filePath) {
  if (!filePath) return {};
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Role map must be a JSON object keyed by Firebase UID.");
  }
  for (const [uid, role] of Object.entries(parsed)) {
    if (!uid.trim() || !ADMIN_ROLES.has(role)) {
      throw new Error(`Invalid role map entry for uid=${uid || "(empty)"}.`);
    }
  }
  return parsed;
}

loadLocalEnv();
const options = parseArgs(process.argv);
if (options.help) {
  console.log(`Admin RBAC backfill

Options:
  --role-map <path>       JSON object mapping Firebase UID to an explicit role
  --expected-project <id> Must match FIREBASE_PROJECT_ID
  --apply                 Write mapped missing adminRole fields
  --confirm-production    Required with --apply
  --help

Default mode is dry-run.
`);
  process.exit(0);
}

if (options.apply && !options.confirmProduction) {
  console.error("Refusing to write without --confirm-production.");
  process.exit(1);
}
if (options.apply && !options.roleMapPath) {
  console.error("Refusing to write without --role-map.");
  process.exit(1);
}

const roleMap = loadRoleMap(options.roleMapPath);
const projectId = requiredEnv("FIREBASE_PROJECT_ID");
if (!options.expectedProject) {
  console.error(
    "Missing expected project. Pass --expected-project <id> or set FIREBASE_MIGRATION_EXPECTED_PROJECT_ID.",
  );
  process.exit(1);
}
if (options.expectedProject !== projectId) {
  console.error(
    `Project mismatch: expected=${options.expectedProject} actual=${projectId}. Aborting.`,
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

const db = getFirestore();
const snapshot = await db.collection("users").where("role", "==", "admin").get();
const admins = snapshot.docs.map((doc) => ({ ref: doc.ref, data: doc.data() }));
const missing = admins.filter(({ data }) => !data.adminRole);

console.log(`mode=${options.apply ? "apply" : "dry-run"}`);
console.log(`projectId=${projectId}`);
console.log(`adminProfiles=${admins.length}`);
console.log(`missingAdminRole=${missing.length}`);

if (options.apply) {
  const unmapped = missing
    .map(({ ref, data }) => data.uid ?? ref.id)
    .filter((uid) => !roleMap[uid]);
  if (unmapped.length > 0) {
    console.error(`Refusing apply: missingRoleMappings=${unmapped.length}`);
    process.exit(1);
  }
}

const failures = [];
let applied = 0;
let skipped = admins.length - missing.length;
for (const { ref, data } of missing) {
  const uid = data.uid ?? ref.id;
  const adminRole = roleMap[uid];
  console.log(
    adminRole
      ? `wouldSet uid=${uid} beforeAdminRole=(missing) afterAdminRole=${adminRole}`
      : `reviewRequired uid=${uid} reason=missing_role_mapping`,
  );
  if (options.apply) {
    try {
      await ref.set(
        {
          adminRole,
          adminCapabilityAllow: Array.isArray(data.adminCapabilityAllow)
            ? data.adminCapabilityAllow
            : [],
          adminCapabilityDeny: Array.isArray(data.adminCapabilityDeny)
            ? data.adminCapabilityDeny
            : [],
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
      applied += 1;
      console.log(`applied uid=${uid} adminRole=${adminRole}`);
    } catch (error) {
      failures.push({
        uid,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`failed uid=${uid}`);
    }
  } else {
    skipped += 1;
  }
}

console.log(`applied=${applied}`);
console.log(`skipped=${skipped}`);
console.log(`failures=${failures.length}`);
for (const failure of failures) {
  console.error(`failure uid=${failure.uid} error=${failure.error}`);
}
if (failures.length > 0) process.exitCode = 1;
console.log("done");
