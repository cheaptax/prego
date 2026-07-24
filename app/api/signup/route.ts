import { NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { withoutUndefined } from "@/lib/firebase/clean";
import { resolveBusinessCardUrl } from "@/lib/business-card-url";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/server";
import type { UserRecord } from "@/lib/firebase/schema";
import { isValidKrMobilePhone, normalizeKrMobilePhone } from "@/lib/phone";
import {
  DEMO_COOPERATIVE_COLLECTION,
  isExistingSignupForCooperative,
  nextDemoSignupStatus,
  parseTestCooperativeMaster,
} from "@/lib/cooperatives/demo-cooperative";
import { resolveSignupCooperative } from "@/lib/cooperatives/server";
import {
  buildSignupRootMetadata,
  buildTestAuthSubjects,
} from "@/lib/test-data/root-metadata";
import { PURGE_LOCK_COLLECTION } from "@/lib/test-data/purge-job-types";
import { isActivePurgeLock } from "@/lib/test-data/purge-lock";
import {
  classifyCustomerEmail,
  hasUnlimitedTestSignup,
  isAllowedCustomerEmail,
} from "@/lib/test-data/email-classification";

export const runtime = "nodejs";

type Payload = {
  idToken?: string;
  name?: string;
  phone?: string;
  phoneVerificationIdToken?: string;
  email?: string;
  cooperativeId?: string;
  nh_org_id?: string;
  manualCooperativeName?: string;
  position?: string;
  duty?: string;
  businessCardUrl?: string;
  businessCardPath?: string;
  consents?: UserRecord["consents"];
};

type SignupResult = {
  grantedPoints: number;
  walletBalance: number;
  retried: boolean;
  status: UserRecord["status"];
};

class SignupRequestError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number
  ) {
    super(code);
  }
}

function getVerifiedPhone(decoded: { phone_number?: unknown }) {
  return typeof decoded.phone_number === "string"
    ? normalizeKrMobilePhone(decoded.phone_number)
    : "";
}

