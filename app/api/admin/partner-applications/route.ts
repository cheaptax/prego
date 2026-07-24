import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requirePermission,
} from "@/lib/firebase/server";
import type {
  PartnerApplicationRecord,
  PartnerApplicationStatus,
} from "@/lib/firebase/schema";
import { isPartnerApplicationStatus } from "@/lib/partner-applications";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await requirePermission(req, "partners:read");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const url = new URL(req.url);
  const requestedStatus = url.searchParams.get("status");
  const status: PartnerApplicationStatus = isPartnerApplicationStatus(
    requestedStatus,
  )
    ? requestedStatus
    : "pending";
  const snapshot = await adminDb()
    .collection("partnerApplications")
    .where("status", "==", status)
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  return NextResponse.json({
    ok: true,
    applications: snapshot.docs.map((doc) => ({
      ...(doc.data() as PartnerApplicationRecord),
      id: doc.id,
    })),
  });
}
