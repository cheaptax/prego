/**
 * Idempotent 둥기농협 master seed.
 *
 * Default mode is dry-run. Firestore writes require --apply.
 *
 * Examples:
 *   npm run seed:demo-cooperative -- --expected-project demo-dunggi-local
 *   npm run seed:demo-cooperative -- --apply --expected-project demo-dunggi-local
 */

import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  DEMO_COOPERATIVE_COLLECTION,
  DUNGGI_COOPERATIVE_ID,
  DUNGGI_COOPERATIVE_INTERNAL_CODE,
  buildDunggiSeedPlan,
} from "../../lib/cooperatives/demo-cooperative.ts";

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;
  const content = readFileSync(".env.local", "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return "";
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value.trim();
}

function parseArgs(argv) {
  const args = argv.slice(2);
  return {
    help: args.includes("--help") || args.includes("-h"),
    apply: args.includes("--apply"),
    offline: args.includes("--offline"),
    expectedProject:
      readOption(args, "--expected-project") ||
      process.env.DEMO_COOPERATIVE_SEED_EXPECTED_PROJECT_ID?.trim() ||
      "",
    productionConfirmation: readOption(args, "--confirm-production"),
  };
}

function printHelp() {
  console.log(`둥기농협 master seed

Default: dry-run (no writes)

Options:
  --apply                         Apply the previewed Firestore upsert
  --offline                       Print a create preview without connecting; never writes
  --expected-project <id>         Must match the target Firebase project
  --confirm-production <code>     Production only; code must be ${DUNGGI_COOPERATIVE_INTERNAL_CODE}
  --help                          Show this help

Production apply additionally requires:
  DEMO_COOPERATIVE_SEED_PRODUCTION_ENABLED=true

No Firebase Auth users or customer usage data are created.
`);
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function resolveEnvironment() {
  if (process.env.FIRESTORE_EMULATOR_HOST) return "emulator";
  return (
    process.env.VERCEL_ENV?.trim() ||
    process.env.NODE_ENV?.trim() ||
    "local"
  );
}

function initializeFirebase(projectId) {
  if (getApps().length) return getApps()[0];
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({ projectId });
  }
  return initializeApp({
    credential: cert({
      projectId,
      clientEmail: requiredEnv("FIREBASE_CLIENT_EMAIL"),
      privateKey: requiredEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    }),
  });
}

function safePreview(plan) {
  return {
    action: plan.action,
    documentPath: `${DEMO_COOPERATIVE_COLLECTION}/${DUNGGI_COOPERATIVE_ID}`,
    write: plan.write,
    preservedUsageFields: plan.preservedFields,
  };
}

loadLocalEnv();

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

const projectId =
  process.env.FIREBASE_PROJECT_ID?.trim() ||
  process.env.GCLOUD_PROJECT?.trim() ||
  "";
if (!projectId) {
  console.error("Missing FIREBASE_PROJECT_ID or GCLOUD_PROJECT.");
  process.exit(1);
}
if (!options.expectedProject) {
  console.error(
    "Missing expected project. Pass --expected-project <id> or set DEMO_COOPERATIVE_SEED_EXPECTED_PROJECT_ID.",
  );
  process.exit(1);
}
if (options.expectedProject !== projectId) {
  console.error(
    `Project mismatch: expected=${options.expectedProject} actual=${projectId}. Aborting.`,
  );
  process.exit(1);
}

const environment = resolveEnvironment();
const isProduction = environment === "production";
console.log(`Environment: ${options.offline ? `${environment}-offline` : environment}`);
console.log(`Target Firebase project ID: ${projectId}`);
console.log(
  `Target document: ${DEMO_COOPERATIVE_COLLECTION}/${DUNGGI_COOPERATIVE_ID}`,
);
console.log(`Mode: ${options.apply ? "apply" : "dry-run (no writes)"}`);

if (options.offline && options.apply) {
  console.error("--offline cannot be combined with --apply.");
  process.exit(1);
}

if (
  options.apply &&
  isProduction &&
  (process.env.DEMO_COOPERATIVE_SEED_PRODUCTION_ENABLED !== "true" ||
    options.productionConfirmation !== DUNGGI_COOPERATIVE_INTERNAL_CODE)
) {
  console.error(
    "Production apply requires DEMO_COOPERATIVE_SEED_PRODUCTION_ENABLED=true and exact --confirm-production code.",
  );
  process.exit(1);
}

if (options.offline) {
  const plan = buildDunggiSeedPlan(null, new Date().toISOString());
  console.log("Preview (offline; existing document was not inspected):");
  console.log(JSON.stringify(safePreview(plan), null, 2));
  console.log("Offline dry-run complete. Firestore was not contacted.");
  process.exit(0);
}

initializeFirebase(projectId);
const db = getFirestore();
const documentRef = db
  .collection(DEMO_COOPERATIVE_COLLECTION)
  .doc(DUNGGI_COOPERATIVE_ID);
const duplicateCodeQuery = db
  .collection(DEMO_COOPERATIVE_COLLECTION)
  .where("internalCode", "==", DUNGGI_COOPERATIVE_INTERNAL_CODE);

try {
  const [snapshot, duplicateCodeSnapshot] = await Promise.all([
    documentRef.get(),
    duplicateCodeQuery.get(),
  ]);
  const duplicateIds = duplicateCodeSnapshot.docs
    .map((document) => document.id)
    .filter((id) => id !== DUNGGI_COOPERATIVE_ID);
  if (duplicateIds.length > 0) {
    throw new Error(
      `demo_cooperative_internal_code_duplicate:${duplicateIds.join(",")}`,
    );
  }

  const plan = buildDunggiSeedPlan(
    snapshot.exists ? snapshot.data() ?? {} : null,
    new Date().toISOString(),
  );
  console.log("Preview:");
  console.log(JSON.stringify(safePreview(plan), null, 2));

  if (!options.apply) {
    console.log("Dry-run complete. Firestore was not modified.");
    process.exit(0);
  }

  const result = await db.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(documentRef);
    const codeSnapshot = await transaction.get(duplicateCodeQuery);
    const conflictingIds = codeSnapshot.docs
      .map((document) => document.id)
      .filter((id) => id !== DUNGGI_COOPERATIVE_ID);
    if (conflictingIds.length > 0) {
      throw new Error(
        `demo_cooperative_internal_code_duplicate:${conflictingIds.join(",")}`,
      );
    }

    const currentPlan = buildDunggiSeedPlan(
      currentSnapshot.exists ? currentSnapshot.data() ?? {} : null,
      new Date().toISOString(),
    );
    if (currentPlan.action === "create") {
      transaction.create(documentRef, currentPlan.write);
    } else if (currentPlan.action === "update") {
      transaction.set(documentRef, currentPlan.write, { merge: true });
    }
    return currentPlan;
  });

  console.log(
    `Seed complete: action=${result.action} document=${documentRef.path}`,
  );
  if (result.preservedFields.length > 0) {
    console.log(
      `Preserved usage fields: ${result.preservedFields.join(", ")}`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
