import { NextResponse } from "next/server";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { AUDIT_QUOTE_REQUESTS } from "@/lib/audit-quote/collections";
import type { AuditQuoteRequestRecord, AuditQuoteStatus } from "@/lib/audit-quote/types";
import { searchSignupCooperatives } from "@/lib/cooperatives/server";
import { normalizeCooperativeSearchText } from "@/lib/cooperatives/master";
import { adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import {
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
  writeAuditLog,
} from "@/lib/firebase/server";
import type {
  PartnerRecord,
  QuoteAssignmentRecord,
  QuoteRequestRecord,
  QuoteRecord,
} from "@/lib/firebase/schema";
import {
  formatAssignedPartnerNames,
  resolveExpectedAuditQuoteCount,
} from "@/lib/quotes/audit-quote-assignment";
import {
  getCooperativeQuotePriceMaster,
  seedQuoteAutomationFromMaster,
} from "@/lib/quotes/cooperative-quote-price-master-repository";
import type {
  CooperativeQuotePartnerPrice,
  CooperativeQuotePriceMasterRow,
} from "@/lib/quotes/cooperative-quote-price-master-types";
import {
  adminProxyMissingFixHint,
  adminProxyMissingLabel,
  adminProxySendErrorLabel,
  checkAdminProxyQuoteReadiness,
  resolveAdminProxySendPlan,
} from "@/lib/quotes/admin-proxy-quote-readiness";
import {
  deliverExistingQuoteToCustomer,
  finalizePartnerQuoteDelivery,
} from "@/lib/quotes/finalize-partner-quote-delivery";
import { buildQuote } from "@/app/api/partner/quotes/[assignmentId]/route";
import {
  ensureQuoteRequest,
  quoteRequestIdFor,
} from "@/lib/quotes/quote-requests";
import { nextImmutableQuoteVersion } from "@/lib/quotes/nh-audit-quote-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  requestIds?: string[];
  dryRun?: boolean;
};

const PRE_QUOTE_STATUSES = new Set<AuditQuoteStatus>([
  "received",
  "contacting",
  "qualified",
  "info_complete",
]);

async function loadActiveAssignments(db: Firestore, quoteRequestId: string) {
  const snapshot = await db
    .collection("quoteAssignments")
    .where("quoteRequestId", "==", quoteRequestId)
    .get();
  return snapshot.docs
    .map((doc) => ({ ...(doc.data() as QuoteAssignmentRecord), id: doc.id }))
    .filter((assignment) => assignment.status !== "revoked");
}

async function resolveCooperativeId(audit: AuditQuoteRequestRecord) {
  const name = audit.targetCooperativeName?.trim();
  if (!name) return null;
  const matches = await searchSignupCooperatives(name, 10);
  const normalized = normalizeCooperativeSearchText(name);
  const hit =
    matches.find(
      (item) =>
        normalizeCooperativeSearchText(item.cooperative_name) === normalized,
    ) ?? matches[0];
  return hit?.cooperative_id ?? null;
}

function masterSendPrices(master: CooperativeQuotePriceMasterRow) {
  const winner =
    master.prices.find((price) => price.isPlannedWinner) ??
    master.prices.find(
      (price) => price.partnerId === master.plan.plannedWinnerPartnerId,
    );
  const others = master.prices
    .filter((price) => price.partnerId !== winner?.partnerId)
    .slice(0, 2);
  return [winner, ...others].filter(
    (price): price is CooperativeQuotePartnerPrice => Boolean(price),
  );
}

