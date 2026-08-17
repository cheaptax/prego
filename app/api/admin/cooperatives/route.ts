import { randomUUID } from "node:crypto";
import { FieldPath } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import {
  applyCanonicalMasterRecord,
  mergeAdminMasterSearchRecords,
} from "@/lib/cooperatives/catalog";
import { readProductionMastersForQuery } from "@/lib/cooperatives/catalog-query";
import {
  COOPERATIVE_MASTER_COLLECTION,
  COOPERATIVE_MASTER_CONFIG_COLLECTION,
  COOPERATIVE_MASTER_CONFIG_ID,
  createProductionCooperativeMaster,
  normalizeCooperativeMasterInput,
  normalizeCooperativeSearchText,
  parseProductionCooperativeMaster,
} from "@/lib/cooperatives/master";
import { ensureStaticCooperativeMasterSynced } from "@/lib/cooperatives/sync-static-master";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
  writeAuditLog,
} from "@/lib/firebase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function decodeCursor(value: string) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as { name?: unknown; id?: unknown };
    return typeof parsed.name === "string" && typeof parsed.id === "string"
      ? { name: parsed.name, id: parsed.id }
      : null;
  } catch {
    return null;
  }
}

function encodeCursor(name: string, id: string) {
  return Buffer.from(JSON.stringify({ name, id }), "utf8").toString(
    "base64url",
  );
}

export async function GET(request: Request) {
  try {
    await requireAdminCapability(request, "cooperatives:read");
    const url = new URL(request.url);
    const search = normalizeCooperativeSearchText(
      url.searchParams.get("q") ?? "",
    );
    const pageSize = Math.min(
      Math.max(Number(url.searchParams.get("pageSize") ?? 30), 10),
      100,
    );
    const cursor = decodeCursor(url.searchParams.get("cursor") ?? "");
    const db = adminDb();
    try {
      await ensureStaticCooperativeMasterSynced(db);
    } catch (error) {
      console.error("Cooperative master region sync failed.", error);
    }
    const configSnapshot = await db
      .collection(COOPERATIVE_MASTER_CONFIG_COLLECTION)
      .doc(COOPERATIVE_MASTER_CONFIG_ID)
      .get();
    if (
      !configSnapshot.exists ||
      configSnapshot.data()?.status !== "ACTIVE"
    ) {
      return NextResponse.json(
        { ok: false, error: "cooperative_master_not_ready" },
        { status: 409 },
      );
    }
    const rawQuery = url.searchParams.get("q")?.trim() ?? "";
    if (search) {
      const { firestoreRecords } = await readProductionMastersForQuery(
        db,
        rawQuery || search,
        Math.min(Math.max(pageSize * 4, 40), 120),
      );
      const matched = mergeAdminMasterSearchRecords({
        query: rawQuery || search,
        firestoreRecords,
      });
      const items = matched.slice(0, pageSize).map(applyCanonicalMasterRecord);
      return NextResponse.json(
        {
          ok: true,
          items,
          total: Number(configSnapshot.data()?.sourceRecordCount ?? 0),
          nextCursor: null,
        },
        { headers: { "cache-control": "private, no-store" } },
      );
    }
    let query = db
      .collection(COOPERATIVE_MASTER_COLLECTION)
      .orderBy("cooperativeName")
      .orderBy(FieldPath.documentId())
      .limit(pageSize + 1);
    if (cursor) {
      query = query.startAfter(cursor.name, cursor.id);
    }
    const snapshot = await query.get();
    const records = snapshot.docs.flatMap((document) => {
      const record = parseProductionCooperativeMaster(document.data());
      return record ? [applyCanonicalMasterRecord(record)] : [];
    });
    const hasMore = records.length > pageSize;
    const items = records.slice(0, pageSize);
    const last = items.at(-1);
    return NextResponse.json(
      {
        ok: true,
        items,
        total: Number(configSnapshot.data()?.sourceRecordCount ?? 0),
        nextCursor:
          !search && hasMore && last
            ? encodeCursor(last.cooperativeName, last.cooperativeId)
            : null,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }
}

export async function POST(request: Request) {
  let admin;
  try {
    admin = await requireAdminCapability(request, "cooperatives:write");
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }
  const value = normalizeCooperativeMasterInput(
    await request.json().catch(() => null),
  );
  if (!value) {
    return NextResponse.json(
      { ok: false, error: "invalid_cooperative" },
      { status: 400 },
    );
  }
  const cooperativeId = `coop-admin-${randomUUID()}`;
  if (value.successorCooperativeId === cooperativeId) {
    return NextResponse.json(
      { ok: false, error: "invalid_successor" },
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
    const configSnapshot = await transaction.get(configRef);
    const successorSnapshot = value.successorCooperativeId
      ? await transaction.get(
          db
            .collection(COOPERATIVE_MASTER_COLLECTION)
            .doc(value.successorCooperativeId),
        )
      : null;
    if (
      !configSnapshot.exists ||
      configSnapshot.data()?.status !== "ACTIVE"
    ) {
      return { ok: false as const, error: "cooperative_master_not_ready" };
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
    });
    transaction.create(ref, record);
    transaction.update(configRef, {
      sourceRecordCount:
        Number(configSnapshot.data()?.sourceRecordCount ?? 0) + 1,
      updatedAt: now,
    });
    writeAuditLog(transaction, db, {
      actorUid: admin.uid,
      actorEmail: admin.email,
      action: "cooperative.created",
      targetType: "organization",
      targetId: cooperativeId,
      metadata: {
        cooperativeName: record.cooperativeName,
        status: record.status,
      },
      createdAt: now,
    });
    return { ok: true as const, record };
  });
  return NextResponse.json(result, { status: result.ok ? 201 : 409 });
}
