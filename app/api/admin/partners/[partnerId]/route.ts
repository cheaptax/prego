import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import { hasPermission } from "@/lib/admin/rbac";
import {
  addAdminAuditLog,
  authErrorCode,
  authErrorStatus,
  requireActiveAdmin,
  requirePermission,
  writeAdminAuditLog,
} from "@/lib/firebase/server";
import type { PartnerRecord } from "@/lib/firebase/schema";
import {
  PARTNER_UNIQUE_KEYS_COLLECTION,
  hardDeleteBlockReasons,
  isPartnerStatusTransitionAllowed,
  normalizePartnerUniqueValue,
  partnerUniqueKeyIds,
} from "@/lib/partner-management";
import {
  loadPartnerRelationData,
  syncPartnerAccountAccess,
} from "@/lib/partner-management-server";
import { validatePartnerPayload } from "@/lib/partners";

export const runtime = "nodejs";

type Params = { params: Promise<{ partnerId: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    await requirePermission(req, "partners:read");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }
  const { partnerId } = await params;
  const db = adminDb();
  const snapshot = await db.collection("partners").doc(partnerId).get();
  if (!snapshot.exists) {
    return NextResponse.json(
      { ok: false, error: "partner_not_found" },
      { status: 404 },
    );
  }
  const partner = snapshot.data() as PartnerRecord;
  const relations = await loadPartnerRelationData(db, partnerId);
  const accounts = relations.accounts.map((account) => ({
    uid: account.uid,
    name: account.name,
    email: account.email,
    phone: account.phone,
    position: account.position,
    duty: account.duty,
    accountStatus: account.accountStatus,
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }));
  return NextResponse.json({
    ok: true,
    partner: { ...partner, id: partner.id || partnerId },
    accounts,
    summary: relations.summary,
  });
}

