import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import {
  addAdminAuditLog,
  authErrorCode,
  authErrorStatus,
  requirePermission,
} from "@/lib/firebase/server";
import type {
  PartnerApplicationRecord,
  PartnerRecord,
  UserRecord,
} from "@/lib/firebase/schema";
import {
  PARTNER_UNIQUE_KEYS_COLLECTION,
  partnerUniqueKeyIds,
} from "@/lib/partner-management";
import {
  escapeEmailHtml,
  getAppBaseUrl,
  sendTransactionalEmail,
} from "@/lib/email/resend";

export const runtime = "nodejs";

type Params = { params: Promise<{ applicationId: string }> };
type Payload = {
  action?: "approve" | "reject";
  reviewNote?: string;
  businessRegistrationNumber?: string;
  businessAddress?: string;
};

export async function PATCH(req: Request, { params }: Params) {
  let session;
  try {
    session = await requirePermission(req, "partners:create");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const { applicationId } = await params;
  const body = (await req.json().catch(() => null)) as Payload | null;
  const action = body?.action;
  const reviewNote = body?.reviewNote?.trim() ?? "";
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json(
      { ok: false, error: "invalid_action" },
      { status: 400 },
    );
  }

  const db = adminDb();
  const applicationRef = db.collection("partnerApplications").doc(applicationId);
  const applicationSnapshot = await applicationRef.get();
  if (!applicationSnapshot.exists) {
    return NextResponse.json(
      { ok: false, error: "application_not_found" },
      { status: 404 },
    );
  }
  const application = applicationSnapshot.data() as PartnerApplicationRecord;
  if (application.status !== "pending") {
    return NextResponse.json(
      { ok: false, error: "application_already_reviewed" },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  if (action === "reject") {
    await applicationRef.set(
      {
        status: "rejected",
        reviewNote,
        reviewedBy: session.decoded.uid,
        reviewedByEmail: session.decoded.email,
        reviewedAt: now,
        updatedAt: now,
      } satisfies Partial<PartnerApplicationRecord>,
      { merge: true },
    );
    await addAdminAuditLog(db, {
      actorId: session.decoded.uid,
      actorEmail: session.decoded.email,
      actorRole: session.context.adminRole,
      requiredPermission: "partners:create",
      action: "partner_application.rejected",
      targetType: "partnerApplication",
      targetId: applicationId,
      metadata: { reviewNote },
      createdAt: now,
    });
    return NextResponse.json({ ok: true });
  }

  const businessRegistrationNumber = String(
    body?.businessRegistrationNumber ??
    application.businessRegistrationNumber ??
    "",
  ).trim();
  const businessAddress = String(
    body?.businessAddress ??
    application.businessAddress ??
    "",
  ).trim();
  if (
    !/^\d{3}-?\d{2}-?\d{5}$/.test(businessRegistrationNumber) ||
    !businessAddress ||
    businessAddress.length > 300
  ) {
    return NextResponse.json(
      { ok: false, error: "application_supplier_profile_incomplete" },
      { status: 409 },
    );
  }

  const partnerRef = db.collection("partners").doc();
  const uniqueKeys = partnerUniqueKeyIds({
    name: application.organizationName,
    contactEmail: application.contactEmail,
  });
  const partner: PartnerRecord = withoutUndefined({
    id: partnerRef.id,
    name: application.organizationName,
    displayName: application.displayName,
    partnerType: application.partnerType,
    profession: application.profession,
    fields: application.fields,
    managerName: application.managerName,
    contactEmail: application.contactEmail,
    contactPhone: application.contactPhone,
    businessRegistrationNumber,
    businessAddress,
    status: "active",
    pointMin: 30000,
    pointMax: 100000,
    memo: application.memo,
    createdBy: session.decoded.uid,
    createdByEmail: session.decoded.email,
    createdAt: now,
    updatedBy: session.decoded.uid,
    updatedByEmail: session.decoded.email,
    updatedAt: now,
    statusChangedAt: now,
    statusChangedBy: session.decoded.uid,
    statusChangedByEmail: session.decoded.email,
  } satisfies PartnerRecord);

  let authUser;
  try {
    authUser = await adminAuth().createUser({
      email: application.contactEmail,
      displayName: application.managerName,
      emailVerified: true,
      disabled: false,
    });
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "";
    return NextResponse.json(
      {
        ok: false,
        error:
          code === "auth/email-already-exists"
            ? "partner_account_email_exists"
            : "partner_account_create_failed",
      },
      { status: code === "auth/email-already-exists" ? 409 : 500 },
    );
  }

  const user: UserRecord = withoutUndefined({
    uid: authUser.uid,
    name: application.managerName,
    phone: application.contactPhone,
    email: application.contactEmail,
    position: "제휴 전문가",
    duty: application.displayName,
    consents: {
      terms: false,
      privacy: application.privacyConsent,
      marketing: false,
      email: true,
      sms: false,
      kakao: false,
    },
    role: "partner",
    partnerId: partner.id,
    accountStatus: "active",
    status: "active",
    createdAt: now,
    updatedAt: now,
  } satisfies UserRecord);

  try {
    await db.runTransaction(async (transaction) => {
      const nameKeyRef = db
        .collection(PARTNER_UNIQUE_KEYS_COLLECTION)
        .doc(uniqueKeys.name);
      const emailKeyRef = db
        .collection(PARTNER_UNIQUE_KEYS_COLLECTION)
        .doc(uniqueKeys.contactEmail);
      const [freshApplication, nameKey, emailKey] = await Promise.all([
        transaction.get(applicationRef),
        transaction.get(nameKeyRef),
        transaction.get(emailKeyRef),
      ]);
      if (
        !freshApplication.exists ||
        (freshApplication.data() as PartnerApplicationRecord).status !==
          "pending"
      ) {
        throw new Error("application_already_reviewed");
      }
      if (nameKey.exists) throw new Error("duplicate_partner_name");
      if (emailKey.exists) throw new Error("duplicate_partner_email");

      transaction.create(partnerRef, partner);
      transaction.create(nameKeyRef, {
        kind: "name",
        partnerId: partner.id,
        createdAt: now,
      });
      transaction.create(emailKeyRef, {
        kind: "contactEmail",
        partnerId: partner.id,
        createdAt: now,
      });
      transaction.set(db.collection("users").doc(authUser.uid), user);
      transaction.set(
        applicationRef,
        {
          status: "approved",
          approvedPartnerId: partner.id,
          approvedAccountUid: authUser.uid,
          businessRegistrationNumber,
          businessAddress,
          reviewNote,
          reviewedBy: session.decoded.uid,
          reviewedByEmail: session.decoded.email,
          reviewedAt: now,
          updatedAt: now,
        } satisfies Partial<PartnerApplicationRecord>,
        { merge: true },
      );
    });
    await adminAuth().setCustomUserClaims(authUser.uid, {
      partner: true,
      partnerId: partner.id,
    });
  } catch (error) {
    await adminAuth().deleteUser(authUser.uid).catch(() => undefined);
    const code = error instanceof Error ? error.message : "approve_failed";
    return NextResponse.json(
      { ok: false, error: code },
      { status: code.startsWith("duplicate_") ? 409 : 500 },
    );
  }

  const resetLink = await adminAuth().generatePasswordResetLink(
    application.contactEmail,
    { url: `${getAppBaseUrl()}/partner` },
  );
  await sendTransactionalEmail({
    to: application.contactEmail,
    subject: "[농협지원센터] 제휴사 가입이 승인되었습니다",
    html: `<p>${escapeEmailHtml(application.managerName)}님, 제휴사 가입이 승인되었습니다.</p><p><a href="${escapeEmailHtml(resetLink)}">비밀번호를 설정하고 제휴사 포털로 이동하기</a></p>`,
    text: `${application.managerName}님, 제휴사 가입이 승인되었습니다.\n비밀번호 설정: ${resetLink}`,
    idempotencyKey: `partner-application-approved/${applicationId}`,
  });
  await addAdminAuditLog(db, {
    actorId: session.decoded.uid,
    actorEmail: session.decoded.email,
    actorRole: session.context.adminRole,
    requiredPermission: "partners:create",
    action: "partner_application.approved",
    targetType: "partnerApplication",
    targetId: applicationId,
    metadata: {
      partnerId: partner.id,
      accountUid: authUser.uid,
    },
    createdAt: now,
  });

  return NextResponse.json({ ok: true, partner, accountUid: authUser.uid });
}
