import type {
  AdminPermission,
  AdminCapability,
  AdminResourceDescriptor,
  AdminRole,
  AdminScope,
  AdminStatus,
  AuthorizationContext,
  OperatorProfile,
  PartnerRecord,
  UserRecord,
} from "@/lib/firebase/schema";

export const ADMIN_PERMISSIONS = [
  "admin:access",
  "admin:read",
  "members:read",
  "members:write",
  "cooperatives:read",
  "cooperatives:write",
  "operators:read",
  "operators:write",
  "operators:create",
  "operators:update",
  "operators:disable",
  "operators:delete",
  "operators:manageRoles",
  "operators:resetPassword",
  "partners:read",
  "partners:write",
  "partners:create",
  "partners:update",
  "partners:changeStatus",
  "partners:manageMembers",
  "partners:manageScope",
  "inquiries:read",
  "inquiries:write",
  "points:read",
  "points:write",
  "points:adjust",
  "faqs:read",
  "faqs:write",
  "audit:read",
  "auditQuotes:read",
  "auditQuotes:write",
  "auditEvaluations:read",
  "auditEvaluations:write",
  "cms:read",
  "cms:write",
] as const satisfies readonly AdminPermission[];

/** @deprecated Use ADMIN_PERMISSIONS. */
export const ADMIN_CAPABILITIES = ADMIN_PERMISSIONS;

const LEGACY_PERMISSION_EXPANSIONS = {
  "operators:write": [
    "operators:create",
    "operators:update",
    "operators:disable",
    "operators:delete",
    "operators:manageRoles",
    "operators:resetPassword",
  ],
  "partners:write": [
    "partners:create",
    "partners:update",
    "partners:changeStatus",
    "partners:manageMembers",
    "partners:manageScope",
  ],
  "points:write": ["points:adjust"],
} as const satisfies Partial<
  Record<AdminPermission, readonly AdminPermission[]>
>;

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "최고관리자",
  operations_manager: "운영관리자",
  partner_manager: "제휴사관리자",
  cms_editor: "콘텐츠관리자",
  read_only: "조회전용",
};

export const ADMIN_ROLE_DESCRIPTIONS: Record<AdminRole, string> = {
  super_admin: "모든 관리자 기능과 운영자 권한을 관리합니다.",
  operations_manager: "회원, 문의, 포인트, 감사견적 운영을 처리합니다.",
  partner_manager: "제휴사 프로필, 문의 배정, 답변 검수를 처리합니다.",
  cms_editor: "CMS 콘텐츠와 FAQ를 관리합니다.",
  read_only: "운영 현황과 감사 로그를 조회합니다.",
};

export const ADMIN_ROLE_PRESETS = {
  // SUPER_ADMIN is explicit: it receives every registered permission through
  // the same permission engine, not through an email/UID bypass.
  super_admin: [...ADMIN_PERMISSIONS],
  operations_manager: [
    "admin:access",
    "admin:read",
    "members:read",
    "members:write",
    "cooperatives:read",
    "operators:read",
    "partners:read",
    "inquiries:read",
    "inquiries:write",
    "points:read",
    "points:write",
    "points:adjust",
    "faqs:read",
    "faqs:write",
    "audit:read",
    "auditQuotes:read",
    "auditQuotes:write",
    "auditEvaluations:read",
    "auditEvaluations:write",
  ],
  partner_manager: [
    "admin:access",
    "admin:read",
    "partners:read",
    "partners:write",
    "partners:create",
    "partners:update",
    "partners:changeStatus",
    "partners:manageMembers",
    "partners:manageScope",
    "inquiries:read",
    "inquiries:write",
    "audit:read",
  ],
  cms_editor: [
    "admin:access",
    "admin:read",
    "cms:read",
    "cms:write",
    "faqs:read",
    "faqs:write",
    "audit:read",
  ],
  read_only: [
    "admin:access",
    "admin:read",
    "members:read",
    "cooperatives:read",
    "operators:read",
    "partners:read",
    "inquiries:read",
    "points:read",
    "faqs:read",
    "audit:read",
    "auditQuotes:read",
    "auditEvaluations:read",
    "cms:read",
  ],
} as const satisfies Record<AdminRole, readonly AdminPermission[]>;

export const ADMIN_ROLES = Object.keys(ADMIN_ROLE_PRESETS) as AdminRole[];

export const ADMIN_ROLE_RANK = {
  super_admin: 100,
  operations_manager: 80,
  partner_manager: 60,
  cms_editor: 60,
  read_only: 10,
} as const satisfies Record<AdminRole, number>;

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && value in ADMIN_ROLE_PRESETS;
}

