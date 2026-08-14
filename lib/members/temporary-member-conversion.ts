import type { Firestore } from "firebase-admin/firestore";
import type {
  OrganizationRecord,
  PointLedgerRecord,
  PointTransactionRecord,
  UserRecord,
} from "@/lib/firebase/schema";
import type { ResolvedSignupCooperative } from "@/lib/cooperatives/server";
import {
  DEMO_COOPERATIVE_COLLECTION,
  nextDemoSignupStatus,
  parseTestCooperativeMaster,
} from "@/lib/cooperatives/demo-cooperative";
import { signupPointPolicy } from "@/lib/platform";
import { isTemporaryQuoteMember } from "@/lib/members/temporary-quote-member";
import { hasUnlimitedTestSignup } from "@/lib/test-data/email-classification";
import { buildSignupRootMetadata } from "@/lib/test-data/root-metadata";

export { pickQuotedCooperative } from "@/lib/members/quoted-cooperative";

const ALLOWED_DUTIES = new Set([
  "accounting",
  "tax",
  "general",
  "hr",
  "audit",
  "member",
  "other",
]);

export type TemporaryMemberConversionInput = {
  cooperativeId: string;
  position: string;
  duty: string;
  conversionConsent: boolean;
  existingConsents?: UserRecord["consents"] | null;
};

export function validateTemporaryMemberConversion(
  input: TemporaryMemberConversionInput,
) {
  const cooperativeId = input.cooperativeId.trim();
  const position = input.position.trim();
  const duty = input.duty.trim();
  if (!cooperativeId) throw new Error("missing_cooperative");
  if (!position || position.length > 100) throw new Error("invalid_position");
  if (!ALLOWED_DUTIES.has(duty)) throw new Error("invalid_duty");
  if (input.conversionConsent !== true) {
    throw new Error("consent_required");
  }
  const existing = input.existingConsents;
  return {
    cooperativeId,
    position,
    duty,
    consents: {
      terms: true,
      privacy: existing?.privacy !== false,
      marketing: existing?.marketing === true,
      email: existing?.email === true,
      sms: existing?.sms === true,
      kakao: existing?.kakao === true,
    } satisfies UserRecord["consents"],
  };
}

