import { NextResponse } from "next/server";
import {
  authErrorCode,
  authErrorStatus,
  requirePartner,
} from "@/lib/firebase/server";
import { adminDb } from "@/lib/firebase/admin";
import type { QuoteAssignmentRecord } from "@/lib/firebase/schema";
import { getPartnerAutomationPreset } from "@/lib/quotes/quote-automation-repository";

export const runtime = "nodejs";

type Params = { params: Promise<{ assignmentId: string }> };

export async function GET(req: Request, { params }: Params) {
  let session;
  try {
    session = await requirePartner(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }
  const { assignmentId } = await params;
  const partnerId = session.profile.partnerId as string;
  const assignmentSnap = await adminDb()
    .collection("quoteAssignments")
    .doc(assignmentId)
    .get();
  if (!assignmentSnap.exists) {
    return NextResponse.json(
      { ok: false, error: "assignment_not_found" },
      { status: 404 },
    );
  }
  const assignment = assignmentSnap.data() as QuoteAssignmentRecord;
  if (assignment.partnerId !== partnerId || assignment.status === "revoked") {
    return NextResponse.json(
      { ok: false, error: "permission_denied" },
      { status: 403 },
    );
  }
  const preset = await getPartnerAutomationPreset({
    quoteRequestId: assignment.quoteRequestId,
    partnerId,
  });
  return NextResponse.json({
    ok: true,
    preset,
  });
}
