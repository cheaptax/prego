import {
  getAccountStatus,
  getAdminRole,
  getEffectivePermissions,
  isAdminRole,
} from "@/lib/admin/rbac";
import type {
  AdminStatus,
  PartnerRecord,
  PartnerStatus,
  UserRecord,
} from "@/lib/firebase/schema";
import {
  getDefaultPortal,
  type AccountStatus,
  type AccountType,
  type AuthenticatedAccountContext,
  type AuthenticatedAccountRole,
} from "@/lib/auth/portal";

export type FirebaseAccountIdentity = {
  uid: string;
  email?: string;
  admin?: unknown;
  partner?: unknown;
  partnerId?: unknown;
};

export type AccountContextResolutionErrorCode =
  | "profile_not_found"
  | "duplicate_profile"
  | "account_configuration_error"
  | "partner_not_found";

export class AccountContextResolutionError extends Error {
  readonly code: AccountContextResolutionErrorCode;

  constructor(code: AccountContextResolutionErrorCode) {
    super(code);
    this.name = "AccountContextResolutionError";
    this.code = code;
  }
}

export type ResolveAccountContextInput = {
  identity: FirebaseAccountIdentity;
  profiles: readonly UserRecord[];
  partner?: PartnerRecord | null;
};

function normalizeEmail(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function mapAdminStatus(status: AdminStatus | unknown): AccountStatus {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "invited":
      return "INVITED";
    case "suspended":
      return "SUSPENDED";
    case "disabled":
      return "DISABLED";
    default:
      return "DISABLED";
  }
}

function mapCustomerStatus(
  status: UserRecord["status"] | unknown,
): AccountStatus {
  switch (status) {
    case "active":
    case "temporary_quote_member":
      return "ACTIVE";
    case "pending_cooperative_review":
      return "INVITED";
    case "rejected":
      return "DISABLED";
    default:
      return "DISABLED";
  }
}

function mapPartnerStatus(status: PartnerStatus | unknown): AccountStatus {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "pending":
      return "INVITED";
    case "paused":
      return "SUSPENDED";
    case "terminated":
      return "DISABLED";
    default:
      return "DISABLED";
  }
}

const STATUS_PRIORITY: Record<AccountStatus, number> = {
  ACTIVE: 0,
  INVITED: 1,
  SUSPENDED: 2,
  DISABLED: 3,
};

function moreRestrictiveStatus(
  left: AccountStatus,
  right: AccountStatus,
) {
  return STATUS_PRIORITY[left] >= STATUS_PRIORITY[right] ? left : right;
}

function assertClaimProfileConsistency(
  identity: FirebaseAccountIdentity,
  profile: UserRecord,
) {
  const hasAdminClaim = identity.admin === true;
  const hasPartnerClaim = identity.partner === true;

  if (hasAdminClaim && hasPartnerClaim) {
    throw new AccountContextResolutionError(
      "account_configuration_error",
    );
  }

  if (
    (profile.role === "admin" && !hasAdminClaim) ||
    (profile.role === "partner" && !hasPartnerClaim) ||
    (profile.role === "member" && (hasAdminClaim || hasPartnerClaim))
  ) {
    throw new AccountContextResolutionError(
      "account_configuration_error",
    );
  }

  if (
    profile.role !== "admin" &&
    hasAdminClaim
  ) {
    throw new AccountContextResolutionError(
      "account_configuration_error",
    );
  }

  if (
    profile.role !== "partner" &&
    hasPartnerClaim
  ) {
    throw new AccountContextResolutionError(
      "account_configuration_error",
    );
  }
}

function accountTypeForRole(role: UserRecord["role"]): AccountType {
  switch (role) {
    case "member":
      return "CUSTOMER";
    case "partner":
      return "PARTNER_OPERATOR";
    case "admin":
      return "INTERNAL_OPERATOR";
  }
}

function isUserRole(value: unknown): value is UserRecord["role"] {
  return value === "member" || value === "partner" || value === "admin";
}

export function resolveAccountContextFromRecords({
  identity,
  profiles,
  partner,
}: ResolveAccountContextInput): AuthenticatedAccountContext {
  if (profiles.length === 0) {
    throw new AccountContextResolutionError("profile_not_found");
  }
  if (profiles.length !== 1) {
    throw new AccountContextResolutionError("duplicate_profile");
  }

  const profile = profiles[0];
  const tokenEmail = normalizeEmail(identity.email);
  const profileEmail = normalizeEmail(profile.email);
  if (
    !identity.uid ||
    profile.uid !== identity.uid ||
    !isUserRole(profile.role) ||
    !tokenEmail ||
    !profileEmail ||
    tokenEmail !== profileEmail
  ) {
    throw new AccountContextResolutionError(
      "account_configuration_error",
    );
  }

  assertClaimProfileConsistency(identity, profile);
  if (profile.role === "admin" && !isAdminRole(profile.adminRole)) {
    throw new AccountContextResolutionError(
      "account_configuration_error",
    );
  }

  const accountType = accountTypeForRole(profile.role);
  let role: AuthenticatedAccountRole =
    profile.role === "admin" ? getAdminRole(profile) : profile.role;
  let status =
    profile.role === "member"
      ? mapCustomerStatus(profile.status)
      : mapAdminStatus(getAccountStatus(profile));
  let partnerId: string | undefined;

  if (profile.role === "partner") {
    partnerId = profile.partnerId?.trim();
    if (!partnerId || !partner || partner.id !== partnerId) {
      throw new AccountContextResolutionError("partner_not_found");
    }
    if (
      typeof identity.partnerId === "string" &&
      identity.partnerId.trim() &&
      identity.partnerId.trim() !== partnerId
    ) {
      throw new AccountContextResolutionError(
        "account_configuration_error",
      );
    }
    status = moreRestrictiveStatus(
      status,
      mapPartnerStatus(partner.status),
    );
    role = "partner";
  }

  return {
    uid: identity.uid,
    email: profileEmail,
    accountType,
    role,
    status,
    ...(profile.role === "member"
      ? {
          customerAccessLevel:
            profile.status === "temporary_quote_member"
              ? ("QUOTE_ONLY" as const)
              : ("FULL" as const),
        }
      : {}),
    partnerId,
    permissions:
      profile.role === "admin" ? getEffectivePermissions(profile) : [],
    defaultPortal: getDefaultPortal(accountType),
  };
}
