import type { CooperativeSearchItem } from "@/lib/cooperatives/demo-cooperative";

export const COOPERATIVE_MASTER_COLLECTION = "cooperativeMaster";
export const COOPERATIVE_MASTER_CONFIG_COLLECTION =
  "cooperativeMasterConfiguration";
export const COOPERATIVE_MASTER_CONFIG_ID = "current";
export const COOPERATIVE_MASTER_SCHEMA_VERSION = 1;

export type ProductionCooperativeStatus =
  | "active"
  | "pending"
  | "merged"
  | "closed";

export type ProductionCooperativeMasterRecord = {
  schemaVersion: 1;
  cooperativeId: string;
  cooperativeName: string;
  cooperativeType: "지역농협" | "축협" | "품목농협";
  sido: string;
  sigungu: string;
  address: string;
  status: ProductionCooperativeStatus;
  successorCooperativeId?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  source: "STATIC_SEED" | "ADMIN";
  sourceUpdatedAt?: string;
  dataClassification: "PRODUCTION";
  isDemoInstitution: false;
  searchTokens: string[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  revision: number;
};

export type CooperativeMasterConfiguration = {
  schemaVersion: 1;
  mode: "FIRESTORE";
  status: "ACTIVE" | "SEEDING";
  sourceChecksum: string;
  sourceRecordCount: number;
  seededAt: string;
  seededBy: string;
  updatedAt: string;
};

export type CooperativeMasterInput = {
  cooperativeName: string;
  cooperativeType: ProductionCooperativeMasterRecord["cooperativeType"];
  sido: string;
  sigungu: string;
  address: string;
  status: ProductionCooperativeStatus;
  successorCooperativeId?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
};

const TYPES = new Set<ProductionCooperativeMasterRecord["cooperativeType"]>([
  "지역농협",
  "축협",
  "품목농협",
]);
const STATUSES = new Set<ProductionCooperativeStatus>([
  "active",
  "pending",
  "merged",
  "closed",
]);

export function normalizeCooperativeSearchText(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/gu, "");
}

export function buildCooperativeSearchTokens(input: {
  cooperativeId: string;
  cooperativeName: string;
  sido: string;
  sigungu: string;
  address: string;
}) {
  const tokens = new Set<string>();
  for (const rawValue of [
    input.cooperativeId,
    input.cooperativeName,
    input.sido,
    input.sigungu,
    input.address,
    `${input.sido}${input.sigungu}`,
  ]) {
    const value = normalizeCooperativeSearchText(rawValue);
    if (!value) continue;
    tokens.add(value);
    for (let start = 0; start < value.length; start += 1) {
      for (
        let end = start + 1;
        end <= value.length && end - start <= 20;
        end += 1
      ) {
        tokens.add(value.slice(start, end));
        if (tokens.size >= 240) return Array.from(tokens).sort();
      }
    }
  }
  return Array.from(tokens).sort();
}

export function parseProductionCooperativeMaster(
  value: unknown,
): ProductionCooperativeMasterRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== COOPERATIVE_MASTER_SCHEMA_VERSION ||
    typeof record.cooperativeId !== "string" ||
    typeof record.cooperativeName !== "string" ||
    !TYPES.has(
      record.cooperativeType as ProductionCooperativeMasterRecord["cooperativeType"],
    ) ||
    typeof record.sido !== "string" ||
    typeof record.sigungu !== "string" ||
    typeof record.address !== "string" ||
    !STATUSES.has(record.status as ProductionCooperativeStatus) ||
    record.dataClassification !== "PRODUCTION" ||
    record.isDemoInstitution !== false ||
    !Array.isArray(record.searchTokens) ||
    typeof record.createdAt !== "string" ||
    typeof record.createdBy !== "string" ||
    typeof record.updatedAt !== "string" ||
    typeof record.updatedBy !== "string" ||
    typeof record.revision !== "number"
  ) {
    return null;
  }
  return record as ProductionCooperativeMasterRecord;
}

export function normalizeCooperativeMasterInput(
  value: unknown,
): CooperativeMasterInput | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const cooperativeName = String(record.cooperativeName ?? "")
    .trim()
    .slice(0, 120);
  const cooperativeType = String(record.cooperativeType ?? "");
  const sido = String(record.sido ?? "").trim().slice(0, 40);
  const sigungu = String(record.sigungu ?? "").trim().slice(0, 60);
  const address = String(record.address ?? "").trim().slice(0, 300);
  const status = String(record.status ?? "active");
  const successorCooperativeId = String(
    record.successorCooperativeId ?? "",
  ).trim();
  const effectiveFrom = String(record.effectiveFrom ?? "").trim();
  const effectiveTo = String(record.effectiveTo ?? "").trim();
  if (
    !cooperativeName ||
    !TYPES.has(
      cooperativeType as ProductionCooperativeMasterRecord["cooperativeType"],
    ) ||
    !STATUSES.has(status as ProductionCooperativeStatus) ||
    (status === "merged" && !successorCooperativeId)
  ) {
    return null;
  }
  return {
    cooperativeName,
    cooperativeType:
      cooperativeType as ProductionCooperativeMasterRecord["cooperativeType"],
    sido,
    sigungu,
    address,
    status: status as ProductionCooperativeStatus,
    ...(successorCooperativeId ? { successorCooperativeId } : {}),
    ...(effectiveFrom ? { effectiveFrom } : {}),
    ...(effectiveTo ? { effectiveTo } : {}),
  };
}

export function createProductionCooperativeMaster(input: {
  cooperativeId: string;
  value: CooperativeMasterInput;
  source: ProductionCooperativeMasterRecord["source"];
  sourceUpdatedAt?: string;
  actorId: string;
  now: string;
  existing?: ProductionCooperativeMasterRecord | null;
}): ProductionCooperativeMasterRecord {
  const existing = input.existing ?? null;
  const { successorCooperativeId, ...baseValue } = input.value;
  return {
    schemaVersion: COOPERATIVE_MASTER_SCHEMA_VERSION,
    cooperativeId: input.cooperativeId,
    ...baseValue,
    ...(input.value.status === "merged"
      ? { successorCooperativeId }
      : {}),
    source: input.source,
    ...(input.sourceUpdatedAt
      ? { sourceUpdatedAt: input.sourceUpdatedAt }
      : {}),
    dataClassification: "PRODUCTION",
    isDemoInstitution: false,
    searchTokens: buildCooperativeSearchTokens({
      cooperativeId: input.cooperativeId,
      cooperativeName: input.value.cooperativeName,
      sido: input.value.sido,
      sigungu: input.value.sigungu,
      address: input.value.address,
    }),
    createdAt: existing?.createdAt ?? input.now,
    createdBy: existing?.createdBy ?? input.actorId,
    updatedAt: input.now,
    updatedBy: input.actorId,
    revision: (existing?.revision ?? 0) + 1,
  };
}

export function toProductionCooperativeSearchItem(
  record: ProductionCooperativeMasterRecord,
): CooperativeSearchItem {
  return {
    cooperative_id: record.cooperativeId,
    cooperative_name: record.cooperativeName,
    cooperative_type: record.cooperativeType,
    sido: record.sido,
    sigungu: record.sigungu,
    address: record.address,
    status: record.status === "active" ? "active" : "pending",
    signupStatus: record.status === "active" ? "AVAILABLE" : "PENDING",
    isDemoInstitution: false,
    dataClassification: "PRODUCTION",
    resettable: false,
  };
}
