import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  AccountContextResolutionError,
  resolveAccountContextFromRecords,
  type FirebaseAccountIdentity,
} from "@/lib/auth/account-context";
import { getFirebaseLoginErrorMessage } from "@/lib/auth/login-errors";
import {
  canAccessPortal,
  getDefaultPortal,
  getPortalMismatchResult,
} from "@/lib/auth/portal";
import type {
  PartnerRecord,
  UserRecord,
} from "@/lib/firebase/schema";

const source = (relativePath: string) =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

function profile(input: Partial<UserRecord> = {}): UserRecord {
  return {
    uid: "user-1",
    name: "테스트 사용자",
    phone: "",
    email: "user@example.com",
    position: "",
    duty: "",
    consents: {
      terms: true,
      privacy: true,
      marketing: false,
      email: false,
      sms: false,
      kakao: false,
    },
    role: "member",
    status: "active",
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    ...input,
  };
}

function identity(
  input: Partial<FirebaseAccountIdentity> = {},
): FirebaseAccountIdentity {
  return {
    uid: "user-1",
    email: "user@example.com",
    ...input,
  };
}

function partner(
  input: Partial<PartnerRecord> = {},
): PartnerRecord {
  return {
    id: "partner-1",
    name: "제휴사",
    displayName: "제휴사",
    partnerType: "법률",
    fields: [],
    managerName: "담당자",
    contactEmail: "partner@example.com",
    contactPhone: "",
    status: "active",
    pointMin: 0,
    pointMax: 0,
    createdBy: "admin-1",
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedBy: "admin-1",
    updatedAt: "2026-07-22T00:00:00.000Z",
    ...input,
  };
}

describe("portal account context resolution", () => {
  it("resolves a customer profile", () => {
    const account = resolveAccountContextFromRecords({
      identity: identity(),
      profiles: [profile()],
    });
    assert.equal(account.accountType, "CUSTOMER");
    assert.equal(account.role, "member");
    assert.equal(account.status, "ACTIVE");
    assert.equal(account.defaultPortal, "customer");
    assert.deepEqual(account.permissions, []);
  });

  it("resolves an internal operator with existing RBAC permissions", () => {
    const account = resolveAccountContextFromRecords({
      identity: identity({ admin: true }),
      profiles: [
        profile({
          role: "admin",
          adminRole: "operations_manager",
          accountStatus: "active",
        }),
      ],
    });
    assert.equal(account.accountType, "INTERNAL_OPERATOR");
    assert.equal(account.role, "operations_manager");
    assert.equal(account.defaultPortal, "admin");
    assert.equal(account.permissions.includes("admin:access"), true);
  });

  it("fails closed when an administrator has no explicit RBAC role", () => {
    assert.throws(
      () =>
        resolveAccountContextFromRecords({
          identity: identity({ admin: true }),
          profiles: [
            profile({
              role: "admin",
              adminRole: undefined,
              accountStatus: "active",
            }),
          ],
        }),
      (error: unknown) =>
        error instanceof AccountContextResolutionError &&
        error.code === "account_configuration_error",
    );
  });

  it("resolves a partner operator and partner scope", () => {
    const account = resolveAccountContextFromRecords({
      identity: identity({ partner: true, partnerId: "partner-1" }),
      profiles: [
        profile({
          role: "partner",
          partnerId: "partner-1",
          accountStatus: "active",
        }),
      ],
      partner: partner(),
    });
    assert.equal(account.accountType, "PARTNER_OPERATOR");
    assert.equal(account.partnerId, "partner-1");
    assert.equal(account.defaultPortal, "partner");
    assert.equal(account.status, "ACTIVE");
  });

  it("rejects an Auth account without a profile", () => {
    assert.throws(
      () =>
        resolveAccountContextFromRecords({
          identity: identity(),
          profiles: [],
        }),
      (error: unknown) =>
        error instanceof AccountContextResolutionError &&
        error.code === "profile_not_found",
    );
  });

  it("rejects simultaneous customer and operator profiles", () => {
    assert.throws(
      () =>
        resolveAccountContextFromRecords({
          identity: identity({ admin: true }),
          profiles: [
            profile(),
            profile({ role: "admin", adminRole: "super_admin" }),
          ],
        }),
      (error: unknown) =>
        error instanceof AccountContextResolutionError &&
        error.code === "duplicate_profile",
    );
  });

  it("blocks an inactive internal operator", () => {
    const account = resolveAccountContextFromRecords({
      identity: identity({ admin: true }),
      profiles: [
        profile({
          role: "admin",
          adminRole: "operations_manager",
          accountStatus: "suspended",
        }),
      ],
    });
    assert.equal(account.status, "SUSPENDED");
    assert.deepEqual(account.permissions, []);
    assert.equal(canAccessPortal(account, "admin"), false);
    assert.equal(
      getPortalMismatchResult(account, "partner").reason,
      "account_unavailable",
    );
  });

  it("blocks paused and terminated partner organizations", () => {
    const partnerProfile = profile({
      role: "partner",
      partnerId: "partner-1",
      accountStatus: "active",
    });
    const paused = resolveAccountContextFromRecords({
      identity: identity({ partner: true }),
      profiles: [partnerProfile],
      partner: partner({ status: "paused" }),
    });
    const terminated = resolveAccountContextFromRecords({
      identity: identity({ partner: true }),
      profiles: [partnerProfile],
      partner: partner({ status: "terminated" }),
    });
    assert.equal(paused.status, "SUSPENDED");
    assert.equal(terminated.status, "DISABLED");
    assert.equal(canAccessPortal(paused, "partner"), false);
    assert.equal(canAccessPortal(terminated, "partner"), false);
  });
});

