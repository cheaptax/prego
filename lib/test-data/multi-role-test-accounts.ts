import { normalizeEmail } from "@/lib/audit-quote/email-core";
import type { PortalType } from "@/lib/auth/portal";
import type { UserRecord } from "@/lib/firebase/schema";

/**
 * Approved test emails that may share one Firebase Auth identity across
 * customer, partner, and admin portals. Production accounts stay single-role.
 */
export const MULTI_ROLE_TEST_EMAILS = ["prego.ceo@gmail.com"] as const;

const MULTI_ROLE_TEST_EMAIL_SET = new Set<string>(MULTI_ROLE_TEST_EMAILS);

export const ALL_MULTI_ROLE_PORTALS = [
  "customer",
  "partner",
  "admin",
] as const satisfies readonly PortalType[];

export function isMultiRoleTestEmail(raw: string | null | undefined) {
  if (!raw) return false;
  return MULTI_ROLE_TEST_EMAIL_SET.has(normalizeEmail(raw));
}

export function isMultiRoleTestProfile(
  profile: Pick<
    UserRecord,
    "email" | "multiRoleTestAccount" | "enabledPortals"
  > | null | undefined,
) {
  if (!profile?.multiRoleTestAccount) return false;
  return isMultiRoleTestEmail(profile.email);
}

export function normalizeEnabledPortals(
  value: unknown,
): PortalType[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const portals = value.filter(
    (item): item is PortalType =>
      item === "customer" || item === "partner" || item === "admin",
  );
  return portals.length > 0 ? [...new Set(portals)] : undefined;
}

export function mergeEnabledPortals(
  current: readonly PortalType[] | undefined,
  additions: readonly PortalType[],
) {
  return [...new Set([...(current ?? []), ...additions])];
}

export function multiRoleClaimsFromProfile(input: {
  profile: Pick<
    UserRecord,
    "partnerId" | "accountStatus" | "status" | "enabledPortals"
  >;
  existingClaims?: Record<string, unknown>;
  adminEnabled: boolean;
  partnerEnabled?: boolean;
}) {
  const enabledPortals = normalizeEnabledPortals(input.profile.enabledPortals) ?? [];
  const partnerId = input.profile.partnerId?.trim() ?? "";
  const partnerEnabled =
    input.partnerEnabled ??
    (enabledPortals.includes("partner") &&
      Boolean(partnerId) &&
      (input.profile.accountStatus ?? "active") === "active");
  return {
    ...(input.existingClaims ?? {}),
    multiRole: true,
    admin: input.adminEnabled,
    ...(partnerEnabled && partnerId
      ? { partner: true, partnerId }
      : { partner: false, partnerId: null }),
  };
}
