import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/admin/rbac";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import {
  authErrorCode,
  authErrorStatus,
  requirePermission,
  writeAdminAuditLog,
} from "@/lib/firebase/server";
import type { PartnerRecord, UserRecord } from "@/lib/firebase/schema";
import {
  PARTNER_UNIQUE_KEYS_COLLECTION,
  filterPartnerList,
  normalizePartnerUniqueValue,
  paginatePartnerList,
  partnerUniqueKeyIds,
  type PartnerListItem,
} from "@/lib/partner-management";
import { isPartnerStatus, validatePartnerPayload } from "@/lib/partners";
import { isPartnerProfession } from "@/lib/partner-professions";

export const runtime = "nodejs";

export async function GET(req: Request) {
  let session;
  try {
    session = await requirePermission(req, "partners:read");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const url = new URL(req.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const partnerType = url.searchParams.get("type")?.trim() ?? "";
  const requestedProfession = url.searchParams.get("profession");
  const profession = isPartnerProfession(requestedProfession)
    ? requestedProfession
    : undefined;
  const requestedStatus = url.searchParams.get("status");
  const status = isPartnerStatus(requestedStatus) ? requestedStatus : undefined;
  const page = Number(url.searchParams.get("page") ?? 1);
  const pageSize = Number(url.searchParams.get("pageSize") ?? 20);
  const db = adminDb();
  const [partnerSnapshot, accountSnapshot] = await Promise.all([
    db.collection("partners").orderBy("updatedAt", "desc").get(),
    db.collection("users").where("role", "==", "partner").get(),
  ]);
  const memberCounts = new Map<string, number>();
  for (const doc of accountSnapshot.docs) {
    const linkedPartnerId = String(doc.data().partnerId ?? "");
    if (!linkedPartnerId) continue;
    memberCounts.set(
      linkedPartnerId,
      (memberCounts.get(linkedPartnerId) ?? 0) + 1,
    );
  }
  const allPartners: PartnerListItem[] = partnerSnapshot.docs.map((doc) => {
    const partner = doc.data() as PartnerRecord;
    return {
      ...partner,
      id: partner.id || doc.id,
      memberCount: memberCounts.get(partner.id || doc.id) ?? 0,
    };
  });
  const filtered = filterPartnerList(allPartners, {
    search,
    partnerType,
    profession,
    status,
  });
  const { items, pagination } = paginatePartnerList(filtered, page, pageSize);
  return NextResponse.json({
    ok: true,
    partners: items,
    pagination,
    filters: {
      partnerTypes: Array.from(
        new Set(allPartners.map((partner) => partner.partnerType)),
      ).sort(),
      professions: Array.from(
        new Set(allPartners.map((partner) => partner.profession ?? "OTHER")),
      ).sort(),
    },
    scope: session.context.scopes,
  });
}

export async function POST(req: Request) {
  let session;
  try {
    session = await requirePermission(req, "partners:create");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }

  const rawBody = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const payload = validatePartnerPayload(rawBody);
  if (!payload) {
    return NextResponse.json(
      { ok: false, error: "invalid_partner" },
      { status: 400 },
    );
  }
  const createLoginAccount = rawBody?.createLoginAccount === true;
  const loginPassword = String(rawBody?.loginPassword ?? "");
  if (
    createLoginAccount &&
    !hasPermission(session.context, "partners:manageMembers")
  ) {
    return NextResponse.json(
      { ok: false, error: "permission_denied" },
      { status: 403 },
    );
  }
  if (
    createLoginAccount &&
    (loginPassword.length < 8 ||
      !/[A-Za-z]/.test(loginPassword) ||
      !/[0-9]/.test(loginPassword))
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid_partner_account_password" },
      { status: 400 },
    );
  }

  const db = adminDb();
  const ref = db.collection("partners").doc();
  const now = new Date().toISOString();
  const existingSnapshot = await db.collection("partners").get();
  const normalizedName = normalizePartnerUniqueValue(payload.name);
  const duplicate = existingSnapshot.docs
    .map((doc) => doc.data() as PartnerRecord)
    .find(
      (partner) =>
        normalizePartnerUniqueValue(partner.name) === normalizedName ||
        normalizePartnerUniqueValue(partner.contactEmail) ===
          payload.contactEmail,
    );
  if (duplicate) {
    const error =
      normalizePartnerUniqueValue(duplicate.name) === normalizedName
        ? "duplicate_partner_name"
        : "duplicate_partner_email";
    return NextResponse.json({ ok: false, error }, { status: 409 });
  }
  const uniqueKeyIds = partnerUniqueKeyIds(payload);
  const partner: PartnerRecord = withoutUndefined({
    id: ref.id,
    ...payload,
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
  const accountEnabled = partner.status === "active";
  let authUser: { uid: string } | null = null;
  let partnerUser: UserRecord | null = null;
  if (createLoginAccount) {
    try {
      authUser = await adminAuth().createUser({
        email: partner.contactEmail,
        password: loginPassword,
        displayName: partner.managerName,
        emailVerified: true,
        disabled: !accountEnabled,
      });
      await adminAuth().setCustomUserClaims(authUser.uid, {
        partner: accountEnabled,
        partnerId: partner.id,
      });
      partnerUser = withoutUndefined({
        uid: authUser.uid,
        name: partner.managerName,
        phone: partner.contactPhone,
        email: partner.contactEmail,
        position: "제휴사 담당자",
        duty: partner.displayName,
        consents: {
          terms: false,
          privacy: false,
          marketing: false,
          email: false,
          sms: false,
          kakao: false,
        },
        role: "partner",
        partnerId: partner.id,
        accountStatus: accountEnabled ? "active" : "invited",
        status: accountEnabled ? "active" : "pending_cooperative_review",
        createdAt: now,
        updatedAt: now,
      } satisfies UserRecord);
    } catch (error) {
      if (authUser) {
        await adminAuth()
          .deleteUser(authUser.uid)
          .catch(() => undefined);
      }
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
  }

  let result;
  try {
    result = await db.runTransaction(async (transaction) => {
      const nameKeyRef = db
        .collection(PARTNER_UNIQUE_KEYS_COLLECTION)
        .doc(uniqueKeyIds.name);
      const emailKeyRef = db
        .collection(PARTNER_UNIQUE_KEYS_COLLECTION)
        .doc(uniqueKeyIds.contactEmail);
      const [nameKey, emailKey] = await Promise.all([
        transaction.get(nameKeyRef),
        transaction.get(emailKeyRef),
      ]);
      if (nameKey.exists) {
        return { ok: false as const, error: "duplicate_partner_name" };
      }
      if (emailKey.exists) {
        return { ok: false as const, error: "duplicate_partner_email" };
      }
      transaction.create(ref, partner);
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
      if (partnerUser) {
        transaction.create(
          db.collection("users").doc(partnerUser.uid),
          partnerUser,
        );
      }
      writeAdminAuditLog(transaction, db, {
        actorId: session.decoded.uid,
        actorEmail: session.decoded.email,
        actorRole: session.context.adminRole,
        requiredPermission: "partners:create",
        action: "partner.created",
        targetType: "partner",
        targetId: partner.id,
        after: partner,
        metadata: {
          partnerName: partner.displayName,
          status: partner.status,
          fields: partner.fields.join(","),
          loginAccountCreated: Boolean(partnerUser),
        },
        createdAt: now,
      });
      return { ok: true as const };
    });
  } catch {
    if (authUser) {
      await adminAuth()
        .deleteUser(authUser.uid)
        .catch(() => undefined);
    }
    return NextResponse.json(
      { ok: false, error: "partner_create_failed" },
      { status: 500 },
    );
  }
  if (!result.ok) {
    if (authUser) {
      await adminAuth()
        .deleteUser(authUser.uid)
        .catch(() => undefined);
    }
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    partner,
    accountCreated: Boolean(partnerUser),
    accessEnabled: accountEnabled && Boolean(partnerUser),
  });
}