describe("portal access and login errors", () => {
  const customer = resolveAccountContextFromRecords({
    identity: identity(),
    profiles: [profile()],
  });

  it("calculates canonical default portals", () => {
    assert.equal(getDefaultPortal("CUSTOMER"), "customer");
    assert.equal(getDefaultPortal("PARTNER_OPERATOR"), "partner");
    assert.equal(getDefaultPortal("INTERNAL_OPERATOR"), "admin");
  });

  it("returns a safe result for a portal mismatch", () => {
    const result = getPortalMismatchResult(customer, "admin");
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "portal_mismatch");
    assert.equal(result.redirectPath, "/mypage");
    assert.equal(result.defaultPortal, "customer");
  });

  it("converts Firebase errors without exposing raw messages", () => {
    const messages = {
      invalidCredentials: "invalid",
      tooManyRequests: "limited",
      networkError: "network",
      genericError: "generic",
    };
    assert.equal(
      getFirebaseLoginErrorMessage(
        { code: "auth/user-not-found", message: "raw Firebase detail" },
        messages,
      ),
      "invalid",
    );
    assert.equal(
      getFirebaseLoginErrorMessage(
        new Error("raw internal detail"),
        messages,
      ),
      "generic",
    );
  });
});

describe("shared login and session contract", () => {
  it("keeps Firebase password login in one client service", () => {
    const loginForm = source("components/LoginForm.tsx");
    const loginClient = source("lib/auth/login-client.ts");
    assert.doesNotMatch(loginForm, /signInWithEmailAndPassword/);
    assert.match(loginClient, /signInWithEmailAndPassword/);
    assert.match(loginClient, /expectedPortal/);
    assert.match(loginClient, /\/api\/auth\/portal-session/);
  });

  it("creates and deletes only the shared HttpOnly portal session", () => {
    const sessionRoute = source(
      "app/api/auth/portal-session/route.ts",
    );
    const logoutRoute = source("app/api/auth/logout/route.ts");
    assert.match(sessionRoute, /resolveAccountContext\(req\)/);
    assert.match(sessionRoute, /createSessionCookie/);
    assert.match(sessionRoute, /httpOnly: true/);
    assert.match(sessionRoute, /sameSite: "lax"/);
    assert.match(logoutRoute, /PORTAL_SESSION_COOKIE/);
    assert.match(logoutRoute, /maxAge: 0/);
  });

  it("keeps the legacy custom-token API disabled and passwords out of source", () => {
    const legacyRoute = source("app/api/auth/admin-login/route.ts");
    const seed = source("scripts/seed-admin.mjs");
    assert.match(legacyRoute, /status: 410/);
    assert.doesNotMatch(legacyRoute, /createCustomToken/);
    assert.match(seed, /process\.env\.ADMIN_PASSWORD/);
    assert.doesNotMatch(seed, /password:\s*["'][^"']+["']/);
  });
});