export function isAdminPermission(value: unknown): value is AdminPermission {
  return (
    typeof value === "string" &&
    (ADMIN_PERMISSIONS as readonly string[]).includes(value)
  );
}

/** @deprecated Use isAdminPermission. */
export const isAdminCapability = isAdminPermission;

export function normalizeAdminPermissions(value: unknown): AdminPermission[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(isAdminPermission))).sort();
}

/** @deprecated Use normalizeAdminPermissions. */
export const normalizeAdminCapabilities = normalizeAdminPermissions;

export function getAdminRole(profile: Pick<UserRecord, "adminRole">): AdminRole {
  // Read-only is the least-privileged compatibility value for non-auth
  // presentation paths. Authentication rejects missing or invalid roles.
  return isAdminRole(profile.adminRole) ? profile.adminRole : "read_only";
}

export function getAccountStatus(
  profile: Pick<UserRecord, "accountStatus" | "status">,
): AdminStatus {
  if (profile.accountStatus) return profile.accountStatus;
  if (profile.status === "active") return "active";
  if (profile.status === "pending_cooperative_review") return "invited";
  return "disabled";
}

export function isAccountActive(
  subject:
    | Pick<UserRecord, "accountStatus" | "status">
    | Pick<AuthorizationContext, "status">
    | null,
) {
  if (!subject) return false;
  if ("accountStatus" in subject) {
    return getAccountStatus(
      subject as Pick<UserRecord, "accountStatus" | "status">,
    ) === "active";
  }
  return subject.status === "active";
}

function expandPermission(permission: AdminPermission) {
  return [
    permission,
    ...(LEGACY_PERMISSION_EXPANSIONS[permission as keyof typeof LEGACY_PERMISSION_EXPANSIONS] ?? []),
  ] as AdminPermission[];
}

export function getEffectivePermissions(
  profile: Pick<
    UserRecord,
    | "role"
    | "status"
    | "accountStatus"
    | "adminRole"
    | "adminCapabilityAllow"
    | "adminCapabilityDeny"
  > | null,
) {
  if (!profile || profile.role !== "admin" || !isAccountActive(profile)) {
    return [] as AdminPermission[];
  }

  const permissions = new Set<AdminPermission>();
  for (const permission of ADMIN_ROLE_PRESETS[getAdminRole(profile)]) {
    for (const expanded of expandPermission(permission)) {
      permissions.add(expanded);
    }
  }
  for (const permission of normalizeAdminPermissions(profile.adminCapabilityAllow)) {
    for (const expanded of expandPermission(permission)) {
      permissions.add(expanded);
    }
  }
  for (const permission of normalizeAdminPermissions(profile.adminCapabilityDeny)) {
    for (const expanded of expandPermission(permission)) {
      permissions.delete(expanded);
    }
  }
  return Array.from(permissions).sort();
}

/** @deprecated Use getEffectivePermissions. */
export const resolveAdminCapabilities = getEffectivePermissions;

type PermissionProfile = Pick<
  UserRecord,
  | "role"
  | "status"
  | "accountStatus"
  | "adminRole"
  | "adminCapabilityAllow"
  | "adminCapabilityDeny"
>;

function isAuthorizationContext(
  subject: PermissionProfile | AuthorizationContext,
): subject is AuthorizationContext {
  return "accountType" in subject && Array.isArray(subject.permissions);
}

export function hasPermission(
  subject: PermissionProfile | AuthorizationContext | null,
  permission: AdminPermission,
) {
  if (!subject || !isAccountActive(subject)) return false;
  return isAuthorizationContext(subject)
    ? subject.permissions.includes(permission)
    : getEffectivePermissions(subject).includes(permission);
}

export function hasAnyPermission(
  subject: PermissionProfile | AuthorizationContext | null,
  permissions: readonly AdminPermission[],
) {
  return permissions.some((permission) => hasPermission(subject, permission));
}

export function hasAllPermissions(
  subject: PermissionProfile | AuthorizationContext | null,
  permissions: readonly AdminPermission[],
) {
  return permissions.every((permission) => hasPermission(subject, permission));
}

/** @deprecated Use hasPermission. */
export function hasAdminCapability(
  profile: PermissionProfile | null,
  capability: AdminCapability,
) {
  return hasPermission(profile, capability);
}

