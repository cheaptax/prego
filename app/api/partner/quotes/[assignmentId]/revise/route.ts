import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import {
  authErrorCode,
  authErrorStatus,
  requirePartner,
  writeAuditLog,
} from "@/lib/firebase/server";
import type {
  QuoteAssignmentRecord,
  QuoteRecord,
  QuoteRequestRecord,
} from "@/lib/firebase/schema";
import {
  buildRevisionDraftFromSentQuote,
  partnerQuoteRevisionBlockReason,
  pickLatestSentQuote,
} from "@/lib/quotes/quote-revision";

export const runtime = "nodejs";

type Params = { params: Promise<{ assignmentId: string }> };

export async function POST(req: Request, { params }: Params) {
  let partnerSession;
  try {
    partnerSession = await requirePartner(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const { assignmentId } = await params;
  const partnerId = partnerSession.profile.partnerId as string;
  const db = adminDb();
  const assignmentRef = db.collection("quoteAssignments").doc(assignmentId);
  const assignmentSnapshot = await assignmentRef.get();
  if (!assignmentSnapshot.exists) {
    return NextResponse.json(
      { ok: false, error: "assignment_not_found" },
      { status: 404 },
    );
  }
  const assignment = {
    ...(assignmentSnapshot.data() as QuoteAssignmentRecord),
    id: assignmentId,
  };
  const quoteRequestSnapshot = await db
    .collection("quoteRequests")
    .doc(assignment.quoteRequestId)
    .get();
  if (!quoteRequestSnapshot.exists) {
    return NextResponse.json(
      { ok: false, error: "quote_request_not_found" },
      { status: 404 },
    );
  }
  const quoteRequest = quoteRequestSnapshot.data() as QuoteRequestRecord;
  const revisionBlock = partnerQuoteRevisionBlockReason({
    authenticatedPartnerId: partnerId,
    assignment,
    quoteRequest,
  });
  if (revisionBlock) {
    return NextResponse.json(
      { ok: false, error: revisionBlock },
      {
        status:
          revisionBlock === "permission_denied" ||
          revisionBlock === "assignment_revoked"
            ? 403
            : 409,
      },
    );
  }

  const sentSnapshot = await db
    .collection("quotes")
    .where("quoteAssignmentId", "==", assignmentId)
    .where("status", "in", ["finalized", "delivered"])
    .get();
  const latestSent = pickLatestSentQuote(
    sentSnapshot.docs.map((doc) => {
      const data = doc.data() as QuoteRecord;
      return { ...data, id: data.id || doc.id };
    }),
    assignmentId,
  );
  if (!latestSent) {
    return NextResponse.json(
      { ok: false, error: "sent_quote_not_found" },
      { status: 404 },
    );
  }

  const now = new Date().toISOString();
  const draft = withoutUndefined(
    buildRevisionDraftFromSentQuote({
      source: latestSent,
      createdBy: partnerSession.decoded.uid,
      createdByEmail: partnerSession.decoded.email,
      now,
    }),
  ) as QuoteRecord;

  try {
    await db.runTransaction(async (transaction) => {
      const currentAssignment = await transaction.get(assignmentRef);
      if (!currentAssignment.exists) {
        throw new Error("assignment_not_found");
      }
      const current = currentAssignment.data() as QuoteAssignmentRecord;
      if (current.partnerId !== partnerId) {
        throw new Error("permission_denied");
      }
      if (current.status === "revoked") {
        throw new Error("assignment_revoked");
      }
      if (["closed", "cancelled"].includes(quoteRequest.status)) {
        throw new Error("quote_request_closed");
      }
      const draftRef = db.collection("quotes").doc(draft.id);
      // Idempotent: another account may have already opened a revision.
      if (current.status === "drafting") {
        const existingDraft = await transaction.get(draftRef);
        if (!existingDraft.exists) {
          transaction.set(draftRef, draft);
        }
        return;
      }
      const block = partnerQuoteRevisionBlockReason({
        authenticatedPartnerId: partnerId,
        assignment: current,
        quoteRequest,
      });
      if (block) {
        throw new Error(block);
      }
      transaction.set(draftRef, draft);
      transaction.set(
        assignmentRef,
        {
          status: "drafting",
          updatedAt: now,
        } satisfies Partial<QuoteAssignmentRecord>,
        { merge: true },
      );
      writeAuditLog(transaction, db, {
        actorUid: partnerSession.decoded.uid,
        actorEmail: partnerSession.decoded.email,
        action: "quote.revision_opened",
        targetType: "quote",
        targetId: draft.id,
        metadata: {
          quoteAssignmentId: assignmentId,
          sourceQuoteId: latestSent.id,
          sourceVersion: latestSent.version,
        },
        createdAt: now,
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "revise_failed";
    if (message === "assignment_not_found") {
      return NextResponse.json(
        { ok: false, error: message },
        { status: 404 },
      );
    }
    if (
      [
        "permission_denied",
        "assignment_not_finalized",
        "assignment_revoked",
        "quote_request_closed",
      ].includes(message)
    ) {
      return NextResponse.json(
        { ok: false, error: message },
        {
          status:
            message === "permission_denied" || message === "assignment_revoked"
              ? 403
              : 409,
        },
      );
    }
    return NextResponse.json(
      { ok: false, error: "revise_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    quote: draft,
    assignment: {
      ...assignment,
      status: "drafting" as const,
      updatedAt: now,
    },
    sourceQuote: latestSent,
  });
}
