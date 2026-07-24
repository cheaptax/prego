export const DEMO_COOPERATIVE_COLLECTION = "demoCooperativeMaster";
export const DUNGGI_COOPERATIVE_ID = "demo-dunggi-nh";
export const DUNGGI_COOPERATIVE_INTERNAL_CODE = "DEMO_DUNGGI_NH";
export const DUNGGI_TEST_SCENARIO_ID = "dunggi-signup-v1";
export const PRIGO_COOPERATIVE_ID = "demo-prigo-nh";
export const PRIGO_COOPERATIVE_INTERNAL_CODE = "DEMO_PRIGO_NH";
export const PRIGO_TEST_SCENARIO_ID = "prigo-signup-v1";
export const PREGO_COOPERATIVE_ID = "demo-prego-nh";
export const PREGO_COOPERATIVE_INTERNAL_CODE = "DEMO_PREGO_NH";
export const PREGO_TEST_SCENARIO_ID = "prego-prelaunch-dummy-v1";
export const DEMO_COOPERATIVE_SEED_ACTOR = "seed:demo-cooperative";

export type DataClassification = "PRODUCTION" | "DEMO" | "TEST";
export type CooperativeSignupStatus = "AVAILABLE" | "PENDING" | "REGISTERED";

export const TEST_COOPERATIVE_DEFINITIONS = [
  {
    cooperativeId: DUNGGI_COOPERATIVE_ID,
    cooperativeName: "둥기농협",
    internalCode: DUNGGI_COOPERATIVE_INTERNAL_CODE,
    testScenarioId: DUNGGI_TEST_SCENARIO_ID,
    address: "업무 테스트용 가상 농협",
  },
  {
    cooperativeId: PRIGO_COOPERATIVE_ID,
    cooperativeName: "프리고농협",
    internalCode: PRIGO_COOPERATIVE_INTERNAL_CODE,
    testScenarioId: PRIGO_TEST_SCENARIO_ID,
    address: "프리고 기능 테스트용 가상 농협",
  },
  {
    cooperativeId: PREGO_COOPERATIVE_ID,
    cooperativeName: "프레고농협",
    internalCode: PREGO_COOPERATIVE_INTERNAL_CODE,
    testScenarioId: PREGO_TEST_SCENARIO_ID,
    address: "배포 전 더미 계정 통합용 가상 농협",
  },
] as const;

export type TestCooperativeDefinition =
  (typeof TEST_COOPERATIVE_DEFINITIONS)[number];

export type DemoCooperativeMasterRecord = {
  schemaVersion: 1;
  cooperativeId: TestCooperativeDefinition["cooperativeId"];
  cooperativeName: TestCooperativeDefinition["cooperativeName"];
  internalCode: TestCooperativeDefinition["internalCode"];
  testScenarioId: TestCooperativeDefinition["testScenarioId"];
  cooperativeType: "지역농협";
  sido: "테스트";
  sigungu: "";
  address: string;
  status: "active";
  signupStatus: CooperativeSignupStatus;
  source: "INTERNAL_DEMO";
  isDemoInstitution: true;
  dataClassification: "DEMO";
  resettable: true;
  seedVersion: 1;
  createdAt: string;
  createdBy: typeof DEMO_COOPERATIVE_SEED_ACTOR;
  updatedAt: string;
  updatedBy: string;
};

export type CooperativeSearchItem = {
  cooperative_id: string;
  cooperative_name: string;
  cooperative_type: "지역농협" | "축협" | "품목농협";
  sido: string;
  sigungu: string;
  address: string;
  status: "active" | "pending";
  signupStatus: CooperativeSignupStatus;
  isDemoInstitution: boolean;
  dataClassification: DataClassification;
  resettable: boolean;
};

const DUNGGI_BASIC_MASTER_FIELDS = {
  schemaVersion: 1,
  cooperativeId: DUNGGI_COOPERATIVE_ID,
  cooperativeName: "둥기농협",
  internalCode: DUNGGI_COOPERATIVE_INTERNAL_CODE,
  testScenarioId: DUNGGI_TEST_SCENARIO_ID,
  cooperativeType: "지역농협",
  sido: "테스트",
  sigungu: "",
  address: "업무 테스트용 가상 농협",
  status: "active",
  source: "INTERNAL_DEMO",
  isDemoInstitution: true,
  dataClassification: "DEMO",
  resettable: true,
  seedVersion: 1,
} as const;

export function getTestCooperativeDefinition(cooperativeId: string) {
  return TEST_COOPERATIVE_DEFINITIONS.find(
    (definition) => definition.cooperativeId === cooperativeId,
  );
}

