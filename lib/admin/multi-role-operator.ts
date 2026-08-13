import type { UserRecord as AuthUserRecord } from "firebase-admin/auth";
import { withoutUndefined } from "@/lib/firebase/clean";
import type {
  AdminRole,
  AdminStatus,
  UserRecord as ProfileRecord,
} from "@/lib/firebase/schema";
import type { PortalType } from "@/lib/auth/portal";
import {
  isMultiRoleTestEmail,
  mergeEnabledPortals,
  multiRoleClaimsFromProfile,
  normalizeEnabledPortals,
} from "@/lib/test-data/multi-role-test-accounts";

export type PromoteOperatorInput = {
  authUser: AuthUserRecord;
  existingProfile: ProfileRecord | null;
  name: string;
  email: string;
  position: string;
  duty: string;
  status: ProfileRecord["status"];
  adminRole: AdminRole;
  adminCapabilityAllow: NonNullable<ProfileRecord["adminCapabilityAllow"]>;
  adminCapabilityDeny: NonNullable<ProfileRecord["adminCapabilityDeny"]>;
  now: string;
};

export function canPromoteEmailToMultiRoleOperator(email: string) {
  return isMultiRoleTestEmail(email);
}

export function buildMultiRoleOperatorProfile(
  input: PromoteOperatorInput,
): ProfileRecord {
  const previous = input.existingProfile;
  const previousPortals = normalizeEnabledPortals(previous?.enabledPortals);
  const additions: PortalType[] = ["admin", "customer"];
  if (previous?.partnerId?.trim()) additions.push("partner");
  const enabledPortals = mergeEnabledPortals(previousPortals, additions);

  return withoutUndefined({
    ...(previous ?? {
      phone: "",
      consents: {
        terms: false,
        privacy: false,
        marketing: false,
        email: false,
        sms: false,
        kakao: false,
      },
    }),
    uid: input.authUser.uid,
    name: input.name,
    phone: previous?.phone ?? "",
    email: input.email,
    position: input.position,
    duty: input.duty,
    consents: previous?.consents ?? {
      terms: false,
      privacy: false,
      marketing: false,
      email: false,
      sms: false,
      kakao: false,
    },
    role: "admin",
    adminRole: input.adminRole,
    adminCapabilityAllow: input.adminCapabilityAllow,
    adminCapabilityDeny: input.adminCapabilityDeny,
    accountStatus: input.status === "active" ? "active" : "disabled",
    status: input.status === "active" ? "active" : "rejected",
    multiRoleTestAccount: true,
    enabledPortals,
    createdAt: previous?.createdAt ?? input.now,
    updatedAt: input.now,
  }) as ProfileRecord;
}

export function buildMultiRoleOperatorClaims(input: {
  authUser: AuthUserRecord;
  profile: ProfileRecord;
  adminEnabled: boolean;
}) {
  return multiRoleClaimsFromProfile({
    profile: input.profile,
    existingClaims: input.authUser.customClaims ?? {},
    adminEnabled: input.adminEnabled,
  });
}

export type AttachPartnerInput = {
  authUser: AuthUserRecord;
  existingProfile: ProfileRecord;
  partnerId: string;
  partnerDisplayName: string;
  name: string;
  phone: string;
  position: string;
  duty: string;
  accountStatus: AdminStatus;
  status: ProfileRecord["status"];
  now: string;
};

export function buildMultiRolePartnerAttachment(
  input: AttachPartnerInput,
): ProfileRecord {
  const keepAdmin =
    input.existingProfile.role === "admin" ||
    Boolean(input.existingProfile.adminRole);
  const enabledPortals = mergeEnabledPortals(
    normalizeEnabledPortals(input.existingProfile.enabledPortals),
    keepAdmin ? ["partner", "admin", "customer"] : ["partner", "customer"],
  );

  return withoutUndefined({
    ...input.existingProfile,
    uid: input.authUser.uid,
    name: input.name,
    phone: input.phone || input.existingProfile.phone || "",
    email: input.existingProfile.email,
    position: input.position,
    duty: input.duty || input.partnerDisplayName,
    partnerId: input.partnerId,
    accountStatus: input.accountStatus,
    status: input.status,
    multiRoleTestAccount: true,
    enabledPortals,
    ...(keepAdmin
      ? {
          role: "admin" as const,
          adminRole: input.existingProfile.adminRole,
          adminCapabilityAllow: input.existingProfile.adminCapabilityAllow,
          adminCapabilityDeny: input.existingProfile.adminCapabilityDeny,
        }
      : {
          role: "partner" as const,
        }),
    updatedAt: input.now,
  }) as ProfileRecord;
}
