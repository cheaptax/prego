import assert from "node:assert/strict";
import test from "node:test";
import {
  getAuditEvaluationAccessEmailAdapter,
  ResendAccessEmailAdapter,
  type AuditEvaluationAccessEmailAdapter,
  WebhookAccessEmailAdapter,
} from "@/lib/audit-evaluation/access-email-adapter";
import type {
  AuditEvaluationCustomerAccessRepository,
  AuditQuoteAccessSource,
  ConsumeAccessTokenResult,
} from "@/lib/audit-evaluation/customer-access-repository";
import { AuditEvaluationCustomerAccessService } from "@/lib/audit-evaluation/customer-access-service";
import { addMinutes } from "@/lib/audit-evaluation/customer-access-token";
import { canUseFirebaseCustomerEvaluationAccess } from "@/lib/audit-evaluation/firebase-customer-access-policy";
import type {
  AuditEvaluationAccessTokenRecord,
  AuditEvaluationCase,
  AuditEvaluationSessionRecord,
  EvaluationConfig,
  StandardQuoteDocumentRecord,
} from "@/lib/audit-evaluation/types";
import { hmacEmailHash } from "@/lib/audit-quote/email";
import type { AuditQuoteRequestRecord } from "@/lib/audit-quote/types";
import { createValidEvaluationConfig } from "@/lib/audit-evaluation/testing/fixtures";
import { processAuditEvaluationPublicAccessRequest } from "@/lib/audit-evaluation/public-access-request";

const NOW = "2026-07-21T00:00:00.000Z";
const ACCESS_SECRET = "access-secret-that-is-at-least-32-bytes-long";
const EMAIL_PEPPER = "email-pepper-for-tests";
const FLAGS = {
  enabled: true,
  customerEntryEnabled: true,
  reportDownloadEnabled: false,
  adminEnabled: false,
  aiNarrativeEnabled: false,
};

test("production email webhook requires HTTPS and a bearer secret", () => {
  assert.equal(
    getAuditEvaluationAccessEmailAdapter({
      AUDIT_EVALUATION_EMAIL_PROVIDER: "webhook",
      AUDIT_EVALUATION_EMAIL_WEBHOOK_URL: "http://mail.example.test/send",
      AUDIT_EVALUATION_EMAIL_WEBHOOK_TOKEN: "long-enough-test-token",
    }).available,
    false,
  );
  assert.equal(
    getAuditEvaluationAccessEmailAdapter({
      AUDIT_EVALUATION_EMAIL_PROVIDER: "webhook",
      AUDIT_EVALUATION_EMAIL_WEBHOOK_URL: "https://mail.example.test/send",
      AUDIT_EVALUATION_EMAIL_WEBHOOK_TOKEN: "short",
    }).available,
    false,
  );
});

test("production email webhook sends a bounded versioned request", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const adapter = new WebhookAccessEmailAdapter({
    url: "https://mail.example.test/send",
    bearerToken: "long-enough-test-token",
    fetcher: (async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(null, { status: 202 });
    }) as typeof fetch,
  });
  await adapter.sendAccessLink({
    recipientEmail: "fixture@nonghyup.com",
    magicLink: "https://support.example/evaluate#access_token=opaque",
    expiresAt: NOW,
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://mail.example.test/send");
  assert.equal(requests[0].init?.method, "POST");
  assert.equal(
    (requests[0].init?.headers as Record<string, string>).authorization,
    "Bearer long-enough-test-token",
  );
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
    schemaVersion: 1,
    event: "AUDIT_EVALUATION_ACCESS_LINK",
    recipientEmail: "fixture@nonghyup.com",
    magicLink: "https://support.example/evaluate#access_token=opaque",
    expiresAt: NOW,
  });
});

