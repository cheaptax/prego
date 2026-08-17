import {
  applyCanonicalSearchItem,
  mergeProductionSearchItems,
  staticProductionSearchItems,
} from "@/lib/cooperatives/catalog";
import { readProductionMastersForQuery } from "@/lib/cooperatives/catalog-query";
import {
  DEMO_COOPERATIVE_COLLECTION,
  TEST_COOPERATIVE_DEFINITIONS,
  createTestCooperativeMaster,
  parseTestCooperativeMaster,
  searchCooperativeCatalog,
  toDemoCooperativeSearchItem,
  type CooperativeSearchItem,
  type DemoCooperativeMasterRecord,
} from "@/lib/cooperatives/demo-cooperative";
import { adminDb } from "@/lib/firebase/admin";
import {
  COOPERATIVE_MASTER_COLLECTION,
  COOPERATIVE_MASTER_CONFIG_COLLECTION,
  COOPERATIVE_MASTER_CONFIG_ID,
  parseProductionCooperativeMaster,
  toProductionCooperativeSearchItem,
} from "@/lib/cooperatives/master";
import { ensureStaticCooperativeMasterSynced } from "@/lib/cooperatives/sync-static-master";

export type ResolvedSignupCooperative = CooperativeSearchItem & {
  masterSource:
    | "REAL_STATIC_MASTER"
    | "REAL_FIRESTORE_MASTER"
    | "DEMO_FIRESTORE";
};

const realCooperatives = staticProductionSearchItems;

export function isDemoCooperativeSignupEnabled() {
  const configured = process.env.DEMO_COOPERATIVE_SIGNUP_ENABLED?.trim();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return true;
}

async function readTestMasters(): Promise<DemoCooperativeMasterRecord[]> {
  if (!isDemoCooperativeSignupEnabled()) return [];
  const now = new Date().toISOString();
  const snapshots = await Promise.all(
    TEST_COOPERATIVE_DEFINITIONS.map((definition) =>
      adminDb()
        .collection(DEMO_COOPERATIVE_COLLECTION)
        .doc(definition.cooperativeId)
        .get(),
    ),
  );
  return TEST_COOPERATIVE_DEFINITIONS.map((definition, index) => {
    const snapshot = snapshots[index];
    if (snapshot.exists) {
      const record = parseTestCooperativeMaster(snapshot.data(), snapshot.id);
      if (record) return record;
    }
    // Firestore에 아직 시드되지 않아도 검색·선택 가능하도록 정의 기반으로 합성
    return createTestCooperativeMaster(definition, now);
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
        ...applyCanonicalSearchItem(toProductionCooperativeSearchItem(record)),
        masterSource: "REAL_FIRESTORE_MASTER",
      };
    }
  } else {
    const real = realCooperatives.find(
      (item) => item.cooperative_id === cooperativeId,
    );
    if (real) {
      return {
        ...applyCanonicalSearchItem(real),
        masterSource: "REAL_STATIC_MASTER",
      };
    }
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
  if (demo) {
    return {
      ...toDemoCooperativeSearchItem(demo),
      masterSource: "DEMO_FIRESTORE",
    };
  }
  const definition = TEST_COOPERATIVE_DEFINITIONS.find(
    (item) => item.cooperativeId === cooperativeId,
  );
  if (!definition) return null;
  return {
    ...toDemoCooperativeSearchItem(
      createTestCooperativeMaster(definition, new Date().toISOString()),
    ),
    masterSource: "DEMO_FIRESTORE",
  };
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
  let production = searchCooperativeCatalog(
    staticProductionSearchItems,
    query,
    Math.min(limit * 4, 40),
  );
  if (await usesFirestoreProductionMaster()) {
    void ensureStaticCooperativeMasterSynced(adminDb()).catch((error) => {
      console.error("Cooperative master region sync failed.", error);
    });
    const { staticHits, firestoreRecords } =
      await readProductionMastersForQuery(
        adminDb(),
        query,
        Math.min(Math.max(limit * 4, 20), 80),
      );
    production = mergeProductionSearchItems({
      query,
      limit: Math.min(limit * 4, 40),
      staticHits,
      firestoreRecords,
    });
  }
  return searchCooperativeCatalog(
    [...production, ...demo.map(toDemoCooperativeSearchItem)],
    query,
    limit,
  );
}