export function createTestCooperativeMaster(
  definition: TestCooperativeDefinition,
  now: string,
): DemoCooperativeMasterRecord {
  return {
    schemaVersion: 1,
    cooperativeId: definition.cooperativeId,
    cooperativeName: definition.cooperativeName,
    internalCode: definition.internalCode,
    testScenarioId: definition.testScenarioId,
    cooperativeType: "지역농협",
    sido: "테스트",
    sigungu: "",
    address: definition.address,
    status: "active",
    signupStatus: "AVAILABLE",
    source: "INTERNAL_DEMO",
    isDemoInstitution: true,
    dataClassification: "DEMO",
    resettable: true,
    seedVersion: 1,
    createdAt: now,
    createdBy: DEMO_COOPERATIVE_SEED_ACTOR,
    updatedAt: now,
    updatedBy: DEMO_COOPERATIVE_SEED_ACTOR,
  };
}

export function createDunggiCooperativeMaster(
  now: string,
): DemoCooperativeMasterRecord {
  return createTestCooperativeMaster(TEST_COOPERATIVE_DEFINITIONS[0], now);
}

export function isCooperativeSignupStatus(
  value: unknown,
): value is CooperativeSignupStatus {
  return value === "AVAILABLE" || value === "PENDING" || value === "REGISTERED";
}

export function parseDunggiCooperativeMaster(
  value: unknown,
): DemoCooperativeMasterRecord | null {
  return parseTestCooperativeMaster(value, DUNGGI_COOPERATIVE_ID);
}

export function parseTestCooperativeMaster(
  value: unknown,
  expectedCooperativeId?: string,
): DemoCooperativeMasterRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const definition = getTestCooperativeDefinition(
    String(record.cooperativeId ?? ""),
  );
  if (
    !definition ||
    (expectedCooperativeId !== undefined &&
      definition.cooperativeId !== expectedCooperativeId) ||
    record.schemaVersion !== 1 ||
    record.cooperativeName !== definition.cooperativeName ||
    record.internalCode !== definition.internalCode ||
    record.testScenarioId !== definition.testScenarioId ||
    record.cooperativeType !== "지역농협" ||
    record.status !== "active" ||
    record.source !== "INTERNAL_DEMO" ||
    record.isDemoInstitution !== true ||
    record.dataClassification !== "DEMO" ||
    record.resettable !== true ||
    record.seedVersion !== 1 ||
    !isCooperativeSignupStatus(record.signupStatus) ||
    typeof record.sido !== "string" ||
    typeof record.sigungu !== "string" ||
    typeof record.address !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.createdBy !== "string" ||
    typeof record.updatedAt !== "string" ||
    typeof record.updatedBy !== "string"
  ) {
    return null;
  }
  return record as DemoCooperativeMasterRecord;
}

export function toDemoCooperativeSearchItem(
  record: DemoCooperativeMasterRecord,
): CooperativeSearchItem {
  return {
    cooperative_id: record.cooperativeId,
    cooperative_name: record.cooperativeName,
    cooperative_type: record.cooperativeType,
    sido: record.sido,
    sigungu: record.sigungu,
    address: record.address,
    status: record.status,
    signupStatus: record.signupStatus,
    isDemoInstitution: true,
    dataClassification: "DEMO",
    resettable: record.resettable,
  };
}

export function toRealCooperativeSearchItem(record: {
  cooperative_id: string;
  cooperative_name: string;
  cooperative_type: "지역농협" | "축협" | "품목농협";
  sido: string;
  sigungu: string;
  address: string;
  status: "active" | "pending";
}): CooperativeSearchItem {
  return {
    ...record,
    signupStatus: "AVAILABLE",
    isDemoInstitution: false,
    dataClassification: "PRODUCTION",
    resettable: false,
  };
}

export function searchCooperativeCatalog(
  cooperatives: readonly CooperativeSearchItem[],
  rawQuery: string,
  limit = 10,
) {
  const normalize = (value: string) =>
    value.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, "");
  const query = normalize(rawQuery);
  if (!query) return [];
  return cooperatives
    .filter(
      (item) =>
        item.status === "active" &&
        (normalize(item.cooperative_name).includes(query) ||
          normalize(`${item.sido} ${item.sigungu}`).includes(query)),
    )
    .slice(0, limit);
}

export function isCooperativeSelectableForSignup(
  cooperative: CooperativeSearchItem,
) {
  return cooperative.status === "active";
}

export function nextDemoSignupStatus(
  current: CooperativeSignupStatus,
  event: "SUBMITTED" | "APPROVED",
): CooperativeSignupStatus {
  if (event === "APPROVED") return "REGISTERED";
  return current === "REGISTERED" ? "REGISTERED" : "PENDING";
}

