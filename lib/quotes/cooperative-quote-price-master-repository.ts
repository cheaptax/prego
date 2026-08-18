import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { AuditQuoteRequestRecord } from "@/lib/audit-quote/types";
import { searchSignupCooperatives } from "@/lib/cooperatives/server";
import { normalizeCooperativeSearchText } from "@/lib/cooperatives/master";
import { withoutUndefined } from "@/lib/firebase/clean";
import { adminDb } from "@/lib/firebase/admin";
import type { PartnerRecord, QuoteAssignmentRecord } from "@/lib/firebase/schema";
import { isPartnerActive } from "@/lib/partners";
import { isPartnerEligibleForAuditQuote } from "@/lib/quotes/audit-quote-assignment";
import {
  getQuoteAutomationPlan,
  inboxQuoteRequestId,
  saveQuoteAutomationPlan,
} from "@/lib/quotes/quote-automation-repository";
import {
  cooperativeQuotePricePlanInputSchema,
} from "@/lib/quotes/cooperative-quote-price-master-schemas";
import { nonSelectedMasterPriceFields } from "@/lib/quotes/cooperative-quote-price-master-pricing";
import {
  COOPERATIVE_QUOTE_PRICE_MASTER_COLLECTIONS,
  type CooperativeQuotePartnerPrice,
  type CooperativeQuotePriceChangeEvent,
  type CooperativeQuotePriceMasterRow,
  type CooperativeQuotePricePlan,
} from "@/lib/quotes/cooperative-quote-price-master-types";

export type QuotePriceMasterActor = {
  uid: string;
  email?: string;
};

export function cooperativeQuotePricePlanId(input: {
  fiscalYear: number;
  cooperativeId: string;
}) {
  return `${input.fiscalYear}_${input.cooperativeId}`;
}

export function cooperativeQuotePartnerPriceId(input: {
  fiscalYear: number;
  cooperativeId: string;
  partnerId: string;
}) {
  return `${input.fiscalYear}_${input.cooperativeId}_${input.partnerId}`;
}