async function ensureAssignment(input: {
  db: Firestore;
  auditRef: DocumentReference;
  audit: AuditQuoteRequestRecord;
  quoteRequest: QuoteRequestRecord;
  partner: PartnerRecord;
  actor: { uid: string; email?: string };
  existingAssignments: QuoteAssignmentRecord[];
}) {
  const existing = input.existingAssignments.find(
    (assignment) => assignment.partnerId === input.partner.id,
  );
  if (existing) return existing;

  const now = new Date().toISOString();
  const assignmentRef = input.db
    .collection("quoteAssignments")
    .doc(`${input.quoteRequest.id}_${input.partner.id}`);
  const quoteRequestRef = input.db
    .collection("quoteRequests")
    .doc(input.quoteRequest.id);
  const nextAssignments = [
    ...input.existingAssignments,
    {
      partnerId: input.partner.id,
      partnerName: input.partner.displayName,
      status: "assigned" as const,
    },
  ];
  const expectedQuoteCount = resolveExpectedAuditQuoteCount(
    input.audit.quoteCount,
    nextAssignments.length,
  );
  const assignedTo = formatAssignedPartnerNames(nextAssignments);
  const nextAuditStatus = PRE_QUOTE_STATUSES.has(input.audit.status)
    ? "quotes_requested"
    : input.audit.status;

  const assignment: QuoteAssignmentRecord = withoutUndefined({
    id: assignmentRef.id,
    quoteRequestId: input.quoteRequest.id,
    partnerId: input.partner.id,
    partnerName: input.partner.displayName,
    status: "assigned",
    assignedBy: input.actor.uid,
    assignedByEmail: input.actor.email,
    assignedAt: now,
    createdAt: now,
    updatedAt: now,
  } satisfies QuoteAssignmentRecord);

  await input.db.runTransaction(async (transaction) => {
    const current = await transaction.get(assignmentRef);
    if (current.exists) {
      const data = current.data() as QuoteAssignmentRecord;
      if (data.status !== "revoked") return;
    }
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
      input.auditRef,
      withoutUndefined({
        assignedTo,
        status: nextAuditStatus,
        quoteCount: expectedQuoteCount,
        updatedAt: now,
      }),
      { merge: true },
    );
    writeAuditLog(transaction, input.db, {
      actorUid: input.actor.uid,
      actorEmail: input.actor.email,
      action: "audit_quote.partner_assigned",
      targetType: "auditQuote",
      targetId: input.audit.requestId,
      metadata: {
        partnerId: input.partner.id,
        partnerName: input.partner.displayName,
        quoteRequestId: input.quoteRequest.id,
        source: "admin_proxy_quote_send",
      },
      createdAt: now,
    });
  });
  return assignment;
}

