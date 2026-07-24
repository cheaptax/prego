import {
  ADMIN_PERMISSIONS,
  ADMIN_ROLE_PRESETS,
  ADMIN_ROLE_RANK,
  ADMIN_ROLES,
  getAccountStatus,
  getAdminRole,
} from "@/lib/admin/rbac";
import type {
  AdminPermission,
  AdminRole,
  AdminScope,
  AdminStatus,
  UserRecord,
} from "@/lib/firebase/schema";

const LEGACY_PERMISSIONS = new Set<AdminPermission>([
  "admin:read",
  "operators:write",
  "partners:write",
  "points:write",
]);

export const MANAGEABLE_ADMIN_PERMISSIONS = ADMIN_PERMISSIONS.filter(
  (permission) => !LEGACY_PERMISSIONS.has(permission),
);

export const OPERATOR_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

export type OperatorListItem = UserRecord & {
  accountStatus: AdminStatus;
  scopes: AdminScope[];
  partnerName?: string;
  lastLoginAt?: string;
};

export type OperatorFormInput = {
  mode: "create" | "edit";
  name: string;
  email: string;
  password?: string;
  adminRole: AdminRole;
};

export type OperatorFormErrors = Partial<
  Record<"name" | "email" | "password" | "adminRole", string>
>;

export function validateOperatorForm(input: OperatorFormInput) {
  const errors: OperatorFormErrors = {};
  if (!input.name.trim()) errors.name = "required";
  const email = input.email.trim();
  if (!email) {
    errors.email = "required";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "invalid";
  }
  const password = input.password?.trim() ?? "";
  if (input.mode === "create" && password.length < 8) {
    errors.password = "required_policy";
  } else if (input.mode === "edit" && password && password.length < 8) {
    errors.password = "policy";
  }
  if (!ADMIN_ROLES.includes(input.adminRole)) {
    errors.adminRole = "invalid";
  }
  return errors;
}

export function getAssignableAdminRoles(actorRole: AdminRole | undefined) {
  if (!actorRole) return [] as AdminRole[];
  if (actorRole === "super_admin") return [...ADMIN_ROLES];
  return ADMIN_ROLES.filter(
    (role) => ADMIN_ROLE_RANK[role] < ADMIN_ROLE_RANK[actorRole],
  );
}

export function getRolePermissionPreview(role: AdminRole, maximum = 8) {
  return ADMIN_ROLE_PRESETS[role]
    .filter((permission) => !LEGACY_PERMISSIONS.has(permission))
    .slice(0, maximum);
}

export function permissionCopyKeys(permission: AdminPermission) {
  const [resource, action] = permission.split(":");
  return {
    resource: `permissionResource.${resource}`,
    action: `permissionAction.${action}`,
  };
}

export function operatorAccountStatus(operator: UserRecord) {
  return getAccountStatus(operator);
}

export function isLastActiveSuperAdmin(
  operator: UserRecord,
  activeSuperAdminCount: number,
) {
  return (
    getAdminRole(operator) === "super_admin" &&
    operatorAccountStatus(operator) === "active" &&
    activeSuperAdminCount <= 1
  );
}

export function operatorProtection(input: {
  operator: UserRecord;
  actorUid?: string;
  actorRole?: AdminRole;
  activeSuperAdminCount: number;
}) {
  const self = input.operator.uid === input.actorUid;
  const lastSuperAdmin = isLastActiveSuperAdmin(
    input.operator,
    input.activeSuperAdminCount,
  );
  const targetRole = getAdminRole(input.operator);
  const actorCanReachTarget = Boolean(
    input.actorRole &&
    (
      input.actorRole === "super_admin" ||
      ADMIN_ROLE_RANK[input.actorRole] > ADMIN_ROLE_RANK[targetRole]
    ),
  );
  return {
    self,
    lastSuperAdmin,
    actorCanReachTarget,
    blocksSensitiveChange: self || lastSuperAdmin || !actorCanReachTarget,
  };
}

export function dangerousOperatorChanges(
  current: UserRecord,
  next: {
    adminRole: AdminRole;
    status: UserRecord["status"];
  },
) {
  const currentRole = getAdminRole(current);
  return {
    superAdminRoleChange:
      currentRole === "super_admin" && next.adminRole !== "super_admin",
    roleDemotion:
      ADMIN_ROLE_RANK[next.adminRole] < ADMIN_ROLE_RANK[currentRole],
    deactivation: current.status === "active" && next.status !== "active",
  };
}

export function operatorServerErrorCopyKey(error: string | undefined) {
  switch (error) {
    case "email_already_exists":
      return "operatorDuplicateEmail";
    case "weak_password":
      return "operatorPasswordPolicyError";
    case "last_super_admin":
      return "operatorLastSuperAdminError";
    case "protected_operator":
      return "operatorSelfProtectionError";
    case "operator_management_denied":
    case "permission_denied":
      return "operatorPermissionDeniedError";
    case "unsupported_role":
      return "operatorRoleError";
    default:
      return "operatorSaveFailed";
  }
}