export async function convertTemporaryMember(input: {
  db: Firestore;
  uid: string;
  cooperative: ResolvedSignupCooperative;
  conversion: TemporaryMemberConversionInput;
  now?: string;
}) {
  const conversion = validateTemporaryMemberConversion(input.conversion);
  if (conversion.cooperativeId !== input.cooperative.cooperative_id) {
    throw new Error("invalid_cooperative");
  }
  const now = input.now ?? new Date().toISOString();
  const userRef = input.db.collection("users").doc(input.uid);
  const testMetadata = buildSignupRootMetadata({
    cooperative: input.cooperative,
    rootEntityId: input.uid,
    createdBy: input.uid,
    createdAt: now,
  });

  return input.db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    if (!userSnapshot.exists) throw new Error("profile_not_found");
    const user = userSnapshot.data() as UserRecord;
    if (user.status === "active") {
      return {
        alreadyActive: true,
        grantedPoints: 0,
        walletBalance: 0,
      };
    }
    if (!isTemporaryQuoteMember(user)) {
      throw new Error("temporary_membership_required");
    }

    const phoneSnapshot = await transaction.get(
      input.db.collection("users").where("phone", "==", user.phone).limit(3),
    );
    const otherPhoneAccounts = phoneSnapshot.docs.filter(
      (document) => document.id !== input.uid,
    ).length;
    if (
      !hasUnlimitedTestSignup({ email: user.email, phone: user.phone }) &&
      otherPhoneAccounts >= 2
    ) {
      throw new Error("phone_account_limit_exceeded");
    }

    const orgRef = input.db
      .collection("organizations")
      .doc(conversion.cooperativeId);
    const orgSnapshot = await transaction.get(orgRef);
    const demoMasterRef =
      input.cooperative.masterSource === "DEMO_FIRESTORE"
        ? input.db
            .collection(DEMO_COOPERATIVE_COLLECTION)
            .doc(conversion.cooperativeId)
        : null;
    const demoMasterSnapshot = demoMasterRef
      ? await transaction.get(demoMasterRef)
      : null;
    const demoMaster = demoMasterSnapshot
      ? parseTestCooperativeMaster(
          demoMasterSnapshot.data(),
          conversion.cooperativeId,
        )
      : null;
    if (demoMasterRef && !demoMaster) {
      throw new Error("invalid_cooperative");
    }
    const existingOrganization = orgSnapshot.exists
      ? (orgSnapshot.data() as OrganizationRecord)
      : null;
    const wasPreviouslyJoined = Boolean(
      existingOrganization?.users?.includes(input.uid),
    );
    const isFirstUser = !existingOrganization;
    const grantedPoints = wasPreviouslyJoined
      ? 0
      : signupPointPolicy.userJoinGrant +
        (isFirstUser ? signupPointPolicy.firstOrganizationGrant : 0);
    const startingBalance = existingOrganization?.walletBalance ?? 0;
    const walletBalance = startingBalance + grantedPoints;

    transaction.set(
      orgRef,
      {
        cooperativeId: conversion.cooperativeId,
        nh_org_id: conversion.cooperativeId,
        cooperativeName: input.cooperative.cooperative_name,
        walletBalance,
        users: Array.from(
          new Set([...(existingOrganization?.users ?? []), input.uid]),
        ),
        ...testMetadata,
        createdAt: existingOrganization?.createdAt ?? now,
        updatedAt: now,
      } satisfies OrganizationRecord,
      { merge: true },
    );

    transaction.set(
      userRef,
      {
        cooperativeId: conversion.cooperativeId,
        nh_org_id: conversion.cooperativeId,
        cooperativeName: input.cooperative.cooperative_name,
        position: conversion.position,
        duty: conversion.duty,
        consents: {
          terms: true,
          privacy: user.consents?.privacy !== false,
          marketing: user.consents?.marketing === true,
          email: user.consents?.email === true,
          sms: user.consents?.sms === true,
          kakao: user.consents?.kakao === true,
        },
        ...testMetadata,
        status: "active",
        temporaryMember: {
          source:
            user.temporaryMember?.source ?? "audit_quote_request",
          sourceRequestIds: user.temporaryMember?.sourceRequestIds ?? [],
          ...(user.temporaryMember?.activatedAt
            ? { activatedAt: user.temporaryMember.activatedAt }
            : { activatedAt: now }),
          convertedAt: now,
        },
        updatedAt: now,
      } satisfies Partial<UserRecord>,
      { merge: true },
    );
    if (demoMasterRef && demoMaster) {
      transaction.update(demoMasterRef, {
        signupStatus: nextDemoSignupStatus(
          demoMaster.signupStatus,
          "APPROVED",
        ),
        updatedAt: now,
        updatedBy: input.uid,
      });
    }

    let runningBalance = startingBalance;
    if (!wasPreviouslyJoined && isFirstUser) {
      const ledgerRef = input.db.collection("pointLedger").doc();
      const transactionRef = input.db.collection("point_transactions").doc();
      runningBalance += signupPointPolicy.firstOrganizationGrant;
      transaction.set(ledgerRef, {
        id: ledgerRef.id,
        cooperativeId: conversion.cooperativeId,
        nh_org_id: conversion.cooperativeId,
        userId: input.uid,
        event: "first_org_signup",
        points: signupPointPolicy.firstOrganizationGrant,
        balanceAfter: runningBalance,
        reason: "견적 임시회원 정회원 전환 시 농협 최초 가입 지급",
        createdAt: now,
      } satisfies PointLedgerRecord);
      transaction.set(transactionRef, {
        id: transactionRef.id,
        cooperativeId: conversion.cooperativeId,
        nh_org_id: conversion.cooperativeId,
        user_id: input.uid,
        type: "first_org_signup",
        amount: signupPointPolicy.firstOrganizationGrant,
        balance_before: startingBalance,
        balance_after: runningBalance,
        reason: "견적 임시회원 정회원 전환 시 농협 최초 가입 지급",
        createdAt: now,
      } satisfies PointTransactionRecord);
    }
    if (!wasPreviouslyJoined) {
      const ledgerRef = input.db.collection("pointLedger").doc();
      const transactionRef = input.db.collection("point_transactions").doc();
      const before = runningBalance;
      runningBalance += signupPointPolicy.userJoinGrant;
      transaction.set(ledgerRef, {
        id: ledgerRef.id,
        cooperativeId: conversion.cooperativeId,
        nh_org_id: conversion.cooperativeId,
        userId: input.uid,
        event: "user_signup",
        points: signupPointPolicy.userJoinGrant,
        balanceAfter: runningBalance,
        reason: "견적 임시회원 정회원 전환 가입 지급",
        createdAt: now,
      } satisfies PointLedgerRecord);
      transaction.set(transactionRef, {
        id: transactionRef.id,
        cooperativeId: conversion.cooperativeId,
        nh_org_id: conversion.cooperativeId,
        user_id: input.uid,
        type: "user_signup",
        amount: signupPointPolicy.userJoinGrant,
        balance_before: before,
        balance_after: runningBalance,
        reason: "견적 임시회원 정회원 전환 가입 지급",
        createdAt: now,
      } satisfies PointTransactionRecord);
    }

    return { alreadyActive: false, grantedPoints, walletBalance };
  });
}
