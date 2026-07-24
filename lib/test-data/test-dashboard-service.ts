import type { Firestore } from "firebase-admin/firestore";
import { partitionAdminDashboardData } from "@/lib/admin/dashboard-classification";
import { adminDb } from "@/lib/firebase/admin";
import type {
  AnswerRatingRecord,
  AnswerRecord,
  AnswerViewRecord,
  ConsultRequestRecord,
  OrganizationRecord,
  PointLedgerRecord,
  PointTransactionRecord,
  UserRecord,
} from "@/lib/firebase/schema";

const DAY_MS = 24 * 60 * 60 * 1_000;

function dayKey(value: string) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? "" : new Date(time).toISOString().slice(0, 10);
}

function increment(map: Map<string, number>, key: string) {
  if (key) map.set(key, (map.get(key) ?? 0) + 1);
}

export class TestDashboardService {
  constructor(private readonly db: Firestore = adminDb()) {}

  async get(now = new Date()) {
    const [
      userSnapshot,
      requestSnapshot,
      answerSnapshot,
      ratingSnapshot,
      answerViewSnapshot,
      organizationSnapshot,
      ledgerSnapshot,
      transactionSnapshot,
    ] = await Promise.all([
      this.db.collection("users").get(),
      this.db.collection("consultRequests").get(),
      this.db.collection("answers").get(),
      this.db.collection("answerRatings").get(),
      this.db.collection("answerViews").get(),
      this.db.collection("organizations").get(),
      this.db.collection("pointLedger").get(),
      this.db.collection("point_transactions").get(),
    ]);
    const test = partitionAdminDashboardData({
      users: userSnapshot.docs.map((document) => document.data() as UserRecord),
      requests: requestSnapshot.docs.map(
        (document) => document.data() as ConsultRequestRecord,
      ),
      answers: answerSnapshot.docs.map(
        (document) => document.data() as AnswerRecord,
      ),
      ratings: ratingSnapshot.docs.map(
        (document) => document.data() as AnswerRatingRecord,
      ),
      answerViews: answerViewSnapshot.docs.map(
        (document) => document.data() as AnswerViewRecord,
      ),
      organizations: organizationSnapshot.docs.map(
        (document) => document.data() as OrganizationRecord,
      ),
      ledger: ledgerSnapshot.docs.map(
        (document) => document.data() as PointLedgerRecord,
      ),
      pointTransactions: transactionSnapshot.docs.map(
        (document) => document.data() as PointTransactionRecord,
      ),
      auditLogs: [],
    }).test;
    const answerRequestIds = new Set(
      test.answers.map((answer) => answer.requestId),
    );
    const ratingAverage = test.ratings.length
      ? test.ratings.reduce((sum, rating) => sum + rating.score, 0) /
        test.ratings.length
      : 0;
    const topCooperativeCounts = new Map<string, number>();
    for (const request of test.requests) {
      increment(
        topCooperativeCounts,
        request.cooperativeName ??
          request.cooperativeDisplay ??
          request.manualCooperativeName ??
          "소속 미지정",
      );
    }
    const start = new Date(now.getTime() - 13 * DAY_MS);
    start.setUTCHours(0, 0, 0, 0);
    const signups = new Map<string, number>();
    const requests = new Map<string, number>();
    const answers = new Map<string, number>();
    test.users.forEach((record) => increment(signups, dayKey(record.createdAt)));
    test.requests.forEach((record) =>
      increment(requests, dayKey(record.createdAt)),
    );
    test.answers.forEach((record) =>
      increment(answers, dayKey(record.createdAt)),
    );
    const daily = Array.from({ length: 14 }, (_, index) => {
      const date = new Date(start.getTime() + index * DAY_MS)
        .toISOString()
        .slice(0, 10);
      return {
        date,
        signups: signups.get(date) ?? 0,
        requests: requests.get(date) ?? 0,
        answers: answers.get(date) ?? 0,
      };
    });
    return {
      generatedAt: now.toISOString(),
      summary: {
        members: test.users.length,
        requests: test.requests.length,
        answers: test.answers.length,
        ratings: test.ratings.length,
        ratingAverage,
        answeredRequests: test.requests.filter((request) =>
          answerRequestIds.has(request.id),
        ).length,
        organizations: test.organizations.length,
        walletBalance: test.organizations.reduce(
          (sum, organization) => sum + (organization.walletBalance ?? 0),
          0,
        ),
      },
      topCooperatives: Array.from(
        topCooperativeCounts,
        ([name, count]) => ({ name, count }),
      )
        .sort((left, right) => right.count - left.count)
        .slice(0, 6),
      daily,
    };
  }
}
