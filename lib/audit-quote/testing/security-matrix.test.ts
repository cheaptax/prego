import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Firestore } from "firebase-admin/firestore";
import type { AuditQuoteConfig } from "@/lib/audit-quote/config";
import { getAuditQuoteConfig } from "@/lib/audit-quote/config";
import { AUDIT_QUOTE_REQUESTS } from "@/lib/audit-quote/collections";
import { hmacEmailHash } from "@/lib/audit-quote/email";
import { guardAuditQuoteRequest } from "@/lib/audit-quote/http";
import { buildAuditQuoteNotifyPayload } from "@/lib/audit-quote/notify";
import { getPublicAuditQuoteConfig } from "@/lib/audit-quote/public-config";
import { canTransitionAuditQuoteStatus } from "@/lib/audit-quote/status";
import { submitAuditQuoteRequest } from "@/lib/audit-quote/submit";
import { trackAuditQuoteEvent } from "@/lib/audit-quote/analytics";
import { MemoryFirestore } from "@/lib/audit-quote/testing/memory-firestore";

const pepper = "test-audit-quote-pepper-key";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

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
      ipMax: 2,
      emailWindowMs: 24 * 60 * 60 * 1000,
      emailMax: 1,
    },
    captchaEnabled: false,
    appCheckEnabled: false,
    ...overrides,
  };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    email: "matrix.user@nonghyup.com",
    contactName: "김농협",
    phone: "010-1234-5678",
    privacyConsent: true,
    privacyPolicyVersion: "2026-07-20",
    campaign: "fy27-audit-quote",
    channel: "event_page",
    pagePath: "/events/audit-quote",
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

