import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AdminAuthorizationError,
  assertAdminScope,
  authErrorCode,
  authErrorResponse,
  authErrorStatus,
  getBearerToken,
} from "@/lib/firebase/server";
import type { AuthorizationContext } from "@/lib/firebase/schema";

const activeAdmin: AuthorizationContext = {
  uid: "admin-1",
  accountType: "admin",
  status: "active",
  adminRole: "operations_manager",
  permissions: ["admin:access"],
  scopes: ["ALL"],
};

describe("admin server authorization helpers", () => {
  it("parses Firebase bearer tokens without accepting other schemes", () => {
    assert.equal(getBearerToken(new Request("https://example.test")), "");
    assert.equal(getBearerToken(new Request("https://example.test", {
      headers: { authorization: "Basic abc" },
    })), "");
    assert.equal(getBearerToken(new Request("https://example.test", {
      headers: { authorization: "Bearer firebase-token" },
    })), "firebase-token");
  });

  it("maps unauthenticated and forbidden errors consistently", async () => {
    const unauthenticated = new AdminAuthorizationError("missing_token", 401);
    const forbidden = new AdminAuthorizationError("permission_denied", 403);
    assert.equal(authErrorStatus(unauthenticated), 401);
    assert.equal(authErrorCode(unauthenticated), "missing_token");
    assert.equal(authErrorStatus(forbidden), 403);

    const response = authErrorResponse(forbidden);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "permission_denied",
    });
  });

  it("throws a typed 403 when a resource is outside the asserted scope", () => {
    assert.doesNotThrow(() => {
      assertAdminScope(activeAdmin, { partnerId: "partner-a" });
    });

    const partnerContext: AuthorizationContext = {
      ...activeAdmin,
      accountType: "partner",
      adminRole: undefined,
      permissions: [],
      scopes: ["PARTNER"],
      partnerId: "partner-a",
    };
    assert.throws(
      () => {
        assertAdminScope(
          partnerContext,
          { partnerId: "partner-b" },
          "PARTNER",
        );
      },
      (error) =>
        error instanceof AdminAuthorizationError &&
        error.code === "scope_denied" &&
        error.status === 403,
    );
  });
});
