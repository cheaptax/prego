import {
  formatCooperativeRegion,
  searchCooperativeCatalog,
  toRealCooperativeSearchItem,
  type CooperativeSearchItem,
} from "@/lib/cooperatives/demo-cooperative";
import {
  buildCooperativeSearchTokens,
  normalizeCooperativeSearchText,
  toProductionCooperativeSearchItem,
  type ProductionCooperativeMasterRecord,
} from "@/lib/cooperatives/master";
import { nonghyupMaster } from "@/lib/platform";

export const staticProductionSearchItems: CooperativeSearchItem[] =
  nonghyupMaster.map(toRealCooperativeSearchItem);

let staticProductionByIdCache: Map<
  string,
  (typeof nonghyupMaster)[number]
> | null = null;

function staticProductionById() {
  if (!staticProductionByIdCache) {
    staticProductionByIdCache = new Map(
      nonghyupMaster.map((record) => [record.cooperative_id, record]),
    );
  }
  return staticProductionByIdCache;
}

export function isPlaceholderRegion(sido: string) {
  return !sido.trim() || sido.trim() === "전국";
}

export function applyCanonicalSearchItem(
  item: CooperativeSearchItem,
): CooperativeSearchItem {
  if (item.isDemoInstitution || !isPlaceholderRegion(item.sido)) return item;
  const fallback = staticProductionById().get(item.cooperative_id);
  if (!fallback || isPlaceholderRegion(fallback.sido)) return item;
  return {
    ...item,
    sido: fallback.sido,
    sigungu: fallback.sigungu,
    address:
      fallback.address ||
      [fallback.sido, fallback.sigungu].filter(Boolean).join(" "),
  };
}

export function applyCanonicalMasterRecord(
  record: ProductionCooperativeMasterRecord,
): ProductionCooperativeMasterRecord {
  if (record.source === "ADMIN" && !isPlaceholderRegion(record.sido)) {
    return record;
  }
  if (!isPlaceholderRegion(record.sido)) return record;
  const fallback = staticProductionById().get(record.cooperativeId);
  if (!fallback || isPlaceholderRegion(fallback.sido)) return record;
  const sido = fallback.sido;
  const sigungu = fallback.sigungu;
  const address =
    fallback.address || [sido, sigungu].filter(Boolean).join(" ");
  return {
    ...record,
    sido,
    sigungu,
    address,
    searchTokens: buildCooperativeSearchTokens({
      cooperativeId: record.cooperativeId,
      cooperativeName: record.cooperativeName,
      sido,
      sigungu,
      address,
    }),
  };
}

export function productionMasterMatchesQuery(
  record: ProductionCooperativeMasterRecord,
  rawQuery: string,
) {
  const query = normalizeCooperativeSearchText(rawQuery);
  if (!query) return true;
  return (
    normalizeCooperativeSearchText(record.cooperativeName).includes(query) ||
    normalizeCooperativeSearchText(record.cooperativeId).includes(query) ||
    normalizeCooperativeSearchText(
      formatCooperativeRegion(record),
    ).includes(query) ||
    record.searchTokens.includes(query)
  );
}

export function searchStaticProductionItems(query: string, limit = 40) {
  return searchCooperativeCatalog(staticProductionSearchItems, query, limit);
}

export function mergeProductionSearchItems(input: {
  query: string;
  limit: number;
  staticHits: readonly CooperativeSearchItem[];
  firestoreRecords: readonly ProductionCooperativeMasterRecord[];
}): CooperativeSearchItem[] {
  const firestoreById = new Map(
    input.firestoreRecords.map((record) => [record.cooperativeId, record]),
  );
  const merged: CooperativeSearchItem[] = [];
  const seen = new Set<string>();

  for (const hit of input.staticHits) {
    const record = firestoreById.get(hit.cooperative_id);
    if (record) {
      if (record.status !== "active") {
        seen.add(hit.cooperative_id);
        continue;
      }
      merged.push(
        applyCanonicalSearchItem(toProductionCooperativeSearchItem(record)),
      );
    } else {
      merged.push(applyCanonicalSearchItem(hit));
    }
    seen.add(hit.cooperative_id);
  }

  for (const record of input.firestoreRecords) {
    if (seen.has(record.cooperativeId) || record.status !== "active") continue;
    merged.push(
      applyCanonicalSearchItem(toProductionCooperativeSearchItem(record)),
    );
  }

  return searchCooperativeCatalog(merged, input.query, input.limit);
}

export function mergeAdminMasterSearchRecords(input: {
  query: string;
  firestoreRecords: readonly ProductionCooperativeMasterRecord[];
}): ProductionCooperativeMasterRecord[] {
  return input.firestoreRecords
    .map(applyCanonicalMasterRecord)
    .filter((record) => productionMasterMatchesQuery(record, input.query))
    .sort((left, right) =>
      left.cooperativeName.localeCompare(right.cooperativeName, "ko"),
    );
}