export function isExistingSignupForCooperative(
  existing: { cooperativeId?: string } | null,
  cooperativeId: string,
) {
  return existing?.cooperativeId === cooperativeId;
}

type SeedPlan =
  | {
      action: "create";
      write: DemoCooperativeMasterRecord;
      preservedFields: string[];
    }
  | {
      action: "update";
      write: Partial<DemoCooperativeMasterRecord>;
      preservedFields: string[];
    }
  | {
      action: "noop";
      write: Record<string, never>;
      preservedFields: string[];
    };

const PRESERVED_USAGE_FIELDS = [
  "signupStatus",
  "registeredAt",
  "registeredBy",
  "claimedBy",
  "ownerUid",
  "customerId",
  "tenantId",
  "membershipId",
  "registrationEmail",
] as const;

export function buildTestCooperativeSeedPlan(
  existing: Record<string, unknown> | null,
  definition: TestCooperativeDefinition,
  now: string,
): SeedPlan {
  const desired = createTestCooperativeMaster(definition, now);
  if (!existing) {
    return { action: "create", write: desired, preservedFields: [] };
  }
  if (
    (existing.cooperativeId !== undefined &&
      existing.cooperativeId !== definition.cooperativeId) ||
    (existing.internalCode !== undefined &&
      existing.internalCode !== definition.internalCode) ||
    (existing.dataClassification !== undefined &&
      existing.dataClassification !== "DEMO")
  ) {
    throw new Error("demo_cooperative_identity_conflict");
  }
  if (
    existing.signupStatus !== undefined &&
    !isCooperativeSignupStatus(existing.signupStatus)
  ) {
    throw new Error("demo_cooperative_signup_status_invalid");
  }
  const immutableUsageKeys = new Set([
    "signupStatus",
    "createdAt",
    "createdBy",
    "updatedAt",
    "updatedBy",
  ]);
  const changed = Object.entries(desired).filter(
    ([key, value]) => !immutableUsageKeys.has(key) && existing[key] !== value,
  );
  if (changed.length === 0) {
    return {
      action: "noop",
      write: {},
      preservedFields: PRESERVED_USAGE_FIELDS.filter((field) => field in existing),
    };
  }
  return {
    action: "update",
    write: {
      ...Object.fromEntries(changed),
      updatedAt: now,
      updatedBy: DEMO_COOPERATIVE_SEED_ACTOR,
    },
    preservedFields: PRESERVED_USAGE_FIELDS.filter((field) => field in existing),
  };
}

function assertExistingDunggiIdentity(existing: Record<string, unknown>) {
  if (
    existing.cooperativeId !== undefined &&
    existing.cooperativeId !== DUNGGI_COOPERATIVE_ID
  ) {
    throw new Error("demo_cooperative_id_conflict");
  }
  if (
    existing.internalCode !== undefined &&
    existing.internalCode !== DUNGGI_COOPERATIVE_INTERNAL_CODE
  ) {
    throw new Error("demo_cooperative_internal_code_conflict");
  }
  if (
    existing.dataClassification !== undefined &&
    existing.dataClassification !== "DEMO"
  ) {
    throw new Error("demo_cooperative_classification_conflict");
  }
  if (
    existing.signupStatus !== undefined &&
    !isCooperativeSignupStatus(existing.signupStatus)
  ) {
    throw new Error("demo_cooperative_signup_status_invalid");
  }
}

export function buildDunggiSeedPlan(
  existing: Record<string, unknown> | null,
  now: string,
): SeedPlan {
  if (!existing) {
    return {
      action: "create",
      write: createDunggiCooperativeMaster(now),
      preservedFields: [],
    };
  }

  assertExistingDunggiIdentity(existing);
  const changedBasicFields = Object.entries(DUNGGI_BASIC_MASTER_FIELDS).filter(
    ([key, value]) => existing[key] !== value,
  );
  if (changedBasicFields.length === 0) {
    return {
      action: "noop",
      write: {},
      preservedFields: PRESERVED_USAGE_FIELDS.filter(
        (field) => field in existing,
      ),
    };
  }

  const write = Object.fromEntries(changedBasicFields) as Partial<
    DemoCooperativeMasterRecord
  >;
  write.updatedAt = now;
  write.updatedBy = DEMO_COOPERATIVE_SEED_ACTOR;
  return {
    action: "update",
    write,
    preservedFields: PRESERVED_USAGE_FIELDS.filter(
      (field) => field in existing,
    ),
  };
}
