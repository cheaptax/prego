import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { partitionAdminDashboardData } from "@/lib/admin/dashboard-classification";
import type {
  AnswerRatingRecord,
  AnswerRecord,
  AnswerViewRecord,
  ConsultRequestRecord,
  OrganizationRecord,
  PointLedgerRecord,
  UserRecord,
} from "@/lib/firebase/schema";

const baseUser = {
  name: "담당자",
  phone: "01000000000",
  role: "member",
  status: "active",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
} as const;

describe("administrator dashboard data classification", () => {
  it("excludes historical request snapshots when their owner is now test data", () => {
    const testUser = {
      ...baseUser,
      uid: "test-user",
      email: "old-dummy@example.com",
      cooperativeId: "demo-prego",
      cooperativeName: "프레고농협",
      dataClassification: "DEMO",
    } as UserRecord;
    const productionUser = {
      ...baseUser,
      uid: "production-user",
      email: "real@nonghyup.com",
      cooperativeId: "coop-001",
      cooperativeName: "서울축산농협",
      dataClassification: "PRODUCTION",
    } as UserRecord;
    const oldTestRequest = {
      id: "request-test",
      uid: testUser.uid,
      cooperativeId: "coop-001",
      cooperativeName: "서울축산농협",
      createdAt: "2026-07-01T00:00:00.000Z",
    } as ConsultRequestRecord;
    const productionRequest = {
      id: "request-production",
      uid: productionUser.uid,
      cooperativeId: "coop-001",
      cooperativeName: "서울축산농협",
      createdAt: "2026-07-02T00:00:00.000Z",
    } as ConsultRequestRecord;
    const answers = [
      { id: "answer-test", requestId: oldTestRequest.id },
      { id: "answer-production", requestId: productionRequest.id },
    ] as AnswerRecord[];
    const ratings = [
      { id: "rating-test", requestId: oldTestRequest.id, score: 5 },
      { id: "rating-production", requestId: productionRequest.id, score: 4 },
    ] as AnswerRatingRecord[];
    const answerViews = [
      { id: "view-test", requestId: oldTestRequest.id },
      { id: "view-production", requestId: productionRequest.id },
    ] as AnswerViewRecord[];
    const organizations = [
      {
        cooperativeId: "demo-prego",
        users: [testUser.uid],
        dataClassification: "DEMO",
      },
      {
        cooperativeId: "coop-001",
        users: [productionUser.uid],
        dataClassification: "PRODUCTION",
      },
      {
        cooperativeId: "orphan-old-dummy",
        users: [],
        dataClassification: "PRODUCTION",
      },
    ] as OrganizationRecord[];
    const ledger = [
      { id: "ledger-test", userId: testUser.uid },
      { id: "ledger-production", userId: productionUser.uid },
    ] as PointLedgerRecord[];

    const result = partitionAdminDashboardData({
      users: [testUser, productionUser],
      requests: [oldTestRequest, productionRequest],
      answers,
      ratings,
      answerViews,
      organizations,
      ledger,
      pointTransactions: [],
      auditLogs: [],
    });

    assert.deepEqual(
      result.production.requests.map((request) => request.id),
      ["request-production"],
    );
    assert.deepEqual(
      result.production.answers.map((answer) => answer.id),
      ["answer-production"],
    );
    assert.deepEqual(
      result.production.organizations.map(
        (organization) => organization.cooperativeId,
      ),
      ["coop-001"],
    );
    assert.deepEqual(
      result.test.requests.map((request) => request.id),
      ["request-test"],
    );
    assert.deepEqual(
      result.test.ratings.map((rating) => rating.id),
      ["rating-test"],
    );
    assert.deepEqual(
      result.test.answerViews.map((view) => view.id),
      ["view-test"],
    );
    assert.deepEqual(
      result.test.ledger.map((entry) => entry.id),
      ["ledger-test"],
    );
  });
});