async function processRequest(input: {
  requestId: string;
  dryRun: boolean;
  actor: { uid: string; email?: string };
}) {
  const db = adminDb();
  const auditRef = db.collection(AUDIT_QUOTE_REQUESTS).doc(input.requestId);
  const auditSnapshot = await auditRef.get();
  if (!auditSnapshot.exists) {
    return { requestId: input.requestId, error: "audit_quote_not_found" };
  }
  const audit = {
    ...(auditSnapshot.data() as AuditQuoteRequestRecord),
    requestId: input.requestId,
  };
  const cooperativeId = audit.targetCooperativeId ?? await resolveCooperativeId(audit);
  if (!cooperativeId || !audit.fiscalYear) {
    return { requestId: input.requestId, error: "cooperative_not_found" };
  }
  const master = await getCooperativeQuotePriceMaster({
    fiscalYear: audit.fiscalYear,
    cooperativeId,
  });
  if (!master) {
    return { requestId: input.requestId, error: "master_not_found" };
  }
  const prices = masterSendPrices(master);
  if (prices.length === 0) {
    return {
      requestId: input.requestId,
      error: "master_prices_empty",
      assigned: [],
      sent: [],
      skipped: [],
      errors: [],
      masterPartnerCount: 0,
    };
  }
  const partners = await Promise.all(
    prices.map(async (price) => {
      const snapshot = await db.collection("partners").doc(price.partnerId).get();
      return snapshot.exists
        ? ({ ...(snapshot.data() as PartnerRecord), id: snapshot.id } as PartnerRecord)
        : null;
    }),
  );
  const quoteRequest = await ensureQuoteRequest(db, {
    sourceType: "audit_quote",
    source: audit,
  });
  let assignments = await loadActiveAssignments(db, quoteRequest.id);
  const assigned: string[] = [];
  const sent: string[] = [];
  const sentVersions: number[] = [];
  const skipped: Array<{
    partnerId: string;
    partnerName: string;
    missing: string[];
    missingLabels: string[];
    missingDetails: string[];
    fixHints: string[];
  }> = [];
  const errors: Array<{
    partnerId: string;
    partnerName?: string;
    error: string;
    errorLabel: string;
  }> = [];

  for (let index = 0; index < prices.length; index += 1) {
    const price = prices[index];
    const partner = partners[index];
    if (!partner) {
      errors.push({
        partnerId: price.partnerId,
        partnerName: price.partnerName,
        error: "partner_not_found",
        errorLabel: adminProxySendErrorLabel("partner_not_found"),
      });
      continue;
    }
    try {
      const readiness = checkAdminProxyQuoteReadiness({ partner, price });
      if (!readiness.ready) {
        skipped.push({
          partnerId: partner.id,
          partnerName: partner.displayName || partner.name,
          missing: readiness.missing,
          missingLabels: readiness.missing.map(adminProxyMissingLabel),
          missingDetails: readiness.nhAuditMissingLabels ?? [],
          fixHints: readiness.missing.map(adminProxyMissingFixHint),
        });
        continue;
      }
      if (input.dryRun) {
        sent.push(partner.id);
        continue;
      }
      const assignment = await ensureAssignment({
        db,
        auditRef,
        audit,
        quoteRequest,
        partner,
        actor: input.actor,
        existingAssignments: assignments,
      });
      if (!assignments.some((item) => item.id === assignment.id)) {
        assignments = [...assignments, assignment];
        assigned.push(partner.id);
      }
      await seedQuoteAutomationFromMaster({
        auditQuoteRequest: audit,
        assignments,
        actor: input.actor,
        now: new Date().toISOString(),
      });
      const previousSnapshot = await db
        .collection("quotes")
        .where("quoteAssignmentId", "==", assignment.id)
        .get();
      const previousVersions = previousSnapshot.docs.map((doc) => ({
        ...(doc.data() as QuoteRecord),
        id: doc.id,
      }));
      const latestSent = previousVersions
        .filter((quote) => ["finalized", "delivered"].includes(quote.status))
        .sort((left, right) => Number(right.version) - Number(left.version))[0];

      if (
        latestSent &&
        resolveAdminProxySendPlan({ latestSent }) === "retry_existing"
      ) {
        const retried = await deliverExistingQuoteToCustomer({
          db,
          quote: latestSent,
          quoteRequest,
        });
        if (!retried.ok) {
          errors.push({
            partnerId: partner.id,
            partnerName: partner.displayName || partner.name,
            error: retried.error,
            errorLabel: adminProxySendErrorLabel(retried.error),
          });
          continue;
        }
        sent.push(partner.id);
        sentVersions.push(Number(latestSent.version) || 1);
        continue;
      }

      const version = nextImmutableQuoteVersion(
        previousVersions.map((quote) => Number(quote.version)),
      );
      const built = await buildQuote(
        assignment.id,
        {
          profile: { partnerId: partner.id },
          decoded: { uid: partner.id, email: partner.contactEmail },
        },
        {
          supplierProfile: readiness.supplierProfile,
          nhAuditSubmission: readiness.nhAuditSubmission,
        },
        "finalized",
        version,
      );
      if (!built.ok) {
        errors.push({
          partnerId: partner.id,
          partnerName: partner.displayName || partner.name,
          error: built.error,
          errorLabel: adminProxySendErrorLabel(built.error),
        });
        continue;
      }
      const delivered = await finalizePartnerQuoteDelivery({
        db,
        assignmentId: assignment.id,
        built,
        previousVersions,
        actor: { ...input.actor, mode: "admin_proxy" },
      });
      if (!delivered.ok) {
        errors.push({
          partnerId: partner.id,
          partnerName: partner.displayName || partner.name,
          error: delivered.error,
          errorLabel: adminProxySendErrorLabel(delivered.error),
        });
        continue;
      }
      if (delivered.delivery.status !== "sent") {
        errors.push({
          partnerId: partner.id,
          partnerName: partner.displayName || partner.name,
          error: delivered.delivery.error ?? "email_send_failed",
          errorLabel: adminProxySendErrorLabel(
            delivered.delivery.error ?? "email_send_failed",
          ),
        });
        continue;
      }
      sent.push(partner.id);
      sentVersions.push(version);
    } catch (error) {
      const code = error instanceof Error ? error.message : "send_failed";
      errors.push({
        partnerId: partner.id,
        partnerName: partner.displayName || partner.name,
        error: code,
        errorLabel: adminProxySendErrorLabel(code),
      });
    }
  }

  return {
    requestId: input.requestId,
    quoteRequestId: quoteRequestIdFor("audit_quote", input.requestId),
    assigned,
    sent,
    sentVersions,
    skipped,
    errors,
    masterPartnerCount: prices.length,
  };
}

export async function POST(request: Request) {
  let admin;
  try {
    admin = await requireAdminCapability(request, "auditQuotes:write");
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }
  const body = (await request.json().catch(() => null)) as Body | null;
  const requestIds = [...new Set(body?.requestIds ?? [])]
    .map((id) => String(id).trim())
    .filter(Boolean)
    .slice(0, 50);
  if (requestIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: "missing_request_ids" },
      { status: 400 },
    );
  }
  const dryRun = body?.dryRun !== false;
  const results = [];
  for (const requestId of requestIds) {
    try {
      results.push(
        await processRequest({
          requestId,
          dryRun,
          actor: { uid: admin.uid, email: admin.email },
        }),
      );
    } catch (error) {
      results.push({
        requestId,
        error: error instanceof Error ? error.message : "proxy_send_failed",
        assigned: [],
        sent: [],
        skipped: [],
        errors: [],
        masterPartnerCount: 0,
      });
    }
  }
  return NextResponse.json({
    ok: true,
    dryRun,
    results,
  });
}
