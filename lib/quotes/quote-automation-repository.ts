import "server-only";

import { createHash } from "node:crypto";
import { adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import {
  quoteAutomationPlanLookupIds,
  quoteRequestIdFor,
} from "@/lib/quotes/quote-requests";
import {
  quoteAutomationPartnerPresetInputSchema,
  quoteAutomationRequestPlanInputSchema,
} from "@/lib/quotes/quote-automation-schemas";
import {
  QUOTE_AUTOMATION_COLLECTIONS,
  type QuoteAutomationPartnerPreset,
  type QuoteAutomationRequestPlan,
  type SafePriceAdjustmentEvent,
} from "@/lib/quotes/quote-automation-types";

export function partnerPresetId(quoteRequestId: string, partnerId: string) {
  return createHash("sha256")
    .update(`preset|${quoteRequestId}|${partnerId}`)
    .digest("hex")
    .slice(0, 40);
}

export async function getQuoteAutomationPlan(quoteRequestId: string) {
  const db = adminDb();
  const [planSnap, presetsSnap] = await Promise.all([
    db
      .collection(QUOTE_AUTOMATION_COLLECTIONS.requestPlans)
      .doc(quoteRequestId)
      .get(),
    db
      .collection(QUOTE_AUTOMATION_COLLECTIONS.partnerPresets)
      .where("quoteRequestId", "==", quoteRequestId)
      .limit(100)
      .get(),
  ]);
  const plan = planSnap.exists
    ? (planSnap.data() as QuoteAutomationRequestPlan)
    : null;
  const presets = presetsSnap.docs.map(
    (document) => document.data() as QuoteAutomationPartnerPreset,
  );
  return { plan, presets };
}

export async function getQuoteAutomationPlanForRequest(quoteRequestId: string) {
  for (const id of quoteAutomationPlanLookupIds(quoteRequestId)) {
    const loaded = await getQuoteAutomationPlan(id);
    if (loaded.plan || loaded.presets.length > 0) return loaded;
  }
  return { plan: null, presets: [] as QuoteAutomationPartnerPreset[] };
}

export async function getPartnerAutomationPreset(input: {
  quoteRequestId: string;
  partnerId: string;
}) {
  const snapshot = await adminDb()
    .collection(QUOTE_AUTOMATION_COLLECTIONS.partnerPresets)
    .doc(partnerPresetId(input.quoteRequestId, input.partnerId))
    .get();
  return snapshot.exists
    ? (snapshot.data() as QuoteAutomationPartnerPreset)
    : null;
}

export async function saveQuoteAutomationPlan(input: {
  quoteRequestId: string;
  auditQuoteRequestId: string;
  cooperativeName?: string;
  fiscalYear?: number;
  payload: unknown;
  actor: { uid: string; email?: string };
  now: string;
}) {
  const parsed = quoteAutomationRequestPlanInputSchema.safeParse(input.payload);
  if (!parsed.success) {
    return { ok: false as const, error: "invalid_input", issues: parsed.error.issues };
  }
  const db = adminDb();
  const existing = await getQuoteAutomationPlan(input.quoteRequestId);
  const plan: QuoteAutomationRequestPlan = {
    id: input.quoteRequestId,
    quoteRequestId: input.quoteRequestId,
    auditQuoteRequestId: input.auditQuoteRequestId,
    cooperativeName: input.cooperativeName,
    fiscalYear: input.fiscalYear,
    plannedWinnerPartnerId: parsed.data.plannedWinnerPartnerId,
    notes: parsed.data.notes,
    updatedBy: input.actor.uid,
    updatedByEmail: input.actor.email,
    createdAt: existing.plan?.createdAt ?? input.now,
    updatedAt: input.now,
  };

  const nextPresets: QuoteAutomationPartnerPreset[] = parsed.data.partnerPresets.map(
    (item) => {
      const previous = existing.presets.find(
        (candidate) => candidate.partnerId === item.partnerId,
      );
      return {
        id: partnerPresetId(input.quoteRequestId, item.partnerId),
        quoteRequestId: input.quoteRequestId,
        auditQuoteRequestId: input.auditQuoteRequestId,
        assignmentId: item.assignmentId,
        partnerId: item.partnerId,
        partnerName:
          item.partnerName?.trim() ||
          previous?.partnerName ||
          item.partnerId,
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
    db
      .collection(QUOTE_AUTOMATION_COLLECTIONS.requestPlans)
      .doc(plan.id),
    withoutUndefined(plan),
  );
  const keepIds = new Set(nextPresets.map((item) => item.id));
  for (const previous of existing.presets) {
    if (!keepIds.has(previous.id)) {
      batch.delete(
        db
          .collection(QUOTE_AUTOMATION_COLLECTIONS.partnerPresets)
          .doc(previous.id),
      );
    }
  }
  for (const preset of nextPresets) {
    batch.set(
      db
        .collection(QUOTE_AUTOMATION_COLLECTIONS.partnerPresets)
        .doc(preset.id),
      withoutUndefined(preset),
    );
  }
  await batch.commit();
  return { ok: true as const, plan, presets: nextPresets };
}

export async function savePriceAdjustmentEvents(
  events: readonly SafePriceAdjustmentEvent[],
) {
  if (events.length === 0) return;
  const db = adminDb();
  const batch = db.batch();
  for (const event of events) {
    batch.set(
      db
        .collection(QUOTE_AUTOMATION_COLLECTIONS.priceAdjustmentEvents)
        .doc(event.id),
      withoutUndefined(event),
    );
  }
  await batch.commit();
}

export function inboxQuoteRequestId(auditQuoteRequestId: string) {
  return quoteRequestIdFor("audit_quote", auditQuoteRequestId);
}

export function parsePartnerPresetInput(value: unknown) {
  return quoteAutomationPartnerPresetInputSchema.safeParse(value);
}
