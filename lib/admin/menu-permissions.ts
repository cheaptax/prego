import {
  hasAnyPermission,
  hasPermission,
  isAccountActive,
} from "@/lib/admin/rbac";
import type {
  AdminPermission,
  AuthorizationContext,
} from "@/lib/firebase/schema";

/**
 * UX-only menu policy. Server APIs must independently call requirePermission,
 * requireAnyPermission, and scope assertions; this module is never a security
 * boundary.
 */
export const ADMIN_MENU_PERMISSION_REQUIREMENTS = {
  overview: ["admin:access"],
  members: ["members:read", "operators:read", "cooperatives:read"],
  operators: ["operators:read"],
  partners: ["partners:read"],
  inquiries: ["inquiries:read"],
  auditQuotes: ["auditQuotes:read"],
  quotePriceMaster: ["auditQuotes:read"],
  auditEvaluations: ["auditEvaluations:read"],
  points: ["points:read"],
  audit: ["audit:read"],
  sitemap: ["admin:access"],
  cms: ["cms:read"],
} as const satisfies Record<string, readonly AdminPermission[]>;

export type AdminPermissionMenuId =
  keyof typeof ADMIN_MENU_PERMISSION_REQUIREMENTS;

export function canShowAdminMenu(
  context: AuthorizationContext | null,
  menuId: AdminPermissionMenuId,
) {
  return Boolean(
    context &&
    isAccountActive(context) &&
    hasAnyPermission(
      context,
      ADMIN_MENU_PERMISSION_REQUIREMENTS[menuId],
    ),
  );
}

export function canShowAdminAction(
  context: AuthorizationContext | null,
  permission: AdminPermission,
) {
  return hasPermission(context, permission);
}
