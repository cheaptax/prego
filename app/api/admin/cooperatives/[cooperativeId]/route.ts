import { NextResponse } from "next/server";
import {
  COOPERATIVE_MASTER_COLLECTION,
  COOPERATIVE_MASTER_CONFIG_COLLECTION,
  COOPERATIVE_MASTER_CONFIG_ID,
  createProductionCooperativeMaster,
  normalizeCooperativeMasterInput,
  parseProductionCooperativeMaster,
} from "@/lib/cooperatives/master";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
  writeAuditLog,
} from "@/lib/firebase/server";

export const runtime = "nodejs";

type Payload = Record<string, unknown> & {
  expectedRevision?: unknown;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ cooperativeId: string }> },
) {
  let admin;
  try {
    admin = await requireAdminCapability(request, "cooperatives:write");
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }
  const body = (await request.json().catch(() => null)) as Payload | null;
  const value = normalizeCooperativeMasterInput(body);
  const expectedRevision = Number(body?.expectedRevision);
  const { cooperativeId } = await context.params;
  if (
    !value ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 1 ||
    value.successorCooperativeId === cooperativeId
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid_cooperative" },
      { status: 400 },
    );
  }
  const db = adminDb();
  const ref = db.collection(COOPERATIVE_MASTER_COLLECTION).doc(cooperativeId);
  const configRef = db
    .collection(COOPERATIVE_MASTER_CONFIG_COLLECTION)
    .doc(COOPERATIVE_MASTER_CONFIG_ID);
  const now = new Date().toISOString();
  const result = await db.runTransaction(async (transaction) => {
    const [snapshot, configSnapshot, successorSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(configRef),
      value.successorCooperativeId
        ? transaction.get(
            db
              .collection(COOPERATIVE_MASTER_COLLECTION)
              .doc(value.successorCooperativeId),
          )
        : Promise.resolve(null),
    ]);
    const existing = snapshot.exists
      ? parseProductionCooperativeMaster(snapshot.data())
      : null;
    if (!existing) {
      return { ok: false as const, error: "cooperative_not_found" };
    }
    if (
      !configSnapshot.exists ||
      configSnapshot.data()?.status !== "ACTIVE"
    ) {
      return { ok: false as const, error: "cooperative_master_not_ready" };
    }
    if (existing.revision !== expectedRevision) {
      return { ok: false as const, error: "stale_cooperative" };
    }
    if (successorSnapshot) {
      const successor = parseProductionCooperativeMaster(
        successorSnapshot.data(),
      );
      if (!successor || successor.status !== "active") {
        return { ok: false as const, error: "invalid_successor" };
      }
    }
    const record = createProductionCooperativeMaster({
      cooperativeId,
      value,
      source: "ADMIN",
      actorId: admin.uid,
      now,
      existing,
    });
    transaction.set(ref, record);
    transaction.update(configRef, { updatedAt: now });
    const action =
      record.status === "merged"
        ? "cooperative.merged"
        : record.status === "closed"
          ? "cooperative.closed"
          : existing.status !== "active" && record.status === "active"
            ? "cooperative.reactivated"
            : "cooperative.updated";
    writeAuditLog(transaction, db, {
      actorUid: admin.uid,
      actorEmail: admin.email,
      action,
      targetType: "organization",
      targetId: cooperativeId,
      before: {
        cooperativeName: existing.cooperativeName,
        cooperativeType: existing.cooperativeType,
        status: existing.status,
        successorCooperativeId: existing.successorCooperativeId ?? null,
        revision: existing.revision,
      },
      after: {
        cooperativeName: record.cooperativeName,
        cooperativeType: record.cooperativeType,
        status: record.status,
        successorCooperativeId: record.successorCooperativeId ?? null,
        revision: record.revision,
      },
      createdAt: now,
    });
    return { ok: true as const, record };
  });
  const status =
    result.ok
      ? 200
      : result.error === "cooperative_not_found"
        ? 404
        : 409;
  return NextResponse.json(result, { status });
}