function changeEventId(input: {
  action: CooperativeQuotePriceChangeEvent["action"];
  fiscalYear: number;
  cooperativeId: string;
  partnerId?: string;
  now: string;
}) {
  return createHash("sha256")
    .update(
      [
        input.action,
        input.fiscalYear,
        input.cooperativeId,
        input.partnerId ?? "",
        input.now,
        randomUUID(),
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 40);
}

export async function listSavedPartnerPricesForFiscalYear(fiscalYear: number) {
  const snapshot = await adminDb()
    .collection(COOPERATIVE_QUOTE_PRICE_MASTER_COLLECTIONS.partnerPrices)
    .where("fiscalYear", "==", fiscalYear)
    .limit(10_000)
    .get();
  return snapshot.docs.map(
    (document) => document.data() as CooperativeQuotePartnerPrice,
  );
}

export async function listCooperativeQuotePriceMaster(input: {
  fiscalYear: number;
  cooperativeId?: string;
  pageSize?: number;
}) {
  const db = adminDb();
  const pageSize = Math.min(Math.max(input.pageSize ?? 30, 10), 2_000);
  // Avoid composite index requirement: equality filter + in-memory sort.
  const planQuery = input.cooperativeId
    ? db
        .collection(COOPERATIVE_QUOTE_PRICE_MASTER_COLLECTIONS.plans)
        .where("fiscalYear", "==", input.fiscalYear)
        .where("cooperativeId", "==", input.cooperativeId)
        .limit(pageSize)
    : db
        .collection(COOPERATIVE_QUOTE_PRICE_MASTER_COLLECTIONS.plans)
        .where("fiscalYear", "==", input.fiscalYear)
        .limit(pageSize);
  const planSnapshot = await planQuery.get();
  const plans = planSnapshot.docs
    .map((document) => document.data() as CooperativeQuotePricePlan)
    .sort((left, right) =>
      left.cooperativeName.localeCompare(right.cooperativeName, "ko"),
    );
  if (plans.length === 0) return [] as CooperativeQuotePriceMasterRow[];
  const priceSnapshots = await Promise.all(
    plans.map((plan) =>
      db
        .collection(COOPERATIVE_QUOTE_PRICE_MASTER_COLLECTIONS.partnerPrices)
        .where("fiscalYear", "==", plan.fiscalYear)
        .where("cooperativeId", "==", plan.cooperativeId)
        .limit(200)
        .get(),
    ),
  );
  return plans.map((plan, index) => ({
    plan,
    prices: priceSnapshots[index].docs
      .map((document) => document.data() as CooperativeQuotePartnerPrice)
      .sort((left, right) =>
        left.partnerName.localeCompare(right.partnerName, "ko"),
      ),
  }));
}

export async function getCooperativeQuotePriceMaster(input: {
  fiscalYear: number;
  cooperativeId: string;
}) {
  return (
    await listCooperativeQuotePriceMaster({
      fiscalYear: input.fiscalYear,
      cooperativeId: input.cooperativeId,
      pageSize: 1,
    })
  )[0] ?? null;
}

export async function saveCooperativeQuotePriceMaster(input: {
  payload: unknown;
  actor: QuotePriceMasterActor;
  now: string;
}) {
  const parsed = cooperativeQuotePricePlanInputSchema.safeParse(input.payload);
  if (!parsed.success) {
    return { ok: false as const, error: "invalid_input", issues: parsed.error.issues };
  }
  const db = adminDb();
  const data = parsed.data;
  const planId = cooperativeQuotePricePlanId(data);
  const existing = await getCooperativeQuotePriceMaster(data);
  const plan: CooperativeQuotePricePlan = {
    id: planId,
    fiscalYear: data.fiscalYear,
    cooperativeId: data.cooperativeId,
    cooperativeName: data.cooperativeName,
    plannedWinnerPartnerId: data.plannedWinnerPartnerId,
    notes: data.notes,
    updatedBy: input.actor.uid,
    updatedByEmail: input.actor.email,
    createdAt: existing?.plan.createdAt ?? input.now,
    updatedAt: input.now,
  };
  const previousByPartner = new Map(
    (existing?.prices ?? []).map((price) => [price.partnerId, price]),
  );
  const prices: CooperativeQuotePartnerPrice[] = data.partnerPrices.map(
    (item) => {
      const previous = previousByPartner.get(item.partnerId);
      return {
        id: cooperativeQuotePartnerPriceId({
          fiscalYear: data.fiscalYear,
          cooperativeId: data.cooperativeId,
          partnerId: item.partnerId,
        }),
        fiscalYear: data.fiscalYear,
        cooperativeId: data.cooperativeId,
        cooperativeName: data.cooperativeName,
        partnerId: item.partnerId,
        partnerName: item.partnerName || previous?.partnerName || item.partnerId,
        plannedAuditFeeWon: item.plannedAuditFeeWon,
        expenseBillingMode: item.expenseBillingMode,
        expectedExpenseWon: item.expectedExpenseWon,
        safePriceMinWon: item.safePriceMinWon,
        safePriceMaxWon: item.safePriceMaxWon,
        isPlannedWinner: item.isPlannedWinner,
        locked: item.locked ?? previous?.locked ?? false,
        updatedBy: input.actor.uid,
        updatedByEmail: input.actor.email,
        createdAt: previous?.createdAt ?? input.now,
        updatedAt: input.now,
      };
    },
  );

  const batch = db.batch();
  batch.set(
    db.collection(COOPERATIVE_QUOTE_PRICE_MASTER_COLLECTIONS.plans).doc(plan.id),
    withoutUndefined(plan),
  );
  const keepIds = new Set(prices.map((price) => price.id));
  for (const previous of existing?.prices ?? []) {
    if (!keepIds.has(previous.id)) {
      batch.delete(
        db
          .collection(COOPERATIVE_QUOTE_PRICE_MASTER_COLLECTIONS.partnerPrices)
          .doc(previous.id),
      );
    }
  }
  for (const price of prices) {
    batch.set(
      db
        .collection(COOPERATIVE_QUOTE_PRICE_MASTER_COLLECTIONS.partnerPrices)
        .doc(price.id),
      withoutUndefined(price),
    );
  }
  const event: CooperativeQuotePriceChangeEvent = {
    id: changeEventId({
      action: "master.upserted",
      fiscalYear: plan.fiscalYear,
      cooperativeId: plan.cooperativeId,
      now: input.now,
    }),
    fiscalYear: plan.fiscalYear,
    cooperativeId: plan.cooperativeId,
    action: "master.upserted",
    actorUid: input.actor.uid,
    actorEmail: input.actor.email,
    metadata: { partnerCount: prices.length },
    createdAt: input.now,
  };
  batch.set(
    db
      .collection(COOPERATIVE_QUOTE_PRICE_MASTER_COLLECTIONS.changeEvents)
      .doc(event.id),
    withoutUndefined(event),
  );
  await batch.commit();
  return { ok: true as const, row: { plan, prices } };
}

/** Fast path for Excel commit: one fiscal-year read, chunked writes (no per-row get). */
export async function saveCooperativeQuotePriceMasterBulk(input: {
  payloads: unknown[];
  actor: QuotePriceMasterActor;
  now: string;
}) {
  const parsedPayloads = input.payloads.flatMap((payload) => {
    const parsed = cooperativeQuotePricePlanInputSchema.safeParse(payload);
    return parsed.success ? [parsed.data] : [];
  });
  if (parsedPayloads.length === 0) {
    return { ok: true as const, committed: 0 };
  }
  const fiscalYear = parsedPayloads[0].fiscalYear;
  const db = adminDb();
  const existingPrices = await listSavedPartnerPricesForFiscalYear(fiscalYear);
  const existingByCoop = new Map<string, CooperativeQuotePartnerPrice[]>();
  for (const price of existingPrices) {
    const list = existingByCoop.get(price.cooperativeId) ?? [];
    list.push(price);
    existingByCoop.set(price.cooperativeId, list);
  }

  type WriteOp =
    | { type: "set"; collection: string; id: string; data: Record<string, unknown> }
    | { type: "delete"; collection: string; id: string };
  const ops: WriteOp[] = [];

  for (const data of parsedPayloads) {
    const previousPrices = existingByCoop.get(data.cooperativeId) ?? [];
    const planId = cooperativeQuotePricePlanId(data);
    const plan: CooperativeQuotePricePlan = {
      id: planId,
      fiscalYear: data.fiscalYear,
      cooperativeId: data.cooperativeId,
      cooperativeName: data.cooperativeName,
      plannedWinnerPartnerId: data.plannedWinnerPartnerId,
      notes: data.notes,
      updatedBy: input.actor.uid,
      updatedByEmail: input.actor.email,
      createdAt: input.now,
      updatedAt: input.now,
    };
    ops.push({
      type: "set",
      collection: COOPERATIVE_QUOTE_PRICE_MASTER_COLLECTIONS.plans,
      id: plan.id,
      data: withoutUndefined(plan) as Record<string, unknown>,
    });

    const prices: CooperativeQuotePartnerPrice[] = data.partnerPrices.map(
      (item) => {
        const previous = previousPrices.find(
          (price) => price.partnerId === item.partnerId,
        );
        return {
          id: cooperativeQuotePartnerPriceId({
            fiscalYear: data.fiscalYear,
            cooperativeId: data.cooperativeId,
            partnerId: item.partnerId,
          }),
          fiscalYear: data.fiscalYear,
          cooperativeId: data.cooperativeId,
          cooperativeName: data.cooperativeName,
          partnerId: item.partnerId,
          partnerName: item.partnerName || previous?.partnerName || item.partnerId,
          plannedAuditFeeWon: item.plannedAuditFeeWon,
          expenseBillingMode: item.expenseBillingMode,
          expectedExpenseWon: item.expectedExpenseWon,
          safePriceMinWon: item.safePriceMinWon,
          safePriceMaxWon: item.safePriceMaxWon,
          isPlannedWinner: item.isPlannedWinner,
          locked: item.locked ?? previous?.locked ?? false,
          updatedBy: input.actor.uid,
          updatedByEmail: input.actor.email,
          createdAt: previous?.createdAt ?? input.now,
          updatedAt: input.now,
        };
      },
    );
    const keepIds = new Set(prices.map((price) => price.id));
    for (const previous of previousPrices) {
      if (!keepIds.has(previous.id)) {
        ops.push({
          type: "delete",
          collection: COOPERATIVE_QUOTE_PRICE_MASTER_COLLECTIONS.partnerPrices,
          id: previous.id,
        });
      }
    }
    for (const price of prices) {
      ops.push({
        type: "set",
        collection: COOPERATIVE_QUOTE_PRICE_MASTER_COLLECTIONS.partnerPrices,
        id: price.id,
        data: withoutUndefined(price) as Record<string, unknown>,
      });
    }
  }

  ops.push({
    type: "set",
    collection: COOPERATIVE_QUOTE_PRICE_MASTER_COLLECTIONS.changeEvents,
    id: changeEventId({
      action: "master.upserted",
      fiscalYear,
      cooperativeId: "bulk",
      now: input.now,
    }),
    data: withoutUndefined({
      id: changeEventId({
        action: "master.upserted",
        fiscalYear,
        cooperativeId: "bulk",
        now: input.now,
      }),
      fiscalYear,
      cooperativeId: "bulk",
      action: "master.upserted",
      actorUid: input.actor.uid,
      actorEmail: input.actor.email,
      metadata: { partnerCount: parsedPayloads.length, mode: "excel_bulk" },
      createdAt: input.now,
    }) as Record<string, unknown>,
  });

  const chunkSize = 400;
  for (let index = 0; index < ops.length; index += chunkSize) {
    const chunk = ops.slice(index, index + chunkSize);
    const batch = db.batch();
    for (const op of chunk) {
      const ref = db.collection(op.collection).doc(op.id);
      if (op.type === "delete") batch.delete(ref);
      else batch.set(ref, op.data);
    }
    await batch.commit();
  }

  return { ok: true as const, committed: parsedPayloads.length };
}

export async function validateQuotePriceMasterPartners(partnerIds: string[]) {
  const unique = [...new Set(partnerIds)];
  const snapshots = await Promise.all(
    unique.map((partnerId) => adminDb().collection("partners").doc(partnerId).get()),
  );
  const partners = new Map<string, PartnerRecord>();
  const invalid: string[] = [];
  for (const snapshot of snapshots) {
    const data = snapshot.exists ? (snapshot.data() as PartnerRecord) : null;
    if (data && isPartnerActive(data) && isPartnerEligibleForAuditQuote(data)) {
      partners.set(snapshot.id, data);
    } else {
      invalid.push(snapshot.id);
    }
  }
  return { partners, invalid };
}

export async function resolveCooperativeQuoteSafetyBand(input: {
  fiscalYear: number;
  cooperativeId?: string | null;
  cooperativeName?: string | null;
}) {
  const byId = input.cooperativeId
    ? await getCooperativeQuotePriceMaster({
        fiscalYear: input.fiscalYear,
        cooperativeId: input.cooperativeId,
      })
    : null;
  const byName = byId
    ? null
    : await findMasterByCooperativeName(input.fiscalYear, input.cooperativeName);
  const master = byId ?? byName;
  if (!master) return null;
  const winner =
    master.prices.find((price) => price.isPlannedWinner) ??
    master.prices[0] ??
    null;
  if (!winner) return null;
  return {
    safePriceMinWon: winner.safePriceMinWon,
    safePriceMaxWon: winner.safePriceMaxWon,
    plannedAuditFeeWon: winner.plannedAuditFeeWon,
    prices: master.prices,
  };
}

async function findMasterByCooperativeName(
  fiscalYear: number,
  cooperativeName?: string | null,
) {
  const name = cooperativeName?.trim();
  if (!name) return null;
  const cooperative = await resolveCooperativeForQuoteMaster(name);
  if (cooperative) {
    const master = await getCooperativeQuotePriceMaster({
      fiscalYear,
      cooperativeId: cooperative.cooperative_id,
    });
    if (master) return master;
  }
  const key = normalizeCooperativeSearchText(name);
  if (!key) return null;
  const rows = await listCooperativeQuotePriceMaster({
    fiscalYear,
    pageSize: 2_000,
  });
  return (
    rows.find(
      (row) =>
        normalizeCooperativeSearchText(row.plan.cooperativeName) === key,
    ) ?? null
  );
}

export async function resolveCooperativeForQuoteMaster(name: string) {
  const normalized = normalizeCooperativeSearchText(name);
  if (!normalized) return null;
  const matches = await searchSignupCooperatives(name, 10);
  return (
    matches.find(
      (item) => normalizeCooperativeSearchText(item.cooperative_name) === normalized,
    ) ?? matches[0] ?? null
  );
}

export async function seedQuoteAutomationFromMaster(input: {
  auditQuoteRequest: AuditQuoteRequestRecord;
  assignments: readonly QuoteAssignmentRecord[];
  actor: QuotePriceMasterActor;
  now: string;
}) {
  const fiscalYear = input.auditQuoteRequest.fiscalYear;
  const cooperativeName = input.auditQuoteRequest.targetCooperativeName;
  if (!fiscalYear || !cooperativeName) {
    return { ok: true as const, seeded: false, reason: "missing_cooperative" };
  }
  const cooperative = await resolveCooperativeForQuoteMaster(cooperativeName);
  if (!cooperative) {
    return { ok: true as const, seeded: false, reason: "cooperative_not_found" };
  }
  const master = await getCooperativeQuotePriceMaster({
    fiscalYear,
    cooperativeId: cooperative.cooperative_id,
  });
  if (!master) return { ok: true as const, seeded: false, reason: "master_not_found" };

  const quoteRequestId = inboxQuoteRequestId(input.auditQuoteRequest.requestId);
  const existing = await getQuoteAutomationPlan(quoteRequestId);
  const activeAssignments = input.assignments.filter(
    (assignment) => assignment.status !== "revoked",
  );
  const existingByPartner = new Map(
    existing.presets.map((preset) => [preset.partnerId, preset]),
  );
  const winnerPrice =
    master.prices.find((price) => price.isPlannedWinner) ??
    master.prices.find(
      (price) => price.partnerId === master.plan.plannedWinnerPartnerId,
    ) ??
    null;
  const priceByPartner = new Map(
    master.prices.map((price) => [price.partnerId, price]),
  );
  let nextSyntheticIndex = master.prices.filter(
    (price) => !price.isPlannedWinner,
  ).length;
  const partnerPresets = activeAssignments.map((assignment) => {
    const existingPreset = existingByPartner.get(assignment.partnerId);
    if (existingPreset?.locked) {
      return existingPreset;
    }
    const price = priceByPartner.get(assignment.partnerId);
    if (price) {
      return {
        assignmentId: assignment.id,
        partnerId: price.partnerId,
        partnerName: price.partnerName,
        plannedAuditFeeWon: price.plannedAuditFeeWon,
        expenseBillingMode: price.expenseBillingMode,
        expectedExpenseWon: price.expectedExpenseWon,
        safePriceMinWon: price.safePriceMinWon,
        safePriceMaxWon: price.safePriceMaxWon,
        isPlannedWinner: price.isPlannedWinner,
        locked: price.locked,
      };
    }
    const fields = nonSelectedMasterPriceFields({
      plannedWinnerFeeWon: winnerPrice?.plannedAuditFeeWon ?? "1",
      index: nextSyntheticIndex,
    });
    nextSyntheticIndex += 1;
    return {
      assignmentId: assignment.id,
      partnerId: assignment.partnerId,
      partnerName: assignment.partnerName,
      ...fields,
    };
  });
  if (partnerPresets.length === 0) {
    return { ok: true as const, seeded: false, reason: "no_assigned_partner_price" };
  }
  const plannedWinnerPartnerId =
    partnerPresets.find((item) => item.isPlannedWinner)?.partnerId ?? null;
  const result = await saveQuoteAutomationPlan({
    quoteRequestId,
    auditQuoteRequestId: input.auditQuoteRequest.requestId,
    cooperativeName: cooperative.cooperative_name,
    fiscalYear,
    payload: {
      plannedWinnerPartnerId,
      notes: existing.plan?.notes || "농협 견적 마스터에서 자동 시드됨",
      partnerPresets,
    },
    actor: input.actor,
    now: input.now,
  });
  if (!result.ok) return { ok: false as const, error: result.error };
  await recordQuotePriceMasterChange({
    action: "request.seeded",
    fiscalYear,
    cooperativeId: cooperative.cooperative_id,
    actor: input.actor,
    now: input.now,
    metadata: {
      quoteRequestId,
      auditQuoteRequestId: input.auditQuoteRequest.requestId,
      partnerCount: partnerPresets.length,
    },
  });
  return { ok: true as const, seeded: true, plan: result.plan, presets: result.presets };
}

export async function recordQuotePriceMasterChange(input: {
  action: CooperativeQuotePriceChangeEvent["action"];
  fiscalYear: number;
  cooperativeId: string;
  partnerId?: string;
  actor: QuotePriceMasterActor;
  now: string;
  metadata: Record<string, unknown>;
}) {
  const event: CooperativeQuotePriceChangeEvent = {
    id: changeEventId(input),
    fiscalYear: input.fiscalYear,
    cooperativeId: input.cooperativeId,
    partnerId: input.partnerId,
    action: input.action,
    actorUid: input.actor.uid,
    actorEmail: input.actor.email,
    metadata: input.metadata,
    createdAt: input.now,
  };
  await adminDb()
    .collection(COOPERATIVE_QUOTE_PRICE_MASTER_COLLECTIONS.changeEvents)
    .doc(event.id)
    .set(withoutUndefined(event));
  return event;
}