export function createAuthorizationContext(
  profile: UserRecord,
): AuthorizationContext {
  const status = getAccountStatus(profile);
  const active = status === "active";
  let scopes: AdminScope[] = [];
  if (active && profile.role === "admin") {
    scopes = ["ALL"];
  } else if (active && profile.role === "partner") {
    scopes = ["PARTNER", "ASSIGNED"];
  } else if (active) {
    scopes = ["OWN", "ORGANIZATION"];
  }

  return {
    uid: profile.uid,
    email: profile.email,
    accountType: profile.role,
    status,
    adminRole:
      profile.role === "admin" ? getAdminRole(profile) : undefined,
    permissions:
      profile.role === "admin" ? getEffectivePermissions(profile) : [],
    scopes,
    organizationId: profile.nh_org_id ?? profile.cooperativeId,
    partnerId: profile.partnerId,
  };
}

function matchesScope(
  context: AuthorizationContext,
  resource: AdminResourceDescriptor,
  scope: AdminScope,
) {
  if (scope === "ALL") return true;
  if (scope === "OWN") return resource.ownerId === context.uid;
  if (scope === "ORGANIZATION") {
    return Boolean(
      context.organizationId &&
      resource.organizationId &&
      context.organizationId === resource.organizationId,
    );
  }
  if (scope === "PARTNER") {
    return Boolean(
      context.partnerId &&
      resource.partnerId &&
      context.partnerId === resource.partnerId,
    );
  }
  return Boolean(
    resource.assignedUserIds?.includes(context.uid) ||
    context.partnerId &&
      resource.assignedPartnerId === context.partnerId,
  );
}

export function canAccessResource(
  context: AuthorizationContext,
  resource: AdminResourceDescriptor,
  requiredScope?: AdminScope,
) {
  if (!isAccountActive(context)) return false;
  if (requiredScope) {
    return context.scopes.includes(requiredScope) &&
      matchesScope(context, resource, requiredScope);
  }
  return context.scopes.some((scope) => matchesScope(context, resource, scope));
}

export function isSuperAdmin(
  subject:
    | Pick<OperatorProfile, "adminRole" | "accountStatus" | "status">
    | Pick<AuthorizationContext, "adminRole" | "status">
    | null,
) {
  return Boolean(
    subject &&
    subject.adminRole === "super_admin" &&
    isAccountActive(subject),
  );
}

export function wouldRemoveLastSuperAdmin(input: {
  target: Pick<OperatorProfile, "adminRole" | "accountStatus" | "status">;
  activeSuperAdminCount: number;
  nextRole?: AdminRole;
  nextStatus?: AdminStatus;
  deleting?: boolean;
}) {
  if (!isSuperAdmin(input.target)) return false;
  const removesSuperAdmin =
    input.deleting === true ||
    input.nextRole !== undefined && input.nextRole !== "super_admin" ||
    input.nextStatus !== undefined && input.nextStatus !== "active";
  return removesSuperAdmin && input.activeSuperAdminCount <= 1;
}

export type ManageOperatorOptions = {
  permission?: Extract<AdminPermission, `operators:${string}`>;
  activeSuperAdminCount?: number;
  nextRole?: AdminRole;
  nextStatus?: AdminStatus;
  deleting?: boolean;
};

export function canManageOperator(
  actor: AuthorizationContext,
  target: OperatorProfile,
  options: ManageOperatorOptions = {},
) {
  const permission = options.permission ?? "operators:update";
  if (
    actor.accountType !== "admin" ||
    !actor.adminRole ||
    !hasPermission(actor, permission) ||
    actor.uid === target.uid
  ) {
    return false;
  }

  const targetRole = getAdminRole(target);
  if (ADMIN_ROLE_RANK[actor.adminRole] < ADMIN_ROLE_RANK[targetRole]) {
    return false;
  }
  if (
    ADMIN_ROLE_RANK[actor.adminRole] === ADMIN_ROLE_RANK[targetRole] &&
    actor.adminRole !== "super_admin"
  ) {
    return false;
  }
  if (
    options.nextRole &&
    actor.adminRole !== "super_admin" &&
    ADMIN_ROLE_RANK[options.nextRole] >= ADMIN_ROLE_RANK[actor.adminRole]
  ) {
    return false;
  }
  return !wouldRemoveLastSuperAdmin({
    target,
    activeSuperAdminCount: options.activeSuperAdminCount ??
      Number.POSITIVE_INFINITY,
    nextRole: options.nextRole,
    nextStatus: options.nextStatus,
    deleting: options.deleting,
  });
}

export function canManagePartner(
  actor: AuthorizationContext,
  partner: Pick<PartnerRecord, "id">,
  permission: Extract<AdminPermission, `partners:${string}`> = "partners:update",
) {
  return hasPermission(actor, permission) &&
    canAccessResource(actor, { partnerId: partner.id });
}

export function canManageAdminRoles(profile: UserRecord | null) {
  return hasAnyPermission(profile, [
    "operators:manageRoles",
    "operators:write",
  ]);
}
