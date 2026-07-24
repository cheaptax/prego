import { NextResponse } from "next/server";
import { toAuditQuoteDetail } from "@/lib/audit-quote/admin";
import { AUDIT_QUOTE_REQUESTS } from "@/lib/audit-quote/collections";
import type {
  AuditQuoteRequestRecord,
  AuditQuoteStatus,
} from "@/lib/audit-quote/types";
import { withoutUndefined } from "@/lib/firebase/clean";
import { adminDb } from "@/lib/firebase/admin";
import {
  addAuditLog,
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
  writeAuditLog,
} from "@/lib/firebase/server";
import type {
  PartnerRecord,
  QuoteAssignmentRecord,
  QuoteRequestRecord,
} from "@/lib/firebase/schema";
import { isPartnerActive } from "@/lib/partners";
import {
  formatAssignedPartnerNames,
  isPartnerEligibleForAuditQuote,
  resolveExpectedAuditQuoteCount,
} from "@/lib/quotes/audit-quote-assignment";
import {
  ensureQuoteRequest,
  quoteRequestIdFor,
} from "@/lib/quotes/quote-requests";

export const runtime = "nodejs";

type Params = { params: Promise<{ requestId: string }> };
type Payload = { partnerId?: string };

const PRE_QUOTE_STATUSES = new Set<AuditQuoteStatus>([
  "received",
  "contacting",
  "qualified",
  "info_complete",
]);

