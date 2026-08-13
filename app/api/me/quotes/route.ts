import { NextResponse } from "next/server";
import { AuditEvaluationCustomerAccessService } from "@/lib/audit-evaluation/customer-access-service";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requireQuoteInboxMember,
} from "@/lib/firebase/server";
import type { QuoteRecord, QuoteRequestRecord } from "@/lib/firebase/schema";
import {
  canCustomerReadQuote,
  canCustomerReadQuoteRequest,
} from "@/lib/quotes/quote-access";
import { buildCustomerQuoteComparisonGroups } from "@/lib/quotes/customer-quote-comparison";
import { resolveNhAuditQuoteCompatibility } from "@/lib/quotes/nh-audit-quote-server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  let memberSession;
  try {
    memberSession = await requireQuoteInboxMember(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }
  const { decoded } = memberSession;
  const db = adminDb();
  const email = decoded.email?.trim().toLowerCase() ?? "";
  const [byUid, byEmailDocs] = await Promise.all([
    db.collection("quoteRequests").where("customerUid", "==", decoded.uid).get(),
    email
      ? db
          .collection("quoteRequests")
          .where("customerEmail", "==", email)
          .get()
          .then((snapshot) => snapshot.docs)
      : Promise.resolve([]),
  ]);
  const quoteRequests = new Map<string, QuoteRequestRecord>();
  for (const doc of [...byUid.docs, ...byEmailDocs]) {
    const quoteRequest = {
      ...(doc.data() as QuoteRequestRecord),
      id: doc.id,
    };
    if (canCustomerReadQuoteRequest(decoded, quoteRequest)) {
      quoteRequests.set(doc.id, quoteRequest);
    }
  }
  const quoteSnapshots = await Promise.all(
    Array.from(quoteRequests.keys()).map((id) =>
      db.collection("quotes").where("quoteRequestId", "==", id).get(),
    ),
  );
  const quotes = quoteSnapshots
    .flatMap((snapshot) => snapshot.docs.map((doc) => doc.data() as QuoteRecord))
    .filter((quote) => {
      const quoteRequest = quoteRequests.get(quote.quoteRequestId);
      return quoteRequest && canCustomerReadQuote(decoded, quote, quoteRequest);
    })
    .map((quote) => {
      const quoteRequest = quoteRequests.get(quote.quoteRequestId);
      return {
        ...quote,
        evaluationCompatibility: quoteRequest
          ? resolveNhAuditQuoteCompatibility(
              quote,
              quoteRequest.sourceType,
            )
          : null,
      };
    });

  const requestList = Array.from(quoteRequests.values());
  const accessService = new AuditEvaluationCustomerAccessService();
  const now = new Date().toISOString();
  const auditSourceIds = Array.from(
    new Set(
      requestList
        .filter(
          (request) =>
            request.sourceType === "audit_quote" && Boolean(request.sourceId),
        )
        .map((request) => request.sourceId),
    ),
  );
  const peeks = new Map(
    await Promise.all(
      auditSourceIds.map(async (sourceId) => {
        const peek = await accessService.peekComparisonForAuditQuoteRequest(
          sourceId,
          now,
        );
        return [sourceId, peek] as const;
      }),
    ),
  );
  const comparisons = buildCustomerQuoteComparisonGroups({
    quoteRequests: requestList,
    quotes,
    peeks,
  });

  return NextResponse.json({
    ok: true,
    membershipStatus: memberSession.profile.status,
    quotes: quotes.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")),
    quoteRequests: requestList,
    comparisons,
  });
}
