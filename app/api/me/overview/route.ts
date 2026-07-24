import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  canReadRequest,
  requireActiveMember,
} from "@/lib/firebase/server";
import type {
  AnswerRatingRecord,
  AnswerRecord,
  AnswerViewRecord,
  ConsultRequestRecord,
  OrganizationRecord,
  PointLedgerRecord,
} from "@/lib/firebase/schema";

export const runtime = "nodejs";

export async function GET(req: Request) {
  let user;
  try {
    ({ profile: user } = await requireActiveMember(req));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }

  const db = adminDb();
  const profileIncomplete = false;

  let orgSnapshot;
  let requestSnapshot;
  let answerSnapshot;
  let viewSnapshot;
  let ratingSnapshot;
  let ledgerSnapshot;

  try {
    [
      orgSnapshot,
      requestSnapshot,
      answerSnapshot,
      viewSnapshot,
      ratingSnapshot,
      ledgerSnapshot,
    ] = await Promise.all([
      user.cooperativeId
        ? db.collection("organizations").doc(user.cooperativeId).get()
        : Promise.resolve(null),
      db
        .collection("consultRequests")
        .orderBy("createdAt", "desc")
        .get(),
      db.collection("answers").orderBy("createdAt", "desc").get(),
      db.collection("answerViews").where("uid", "==", user.uid).get(),
      db.collection("answerRatings").where("uid", "==", user.uid).get(),
      user.cooperativeId
        ? db
            .collection("pointLedger")
            .where("cooperativeId", "==", user.cooperativeId)
            .get()
        : Promise.resolve(null),
    ]);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "overview_query_failed",
      },
      { status: 500 }
    );
  }

  const requests = requestSnapshot.docs
    .map((doc) => doc.data() as ConsultRequestRecord)
    .filter((request) => canReadRequest(request, user));
  const requestIds = new Set(requests.map((request) => request.id));
  const answers = answerSnapshot.docs
    .map((doc) => doc.data() as AnswerRecord)
    .filter((answer) => requestIds.has(answer.requestId));
  const views = Array.from(
    new Map(
      viewSnapshot.docs
        .map((doc) => doc.data() as AnswerViewRecord)
        .map((view) => [view.requestId, view])
    ).values()
  );
  const ratings = ratingSnapshot.docs.map(
    (doc) => doc.data() as AnswerRatingRecord
  );
  const organization =
    orgSnapshot && orgSnapshot.exists
      ? (orgSnapshot.data() as OrganizationRecord)
      : null;
  const ledger = ledgerSnapshot
    ? ledgerSnapshot.docs
        .map((doc) => doc.data() as PointLedgerRecord)
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    : [];

  return NextResponse.json({
    ok: true,
    profileIncomplete,
    user,
    organization,
    requests,
    answers,
    views,
    ratings,
    ledger,
  });
}
