/**
 * Idempotent seed for the three internal test cooperative masters.
 * Default mode is read-only. Production writes require an exact confirmation.
 */
import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  DEMO_COOPERATIVE_COLLECTION,
  TEST_COOPERATIVE_DEFINITIONS,
  buildTestCooperativeSeedPlan,
} from "../lib/cooperatives/demo-cooperative.ts";

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

loadLocalEnv();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
const expectedProject = option(args, "--expected-project");
const confirmation = option(args, "--confirm-production");
if (!projectId || expectedProject !== projectId) {
  throw new Error(
    `project_mismatch:expected=${expectedProject || "<required>"}:actual=${projectId || "<missing>"}`,
  );
}
if (
  apply &&
  projectId === "nong-1af31" &&
  confirmation !== "ADD_TEST_COOPERATIVES_nong-1af31"
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
const collection = db.collection(DEMO_COOPERATIVE_COLLECTION);
const refs = TEST_COOPERATIVE_DEFINITIONS.map((definition) =>
  collection.doc(definition.cooperativeId),
);
const snapshots = await Promise.all(refs.map((ref) => ref.get()));
const plans = snapshots.map((snapshot, index) => ({
  definition: TEST_COOPERATIVE_DEFINITIONS[index],
  plan: buildTestCooperativeSeedPlan(
    snapshot.exists ? snapshot.data() ?? {} : null,
    TEST_COOPERATIVE_DEFINITIONS[index],
    new Date().toISOString(),
  ),
}));

console.log(
  JSON.stringify(
    {
      mode: apply ? "APPLY" : "DRY_RUN",
      projectId,
      targets: plans.map(({ definition, plan }) => ({
        cooperativeId: definition.cooperativeId,
        cooperativeName: definition.cooperativeName,
        action: plan.action,
        preservedUsageFields: plan.preservedFields,
      })),
    },
    null,
    2,
  ),
);
if (!apply) process.exit(0);

await db.runTransaction(async (transaction) => {
  const currentSnapshots = await Promise.all(
    refs.map((ref) => transaction.get(ref)),
  );
  const duplicateSnapshots = await Promise.all(
    TEST_COOPERATIVE_DEFINITIONS.map((definition) =>
      transaction.get(
        collection.where("internalCode", "==", definition.internalCode),
      ),
    ),
  );
  const currentPlans = currentSnapshots.map((snapshot, index) => {
    const definition = TEST_COOPERATIVE_DEFINITIONS[index];
    const duplicateIds = duplicateSnapshots[index].docs
      .map((document) => document.id)
      .filter((id) => id !== definition.cooperativeId);
    if (duplicateIds.length > 0) {
      throw new Error(
        `demo_cooperative_internal_code_duplicate:${duplicateIds.join(",")}`,
      );
    }
    return buildTestCooperativeSeedPlan(
      snapshot.exists ? snapshot.data() ?? {} : null,
      definition,
      new Date().toISOString(),
    );
  });
  currentPlans.forEach((plan, index) => {
    if (plan.action === "create") transaction.create(refs[index], plan.write);
    if (plan.action === "update") {
      transaction.set(refs[index], plan.write, { merge: true });
    }
  });
});

console.log("test-cooperative-master-seed-completed");
