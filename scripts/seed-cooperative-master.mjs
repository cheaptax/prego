/**
 * Seeds the 1,109 code-managed production cooperatives into Firestore.
 * Default mode is read-only. Existing ADMIN-managed records are preserved.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  COOPERATIVE_MASTER_COLLECTION,
  COOPERATIVE_MASTER_CONFIG_COLLECTION,
  COOPERATIVE_MASTER_CONFIG_ID,
  createProductionCooperativeMaster,
  parseProductionCooperativeMaster,
} from "../lib/cooperatives/master.ts";
import { nonghyupMaster } from "../lib/platform.ts";

const ACTOR = "seed:production-cooperative-master-v1";
const BATCH_SIZE = 350;

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

function checksum(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
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
const collection = db.collection(COOPERATIVE_MASTER_COLLECTION);
const configRef = db
  .collection(COOPERATIVE_MASTER_CONFIG_COLLECTION)
  .doc(COOPERATIVE_MASTER_CONFIG_ID);
const sourceChecksum = checksum(
  nonghyupMaster.map((record) => ({
    id: record.cooperative_id,
    name: record.cooperative_name,
    type: record.cooperative_type,
    sido: record.sido,
    sigungu: record.sigungu,
    address: record.address,
    status: record.status,
    updatedAt: record.updated_at,
  })),
);
const refs = nonghyupMaster.map((record) =>
  collection.doc(record.cooperative_id),
);
const existingSnapshots = (
  await Promise.all(
    chunks(refs, BATCH_SIZE).map((group) => db.getAll(...group)),
  )
).flat();
const now = new Date().toISOString();
const plans = existingSnapshots.map((snapshot, index) => {
  const source = nonghyupMaster[index];
  const existing = snapshot.exists
    ? parseProductionCooperativeMaster(snapshot.data())
    : null;
  if (snapshot.exists && !existing) {
    throw new Error(`invalid_existing_master:${snapshot.id}`);
  }
  if (existing?.source === "ADMIN") {
    return { action: "preserve", ref: snapshot.ref, record: existing };
  }
  const record = createProductionCooperativeMaster({
    cooperativeId: source.cooperative_id,
    value: {
      cooperativeName: source.cooperative_name,
      cooperativeType: source.cooperative_type,
      sido: source.sido,
      sigungu: source.sigungu,
      address: source.address,
      status: source.status,
    },
    source: "STATIC_SEED",
    sourceUpdatedAt: source.updated_at,
    actorId: ACTOR,
    now,
    existing,
  });
  const changed =
    !existing ||
    existing.cooperativeName !== record.cooperativeName ||
    existing.cooperativeType !== record.cooperativeType ||
    existing.sido !== record.sido ||
    existing.sigungu !== record.sigungu ||
    existing.address !== record.address ||
    existing.status !== record.status ||
    existing.sourceUpdatedAt !== record.sourceUpdatedAt;
  return {
    action: !existing ? "create" : changed ? "update" : "noop",
    ref: snapshot.ref,
    record,
  };
});
const counts = plans.reduce(
  (result, plan) => {
    result[plan.action] += 1;
    return result;
  },
  { create: 0, update: 0, noop: 0, preserve: 0 },
);
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

await configRef.set(
  {
    schemaVersion: 1,
    mode: "FIRESTORE",
    status: "SEEDING",
    sourceChecksum,
    sourceRecordCount: nonghyupMaster.length,
    seededAt: now,
    seededBy: ACTOR,
    updatedAt: now,
  },
  { merge: true },
);
for (const group of chunks(
  plans.filter((plan) => ["create", "update"].includes(plan.action)),
  BATCH_SIZE,
)) {
  const batch = db.batch();
  for (const plan of group) batch.set(plan.ref, plan.record);
  await batch.commit();
}
const finalCount = (await collection.count().get()).data().count;
await configRef.set(
  {
    schemaVersion: 1,
    mode: "FIRESTORE",
    status: "ACTIVE",
    sourceChecksum,
    sourceRecordCount: finalCount,
    seededAt: now,
    seededBy: ACTOR,
    updatedAt: new Date().toISOString(),
  },
  { merge: true },
);
console.log(
  `cooperative-master-seed-completed:records=${finalCount}:checksum=${sourceChecksum}`,
);
