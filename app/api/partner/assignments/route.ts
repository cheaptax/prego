import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requirePartner,
} from "@/lib/firebase/server";
import type {
  ConsultRequestRecord,
  PartnerAnswerDraftRecord,
  PartnerAssignmentRecord,
} from "@/lib/firebase/schema";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { profile } = await requirePartner(req);
    const partnerId = profile?.partnerId ?? "";
    const db = adminDb();
    const [assignmentSnapshot, draftSnapshot] = await Promise.all([
      db.collection("partnerAssignments").where("partnerId", "==", partnerId).get(),
      db
        .collection("partnerAnswerDrafts")
        .where("partnerId", "==", partnerId)
        .get(),
    ]);
    const assignments = assignmentSnapshot.docs
      .map((doc) => {
        const data = doc.data() as PartnerAssignmentRecord;
        return { ...data, id: data.id || doc.id };
      })
      .filter((item) => item.status !== "revoked")
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    const requestIds = Array.from(new Set(assignments.map((item) => item.requestId)));
    const requestSnapshots = await Promise.all(
      requestIds.map((requestId) =>
        db.collection("consultRequests").doc(requestId).get(),
      ),
    );
    const requests = requestSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => snapshot.data() as ConsultRequestRecord);
    const drafts = draftSnapshot.docs.map(
      (doc) => doc.data() as PartnerAnswerDraftRecord,
    );

    return NextResponse.json({
      ok: true,
      assignments,
      requests,
      drafts,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }
}