export async function PATCH(req: Request, { params }: Params) {
  let admin;
  try {
    admin = await requireActiveAdmin(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const payload = validatePartnerPayload(await req.json().catch(() => null));
  if (!payload) {
    return NextResponse.json(
      { ok: false, error: "invalid_partner" },
      { status: 400 },
    );
  }

  const { partnerId } = await params;
  const db = adminDb();
  const ref = db.collection("partners").doc(partnerId);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    return NextResponse.json(
      { ok: false, error: "partner_not_found" },
      { status: 404 },
    );
  }

  const current = snapshot.data() as PartnerRecord;
  if (current.status === "terminated") {
    return NextResponse.json(
      { ok: false, error: "terminated_partner_immutable" },
      { status: 409 },
    );
  }
  const statusChanged = payload.status !== current.status;
  const scopeChanged = payload.fields.join(",") !== current.fields.join(",");
  const basicChanged =
    payload.name !== current.name ||
    payload.displayName !== current.displayName ||
    payload.partnerType !== current.partnerType ||
    payload.profession !== (current.profession ?? "OTHER") ||
    payload.managerName !== current.managerName ||
    payload.contactEmail !== current.contactEmail ||
    payload.contactPhone !== current.contactPhone ||
    payload.businessRegistrationNumber !==
      (current.businessRegistrationNumber ?? "") ||
    payload.businessAddress !== (current.businessAddress ?? "") ||
    payload.pointMin !== current.pointMin ||
    payload.pointMax !== current.pointMax ||
    payload.memo !== (current.memo ?? "");
  if (
    (basicChanged && !hasPermission(admin.context, "partners:update")) ||
    (statusChanged && !hasPermission(admin.context, "partners:changeStatus")) ||
    (scopeChanged && !hasPermission(admin.context, "partners:manageScope"))
  ) {
    return NextResponse.json(
      { ok: false, error: "permission_denied" },
      { status: 403 },
    );
  }
  if (
    statusChanged &&
    !isPartnerStatusTransitionAllowed(current.status, payload.status)
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid_partner_status_transition" },
      { status: 409 },
    );
  }
  const existingPartners = await db.collection("partners").get();
  const duplicate = existingPartners.docs
    .filter((doc) => doc.id !== partnerId)
    .map((doc) => doc.data() as PartnerRecord)
    .find(
      (partner) =>
        normalizePartnerUniqueValue(partner.name) ===
          normalizePartnerUniqueValue(payload.name) ||
        normalizePartnerUniqueValue(partner.contactEmail) ===
          payload.contactEmail,
    );
  if (duplicate) {
    const error =
      normalizePartnerUniqueValue(duplicate.name) ===
      normalizePartnerUniqueValue(payload.name)
        ? "duplicate_partner_name"
        : "duplicate_partner_email";
    return NextResponse.json({ ok: false, error }, { status: 409 });
  }
  const now = new Date().toISOString();
  const partner: PartnerRecord = withoutUndefined({
    ...current,
    ...payload,
    updatedBy: admin.decoded.uid,
    updatedByEmail: admin.decoded.email,
    updatedAt: now,
    statusChangedAt: statusChanged ? now : current.statusChangedAt,
    statusChangedBy: statusChanged
      ? admin.decoded.uid
      : current.statusChangedBy,
    statusChangedByEmail: statusChanged
      ? admin.decoded.email
      : current.statusChangedByEmail,
  } satisfies PartnerRecord);

  const currentKeys = partnerUniqueKeyIds(current);
  const nextKeys = partnerUniqueKeyIds(partner);
  const result = await db.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(ref);
    if (!currentSnapshot.exists) {
      return { ok: false as const, error: "partner_not_found" };
    }
    const keysToCheck: Array<{
      kind: "name" | "contactEmail";
      id: string;
    }> = [
      { kind: "name", id: nextKeys.name },
      { kind: "contactEmail", id: nextKeys.contactEmail },
    ];
    const oldKeysToDelete = [currentKeys.name, currentKeys.contactEmail].filter(
      (oldKeyId) =>
        oldKeyId !== nextKeys.name &&
        oldKeyId !== nextKeys.contactEmail,
    );
    const [keySnapshots, oldKeySnapshots] = await Promise.all([
      Promise.all(keysToCheck.map((key) =>
        transaction.get(
          db.collection(PARTNER_UNIQUE_KEYS_COLLECTION).doc(key.id),
        ))),
      Promise.all(oldKeysToDelete.map((oldKeyId) =>
        transaction.get(
          db.collection(PARTNER_UNIQUE_KEYS_COLLECTION).doc(oldKeyId),
        ))),
    ]);
    const conflictIndex = keySnapshots.findIndex(
      (keySnapshot) =>
        keySnapshot.exists &&
        keySnapshot.data()?.partnerId !== partnerId,
    );
    if (conflictIndex >= 0) {
      return {
        ok: false as const,
        error:
          keysToCheck[conflictIndex].kind === "name"
            ? "duplicate_partner_name"
            : "duplicate_partner_email",
      };
    }
    transaction.set(ref, partner, { merge: true });
    for (const key of keysToCheck) {
      transaction.set(
        db.collection(PARTNER_UNIQUE_KEYS_COLLECTION).doc(key.id),
        { kind: key.kind, partnerId, createdAt: now },
      );
    }
    for (const [index, oldKeyId] of oldKeysToDelete.entries()) {
      const oldSnapshot = oldKeySnapshots[index];
      if (
        !oldSnapshot.exists ||
        oldSnapshot.data()?.partnerId === partnerId
      ) {
        transaction.delete(
          db.collection(PARTNER_UNIQUE_KEYS_COLLECTION).doc(oldKeyId),
        );
      }
    }
    writeAdminAuditLog(transaction, db, {
      actorId: admin.decoded.uid,
      actorEmail: admin.decoded.email,
      actorRole: admin.context.adminRole,
      requiredPermission: statusChanged
        ? "partners:changeStatus"
        : scopeChanged
          ? "partners:manageScope"
          : "partners:update",
      action: statusChanged
        ? "partner.status_changed"
        : scopeChanged
          ? "partner.scope_changed"
          : "partner.updated",
      targetType: "partner",
      targetId: partner.id,
      before: current,
      after: partner,
      metadata: {
        partnerName: partner.displayName,
        previousStatus: current.status,
        status: partner.status,
        profession: partner.profession ?? "OTHER",
        fields: partner.fields.join(","),
      },
      createdAt: now,
    });
    return { ok: true as const };
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.error === "partner_not_found" ? 404 : 409 },
    );
  }
  const relations = statusChanged
    ? await loadPartnerRelationData(db, partnerId)
    : null;
  const authSync = relations
    ? await syncPartnerAccountAccess(relations.accounts, partner)
    : undefined;
  if (authSync?.failedUids.length) {
    await addAdminAuditLog(db, {
      actorId: admin.decoded.uid,
      actorEmail: admin.decoded.email,
      actorRole: admin.context.adminRole,
      requiredPermission: "partners:changeStatus",
      action: "partner.account_sync_failed",
      targetType: "partner",
      targetId: partnerId,
      metadata: {
        failedCount: authSync.failedUids.length,
        failedUids: authSync.failedUids.join(","),
      },
      result: "failed",
      createdAt: new Date().toISOString(),
    });
  }

  return NextResponse.json({ ok: true, partner, authSync });
}