describe("security matrix — intake", () => {
  it("7. 24h dedupe boundary creates a new document after window", async () => {
    const db = new MemoryFirestore();
    const t0 = Date.UTC(2026, 6, 20, 0, 0, 0);
    const cfg = testConfig({
      rateLimit: {
        ipWindowMs: 60_000,
        ipMax: 50,
        emailWindowMs: 60_000,
        emailMax: 50,
      },
    });
    const first = await submitAuditQuoteRequest(
      db as unknown as Firestore,
      cfg,
      baseInput({ idempotencyKey: randomUUID() }),
      { ipHash: "ip-a", nowMs: t0, serverTimestamp: "TS" as never }
    );
    const second = await submitAuditQuoteRequest(
      db as unknown as Firestore,
      cfg,
      baseInput({ idempotencyKey: randomUUID() }),
      {
        ipHash: "ip-b",
        nowMs: t0 + 24 * 60 * 60 * 1000 + 1,
        serverTimestamp: "TS" as never,
      }
    );
    assert.equal(first.kind, "success");
    assert.equal(second.kind, "success");
    if (first.kind === "success" && second.kind === "success") {
      assert.notEqual(first.publicReference, second.publicReference);
      assert.equal(first.created, true);
      assert.equal(second.created, true);
    }
    assert.equal(db.count(AUDIT_QUOTE_REQUESTS), 2);
  });

  it("12. rate limit rejects additional writes without creating docs", async () => {
    const db = new MemoryFirestore();
    const cfg = testConfig({
      rateLimit: {
        ipWindowMs: 60_000,
        ipMax: 1,
        emailWindowMs: 60_000,
        emailMax: 10,
      },
    });
    const first = await submitAuditQuoteRequest(
      db as unknown as Firestore,
      cfg,
      baseInput({
        email: "rate1@nonghyup.com",
        idempotencyKey: randomUUID(),
      }),
      { ipHash: "same-ip", nowMs: 1000, serverTimestamp: "TS" as never }
    );
    const second = await submitAuditQuoteRequest(
      db as unknown as Firestore,
      cfg,
      baseInput({
        email: "rate2@nonghyup.com",
        idempotencyKey: randomUUID(),
      }),
      { ipHash: "same-ip", nowMs: 1001, serverTimestamp: "TS" as never }
    );
    assert.equal(first.kind, "success");
    assert.equal(second.kind, "rejected");
    if (second.kind === "rejected") assert.equal(second.error, "rate_limited");
    assert.equal(db.count(AUDIT_QUOTE_REQUESTS), 1);
  });

  it("10. emailHash uses HMAC, not plain SHA256", () => {
    const email = "hash.check@example.com";
    const hmac = hmacEmailHash(email, pepper);
    const plain = createHash("sha256").update(email, "utf8").digest("hex");
    assert.notEqual(hmac, plain);
    assert.equal(hmac.length, 64);
  });

  it("11. success and duplicate responses share the same public shape", async () => {
    const db = new MemoryFirestore();
    const key = randomUUID();
    const first = await submitAuditQuoteRequest(
      db as unknown as Firestore,
      testConfig(),
      baseInput({ idempotencyKey: key }),
      { ipHash: "ip", nowMs: 1, serverTimestamp: "TS" as never }
    );
    const second = await submitAuditQuoteRequest(
      db as unknown as Firestore,
      testConfig(),
      baseInput({ idempotencyKey: key }),
      { ipHash: "ip", nowMs: 2, serverTimestamp: "TS" as never }
    );
    assert.equal(first.kind, "success");
    assert.equal(second.kind, "success");
    if (first.kind === "success" && second.kind === "success") {
      const a = { ok: true, publicReference: first.publicReference };
      const b = { ok: true, publicReference: second.publicReference };
      assert.deepEqual(Object.keys(a), Object.keys(b));
      assert.equal(a.publicReference, b.publicReference);
    }
  });

  it("14. guard failures never reach storage", async () => {
    const db = new MemoryFirestore();
    const guarded = await guardAuditQuoteRequest(
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
    assert.equal(guarded.ok, false);
    assert.equal(db.count(AUDIT_QUOTE_REQUESTS), 0);
  });

  it("19. event flag defaults to disabled without explicit enable", () => {
    const cfg = getAuditQuoteConfig({});
    assert.equal(cfg.enabled, false);
    const pub = getPublicAuditQuoteConfig({
      AUDIT_QUOTE_EVENT_ENABLED: "false",
    });
    assert.equal(pub.enabled, false);
  });
});

describe("security matrix — admin & notify", () => {
  it("21. forbids illegal status transitions", () => {
    assert.equal(canTransitionAuditQuoteStatus("received", "delivered"), false);
    assert.equal(canTransitionAuditQuoteStatus("closed", "contacting"), false);
    assert.equal(canTransitionAuditQuoteStatus("received", "invalid"), true);
  });

  it("22. notify payload never puts raw email in title", () => {
    const payload = buildAuditQuoteNotifyPayload({
      requestId: "r1",
      publicReference: "AQ-TEST-0001",
      email: "raw-secret@example.com",
      campaign: "fy27-audit-quote",
    });
    assert.equal(payload.title.includes("raw-secret@example.com"), false);
  });

  it("20. admin audit-quote routes require requireAdmin", () => {
    const files = [
      "app/api/admin/audit-quotes/route.ts",
      "app/api/admin/audit-quotes/[requestId]/route.ts",
      "app/api/admin/audit-quotes/[requestId]/notify-retry/route.ts",
    ];
    for (const rel of files) {
      const src = readFileSync(path.join(root, rel), "utf8");
      assert.match(src, /requireAdmin/);
    }
  });
});

describe("security matrix — client boundaries", () => {
  it("1-2. client-touched modules do not import firebase-admin or hash pepper", () => {
    const files = [
      "lib/audit-quote/email-core.ts",
      "lib/audit-quote/contact-core.ts",
      "lib/audit-quote/client-form.ts",
      "lib/audit-quote/analytics.ts",
      "lib/audit-quote/public-types.ts",
      "components/AuditQuoteEventPage.tsx",
    ];
    for (const rel of files) {
      const src = readFileSync(path.join(root, rel), "utf8");
      assert.equal(/from\s+["']firebase-admin/.test(src), false, rel);
      assert.equal(/AUDIT_QUOTE_HASH_PEPPER/.test(src), false, rel);
      assert.equal(/FIREBASE_PRIVATE_KEY/.test(src), false, rel);
      assert.equal(/createHmac/.test(src), false, rel);
    }
  });

  it("18. analytics allowlist rejects email-like params", () => {
    const calls: unknown[] = [];
    (globalThis as { window?: unknown }).window = {
      gtag: (...args: unknown[]) => {
        calls.push(args);
      },
    };
    trackAuditQuoteEvent("audit_quote_submit_success", {
      campaign: "fy27-audit-quote",
      email: "leak@example.com",
      requestId: "should-not-pass",
      page_path: "/events/audit-quote",
    } as never);
    assert.equal(calls.length, 1);
    const payload = calls[0] as unknown[];
    assert.deepEqual(payload[1], "audit_quote_submit_success");
    assert.deepEqual(payload[2], {
      campaign: "fy27-audit-quote",
      page_path: "/events/audit-quote",
    });
    delete (globalThis as { window?: unknown }).window;
  });
});
