/**
 * Seeds the 1,109 code-managed production cooperatives into Firestore.
 * Default mode is read-only. Existing ADMIN-managed records are preserved.
 */
import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { nonghyupMaster } from "../lib/platform.ts";
import {
  STATIC_COOPERATIVE_MASTER_ACTOR,
  countStaticMasterSyncPlans,
  loadExistingStaticMasterRecords,
  planStaticCooperativeMasterSync,
  staticCooperativeMasterChecksum,
  writeStaticCooperativeMasterPlans,
} from "../lib/cooperatives/sync-static-master.ts";

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
  confirmation !== "SEED_COOPERATIVE_MASTER_nong-1af31"
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
const sourceChecksum = staticCooperativeMasterChecksum();
const existingById = await loadExistingStaticMasterRecords(db);
const now = new Date().toISOString();
const plans = planStaticCooperativeMasterSync({
  existingById,
  now,
  actorId: STATIC_COOPERATIVE_MASTER_ACTOR,
});
const counts = countStaticMasterSyncPlans(plans);
console.log(
  JSON.stringify(
    {
      mode: apply ? "APPLY" : "DRY_RUN",
      projectId,
      sourceRecordCount: nonghyupMaster.length,
      sourceChecksum,
      counts,
      confirmation:
        `--apply --expected-project ${projectId} ` +
        `--confirm-production SEED_COOPERATIVE_MASTER_${projectId}`,
    },
    null,
    2,
  ),
);
if (!apply) process.exit(0);

const finalCount = await writeStaticCooperativeMasterPlans(db, plans, {
  now,
  actorId: STATIC_COOPERATIVE_MASTER_ACTOR,
  sourceChecksum,
});
console.log(
  `cooperative-master-seed-completed:records=${finalCount}:checksum=${sourceChecksum}`,
);
