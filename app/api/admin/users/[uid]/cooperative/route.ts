import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import {
  DEMO_COOPERATIVE_COLLECTION,
  nextDemoSignupStatus,
  parseTestCooperativeMaster,
} from "@/lib/cooperatives/demo-cooperative";
import { resolveSignupCooperative } from "@/lib/cooperatives/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
  writeAuditLog,
} from "@/lib/firebase/server";
import type {
  OrganizationRecord,
  UserRecord,
} from "@/lib/firebase/schema";
import { PURGE_LOCK_COLLECTION } from "@/lib/test-data/purge-job-types";
import { isActivePurgeLock } from "@/lib/test-data/purge-lock";
import { buildSignupRootMetadata } from "@/lib/test-data/root-metadata";
import { classifyCustomerEmail } from "@/lib/test-data/email-classification";

export const runtime = "nodejs";

type Payload = {
  cooperativeId?: unknown;
  reason?: unknown;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ uid: string }> },
) {
  let admin;
  try {
    admin = await requireAdminCapability(request, "members:write");
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }

  const { uid } = await context.params;
  const body = (await request.json().catch(() => null)) as Payload | null;
  const cooperativeId = String(body?.cooperativeId ?? "").trim();
  const reason = String(body?.reason ?? "").trim();
  if (!cooperativeId || reason.length < 2 || reason.length > 300) {
    return NextResponse.json(
      { ok: false, error: "invalid_payload" },
      { status: 400 },
    );
  }
  const target = await resolveSignupCooperative(cooperativeId);
  if (!target) {
    return NextResponse.json(
      { ok: false, error: "invalid_cooperative" },
      { status: 400 },
    );
  }

  const db = adminDb();
  const userRef = db.collection("users").doc(uid);
  const now = new Date().toISOString();
  const result = await db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    if (!userSnapshot.exists) {
      return { ok: false as const, error: "user_not_found" };
    }
    const user = userSnapshot.data() as UserRecord;
    if (user.role !== "member") {
      return { ok: false as const, error: "member_only" };
    }
    if (user.cooperativeId === target.cooperative_id) {
      return {
        ok: true as const,
        unchanged: true,
        cooperativeId: target.cooperative_id,
        cooperativeName: target.cooperative_name,
      };
    }

    const previousCooperativeId = user.cooperativeId?.trim() ?? "";
    const sourceOrgRef = previousCooperativeId
      ? db.collection("organizations").doc(previousCooperativeId)
      : null;
    const targetOrgRef = db
      .collection("organizations")
      .doc(target.cooperative_id);
    const targetMasterRef =
      target.masterSource === "DEMO_FIRESTORE"
        ? db
            .collection(DEMO_COOPERATIVE_COLLECTION)
            .doc(target.cooperative_id)
        : null;
    const lockRefs = Array.from(
      new Set([previousCooperativeId, target.cooperative_id].filter(Boolean)),
      (id) => db.collection(PURGE_LOCK_COLLECTION).doc(id),
    );
    const [sourceOrgSnapshot, targetOrgSnapshot, targetMasterSnapshot, ...locks] =
      await Promise.all([
        sourceOrgRef ? transaction.get(sourceOrgRef) : Promise.resolve(null),
        transaction.get(targetOrgRef),
        targetMasterRef
          ? transaction.get(targetMasterRef)
          : Promise.resolve(null),
        ...lockRefs.map((ref) => transaction.get(ref)),
      ]);
    if (locks.some((snapshot) => snapshot.exists && isActivePurgeLock(snapshot.data()))) {
      return { ok: false as const, error: "institution_purge_in_progress" };
    }
    const targetMaster = targetMasterSnapshot
      ? parseTestCooperativeMaster(
          targetMasterSnapshot.data(),
          target.cooperative_id,
        )
      : null;
    if (targetMasterRef && !targetMaster) {
      return { ok: false as const, error: "invalid_demo_cooperative_master" };
    }

    const targetOrganization = targetOrgSnapshot.exists
      ? (targetOrgSnapshot.data() as OrganizationRecord)
      : null;
    const testMetadata = buildSignupRootMetadata({
      cooperative: target,
      rootEntityId: uid,
      createdBy: admin.uid,
      createdAt: now,
    });
    const emailClassification = classifyCustomerEmail(user.email);
    transaction.update(userRef, {
      cooperativeId: target.cooperative_id,
      nh_org_id: target.cooperative_id,
      cooperativeName: target.cooperative_name,
      manualCooperativeName: FieldValue.delete(),
      dataClassification:
        testMetadata?.dataClassification ??
        (emailClassification === "TEST" ? "TEST" : "PRODUCTION"),
      sourceInstitutionId:
        testMetadata?.sourceInstitutionId ?? FieldValue.delete(),
      testScenarioId: testMetadata?.testScenarioId ?? FieldValue.delete(),
      testMetadata: testMetadata?.testMetadata ?? FieldValue.delete(),
      updatedAt: now,
    });
    if (user.status === "active") {
      transaction.set(
        targetOrgRef,
        {
          cooperativeId: target.cooperative_id,
          nh_org_id: target.cooperative_id,
          cooperativeName: target.cooperative_name,
          walletBalance: targetOrganization?.walletBalance ?? 0,
          users: Array.from(
            new Set([...(targetOrganization?.users ?? []), uid]),
          ),
          ...(testMetadata ?? {
            dataClassification: target.dataClassification,
          }),
          createdAt: targetOrganization?.createdAt ?? now,
          updatedAt: now,
        } satisfies OrganizationRecord,
        { merge: true },
      );
    }
    if (sourceOrgRef && sourceOrgSnapshot?.exists) {
      const sourceOrganization =
        sourceOrgSnapshot.data() as OrganizationRecord;
      transaction.update(sourceOrgRef, {
        users: (sourceOrganization.users ?? []).filter(
          (memberUid) => memberUid !== uid,
        ),
        updatedAt: now,
      });
    }
    if (user.status === "active" && targetMasterRef && targetMaster) {
      transaction.update(targetMasterRef, {
        signupStatus: nextDemoSignupStatus(
          targetMaster.signupStatus,
          "APPROVED",
        ),
        updatedAt: now,
        updatedBy: admin.uid,
      });
    }
    writeAuditLog(transaction, db, {
      actorUid: admin.uid,
      actorEmail: admin.email,
      action: "user.cooperative_changed",
      targetType: "user",
      targetId: uid,
      metadata: {
        previousCooperativeId: previousCooperativeId || null,
        nextCooperativeId: target.cooperative_id,
        reason,
      },
      createdAt: now,
    });
    return {
      ok: true as const,
      unchanged: false,
      cooperativeId: target.cooperative_id,
      cooperativeName: target.cooperative_name,
    };
  });

  if (!result.ok) {
    const status = result.error === "user_not_found" ? 404 : 409;
    return NextResponse.json(
      { ok: false, error: result.error },
      { status },
    );
  }
  return NextResponse.json(result);
}
