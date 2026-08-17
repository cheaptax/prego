import type { Firestore } from "firebase-admin/firestore";
import { searchStaticProductionItems } from "@/lib/cooperatives/catalog";
import {
  COOPERATIVE_MASTER_COLLECTION,
  normalizeCooperativeSearchText,
  parseProductionCooperativeMaster,
  type ProductionCooperativeMasterRecord,
} from "@/lib/cooperatives/master";
import { chunkValues } from "@/lib/cooperatives/sync-static-master";

export async function readProductionMastersForQuery(
  db: Firestore,
  query: string,
  limit = 80,
) {
  const normalized = normalizeCooperativeSearchText(query);
  const staticHits = searchStaticProductionItems(query, limit);
  const records = new Map<string, ProductionCooperativeMasterRecord>();
  if (normalized) {
    const tokenSnapshot = await db
      .collection(COOPERATIVE_MASTER_COLLECTION)
      .where("searchTokens", "array-contains", normalized)
      .limit(limit)
      .get();
    for (const document of tokenSnapshot.docs) {
      const record = parseProductionCooperativeMaster(document.data());
      if (record) records.set(record.cooperativeId, record);
    }
  }
  const missing = staticHits
    .map((item) => item.cooperative_id)
    .filter((id) => !records.has(id));
  if (missing.length > 0) {
    const refs = missing.map((id) =>
      db.collection(COOPERATIVE_MASTER_COLLECTION).doc(id),
    );
    for (const group of chunkValues(refs, 100)) {
      const snapshots = await db.getAll(...group);
      for (const snapshot of snapshots) {
        if (!snapshot.exists) continue;
        const record = parseProductionCooperativeMaster(snapshot.data());
        if (record) records.set(record.cooperativeId, record);
      }
    }
  }
  return {
    staticHits,
    firestoreRecords: Array.from(records.values()),
  };
}
