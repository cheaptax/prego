import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import {
  COOPERATIVE_MASTER_COLLECTION,
  COOPERATIVE_MASTER_CONFIG_COLLECTION,
  COOPERATIVE_MASTER_CONFIG_ID,
  createProductionCooperativeMaster,
  parseProductionCooperativeMaster,
  type ProductionCooperativeMasterRecord,
} from "@/lib/cooperatives/master";
import { nonghyupMaster } from "@/lib/platform";

export const STATIC_COOPERATIVE_MASTER_ACTOR =
  "seed:production-cooperative-master-v1";
export const STATIC_MASTER_SYNC_BATCH_SIZE = 350;

export type StaticMasterSyncAction = "create" | "update" | "noop" | "preserve";

export type StaticMasterSyncPlan = {
  action: StaticMasterSyncAction;
  cooperativeId: string;
  record: ProductionCooperativeMasterRecord;
};

export function staticCooperativeMasterChecksum(
  records: typeof nonghyupMaster = nonghyupMaster,
) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        records.map((record) => ({
          id: record.cooperative_id,
          name: record.cooperative_name,
          type: record.cooperative_type,
          sido: record.sido,
          sigungu: record.sigungu,
          address: record.address,
          status: record.status,
          updatedAt: record.updated_at,
        })),
      ),
    )
    .digest("hex");
}

export function chunkValues<T>(values: readonly T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export function planStaticCooperativeMasterSync(input: {
  existingById: Map<string, ProductionCooperativeMasterRecord | null>;
  now: string;
  actorId?: string;
}): StaticMasterSyncPlan[] {
  const actorId = input.actorId ?? STATIC_COOPERATIVE_MASTER_ACTOR;
  return nonghyupMaster.map((source) => {
    const existing = input.existingById.get(source.cooperative_id) ?? null;
    if (existing?.source === "ADMIN") {
      return {
        action: "preserve" as const,
        cooperativeId: source.cooperative_id,
        record: existing,
      };
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
      actorId,
      now: input.now,
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
      action: (!existing ? "create" : changed ? "update" : "noop") as
        | "create"
        | "update"
        | "noop",
      cooperativeId: source.cooperative_id,
      record,
    };
  });
}

export function countStaticMasterSyncPlans(
  plans: readonly StaticMasterSyncPlan[],
) {
  return plans.reduce(
    (result, plan) => {
      result[plan.action] += 1;
      return result;
    },
    { create: 0, update: 0, noop: 0, preserve: 0 },
  );
}

export async function loadExistingStaticMasterRecords(
  db: Firestore,
): Promise<Map<string, ProductionCooperativeMasterRecord | null>> {
  const collection = db.collection(COOPERATIVE_MASTER_COLLECTION);
  const refs = nonghyupMaster.map((record) =>
    collection.doc(record.cooperative_id),
  );
  const snapshots = (
    await Promise.all(
      chunkValues(refs, STATIC_MASTER_SYNC_BATCH_SIZE).map((group) =>
        db.getAll(...group),
      ),
    )
  ).flat();
  const existingById = new Map<string, ProductionCooperativeMasterRecord | null>();
  snapshots.forEach((snapshot, index) => {
    const source = nonghyupMaster[index];
    if (!snapshot.exists) {
      existingById.set(source.cooperative_id, null);
      return;
    }
    const existing = parseProductionCooperativeMaster(snapshot.data());
    if (!existing) {
      throw new Error(`invalid_existing_master:${snapshot.id}`);
    }
    existingById.set(source.cooperative_id, existing);
  });
  return existingById;
}

export async function writeStaticCooperativeMasterPlans(
  db: Firestore,
  plans: readonly StaticMasterSyncPlan[],
  input: {
    now: string;
    actorId?: string;
    sourceChecksum: string;
  },
) {
  const actorId = input.actorId ?? STATIC_COOPERATIVE_MASTER_ACTOR;
  const collection = db.collection(COOPERATIVE_MASTER_COLLECTION);
  const configRef = db
    .collection(COOPERATIVE_MASTER_CONFIG_COLLECTION)
    .doc(COOPERATIVE_MASTER_CONFIG_ID);
  const writable = plans.filter((plan) =>
    ["create", "update"].includes(plan.action),
  );
  await configRef.set(
    {
      schemaVersion: 1,
      mode: "FIRESTORE",
      status: "SEEDING",
      sourceChecksum: input.sourceChecksum,
      sourceRecordCount: nonghyupMaster.length,
      seededAt: input.now,
      seededBy: actorId,
      updatedAt: input.now,
    },
    { merge: true },
  );
  for (const group of chunkValues(writable, STATIC_MASTER_SYNC_BATCH_SIZE)) {
    const batch = db.batch();
    for (const plan of group) {
      batch.set(collection.doc(plan.cooperativeId), plan.record);
    }
    await batch.commit();
  }
  const counted = collection.count
    ? (await collection.count().get()).data().count
    : nonghyupMaster.length;
  await configRef.set(
    {
      schemaVersion: 1,
      mode: "FIRESTORE",
      status: "ACTIVE",
      sourceChecksum: input.sourceChecksum,
      sourceRecordCount: counted,
      seededAt: input.now,
      seededBy: actorId,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
  return counted;
}

let syncInFlight: Promise<{
  synced: boolean;
  counts: ReturnType<typeof countStaticMasterSyncPlans>;
}> | null = null;

export async function ensureStaticCooperativeMasterSynced(db: Firestore) {
  if (syncInFlight) return syncInFlight;
  syncInFlight = runStaticCooperativeMasterSync(db).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function runStaticCooperativeMasterSync(db: Firestore) {
  const emptyCounts = { create: 0, update: 0, noop: 0, preserve: 0 };
  const configRef = db
    .collection(COOPERATIVE_MASTER_CONFIG_COLLECTION)
    .doc(COOPERATIVE_MASTER_CONFIG_ID);
  const configSnapshot = await configRef.get();
  const config = configSnapshot.data();
  if (
    !configSnapshot.exists ||
    config?.schemaVersion !== 1 ||
    config?.mode !== "FIRESTORE"
  ) {
    return { synced: false, counts: emptyCounts };
  }
  if (config.status === "SEEDING") {
    return { synced: false, counts: emptyCounts };
  }
  const sourceChecksum = staticCooperativeMasterChecksum();
  if (config.sourceChecksum === sourceChecksum) {
    return { synced: false, counts: emptyCounts };
  }
  const now = new Date().toISOString();
  const existingById = await loadExistingStaticMasterRecords(db);
  const plans = planStaticCooperativeMasterSync({ existingById, now });
  const counts = countStaticMasterSyncPlans(plans);
  if (counts.create === 0 && counts.update === 0) {
    await configRef.set(
      {
        sourceChecksum,
        updatedAt: now,
      },
      { merge: true },
    );
    return { synced: false, counts };
  }
  try {
    await writeStaticCooperativeMasterPlans(db, plans, {
      now,
      sourceChecksum,
    });
    return { synced: true, counts };
  } catch (error) {
    await configRef.set(
      {
        status: "ACTIVE",
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    throw error;
  }
}
