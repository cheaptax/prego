import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Firestore } from "firebase-admin/firestore";
import type { AuditQuoteConfig } from "@/lib/audit-quote/config";
import {
  AUDIT_QUOTE_REQUESTS,
} from "@/lib/audit-quote/collections";
import {
  hmacEmailHash,
  isValidBusinessEmail,
  maskEmail,
  normalizeEmail,
} from "@/lib/audit-quote/email";
import { isAllowedAuditQuoteRequesterEmail } from "@/lib/audit-quote/email-policy";
import { guardAuditQuoteRequest } from "@/lib/audit-quote/http";
import { isValidIdempotencyKey } from "@/lib/audit-quote/idempotency";
import {
  isHoneypotTriggered,
  isJsonContentType,
  isAllowedOrigin,
} from "@/lib/audit-quote/security";
import { submitAuditQuoteRequest } from "@/lib/audit-quote/submit";
import { MemoryFirestore } from "@/lib/audit-quote/testing/memory-firestore";

const pepper = "test-audit-quote-pepper-key";

function testConfig(overrides: Partial<AuditQuoteConfig> = {}): AuditQuoteConfig {
  return {
    enabled: true,
    privacyPolicyVersion: "2026-07-20",
    hashPepper: pepper,
    allowedCampaigns: ["fy27-audit-quote"],
    allowedChannels: ["event_page", "direct", "share"],
    allowedOrigins: ["http://localhost:3000"],
    maxBodyBytes: 8192,
    dedupeWindowMs: 24 * 60 * 60 * 1000,
    pagePath: "/events/audit-quote",
    rateLimit: {
      ipWindowMs: 10 * 60 * 1000,
      ipMax: 50,
      emailWindowMs: 24 * 60 * 60 * 1000,
      emailMax: 20,
    },
    captchaEnabled: false,
    appCheckEnabled: false,
    ...overrides,
  };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    email: "Finance.Team@nonghyup.com",
    contactName: "김농협",
    phone: "010-1234-5678",
    targetCooperativeName: "프리고농협",
    fiscalYear: 2026,
    privacyConsent: true,
    privacyPolicyVersion: "2026-07-20",
    campaign: "fy27-audit-quote",
    channel: "event_page",
    pagePath: "/events/audit-quote",
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

describe("audit-quote unit", () => {
  it("normalizes email without provider-specific mangling", () => {
    assert.equal(normalizeEmail("  Finance.Team+audit@Example.COM "), "finance.team+audit@example.com");
    assert.equal(isValidBusinessEmail("finance.team+audit@example.com"), true);
    assert.equal(isValidBusinessEmail("not-an-email"), false);
    assert.equal(isValidBusinessEmail("a".repeat(80) + "@ex.com"), false);
  });

  it("allows only the exact server-side test email exceptions", () => {
    for (const email of [
      "cheaptaxworld@gmail.com",
      "cheaptax@naver.com",
      "requiem77k@naver.com",
      "prego.ceo@gmail.com",
    ]) {
      assert.equal(isAllowedAuditQuoteRequesterEmail(email), true);
      assert.equal(
        isAllowedAuditQuoteRequesterEmail(` ${email.toUpperCase()} `),
        true,
      );
    }
    assert.equal(
      isAllowedAuditQuoteRequesterEmail("someone@example.com"),
      false,
    );
    assert.equal(
      isAllowedAuditQuoteRequesterEmail("prego.ceo+test@gmail.com"),
      false,
    );
  });

  it("uses HMAC-SHA256 for emailHash", () => {
    const hash = hmacEmailHash("a@b.co", pepper);
    assert.equal(hash.length, 64);
    assert.notEqual(hash, hmacEmailHash("a@b.co", pepper + "x"));
    assert.match(maskEmail("alpha@coop.kr"), /^a\*\*\*@coop\.kr$/);
  });

  it("validates idempotency UUID and honeypot", () => {
    assert.equal(isValidIdempotencyKey(randomUUID()), true);
    assert.equal(isValidIdempotencyKey("short"), false);
    assert.equal(isHoneypotTriggered("https://spam.test"), true);
    assert.equal(isHoneypotTriggered(" "), false);
  });

  it("guards content-type, origin, and body size", async () => {
    assert.equal(isJsonContentType("application/json; charset=utf-8"), true);
    assert.equal(isAllowedOrigin("http://localhost:3000", ["http://localhost:3000"]), true);

    const large = "x".repeat(9000);
    const tooLarge = await guardAuditQuoteRequest(
      new Request("http://localhost:3000/api/audit-quote/requests", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: `{"email":"${large}@example.com"}`,
      }),
      testConfig()
    );
    assert.equal(tooLarge.ok, false);
    if (!tooLarge.ok) {
      assert.equal(tooLarge.error, "payload_too_large");
    }

    const badOrigin = await guardAuditQuoteRequest(
      new Request("http://localhost:3000/api/audit-quote/requests", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: "{}",
      }),
      testConfig()
    );
    assert.equal(badOrigin.ok, false);
    if (!badOrigin.ok) assert.equal(badOrigin.error, "origin_not_allowed");

    const badType = await guardAuditQuoteRequest(
      new Request("http://localhost:3000/api/audit-quote/requests", {
        method: "POST",
        headers: {
          "content-type": "text/plain",
          origin: "http://localhost:3000",
        },
        body: "{}",
      }),
      testConfig()
    );
    assert.equal(badType.ok, false);
    if (!badType.ok) assert.equal(badType.error, "unsupported_media_type");
  });
});

