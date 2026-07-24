import {
  DEMO_COOPERATIVE_COLLECTION,
  TEST_COOPERATIVE_DEFINITIONS,
  parseTestCooperativeMaster,
  searchCooperativeCatalog,
  toDemoCooperativeSearchItem,
  toRealCooperativeSearchItem,
  type CooperativeSearchItem,
  type DemoCooperativeMasterRecord,
} from "@/lib/cooperatives/demo-cooperative";
import { adminDb } from "@/lib/firebase/admin";
import { nonghyupMaster } from "@/lib/platform";
import {
  COOPERATIVE_MASTER_COLLECTION,
  COOPERATIVE_MASTER_CONFIG_COLLECTION,
  COOPERATIVE_MASTER_CONFIG_ID,
  normalizeCooperativeSearchText,
  parseProductionCooperativeMaster,
  toProductionCooperativeSearchItem,
} from "@/lib/cooperatives/master";

export type ResolvedSignupCooperative = CooperativeSearchItem & {
  masterSource:
    | "REAL_STATIC_MASTER"
    | "REAL_FIRESTORE_MASTER"
    | "DEMO_FIRESTORE";
};

const realCooperatives = nonghyupMaster.map(toRealCooperativeSearchItem);

export function isDemoCooperativeSignupEnabled() {
  const configured = process.env.DEMO_COOPERATIVE_SIGNUP_ENABLED?.trim();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return true;
}

async function readTestMasters(): Promise<DemoCooperativeMasterRecord[]> {
  if (!isDemoCooperativeSignupEnabled()) return [];
  const snapshots = await Promise.all(
    TEST_COOPERATIVE_DEFINITIONS.map((definition) =>
      adminDb()
        .collection(DEMO_COOPERATIVE_COLLECTION)
        .doc(definition.cooperativeId)
        .get(),
    ),
  );
  return snapshots.flatMap((snapshot) => {
    if (!snapshot.exists) return [];
    const record = parseTestCooperativeMaster(snapshot.data(), snapshot.id);
    return record ? [record] : [];
  });
}

async function usesFirestoreProductionMaster() {
  const snapshot = await adminDb()
    .collection(COOPERATIVE_MASTER_CONFIG_COLLECTION)
    .doc(COOPERATIVE_MASTER_CONFIG_ID)
    .get();
  const data = snapshot.data();
  return (
    snapshot.exists &&
    data?.schemaVersion === 1 &&
    data?.mode === "FIRESTORE" &&
    data?.status === "ACTIVE"
  );
}

export async function resolveSignupCooperative(
  cooperativeId: string,
): Promise<ResolvedSignupCooperative | null> {
  if (await usesFirestoreProductionMaster()) {
    const snapshot = await adminDb()
      .collection(COOPERATIVE_MASTER_COLLECTION)
      .doc(cooperativeId)
      .get();
    const record = snapshot.exists
      ? parseProductionCooperativeMaster(snapshot.data())
      : null;
    if (record?.status === "active") {
      return {
        ...toProductionCooperativeSearchItem(record),
        masterSource: "REAL_FIRESTORE_MASTER",
      };
    }
  } else {
    const real = realCooperatives.find(
      (item) => item.cooperative_id === cooperativeId,
    );
    if (real) return { ...real, masterSource: "REAL_STATIC_MASTER" };
  }
  if (
    !TEST_COOPERATIVE_DEFINITIONS.some(
      (definition) => definition.cooperativeId === cooperativeId,
    )
  ) {
    return null;
  }
  const demo = (await readTestMasters()).find(
    (record) => record.cooperativeId === cooperativeId,
  );
  return demo
    ? {
        ...toDemoCooperativeSearchItem(demo),
        masterSource: "DEMO_FIRESTORE",
      }
    : null;
}

export async function searchSignupCooperatives(
  query: string,
  limit = 10,
): Promise<CooperativeSearchItem[]> {
  let demo: DemoCooperativeMasterRecord[] = [];
  try {
    demo = await readTestMasters();
  } catch (error) {
    console.error("Demo cooperative lookup failed.", error);
  }
  let production = realCooperatives;
  if (await usesFirestoreProductionMaster()) {
    const normalized = normalizeCooperativeSearchText(query);
    production = normalized
      ? (
          await adminDb()
            .collection(COOPERATIVE_MASTER_COLLECTION)
            .where("searchTokens", "array-contains", normalized)
            .limit(Math.min(Math.max(limit * 4, 20), 100))
            .get()
        ).docs.flatMap((document) => {
          const record = parseProductionCooperativeMaster(document.data());
          return record?.status === "active"
            ? [toProductionCooperativeSearchItem(record)]
            : [];
        })
      : [];
  }
  return searchCooperativeCatalog(
    [...production, ...demo.map(toDemoCooperativeSearchItem)],
    query,
    limit,
  );
}
