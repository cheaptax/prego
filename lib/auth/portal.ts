import type {
  AdminPermission,
  AdminRole,
} from "@/lib/firebase/schema";

export type PortalType = "customer" | "partner" | "admin";

export type AccountType =
  | "CUSTOMER"
  | "PARTNER_OPERATOR"
  | "INTERNAL_OPERATOR";

export type AccountStatus =
  | "ACTIVE"
  | "INVITED"
  | "SUSPENDED"
  | "DISABLED";

export type AuthenticatedAccountRole =
  | "member"
  | "partner"
  | AdminRole;

export type AuthenticatedAccountContext = {
  uid: string;
  email: string;
  accountType: AccountType;
  role: AuthenticatedAccountRole;
  status: AccountStatus;
  customerAccessLevel?: "FULL" | "QUOTE_ONLY";
  partnerId?: string;
  permissions: AdminPermission[];
  defaultPortal: PortalType;
};

export type PortalAccessResult = {
  allowed: boolean;
  reason:
    | "allowed"
    | "portal_mismatch"
    | "approval_pending"
    | "account_unavailable";
  requestedPortal: PortalType;
  defaultPortal: PortalType;
  redirectPath: string | null;
};

export const PORTAL_HOME_PATHS: Record<PortalType, string> = {
  customer: "/mypage",
  partner: "/partner",
  admin: "/admin",
};

export const PORTAL_LOGIN_PATHS: Record<PortalType, string> = {
  customer: "/login",
  partner: "/partner/login",
  admin: "/admin/login",
};

const ACCOUNT_PORTALS: Record<AccountType, PortalType> = {
  CUSTOMER: "customer",
  PARTNER_OPERATOR: "partner",
  INTERNAL_OPERATOR: "admin",
};

export function isPortalType(value: unknown): value is PortalType {
  return value === "customer" || value === "partner" || value === "admin";
}

export function getDefaultPortal(
  account: AccountType | Pick<AuthenticatedAccountContext, "accountType">,
): PortalType {
  const accountType =
    typeof account === "string" ? account : account.accountType;
  return ACCOUNT_PORTALS[accountType];
}

export function getPortalHomePath(
  account: AccountType | Pick<AuthenticatedAccountContext, "accountType">,
) {
  return PORTAL_HOME_PATHS[getDefaultPortal(account)];
}

export function getLoginPathForPortal(portal: PortalType) {
  return PORTAL_LOGIN_PATHS[portal];
}

export function getPostLoginPath(account: AuthenticatedAccountContext) {
  if (
    account.accountType === "CUSTOMER" &&
    account.customerAccessLevel === "QUOTE_ONLY"
  ) {
    return "/mypage/quotes";
  }
  if (
    account.accountType === "CUSTOMER" &&
    account.status === "INVITED"
  ) {
    return "/pending-approval";
  }
  return account.status === "ACTIVE" ? getPortalHomePath(account) : null;
}

export function canAccessPortal(
  account: AuthenticatedAccountContext,
  portal: PortalType,
) {
  return (
    account.status === "ACTIVE" &&
    getDefaultPortal(account) === portal
  );
}

export function getPortalMismatchResult(
  account: AuthenticatedAccountContext,
  requestedPortal: PortalType,
): PortalAccessResult {
  const defaultPortal = getDefaultPortal(account);
  const redirectPath = getPostLoginPath(account);
  const approvalPending =
    account.accountType === "CUSTOMER" &&
    account.status === "INVITED";

  if (account.status !== "ACTIVE" && !approvalPending) {
    return {
      allowed: false,
      reason: "account_unavailable",
      requestedPortal,
      defaultPortal,
      redirectPath: null,
    };
  }

  if (defaultPortal !== requestedPortal) {
    return {
      allowed: false,
      reason: "portal_mismatch",
      requestedPortal,
      defaultPortal,
      redirectPath,
    };
  }

  if (approvalPending) {
    return {
      allowed: false,
      reason: "approval_pending",
      requestedPortal,
      defaultPortal,
      redirectPath,
    };
  }

  return {
    allowed: true,
    reason: "allowed",
    requestedPortal,
    defaultPortal,
    redirectPath,
  };
}

export type PortalSessionResponse =
  | {
      ok: true;
      account: AuthenticatedAccountContext;
      redirectPath: string;
    }
  | {
      ok: false;
      error:
        | "portal_mismatch"
        | "account_unavailable"
        | "invalid_request"
        | "authentication_failed";
      redirectPath?: string;
    };