export async function DELETE(req: Request, { params }: Params) {
  let admin;
  try {
    admin = await requirePermission(req, "partners:changeStatus");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }
  const { partnerId } = await params;
  const db = adminDb();
  const ref = db.collection("partners").doc(partnerId);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    return NextResponse.json(
      { ok: false, error: "partner_not_found" },
      { status: 404 },
    );
  }
  const current = snapshot.data() as PartnerRecord;
  const relations = await loadPartnerRelationData(db, partnerId);
  if (current.status === "terminated") {
    return NextResponse.json({
      ok: true,
      partner: current,
      hardDeleted: false,
      hardDeleteBlockedReasons: hardDeleteBlockReasons(relations.summary),
    });
  }
  if (!isPartnerStatusTransitionAllowed(current.status, "terminated")) {
    return NextResponse.json(
      { ok: false, error: "invalid_partner_status_transition" },
      { status: 409 },
    );
  }
  const now = new Date().toISOString();
  const partner: PartnerRecord = {
    ...current,
    status: "terminated",
    updatedAt: now,
    updatedBy: admin.decoded.uid,
    updatedByEmail: admin.decoded.email,
    statusChangedAt: now,
    statusChangedBy: admin.decoded.uid,
    statusChangedByEmail: admin.decoded.email,
  };
  await db.runTransaction(async (transaction) => {
    transaction.set(ref, partner, { merge: true });
    writeAdminAuditLog(transaction, db, {
      actorId: admin.decoded.uid,
      actorEmail: admin.decoded.email,
      actorRole: admin.context.adminRole,
      requiredPermission: "partners:changeStatus",
      action: "partner.terminated",
      targetType: "partner",
      targetId: partnerId,
      before: current,
      after: partner,
      metadata: {
        memberCount: relations.summary.memberCount,
        assignmentCount: relations.summary.assignmentCount,
        draftCount: relations.summary.draftCount,
        answerCount: relations.summary.answerCount,
      },
      createdAt: now,
    });
  });
  const authSync = await syncPartnerAccountAccess(
    relations.accounts,
    partner,
  );
  if (authSync.failedUids.length) {
    await addAdminAuditLog(db, {
      actorId: admin.decoded.uid,
      actorEmail: admin.decoded.email,
      actorRole: admin.context.adminRole,
      requiredPermission: "partners:changeStatus",
      action: "partner.account_sync_failed",
      targetType: "partner",
      targetId: partnerId,
      metadata: {
        failedCount: authSync.failedUids.length,
        failedUids: authSync.failedUids.join(","),
      },
      result: "failed",
      createdAt: new Date().toISOString(),
    });
  }
  return NextResponse.json({
    ok: true,
    partner,
    authSync,
    hardDeleted: false,
    hardDeleteBlockedReasons: hardDeleteBlockReasons(relations.summary),
  });
}