describe("audit-quote integration (memory firestore)", () => {
  it("stores one document for a valid request", async () => {
    const db = new MemoryFirestore();
    const result = await submitAuditQuoteRequest(
      db as unknown as Firestore,
      testConfig(),
      baseInput(),
      { ipHash: "ip1", nowMs: Date.UTC(2026, 6, 20), serverTimestamp: "SERVER_TS" as never }
    );
    assert.equal(result.kind, "success");
    if (result.kind === "success") {
      assert.equal(result.created, true);
      assert.ok(result.requestId);
    }
    assert.equal(db.count(AUDIT_QUOTE_REQUESTS), 1);
    const stored = db.list(AUDIT_QUOTE_REQUESTS)[0];
    assert.equal(stored.status, "received");
    assert.equal(stored.schemaVersion, 3);
    assert.equal(stored.quoteCount, 0);
    assert.equal(stored.marketingConsent, false);
    assert.equal(stored.email, "finance.team@nonghyup.com");
    assert.equal(stored.emailHash, hmacEmailHash("finance.team@nonghyup.com", pepper));
    assert.equal(stored.contactName, "김농협");
    assert.equal(stored.phone, "010-1234-5678");
    assert.equal(stored.targetCooperativeName, "프리고농협");
    assert.equal(stored.fiscalYear, 2026);
    assert.notEqual(stored.idempotencyKeyHash, baseInput().idempotencyKey);
    if (result.kind === "success") {
      assert.equal(stored.publicReference, result.publicReference);
      // Server-internal result may include email for notify; public API must not.
      const publicBody = {
        ok: true as const,
        publicReference: result.publicReference,
      };
      assert.equal(JSON.stringify(publicBody).includes("finance.team@nonghyup.com"), false);
    }
  });

  it("replays the same Idempotency-Key without creating another document", async () => {
    const db = new MemoryFirestore();
    const key = randomUUID();
    const first = await submitAuditQuoteRequest(
      db as unknown as Firestore,
      testConfig(),
      baseInput({ idempotencyKey: key }),
      { ipHash: "ip1", nowMs: 1_000, serverTimestamp: "SERVER_TS" as never }
    );
    const second = await submitAuditQuoteRequest(
      db as unknown as Firestore,
      testConfig(),
      baseInput({ idempotencyKey: key, email: "other@nonghyup.com" }),
      { ipHash: "ip1", nowMs: 2_000, serverTimestamp: "SERVER_TS" as never }
    );
    assert.equal(first.kind, "success");
    assert.equal(second.kind, "success");
    if (first.kind === "success" && second.kind === "success") {
      assert.equal(first.publicReference, second.publicReference);
    }
    assert.equal(db.count(AUDIT_QUOTE_REQUESTS), 1);
  });

  it("dedupes same campaign+email within 24h across concurrent requests", async () => {
    const db = new MemoryFirestore();
    const nowMs = Date.UTC(2026, 6, 20, 12);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        submitAuditQuoteRequest(
          db as unknown as Firestore,
          testConfig(),
          baseInput({ idempotencyKey: randomUUID() }),
          { ipHash: "ip-concurrent", nowMs, serverTimestamp: "SERVER_TS" as never }
        )
      )
    );
    assert.equal(results.every((item) => item.kind === "success"), true);
    const refs = new Set(
      results.map((item) => (item.kind === "success" ? item.publicReference : ""))
    );
    assert.equal(refs.size, 1);
    assert.equal(db.count(AUDIT_QUOTE_REQUESTS), 1);
  });

  it("rejects invalid email, missing consent, and wrong policy version without storage", async () => {
    const db = new MemoryFirestore();
    const invalidEmail = await submitAuditQuoteRequest(
      db as unknown as Firestore,
      testConfig(),
      baseInput({ email: "bad-email" }),
      { ipHash: "ip1", serverTimestamp: "SERVER_TS" as never }
    );
    const wrongDomain = await submitAuditQuoteRequest(
      db as unknown as Firestore,
      testConfig(),
      baseInput({ email: "someone@example.com" }),
      { ipHash: "ip1", serverTimestamp: "SERVER_TS" as never }
    );
    const missingName = await submitAuditQuoteRequest(
      db as unknown as Firestore,
      testConfig(),
      baseInput({ contactName: "" }),
      { ipHash: "ip1", serverTimestamp: "SERVER_TS" as never }
    );
    const badPhone = await submitAuditQuoteRequest(
      db as unknown as Firestore,
      testConfig(),
      baseInput({ phone: "02-123-4567" }),
      { ipHash: "ip1", serverTimestamp: "SERVER_TS" as never }
    );
    const missingConsent = await submitAuditQuoteRequest(
      db as unknown as Firestore,
      testConfig(),
      baseInput({ privacyConsent: false }),
      { ipHash: "ip1", serverTimestamp: "SERVER_TS" as never }
    );
    const wrongPolicy = await submitAuditQuoteRequest(
      db as unknown as Firestore,
      testConfig(),
      baseInput({ privacyPolicyVersion: "1999-01-01" }),
      { ipHash: "ip1", serverTimestamp: "SERVER_TS" as never }
    );
    assert.equal(invalidEmail.kind, "rejected");
    assert.equal(wrongDomain.kind, "rejected");
    if (wrongDomain.kind === "rejected") {
      assert.equal(wrongDomain.error, "invalid_email");
    }
    assert.equal(missingName.kind, "rejected");
    if (missingName.kind === "rejected") {
      assert.equal(missingName.error, "invalid_name");
    }
    assert.equal(badPhone.kind, "rejected");
    if (badPhone.kind === "rejected") {
      assert.equal(badPhone.error, "invalid_phone");
    }
    assert.equal(missingConsent.kind, "rejected");
    assert.equal(wrongPolicy.kind, "rejected");
    assert.equal(db.count(AUDIT_QUOTE_REQUESTS), 0);
  });

  it("does not store honeypot submissions and keeps success-shaped result", async () => {
    const db = new MemoryFirestore();
    const result = await submitAuditQuoteRequest(
      db as unknown as Firestore,
      testConfig(),
      baseInput({ companyWebsite: "https://bot.example" }),
      { ipHash: "ip-bot", serverTimestamp: "SERVER_TS" as never }
    );
    assert.equal(result.kind, "honeypot");
    assert.equal(db.count(AUDIT_QUOTE_REQUESTS), 0);
    if (result.kind === "honeypot") {
      assert.match(result.publicReference, /^AQ-/);
    }
  });
});

describe("audit-quote firestore rules contract", () => {
  it("denies public client access to audit-quote collections", () => {
    const rulesPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../firestore.rules"
    );
    const rules = readFileSync(rulesPath, "utf8");
    for (const collection of [
      "auditQuoteRequests",
      "auditQuoteIdempotency",
      "auditQuoteEmailDedup",
      "auditQuoteRateLimits",
      "auditQuoteNotifications",
    ]) {
      assert.match(rules, new RegExp(`match /${collection}/\\{[^}]+\\}`));
      const block = rules.split(`match /${collection}/`)[1] ?? "";
      assert.match(block, /allow read, write:\s*if false;/);
    }
  });
});