test("production Resend adapter sends the one-time link without logging it", async () => {
  const sent: Array<{
    to: string;
    html: string;
    text: string;
    idempotencyKey: string;
  }> = [];
  const adapter = new ResendAccessEmailAdapter({
    available: true,
    sender: async (message) => {
      sent.push(message);
      return {
        provider: "resend" as const,
        id: "email-1",
        recipientEmail: message.to,
      };
    },
  });
  await adapter.sendAccessLink({
    recipientEmail: "fixture@nonghyup.com",
    magicLink: "https://support.example/evaluate#access_token=opaque",
    expiresAt: NOW,
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "fixture@nonghyup.com");
  assert.match(sent[0].html, /access_token=opaque/u);
  assert.match(sent[0].text, /access_token=opaque/u);
  assert.match(sent[0].idempotencyKey, /^audit-evaluation-access\/[a-f0-9]{64}$/u);
  assert.equal(
    getAuditEvaluationAccessEmailAdapter({
      RESEND_API_KEY: "re_test",
      RESEND_FROM_EMAIL: "sender@example.com",
    }).available,
    true,
  );
});

class CapturingEmailAdapter
  implements AuditEvaluationAccessEmailAdapter
{
  readonly available = true;
  readonly messages: {
    recipientEmail: string;
    magicLink: string;
    expiresAt: string;
  }[] = [];

  async sendAccessLink(message: {
    recipientEmail: string;
    magicLink: string;
    expiresAt: string;
  }) {
    this.messages.push(message);
  }
}

class FailingEmailAdapter implements AuditEvaluationAccessEmailAdapter {
  readonly available = true;

  async sendAccessLink() {
    throw new Error("provider_secret_must_not_be_exposed");
  }
}

class MemoryCustomerAccessRepository
  implements AuditEvaluationCustomerAccessRepository
{
  source: AuditQuoteAccessSource | null = null;
  config: EvaluationConfig | null = null;
  standardQuotes: StandardQuoteDocumentRecord[] = [];
  readonly cases = new Map<string, AuditEvaluationCase>();
  readonly caseMappings = new Map<string, string>();
  readonly activeTokens = new Map<string, string>();
  readonly tokens = new Map<string, AuditEvaluationAccessTokenRecord>();
  readonly sessions = new Map<string, AuditEvaluationSessionRecord>();
  readonly accessAuditLogs: Array<{
    caseId: string;
    action: "ACCESS_EMAIL_SENT" | "ACCESS_EMAIL_FAILED";
    occurredAt: string;
    errorCode: string | null;
  }> = [];

  async getQuoteRequestById(requestId: string) {
    return this.source?.record.requestId === requestId
      ? this.source
      : null;
  }

  async findQuoteRequestByEmailHash(
    emailHash: string,
    publicReference?: string,
  ) {
    if (
      this.source?.record.emailHash !== emailHash ||
      (publicReference &&
        this.source.record.publicReference !== publicReference)
    ) {
      return null;
    }
    return this.source;
  }

  async getActiveEvaluationConfig() {
    return this.config;
  }

  async listStandardQuotesForRequest() {
    return this.standardQuotes;
  }

  async getCase(caseId: string) {
    return this.cases.get(caseId) ?? null;
  }

  async getCaseByMappingId(mappingId: string) {
    const caseId = this.caseMappings.get(mappingId);
    return caseId ? this.getCase(caseId) : null;
  }

  async createOrGetCase(
    mappingId: string,
    value: AuditEvaluationCase,
  ) {
    const existing = await this.getCaseByMappingId(mappingId);
    if (existing) return existing;
    this.caseMappings.set(mappingId, value.id);
    this.cases.set(value.id, value);
    return value;
  }

  async issueAccessToken(
    mappingId: string,
    value: AuditEvaluationAccessTokenRecord,
    now: string,
  ) {
    const previousHash = this.activeTokens.get(mappingId);
    if (previousHash) {
      const previous = this.tokens.get(previousHash);
      if (previous) {
        this.tokens.set(previousHash, {
          ...previous,
          revokedAt: now,
          replacedByTokenHash: value.tokenHash,
        });
      }
    }
    this.activeTokens.set(mappingId, value.tokenHash);
    this.tokens.set(value.tokenHash, value);
  }

  async consumeAccessToken(
    tokenHash: string,
    sessionHash: string,
    now: string,
  ): Promise<ConsumeAccessTokenResult> {
    const token = this.tokens.get(tokenHash);
    if (!token) return { kind: "invalid" };
    if (token.revokedAt) return { kind: "revoked" };
    if (token.usedAt) return { kind: "used" };
    if (Date.parse(token.expiresAt) <= Date.parse(now)) {
      return { kind: "expired" };
    }
    const evaluationCase = this.cases.get(token.caseId);
    if (!evaluationCase) return { kind: "invalid" };
    const expiresAt =
      Date.parse(addMinutes(now, token.sessionLifetimeMinutes)) <=
      Date.parse(evaluationCase.expiresAt)
        ? addMinutes(now, token.sessionLifetimeMinutes)
        : evaluationCase.expiresAt;
    const session: AuditEvaluationSessionRecord = {
      sessionHash,
      caseId: token.caseId,
      owner: {
        type: "CAPABILITY_SUBJECT",
        subjectId: token.subjectId,
      },
      createdAt: now,
      expiresAt,
      revokedAt: null,
    };
    this.tokens.set(tokenHash, { ...token, usedAt: now });
    this.sessions.set(sessionHash, session);
    return { kind: "success", session, evaluationCase };
  }

  async createSession(value: AuditEvaluationSessionRecord) {
    this.sessions.set(value.sessionHash, value);
  }

  async getSession(sessionHash: string) {
    return this.sessions.get(sessionHash) ?? null;
  }

  async revokeSession(sessionHash: string, now: string) {
    const current = this.sessions.get(sessionHash);
    if (current) {
      this.sessions.set(sessionHash, { ...current, revokedAt: now });
    }
  }

  async recordAccessAuditLog(input: {
    caseId: string;
    action: "ACCESS_EMAIL_SENT" | "ACCESS_EMAIL_FAILED";
    occurredAt: string;
    errorCode: string | null;
  }) {
    this.accessAuditLogs.push(input);
  }
}

function createHarness(options?: {
  status?: AuditQuoteRequestRecord["status"];
  quoteCount?: number;
  allowUpload?: boolean;
}) {
  const repository = new MemoryCustomerAccessRepository();
  const email = "owner@nonghyup.com";
  repository.source = {
    createdAt: "2026-07-01T00:00:00.000Z",
    record: {
      schemaVersion: 2,
      requestId: "request-1",
      publicReference: "AQ-TEST-001",
      email,
      emailHash: hmacEmailHash(email, EMAIL_PEPPER),
      status: options?.status ?? "delivered",
      quoteCount: options?.quoteCount ?? 2,
      privacyPolicyVersion: "privacy-v1",
      marketingConsent: false,
      campaign: "fy27",
      channel: "web",
      pagePath: "/events/audit-quote",
      idempotencyKeyHash: "idempotency",
      assignedTo: null,
      agreedAt: null as never,
      createdAt: null as never,
      updatedAt: null as never,
    },
  };
  repository.config = {
    ...createValidEvaluationConfig(),
    status: "PUBLISHED",
    publishedBy: "admin",
    publishedAt: NOW,
    customerAccessPolicy: {
      ...createValidEvaluationConfig().customerAccessPolicy,
      allowUploadWhenNoRegisteredQuotes: options?.allowUpload ?? true,
    },
  };
  const emailAdapter = new CapturingEmailAdapter();
  const service = new AuditEvaluationCustomerAccessService(repository, {
    emailAdapter,
    accessSecret: ACCESS_SECRET,
    auditQuoteHashPepper: EMAIL_PEPPER,
    baseUrl: "https://support.example.test",
    flags: FLAGS,
  });
  return { repository, emailAdapter, service, email };
}

function tokenFrom(adapter: CapturingEmailAdapter, index = 0) {
  const url = new URL(adapter.messages[index].magicLink);
  return new URLSearchParams(url.hash.slice(1)).get("access_token") ?? "";
}

test("normal customer receives one-time link and case-scoped session", async () => {
  const { service, emailAdapter, email } = createHarness();
  const requested = await service.requestEmailAccess({
    email,
    now: NOW,
  });
  assert.equal(requested.accepted, true);
  assert.equal(emailAdapter.messages.length, 1);
  assert.equal(new URL(emailAdapter.messages[0].magicLink).search, "");

  const grant = await service.exchangeAccessToken(
    tokenFrom(emailAdapter),
    addMinutes(NOW, 1),
  );
  assert.ok(grant);
  const validated = await service.validateCaseSession(
    grant.rawSessionToken,
    grant.evaluationCase.id,
    addMinutes(NOW, 2),
  );
  assert.equal(validated?.evaluationCase.id, grant.evaluationCase.id);
  assert.equal(
    await service.validateCaseSession(
      grant.rawSessionToken,
      "aec_different-case",
      addMinutes(NOW, 2),
    ),
    null,
  );
});

test("limited rollout allowlist stays enumeration-safe", async () => {
  const harness = createHarness();
  const blockedAdapter = new CapturingEmailAdapter();
  const blockedService = new AuditEvaluationCustomerAccessService(
    harness.repository,
    {
      emailAdapter: blockedAdapter,
      accessSecret: ACCESS_SECRET,
      auditQuoteHashPepper: EMAIL_PEPPER,
      flags: FLAGS,
      env: {
        AUDIT_EVALUATION_ACCESS_EMAIL_HASH_ALLOWLIST: "a".repeat(64),
      },
    },
  );
  assert.deepEqual(
    await blockedService.requestEmailAccess({
      email: harness.email,
      now: NOW,
    }),
    { accepted: true, deliveryAttempted: false },
  );
  assert.equal(blockedAdapter.messages.length, 0);

  const allowedAdapter = new CapturingEmailAdapter();
  const allowedService = new AuditEvaluationCustomerAccessService(
    harness.repository,
    {
      emailAdapter: allowedAdapter,
      accessSecret: ACCESS_SECRET,
      auditQuoteHashPepper: EMAIL_PEPPER,
      flags: FLAGS,
      env: {
        AUDIT_EVALUATION_ACCESS_EMAIL_HASH_ALLOWLIST: hmacEmailHash(
          harness.email,
          EMAIL_PEPPER,
        ),
      },
    },
  );
  const allowed = await allowedService.requestEmailAccess({
    email: harness.email,
    now: NOW,
  });
  assert.equal(allowed.deliveryAttempted, true);
  assert.equal(allowedAdapter.messages.length, 1);
});

test("email provider failures stay generic and create a safe admin audit code", async () => {
  const harness = createHarness();
  const service = new AuditEvaluationCustomerAccessService(
    harness.repository,
    {
      emailAdapter: new FailingEmailAdapter(),
      accessSecret: ACCESS_SECRET,
      auditQuoteHashPepper: EMAIL_PEPPER,
      baseUrl: "https://support.example.test",
      flags: FLAGS,
    },
  );

  const result = await service.requestEmailAccess({
    email: harness.email,
    now: NOW,
  });

  assert.deepEqual(result, { accepted: true, deliveryAttempted: false });
  assert.equal(harness.repository.accessAuditLogs.length, 1);
  assert.deepEqual(harness.repository.accessAuditLogs[0], {
    caseId: harness.repository.accessAuditLogs[0].caseId,
    action: "ACCESS_EMAIL_FAILED",
    occurredAt: NOW,
    errorCode: "EMAIL_PROVIDER_DELIVERY_FAILED",
  });
  assert.equal(
    JSON.stringify(harness.repository.accessAuditLogs).includes(
      "provider_secret",
    ),
    false,
  );
});

test("reissue is idempotent and revokes the previous link", async () => {
  const { service, emailAdapter, repository, email } = createHarness();
  await service.requestEmailAccess({ email, now: NOW });
  await service.requestEmailAccess({
    email,
    now: addMinutes(NOW, 2),
  });
  assert.equal(repository.cases.size, 1);
  assert.equal(
    await service.exchangeAccessToken(
      tokenFrom(emailAdapter, 0),
      addMinutes(NOW, 3),
    ),
    null,
  );
  assert.ok(
    await service.exchangeAccessToken(
      tokenFrom(emailAdapter, 1),
      addMinutes(NOW, 3),
    ),
  );
});

test("expired and reused links are rejected", async () => {
  const expired = createHarness();
  await expired.service.requestEmailAccess({
    email: expired.email,
    now: NOW,
  });
  assert.equal(
    await expired.service.exchangeAccessToken(
      tokenFrom(expired.emailAdapter),
      addMinutes(NOW, 31),
    ),
    null,
  );

  const reused = createHarness();
  await reused.service.requestEmailAccess({
    email: reused.email,
    now: NOW,
  });
  const token = tokenFrom(reused.emailAdapter);
  assert.ok(
    await reused.service.exchangeAccessToken(
      token,
      addMinutes(NOW, 1),
    ),
  );
  assert.equal(
    await reused.service.exchangeAccessToken(
      token,
      addMinutes(NOW, 2),
    ),
    null,
  );
});

test("logout and session expiry remove case access", async () => {
  const { service, emailAdapter, email } = createHarness();
  await service.requestEmailAccess({ email, now: NOW });
  const grant = await service.exchangeAccessToken(
    tokenFrom(emailAdapter),
    addMinutes(NOW, 1),
  );
  assert.ok(grant);
  await service.revokeSession(
    grant.rawSessionToken,
    addMinutes(NOW, 2),
  );
  assert.equal(
    await service.validateCaseSession(
      grant.rawSessionToken,
      grant.evaluationCase.id,
      addMinutes(NOW, 3),
    ),
    null,
  );

  const expiring = createHarness();
  if (expiring.repository.config) {
    expiring.repository.config.customerAccessPolicy.sessionLifetimeMinutes =
      1;
  }
  await expiring.service.requestEmailAccess({
    email: expiring.email,
    now: NOW,
  });
  const shortGrant = await expiring.service.exchangeAccessToken(
    tokenFrom(expiring.emailAdapter),
    NOW,
  );
  assert.ok(shortGrant);
  assert.equal(
    await expiring.service.validateCaseSession(
      shortGrant.rawSessionToken,
      shortGrant.evaluationCase.id,
      addMinutes(NOW, 2),
    ),
    null,
  );
});

test("closed requests and requests without quotes or upload stay closed", async () => {
  const closed = createHarness({ status: "closed" });
  await closed.service.requestEmailAccess({
    email: closed.email,
    now: NOW,
  });
  assert.equal(closed.emailAdapter.messages.length, 0);

  const unavailable = createHarness({
    quoteCount: 0,
    allowUpload: false,
  });
  await unavailable.service.requestEmailAccess({
    email: unavailable.email,
    now: NOW,
  });
  assert.equal(unavailable.emailAdapter.messages.length, 0);
});

test("Firebase customer policy rejects administrators and inactive users", () => {
  assert.equal(
    canUseFirebaseCustomerEvaluationAccess(
      {
        uid: "customer",
        email: "owner@nonghyup.com",
        email_verified: true,
      },
      "active",
    ),
    true,
  );
  assert.equal(
    canUseFirebaseCustomerEvaluationAccess(
      {
        uid: "admin",
        email: "admin@nonghyup.com",
        email_verified: true,
        admin: true,
      },
      "active",
    ),
    false,
  );
  assert.equal(
    canUseFirebaseCustomerEvaluationAccess(
      {
        uid: "inactive-admin",
        email: "admin@nonghyup.com",
        email_verified: true,
      },
      "rejected",
    ),
    false,
  );
});

test("legacy public access helper keeps opaque response shape", async () => {
  const existingShape = await processAuditEvaluationPublicAccessRequest(
    JSON.stringify({ email: "owner@nonghyup.com" }),
    async () => ({ deliveryAttempted: true }),
  );
  const missingShape = await processAuditEvaluationPublicAccessRequest(
    JSON.stringify({ email: "missing@nonghyup.com" }),
    async () => ({ deliveryAttempted: false }),
  );
  assert.deepEqual(existingShape, missingShape);
  assert.deepEqual(existingShape, {
    ok: true,
    status: "access_instructions_if_eligible",
  });
});
