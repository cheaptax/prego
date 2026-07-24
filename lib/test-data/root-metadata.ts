import {
  getTestCooperativeDefinition,
  type CooperativeSearchItem,
  type DataClassification,
} from "@/lib/cooperatives/demo-cooperative";

export type TestDataMetadata = {
  scenarioId: string;
  sourceInstitutionId: string;
  origin: "SIGNUP";
  rootEntityId: string;
  createdBy: string;
  createdAt: string;
};

export type TestDataRootFields = {
  dataClassification: DataClassification;
  sourceInstitutionId: string;
  testScenarioId: string;
  testMetadata: TestDataMetadata;
};

export type TestAuthSubjectRecord = {
  authUid: string;
  primaryUserUid: string;
  providerIds: Array<"password" | "phone">;
  dataClassification: "DEMO";
  sourceInstitutionId: string;
  testScenarioId: string;
  createdAt: string;
};

export function buildSignupRootMetadata(input: {
  cooperative: CooperativeSearchItem;
  rootEntityId: string;
  createdBy: string;
  createdAt: string;
}): TestDataRootFields | undefined {
  const definition = getTestCooperativeDefinition(
    input.cooperative.cooperative_id,
  );
  if (
    !definition ||
    input.cooperative.dataClassification !== "DEMO" ||
    input.cooperative.isDemoInstitution !== true
  ) {
    return undefined;
  }

  return {
    dataClassification: "DEMO",
    sourceInstitutionId: definition.cooperativeId,
    testScenarioId: definition.testScenarioId,
    testMetadata: {
      scenarioId: definition.testScenarioId,
      sourceInstitutionId: definition.cooperativeId,
      origin: "SIGNUP",
      rootEntityId: input.rootEntityId,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
    },
  };
}

export function inheritTestRootMetadata(
  source: Partial<TestDataRootFields>,
): Partial<TestDataRootFields> {
  if (
    source.dataClassification !== "DEMO" ||
    !source.sourceInstitutionId ||
    !source.testScenarioId ||
    getTestCooperativeDefinition(source.sourceInstitutionId)?.testScenarioId !==
      source.testScenarioId ||
    !source.testMetadata
  ) {
    return {};
  }
  return {
    dataClassification: source.dataClassification,
    sourceInstitutionId: source.sourceInstitutionId,
    testScenarioId: source.testScenarioId,
    testMetadata: source.testMetadata,
  };
}

export function buildTestAuthSubjects(input: {
  primaryUserUid: string;
  phoneAuthUid: string;
  cooperative: CooperativeSearchItem;
  createdAt: string;
}): TestAuthSubjectRecord[] {
  const definition = getTestCooperativeDefinition(
    input.cooperative.cooperative_id,
  );
  if (!definition) return [];
  const providersByUid = new Map<string, Set<"password" | "phone">>();
  providersByUid.set(input.primaryUserUid, new Set(["password"]));
  const phoneProviders =
    providersByUid.get(input.phoneAuthUid) ?? new Set<"password" | "phone">();
  phoneProviders.add("phone");
  providersByUid.set(input.phoneAuthUid, phoneProviders);

  return Array.from(providersByUid, ([authUid, providers]) => ({
    authUid,
    primaryUserUid: input.primaryUserUid,
    providerIds: Array.from(providers).sort(),
    dataClassification: "DEMO" as const,
    sourceInstitutionId: definition.cooperativeId,
    testScenarioId: definition.testScenarioId,
    createdAt: input.createdAt,
  }));
}