export async function POST(req: Request) {
  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const phone = normalizeKrMobilePhone(body.phone ?? "");

  if (
    !body.idToken ||
    !body.name?.trim() ||
    !phone ||
    !body.phoneVerificationIdToken ||
    !body.email?.trim() ||
    !(body.cooperativeId ?? body.nh_org_id)?.trim() ||
    !body.position?.trim() ||
    !body.duty?.trim() ||
    !body.consents?.terms ||
    !body.consents?.privacy
  ) {
    return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
  }

  if (!isValidKrMobilePhone(phone)) {
    return NextResponse.json({ ok: false, error: "invalid_phone" }, { status: 400 });
  }

  let decoded: DecodedIdToken;
  try {
    decoded = await adminAuth().verifyIdToken(body.idToken);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 401 });
  }

  let phoneDecoded: DecodedIdToken;
  try {
    phoneDecoded = await adminAuth().verifyIdToken(body.phoneVerificationIdToken);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_phone_verification" },
      { status: 401 }
    );
  }

  const verifiedPhone = getVerifiedPhone(phoneDecoded);
  if (verifiedPhone !== phone || !isValidKrMobilePhone(verifiedPhone)) {
    return NextResponse.json(
      { ok: false, error: "invalid_phone_verification" },
      { status: 400 }
    );
  }

  const phoneAuthTime = phoneDecoded.auth_time;
  const tenMinutesInSeconds = 10 * 60;
  if (
    typeof phoneAuthTime !== "number" ||
    Math.floor(Date.now() / 1000) - phoneAuthTime > tenMinutesInSeconds
  ) {
    return NextResponse.json(
      { ok: false, error: "phone_verification_expired" },
      { status: 400 }
    );
  }

  const email = body.email.trim().toLowerCase();
  if (decoded.email?.toLowerCase() !== email) {
    return NextResponse.json({ ok: false, error: "email_mismatch" }, { status: 400 });
  }
  if (!isAllowedCustomerEmail(email)) {
    return NextResponse.json(
      { ok: false, error: "unsupported_customer_email" },
      { status: 400 },
    );
  }

  const db = adminDb();
  const now = new Date().toISOString();
  const uid = decoded.uid;
  const dataClassification = classifyCustomerEmail(email);
  const requestedCooperativeId = (body.cooperativeId ?? body.nh_org_id)?.trim() ?? "";
  const selectedCooperative = await resolveSignupCooperative(
    requestedCooperativeId,
  );

  if (!selectedCooperative) {
    return NextResponse.json(
      { ok: false, error: "invalid_cooperative_id" },
      { status: 400 }
    );
  }
  if (
    selectedCooperative.isDemoInstitution &&
    dataClassification !== "TEST"
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid_cooperative_id" },
      { status: 400 },
    );
  }

  let businessCardUrl = body.businessCardUrl?.trim();
  const businessCardPath = body.businessCardPath?.trim();
  if (businessCardPath) {
    try {
      businessCardUrl = await resolveBusinessCardUrl({
        businessCardPath,
        businessCardUrl,
      });
    } catch {
      // keep client-provided URL if server resolution fails
    }
  }

  const baseUserRecord = {
    uid,
    name: body.name.trim(),
    phone,
    email,
    position: body.position.trim(),
    duty: body.duty.trim(),
    businessCardUrl,
    businessCardPath,
    consents: body.consents,
    role: "member",
    dataClassification:
      dataClassification === "TEST" ? "TEST" : "PRODUCTION",
    createdAt: now,
    updatedAt: now,
  } satisfies Omit<
    UserRecord,
    | "cooperativeId"
    | "cooperativeName"
    | "manualCooperativeName"
    | "status"
  >;

  const orgKey = selectedCooperative.cooperative_id;
  const userRef = db.collection("users").doc(uid);
  const signupMetadata = buildSignupRootMetadata({
    cooperative: selectedCooperative,
    rootEntityId: uid,
    createdBy: uid,
    createdAt: now,
  });
  const demoMasterRef =
    selectedCooperative.masterSource === "DEMO_FIRESTORE"
      ? db
          .collection(DEMO_COOPERATIVE_COLLECTION)
          .doc(selectedCooperative.cooperative_id)
      : null;

  let result: SignupResult;
  try {
    result = await db.runTransaction(async (transaction) => {
      const purgeLockSnapshot = await transaction.get(
        db.collection(PURGE_LOCK_COLLECTION).doc(orgKey),
      );
      if (
        purgeLockSnapshot.exists &&
        isActivePurgeLock(purgeLockSnapshot.data())
      ) {
        throw new SignupRequestError("institution_purge_in_progress", 409);
      }
      const userSnapshot = await transaction.get(userRef);
      const existingUser = userSnapshot.exists
        ? (userSnapshot.data() as UserRecord)
        : null;
      if (
        existingUser &&
        isExistingSignupForCooperative(existingUser, orgKey)
      ) {
        writeAuditLog(transaction, db, {
          actorUid: uid,
          actorEmail: email,
          action: "signup.retried",
          targetType: "user",
          targetId: uid,
          metadata: { cooperativeId: orgKey },
          createdAt: now,
        });
        return {
          grantedPoints: 0,
          walletBalance: 0,
          retried: true,
          status: existingUser.status,
        };
      }

      const phoneSnapshot = await transaction.get(
        db.collection("users").where("phone", "==", phone).limit(3)
      );
      const demoMasterSnapshot = demoMasterRef
        ? await transaction.get(demoMasterRef)
        : null;
      const accountCountForPhone = phoneSnapshot.docs.filter((doc) => doc.id !== uid).length;
      if (
        !hasUnlimitedTestSignup({ email, phone }) &&
        accountCountForPhone >= 2
      ) {
        throw new SignupRequestError("phone_account_limit_exceeded", 409);
      }
      const demoMaster = demoMasterSnapshot
        ? parseTestCooperativeMaster(
            demoMasterSnapshot.data(),
            selectedCooperative.cooperative_id,
          )
        : null;
      if (demoMasterRef && !demoMaster) {
        throw new SignupRequestError("invalid_cooperative_id", 409);
      }

      transaction.set(userRef, withoutUndefined({
        ...baseUserRecord,
        ...signupMetadata,
        cooperativeId: orgKey,
        nh_org_id: orgKey,
        cooperativeName: selectedCooperative.cooperative_name,
        status: "pending_cooperative_review",
      } satisfies UserRecord));

      if (signupMetadata) {
        for (const subject of buildTestAuthSubjects({
          primaryUserUid: uid,
          phoneAuthUid: phoneDecoded.uid,
          cooperative: selectedCooperative,
          createdAt: now,
        })) {
          transaction.set(
            db.collection("testAuthSubjects").doc(subject.authUid),
            subject,
          );
        }
      }

      if (demoMasterRef && demoMaster) {
        transaction.update(demoMasterRef, {
          signupStatus: nextDemoSignupStatus(
            demoMaster.signupStatus,
            "SUBMITTED",
          ),
          updatedAt: now,
          updatedBy: "signup-service",
        });
      }

      writeAuditLog(transaction, db, {
        actorUid: uid,
        actorEmail: email,
        action: "signup.submitted",
        targetType: "user",
        targetId: uid,
        metadata: {
          cooperativeId: orgKey,
          status: "pending_cooperative_review",
        },
        createdAt: now,
      });

      return {
        grantedPoints: 0,
        walletBalance: 0,
        retried: false,
        status: "pending_cooperative_review" as const,
      };
    });
  } catch (error) {
    if (error instanceof SignupRequestError) {
      return NextResponse.json(
        { ok: false, error: error.code },
        { status: error.status }
      );
    }
    throw error;
  }

  return NextResponse.json({
    ok: true,
    completion: {
      cooperativeName: selectedCooperative.cooperative_name,
      status: result.status === "active" ? "active" : "pending",
      walletBalance: result.walletBalance,
      grantedPoints: result.grantedPoints,
    },
  });
}