async function loadActiveAssignments(quoteRequestId: string) {
  const snapshot = await adminDb()
    .collection("quoteAssignments")
    .where("quoteRequestId", "==", quoteRequestId)
    .get();
  return snapshot.docs
    .map((doc) => {
      const data = doc.data() as QuoteAssignmentRecord;
      return { ...data, id: data.id || doc.id };
    })
    .filter((item) => item.status !== "revoked")
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export async function GET(req: Request, { params }: Params) {
  try {
    await requireAdminCapability(req, "auditQuotes:read");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const { requestId } = await params;
  const db = adminDb();
  const auditSnapshot = await db
    .collection(AUDIT_QUOTE_REQUESTS)
    .doc(requestId)
    .get();
  if (!auditSnapshot.exists) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const audit = auditSnapshot.data() as AuditQuoteRequestRecord;
  const quoteRequestId = quoteRequestIdFor("audit_quote", requestId);
  const assignments = await loadActiveAssignments(quoteRequestId);

  return NextResponse.json({
    ok: true,
    quoteRequestId,
    item: toAuditQuoteDetail(audit),
    assignments,
    assignmentCount: assignments.length,
    expectedQuoteCount: resolveExpectedAuditQuoteCount(
      audit.quoteCount,
      assignments.length,
    ),
  });
}

export async function POST(req: Request, { params }: Params) {
  let admin;
  try {
    admin = await requireAdminCapability(req, "auditQuotes:write");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const { requestId } = await params;
  const body = (await req.json().catch(() => null)) as Payload | null;
  const partnerId = body?.partnerId?.trim() ?? "";
  if (!partnerId) {
    return NextResponse.json(
      { ok: false, error: "missing_partner" },
      { status: 400 },
    );
  }

  const db = adminDb();
  const auditRef = db.collection(AUDIT_QUOTE_REQUESTS).doc(requestId);
  const auditSnapshot = await auditRef.get();
  if (!auditSnapshot.exists) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const audit = auditSnapshot.data() as AuditQuoteRequestRecord;
  const partnerSnapshot = await db.collection("partners").doc(partnerId).get();
  if (!partnerSnapshot.exists) {
    return NextResponse.json(
      { ok: false, error: "partner_not_found" },
      { status: 404 },
    );
  }
  const partner = {
    ...(partnerSnapshot.data() as PartnerRecord),
    id: partnerId,
  };
  if (!isPartnerActive(partner)) {
    return NextResponse.json(
      { ok: false, error: "partner_inactive" },
      { status: 400 },
    );
  }
  if (!isPartnerEligibleForAuditQuote(partner)) {
    return NextResponse.json(
      { ok: false, error: "partner_scope_mismatch" },
      { status: 400 },
    );
  }

  const quoteRequest = await ensureQuoteRequest(db, {
    sourceType: "audit_quote",
    source: audit,
  });
  const quoteRequestId = quoteRequest.id;
  const existingAssignments = await loadActiveAssignments(quoteRequestId);
  if (existingAssignments.some((item) => item.partnerId === partnerId)) {
    return NextResponse.json(
      { ok: false, error: "partner_already_assigned" },
      { status: 409 },
    );
  }

  const assignmentRef = db
    .collection("quoteAssignments")
    .doc(`${quoteRequestId}_${partnerId}`);
  const quoteRequestRef = db.collection("quoteRequests").doc(quoteRequestId);
  const now = new Date().toISOString();
  const nextAuditStatus: AuditQuoteStatus = PRE_QUOTE_STATUSES.has(audit.status)
    ? "quotes_requested"
    : audit.status;
  const nextAssignments = [
    ...existingAssignments,
    {
      partnerId,
      partnerName: partner.displayName,
      status: "assigned" as const,
    },
  ];
  const expectedQuoteCount = resolveExpectedAuditQuoteCount(
    audit.quoteCount,
    nextAssignments.length,
  );
  const assignedTo = formatAssignedPartnerNames(nextAssignments);

  const result = await db.runTransaction(async (transaction) => {
    const [assignmentSnapshot, currentAuditSnapshot] = await Promise.all([
      transaction.get(assignmentRef),
      transaction.get(auditRef),
    ]);
    if (!currentAuditSnapshot.exists) {
      return { ok: false as const, error: "not_found" };
    }
    const previous = assignmentSnapshot.exists
      ? (assignmentSnapshot.data() as QuoteAssignmentRecord)
      : null;
    if (previous && previous.status !== "revoked") {
      return { ok: false as const, error: "partner_already_assigned" };
    }
    const assignment: QuoteAssignmentRecord = withoutUndefined({
      id: assignmentRef.id,
      quoteRequestId,
      partnerId,
      partnerName: partner.displayName,
      status: "assigned",
      assignedBy: admin.uid,
      assignedByEmail: admin.email,
      assignedAt: now,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    } satisfies QuoteAssignmentRecord);

    transaction.set(assignmentRef, assignment, { merge: true });
    transaction.set(
      quoteRequestRef,
      {
        status: "assigned",
        expectedQuoteCount,
        supportField: "감사",
        updatedAt: now,
      } satisfies Partial<QuoteRequestRecord>,
      { merge: true },
    );
    transaction.set(
      auditRef,
      withoutUndefined({
        assignedTo,
        status: nextAuditStatus,
        quoteCount: expectedQuoteCount,
        updatedAt: now,
      }),
      { merge: true },
    );
    writeAuditLog(transaction, db, {
      actorUid: admin.uid,
      actorEmail: admin.email,
      action: "audit_quote.partner_assigned",
      targetType: "auditQuote",
      targetId: requestId,
      metadata: {
        partnerId,
        partnerName: partner.displayName,
        quoteRequestId,
        assignmentId: assignment.id,
        assignmentCount: nextAssignments.length,
        expectedQuoteCount,
      },
      createdAt: now,
    });
    return { ok: true as const, assignment };
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      {
        status:
          result.error === "partner_already_assigned"
            ? 409
            : result.error === "not_found"
              ? 404
              : 400,
      },
    );
  }

  const updatedAudit = (
    await auditRef.get()
  ).data() as AuditQuoteRequestRecord;
  const assignments = await loadActiveAssignments(quoteRequestId);
  return NextResponse.json({
    ok: true,
    item: toAuditQuoteDetail(updatedAudit),
    quoteRequestId,
    assignment: result.assignment,
    assignments,
    assignmentCount: assignments.length,
    expectedQuoteCount,
  });
}

export async function DELETE(req: Request, { params }: Params) {
  let admin;
  try {
    admin = await requireAdminCapability(req, "auditQuotes:write");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const { requestId } = await params;
  const partnerId = new URL(req.url).searchParams.get("partnerId")?.trim();
  if (!partnerId) {
    return NextResponse.json(
      { ok: false, error: "missing_partner" },
      { status: 400 },
    );
  }

  const db = adminDb();
  const quoteRequestId = quoteRequestIdFor("audit_quote", requestId);
  const assignmentRef = db
    .collection("quoteAssignments")
    .doc(`${quoteRequestId}_${partnerId}`);
  const now = new Date().toISOString();
  await assignmentRef.set(
    {
      status: "revoked",
      revokedBy: admin.uid,
      revokedAt: now,
      updatedAt: now,
    } satisfies Partial<QuoteAssignmentRecord>,
    { merge: true },
  );

  const remaining = await loadActiveAssignments(quoteRequestId);
  const auditRef = db.collection(AUDIT_QUOTE_REQUESTS).doc(requestId);
  const auditSnapshot = await auditRef.get();
  const audit = auditSnapshot.exists
    ? (auditSnapshot.data() as AuditQuoteRequestRecord)
    : null;
  const expectedQuoteCount = resolveExpectedAuditQuoteCount(
    audit?.quoteCount ?? remaining.length,
    remaining.length,
  );
  await auditRef.set(
    withoutUndefined({
      assignedTo: formatAssignedPartnerNames(remaining) || null,
      quoteCount: Math.max(expectedQuoteCount, remaining.length),
      updatedAt: now,
    }),
    { merge: true },
  );
  await db.collection("quoteRequests").doc(quoteRequestId).set(
    {
      expectedQuoteCount,
      status: remaining.length > 0 ? "assigned" : "requested",
      updatedAt: now,
    } satisfies Partial<QuoteRequestRecord>,
    { merge: true },
  );
  await addAuditLog(db, {
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: "audit_quote.partner_unassigned",
    targetType: "auditQuote",
    targetId: requestId,
    metadata: {
      partnerId,
      quoteRequestId,
      assignmentCount: remaining.length,
    },
    createdAt: now,
  });

  return NextResponse.json({
    ok: true,
    assignments: remaining,
    assignmentCount: remaining.length,
    expectedQuoteCount,
  });
}
