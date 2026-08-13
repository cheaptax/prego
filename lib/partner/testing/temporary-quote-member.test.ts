import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { resolveAccountContextFromRecords } from "@/lib/auth/account-context";
import { getPostLoginPath } from "@/lib/auth/portal";
import type { UserRecord } from "@/lib/firebase/schema";
import {
  activateTemporaryMemberPassword,
  buildTemporaryQuoteMemberInitialPassword,
  createTemporaryMemberActivationLink,
  provisionTemporaryQuoteMember,
} from "@/lib/members/temporary-quote-member";
import {
  pickQuotedCooperative,
  validateTemporaryMemberConversion,
} from "@/lib/members/temporary-member-conversion";
import {
  displayQuotedPhone,
  pickQuotedContact,
} from "@/lib/members/quoted-cooperative";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

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
  it("builds the initial password from the last four phone digits", () => {
    assert.equal(
      buildTemporaryQuoteMemberInitialPassword("010-1234-5678"),
      "nh56785678",
    );
    assert.equal(
      buildTemporaryQuoteMemberInitialPassword("01012345678"),
      "nh56785678",
    );
    assert.equal(buildTemporaryQuoteMemberInitialPassword("123"), null);
  });

  it("provisions an email-login identity and links both quote documents", async () => {
    const db = new MemoryDb();
    let createdPassword = "";
    const auth = {
      async getUserByEmail() {
        throw Object.assign(new Error("missing"), {
          code: "auth/user-not-found",
        });
      },
      async createUser(payload: { password: string }) {
        createdPassword = payload.password;
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
    assert.equal(result.initialPasswordIssued, true);
    assert.equal(result.initialPassword, "nh56785678");
    assert.equal(createdPassword, "nh56785678");
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

  it("resets only unactivated temporary members to the deterministic initial password", async () => {
    const db = new MemoryDb();
    db.values.set("users/temporary-user", temporaryProfile());
    let updatedPassword = "";
    const auth = {
      async getUserByEmail() {
        return { uid: "temporary-user" };
      },
      async updateUser(uid: string, update: { password: string }) {
        assert.equal(uid, "temporary-user");
        updatedPassword = update.password;
        return { uid };
      },
    } as unknown as Auth;

    const result = await provisionTemporaryQuoteMember({
      db: db as unknown as Firestore,
      auth,
      requestId: "request-2",
      quoteRequestId: "audit_quote_request-2",
      email: "quote@example.com",
      contactName: "견적 고객",
      phone: "010-1234-5678",
      marketingConsent: false,
      now: "2026-07-24T00:00:00.000Z",
    });

    assert.equal(result.initialPasswordIssued, true);
    assert.equal(result.initialPassword, "nh56785678");
    assert.equal(updatedPassword, "nh56785678");
  });

  it("does not reset passwords for full members", async () => {
    const db = new MemoryDb();
    db.values.set("users/full-user", {
      ...temporaryProfile("full-user"),
      status: "active",
      temporaryMember: undefined,
    } satisfies UserRecord);
    const auth = {
      async getUserByEmail() {
        return { uid: "full-user" };
      },
      async updateUser() {
        throw new Error("must_not_reset_password");
      },
    } as unknown as Auth;

    const result = await provisionTemporaryQuoteMember({
      db: db as unknown as Firestore,
      auth,
      requestId: "request-3",
      quoteRequestId: "audit_quote_request-3",
      email: "quote@example.com",
      contactName: "견적 고객",
      phone: "010-1234-5678",
      marketingConsent: false,
      now: "2026-07-24T00:00:00.000Z",
    });

    assert.equal(result.profileStatus, "active");
    assert.equal(result.initialPasswordIssued, false);
    assert.equal(result.initialPassword, null);
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

  it("requires remaining membership fields and a single conversion consent", () => {
    const valid = {
      cooperativeId: "cooperative-1",
      position: "과장",
      duty: "accounting",
      conversionConsent: true,
      existingConsents: {
        terms: false,
        privacy: true,
        marketing: true,
        email: true,
        sms: false,
        kakao: false,
      },
    };
    assert.deepEqual(validateTemporaryMemberConversion(valid).consents, {
      terms: true,
      privacy: true,
      marketing: true,
      email: true,
      sms: false,
      kakao: false,
    });
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
          conversionConsent: false,
        }),
      /consent_required/u,
    );
  });

  it("asks only for conversion consent on the membership conversion screen", () => {
    const form = readFileSync(
      path.join(root, "components/TemporaryMemberConversionForm.tsx"),
      "utf8",
    );
    assert.equal((form.match(/type="checkbox"/g) ?? []).length, 1);
    assert.match(form, /conversionConsent: true/);
    assert.equal(form.includes("marketingConsent"), false);
    assert.equal(form.includes("termsConsent"), false);
    assert.match(form, /className="login-page"/);
    assert.match(form, /temporaryConversionQuotedNameLabel/);
    assert.match(form, /temporaryConversionQuotedPhoneLabel/);
    assert.match(form, /quotedContact\.customerName/);
    assert.match(form, /quotedContact\.customerPhone/);
  });

  it("reuses the latest quoted cooperative and contact instead of asking again", () => {
    assert.deepEqual(
      pickQuotedCooperative([
        {
          cooperativeId: "old",
          cooperativeName: "이전농협",
          customerName: "이전 담당자",
          customerPhone: "010-0000-0000",
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
        {
          cooperativeId: "quoted",
          cooperativeName: "재경농협",
          customerName: "김농협",
          customerPhone: "+821012345678",
          updatedAt: "2026-08-13T00:00:00.000Z",
        },
      ]),
      {
        cooperativeId: "quoted",
        cooperativeName: "재경농협",
        customerName: "김농협",
        customerPhone: "+821012345678",
      },
    );
  });

  it("formats quoted phones so customers can confirm the number they submitted", () => {
    assert.equal(displayQuotedPhone("+821012345678"), "010-1234-5678");
    assert.equal(displayQuotedPhone("01012345678"), "010-1234-5678");
    assert.deepEqual(
      pickQuotedContact([
        {
          customerName: "김농협",
          customerPhone: "010-1234-5678",
          updatedAt: "2026-08-13T00:00:00.000Z",
        },
      ]),
      { customerName: "김농협", customerPhone: "010-1234-5678" },
    );
  });

  it("lets customers confirm quote-request identity on the inbox before conversion", () => {
    const page = readFileSync(
      path.join(root, "components/CustomerQuotesPage.tsx"),
      "utf8",
    );
    assert.match(page, /requestInfoTitle/);
    assert.match(page, /requestNameLabel/);
    assert.match(page, /requestPhoneLabel/);
    assert.match(page, /requestCooperativeLabel/);
    assert.match(page, /displayQuotedPhone/);
  });
});
