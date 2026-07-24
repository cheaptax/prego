import { getTestCooperativeDefinition } from "@/lib/cooperatives/demo-cooperative";
import type {
  AnswerRatingRecord,
  AnswerRecord,
  AnswerViewRecord,
  AuditLogRecord,
  ConsultRequestRecord,
  OrganizationRecord,
  PointLedgerRecord,
  PointTransactionRecord,
  UserRecord,
} from "@/lib/firebase/schema";
import { isTestCustomerEmail } from "@/lib/test-data/email-classification";

type UnknownRecord = Record<string, unknown>;

export type AdminDashboardData = {
  users: UserRecord[];
  requests: ConsultRequestRecord[];
  answers: AnswerRecord[];
  ratings: AnswerRatingRecord[];
  answerViews: AnswerViewRecord[];
  organizations: OrganizationRecord[];
  ledger: PointLedgerRecord[];
  pointTransactions: PointTransactionRecord[];
  auditLogs: AuditLogRecord[];
};

function asUnknownRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object"
    ? (value as UnknownRecord)
    : {};
}

function hasExplicitTestMarker(value: unknown) {
  const record = asUnknownRecord(value);
  return (
    record.dataClassification === "DEMO" ||
    record.dataClassification === "TEST" ||
    record.dataClassification === "LEGACY_TEST" ||
    typeof record.testScenarioId === "string" ||
    typeof record.testMetadata === "object"
  );
}

function recordInstitutionIds(value: unknown) {
  const record = asUnknownRecord(value);
  return [
    record.cooperativeId,
    record.nh_org_id,
    record.sourceInstitutionId,
    record.institutionId,
  ].flatMap((candidate) =>
    typeof candidate === "string" && candidate ? [candidate] : [],
  );
}

function referencesTestInstitution(value: unknown) {
  return recordInstitutionIds(value).some((institutionId) =>
    Boolean(getTestCooperativeDefinition(institutionId)),
  );
}

function userIsTest(user: UserRecord) {
  return (
    hasExplicitTestMarker(user) ||
    referencesTestInstitution(user) ||
    isTestCustomerEmail(user.email)
  );
}

export function partitionAdminDashboardData(
  input: AdminDashboardData,
): {
  production: AdminDashboardData;
  test: AdminDashboardData;
} {
  const customerUsers = input.users.filter((user) => user.role === "member");
  const testUserIds = new Set(
    customerUsers.filter(userIsTest).map((user) => user.uid),
  );
  const productionUserIds = new Set(
    customerUsers
      .filter((user) => !testUserIds.has(user.uid))
      .map((user) => user.uid),
  );
  const requestIsTest = (request: ConsultRequestRecord) => {
    const record = asUnknownRecord(request);
    const ownerId =
      typeof record.uid === "string"
        ? record.uid
        : typeof record.user_id === "string"
          ? record.user_id
          : "";
    return (
      hasExplicitTestMarker(request) ||
      referencesTestInstitution(request) ||
      testUserIds.has(ownerId) ||
      isTestCustomerEmail(String(record.userEmail ?? ""))
    );
  };
  const testRequestIds = new Set(
    input.requests.filter(requestIsTest).map((request) => request.id),
  );
  const testInstitutionIds = new Set(
    input.requests
      .filter((request) => testRequestIds.has(request.id))
      .flatMap(recordInstitutionIds),
  );
  const testAnswerIds = new Set(
    input.answers
      .filter((answer) => testRequestIds.has(answer.requestId))
      .map((answer) => answer.id),
  );
  const organizationIsTest = (organization: OrganizationRecord) => {
    const memberIds = Array.isArray(organization.users)
      ? organization.users
      : [];
    const hasProductionMember = memberIds.some((uid) =>
      productionUserIds.has(uid),
    );
    return (
      hasExplicitTestMarker(organization) ||
      referencesTestInstitution(organization) ||
      (!hasProductionMember &&
        recordInstitutionIds(organization).some((institutionId) =>
          testInstitutionIds.has(institutionId),
        )) ||
      (memberIds.length > 0 &&
        memberIds.every((uid) => testUserIds.has(uid)))
    );
  };
  const productionOrganization = (organization: OrganizationRecord) =>
    !organizationIsTest(organization) &&
    organization.users?.some((uid) => productionUserIds.has(uid));
  const ledgerIsTest = (entry: PointLedgerRecord) =>
    hasExplicitTestMarker(entry) ||
    referencesTestInstitution(entry) ||
    testUserIds.has(entry.userId);
  const transactionIsTest = (entry: PointTransactionRecord) =>
    hasExplicitTestMarker(entry) ||
    referencesTestInstitution(entry) ||
    testUserIds.has(entry.user_id);
  const auditLogIsTest = (entry: AuditLogRecord) => {
    const metadata = asUnknownRecord(entry.metadata);
    return (
      testUserIds.has(entry.actorUid) ||
      testUserIds.has(entry.targetId) ||
      testRequestIds.has(entry.targetId) ||
      testAnswerIds.has(entry.targetId) ||
      recordInstitutionIds(metadata).some((institutionId) =>
        Boolean(getTestCooperativeDefinition(institutionId)),
      )
    );
  };
  const test = {
    users: customerUsers.filter((user) => testUserIds.has(user.uid)),
    requests: input.requests.filter((request) =>
      testRequestIds.has(request.id),
    ),
    answers: input.answers.filter((answer) =>
      testRequestIds.has(answer.requestId),
    ),
    ratings: input.ratings.filter((rating) =>
      testRequestIds.has(rating.requestId),
    ),
    answerViews: input.answerViews.filter((view) =>
      testRequestIds.has(view.requestId),
    ),
    organizations: input.organizations.filter(organizationIsTest),
    ledger: input.ledger.filter(ledgerIsTest),
    pointTransactions: input.pointTransactions.filter(transactionIsTest),
    auditLogs: input.auditLogs.filter(auditLogIsTest),
  };
  return {
    production: {
      users: customerUsers.filter((user) => !testUserIds.has(user.uid)),
      requests: input.requests.filter(
        (request) => !testRequestIds.has(request.id),
      ),
      answers: input.answers.filter(
        (answer) => !testRequestIds.has(answer.requestId),
      ),
      ratings: input.ratings.filter(
        (rating) => !testRequestIds.has(rating.requestId),
      ),
      answerViews: input.answerViews.filter(
        (view) => !testRequestIds.has(view.requestId),
      ),
      organizations: input.organizations.filter(productionOrganization),
      ledger: input.ledger.filter((entry) => !ledgerIsTest(entry)),
      pointTransactions: input.pointTransactions.filter(
        (entry) => !transactionIsTest(entry),
      ),
      auditLogs: input.auditLogs.filter((entry) => !auditLogIsTest(entry)),
    },
    test,
  };
}
