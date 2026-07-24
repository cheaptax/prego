import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requirePartner,
} from "@/lib/firebase/server";
import type {
  QuoteAssignmentRecord,
  QuoteRecord,
  QuoteRequestRecord,
} from "@/lib/firebase/schema";
import { loadActivePartnerEvaluationConfig } from "@/lib/audit-evaluation/active-partner-config";
import { buildPartnerEvaluationForm } from "@/lib/audit-evaluation/partner-quote-form";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { profile } = await requirePartner(req);
    const partnerId = profile.partnerId as string;
    const db = adminDb();
    const [assignmentSnapshot, quoteSnapshot, evaluation] = await Promise.all([
      db.collection("quoteAssignments").where("partnerId", "==", partnerId).get(),
      db.collection("quotes").where("partnerId", "==", partnerId).get(),
      loadActivePartnerEvaluationConfig(),
    ]);
    const assignments = assignmentSnapshot.docs
      .map((doc) => {
        const data = doc.data() as QuoteAssignmentRecord;
        return { ...data, id: data.id || doc.id };
      })
      .filter((item) => item.status !== "revoked")
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    const quoteRequestIds = Array.from(
      new Set(assignments.map((assignment) => assignment.quoteRequestId)),
    );
    const requestSnapshots = await Promise.all(
      quoteRequestIds.map((id) => db.collection("quoteRequests").doc(id).get()),
    );
    return NextResponse.json({
      ok: true,
      assignments,
      quoteRequests: requestSnapshots
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => {
          const data = snapshot.data() as QuoteRequestRecord;
          return { ...data, id: data.id || snapshot.id };
        }),
      quotes: quoteSnapshot.docs.map((doc) => {
        const data = doc.data() as QuoteRecord;
        return { ...data, id: data.id || doc.id };
      }),
      auditEvaluationForm: buildPartnerEvaluationForm(
        evaluation.config,
        evaluation.source,
      ),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }
}
