import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requirePermission,
} from "@/lib/firebase/server";
import type {
  QuoteAssignmentRecord,
  QuoteRequestRecord,
  QuoteRecord,
} from "@/lib/firebase/schema";
import { resolveNhAuditQuoteCompatibility } from "@/lib/quotes/nh-audit-quote-server";
import { buildAdminNhAuditQuoteViews } from "@/lib/quotes/nh-audit-admin-view";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await requirePermission(req, "inquiries:read");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }
  const url = new URL(req.url);
  const status = url.searchParams.get("status")?.trim();
  let query = adminDb()
    .collection("quoteRequests")
    .orderBy("updatedAt", "desc")
    .limit(100);
  if (status) {
    query = adminDb()
      .collection("quoteRequests")
      .where("status", "==", status)
      .orderBy("updatedAt", "desc")
      .limit(100);
  }
  const [requestSnapshot, assignmentSnapshot, quoteSnapshot] =
    await Promise.all([
      query.get(),
      adminDb().collection("quoteAssignments").limit(300).get(),
      adminDb().collection("quotes").limit(300).get(),
    ]);
  const quoteRequests = requestSnapshot.docs.map((doc) => ({
    ...(doc.data() as QuoteRequestRecord),
    id: doc.id,
  }));
  const requestById = new Map(
    quoteRequests.map((quoteRequest) => [quoteRequest.id, quoteRequest]),
  );
  const quotes = quoteSnapshot.docs.map((doc) => ({
    ...(doc.data() as QuoteRecord),
    id: doc.id,
  }));
  return NextResponse.json({
    ok: true,
    quoteRequests,
    assignments: assignmentSnapshot.docs.map((doc) => ({
      ...(doc.data() as QuoteAssignmentRecord),
      id: doc.id,
    })),
    quotes: quotes.map((quote) => {
      const quoteRequest = requestById.get(quote.quoteRequestId);
      return {
        ...quote,
        evaluationCompatibility: quoteRequest
          ? resolveNhAuditQuoteCompatibility(
              quote,
              quoteRequest.sourceType,
            )
          : null,
      };
    }),
    auditQuoteViews: buildAdminNhAuditQuoteViews(
      quotes,
      quoteRequests,
    ),
  });
}
