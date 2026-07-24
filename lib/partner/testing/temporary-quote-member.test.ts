import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { resolveAccountContextFromRecords } from "@/lib/auth/account-context";
import { getPostLoginPath } from "@/lib/auth/portal";
import type { UserRecord } from "@/lib/firebase/schema";
import {
  activateTemporaryMemberPassword,
  createTemporaryMemberActivationLink,
  provisionTemporaryQuoteMember,
} from "@/lib/members/temporary-quote-member";
import { validateTemporaryMemberConversion } from "@/lib/members/temporary-member-conversion";

class MemorySnapshot {
  private readonly value: unknown;
  constructor(value: unknown) {
    this.value = value;
  }
  get exists() {
    return this.value !== undefined;
  }
  data() {
    return this.value;
  }
}

class MemoryRef {
  readonly path: string;
  private readonly values: Map<string, unknown>;
  constructor(
    path: string,
    values: Map<string, unknown>,
  ) {
    this.path = path;
    this.values = values;
  }
  async get() {
    return new MemorySnapshot(this.values.get(this.path));
  }
  async set(value: unknown, options?: { merge?: boolean }) {
    const current = this.values.get(this.path);
    this.values.set(
      this.path,
      options?.merge && current && typeof current === "object"
        ? { ...current, ...(value as object) }
        : value,
    );
  }
}

class MemoryDb {
  readonly values = new Map<string, unknown>();
  collection(name: string) {
    return {
      doc: (id: string) => new MemoryRef(`${name}/${id}`, this.values),
    };
  }
  async runTransaction<T>(
    callback: (transaction: {
      get: (ref: MemoryRef) => Promise<MemorySnapshot>;
      set: (
        ref: MemoryRef,
        value: unknown,
        options?: { merge?: boolean },
      ) => void;
      update: (ref: MemoryRef, value: unknown) => void;
    }) => Promise<T>,
  ) {
    return callback({
      get: (ref) => ref.get(),
      set: (ref, value, options) => {
        void ref.set(value, options);
      },
      update: (ref, value) => {
        void ref.set(value, { merge: true });
      },
    });
  }
}

function temporaryProfile(uid = "temporary-user"): UserRecord {
  return {
    uid,
    name: "견적 고객",
    phone: "010-1234-5678",
    email: "quote@example.com",
    position: "",
    duty: "",
    consents: {
      terms: false,
      privacy: true,
      marketing: false,
      email: false,
      sms: false,
      kakao: false,
    },
    role: "member",
    status: "temporary_quote_member",
    temporaryMember: {
      source: "audit_quote_request",
      sourceRequestIds: ["request-1"],
    },
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z",
  };
}

describe("temporary quote membership", () => {
  it("provisions an email-login identity and links both quote documents", async () => {
    const db = new MemoryDb();
    const auth = {
      async getUserByEmail() {
        throw Object.assign(new Error("missing"), {
          code: "auth/user-not-found",
        });
      },
      async createUser() {
        return { uid: "temporary-user" };
      },
    } as unknown as Auth;

    const result = await provisionTemporaryQuoteMember({
      db: db as unknown as Firestore,
      auth,
      requestId: "request-1",
      quoteRequestId: "audit_quote_request-1",
      email: "Quote@Example.com",
      contactName: "견적 고객",
      phone: "010-1234-5678",
      marketingConsent: false,
      now: "2026-07-23T00:00:00.000Z",
    });

    assert.equal(result.uid, "temporary-user");
    assert.equal(
      (db.values.get("users/temporary-user") as UserRecord).status,
      "temporary_quote_member",
    );
    assert.equal(
      (db.values.get("auditQuoteRequests/request-1") as { customerUid: string })
        .customerUid,
      "temporary-user",
    );
    assert.equal(
      (
        db.values.get("quoteRequests/audit_quote_request-1") as {
          customerUid: string;
        }
      ).customerUid,
      "temporary-user",
    );
  });

  it("uses a one-time activation link without exposing a temporary password", async () => {
    const db = new MemoryDb();
    db.values.set("users/temporary-user", temporaryProfile());
    let updatedPassword = "";
    const auth = {
      async updateUser(
        uid: string,
        update: { password: string; emailVerified: boolean },
      ) {
        assert.equal(uid, "temporary-user");
        assert.equal(update.emailVerified, true);
        updatedPassword = update.password;
        return { uid };
      },
    } as unknown as Auth;
    const secret = "temporary-test-secret-123";
    const link = await createTemporaryMemberActivationLink({
      db: db as unknown as Firestore,
      uid: "temporary-user",
      email: "quote@example.com",
      quoteId: "quote-1",
      baseUrl: "https://support.example.com",
      nowMs: Date.parse("2026-07-23T00:00:00.000Z"),
      secret,
    });
    assert.ok(link);
    const token = new URL(link).searchParams.get("activation");
    assert.ok(token);
    assert.equal(link.includes("Password123"), false);

    const activated = await activateTemporaryMemberPassword({
      db: db as unknown as Firestore,
      auth,
      token,
      password: "Password123",
      now: "2026-07-23T01:00:00.000Z",
      secret,
    });
    assert.equal(activated.quoteId, "quote-1");
    assert.equal(updatedPassword, "Password123");
    await assert.rejects(
      activateTemporaryMemberPassword({
        db: db as unknown as Firestore,
        auth,
        token,
        password: "AnotherPass123",
        now: "2026-07-23T01:01:00.000Z",
        secret,
      }),
      /activation_already_used/u,
    );
  });

  it("routes temporary customers only to the quote inbox", () => {
    const account = resolveAccountContextFromRecords({
      identity: {
        uid: "temporary-user",
        email: "quote@example.com",
      },
      profiles: [temporaryProfile()],
    });
    assert.equal(account.status, "ACTIVE");
    assert.equal(account.customerAccessLevel, "QUOTE_ONLY");
    assert.equal(getPostLoginPath(account), "/mypage/quotes");
  });

  it("requires complete remaining membership fields and explicit consent", () => {
    const valid = {
      cooperativeId: "cooperative-1",
      position: "과장",
      duty: "accounting",
      consents: {
        terms: true,
        privacy: true,
        marketing: false,
        email: false,
        sms: false,
        kakao: false,
      },
    };
    assert.equal(
      validateTemporaryMemberConversion(valid).cooperativeId,
      "cooperative-1",
    );
    assert.throws(
      () =>
        validateTemporaryMemberConversion({
          ...valid,
          duty: "tampered",
        }),
      /invalid_duty/u,
    );
    assert.throws(
      () =>
        validateTemporaryMemberConversion({
          ...valid,
          consents: { ...valid.consents, privacy: false },
        }),
      /consent_required/u,
    );
  });
});
