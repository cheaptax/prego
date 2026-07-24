import {
  getAuditEvaluationAccessEmailAdapter,
  type AuditEvaluationAccessEmailAdapter,
} from "@/lib/audit-evaluation/access-email-adapter";
import {
  FirestoreAuditEvaluationCustomerAccessRepository,
  type AuditEvaluationCustomerAccessRepository,
  type AuditQuoteAccessSource,
} from "@/lib/audit-evaluation/customer-access-repository";
import {
  addDays,
  addMinutes,
  auditEvaluationCaseMappingId,
  createAuditEvaluationAccessToken,
  createAuditEvaluationCaseId,
  createAuditEvaluationSubjectId,
  getAuditEvaluationAccessSecret,
  hashAuditEvaluationAccessToken,
  hashAuditEvaluationSessionToken,
} from "@/lib/audit-evaluation/customer-access-token";
import {
  assertAuditEvaluationCapabilityEnabled,
  getServerFeatureFlags,
  type AuditEvaluationFeatureFlags,
} from "@/lib/audit-evaluation/feature-flags";
import type {
  AuditEvaluationAccessTokenRecord,
  AuditEvaluationCase,
  AuditEvaluationSessionRecord,
  CustomerAccessOwner,
  EvaluationConfig,
  StandardQuoteDocumentRecord,
} from "@/lib/audit-evaluation/types";
import {
  hmacEmailHash,
  isNonghyupEmail,
  normalizeEmail,
} from "@/lib/audit-quote/email";

type EnvMap = Record<string, string | undefined>;

export type AuditEvaluationAccessRequestResult = {
  accepted: true;
  deliveryAttempted: boolean;
};

export type AuditEvaluationSessionGrant = {
  rawSessionToken: string;
  session: AuditEvaluationSessionRecord;
  evaluationCase: AuditEvaluationCase;
};

export class AuditEvaluationCustomerAccessService {
  private readonly repository: AuditEvaluationCustomerAccessRepository;
  private readonly emailAdapter: AuditEvaluationAccessEmailAdapter;
  private readonly accessSecret: string;
  private readonly auditQuoteHashPepper: string;
  private readonly baseUrl: string;
  private readonly flags: AuditEvaluationFeatureFlags;
  private readonly allowedEmailHashes: Set<string> | null;

  constructor(
    repository: AuditEvaluationCustomerAccessRepository =
      new FirestoreAuditEvaluationCustomerAccessRepository(),
    options: {
      emailAdapter?: AuditEvaluationAccessEmailAdapter;
      accessSecret?: string;
      auditQuoteHashPepper?: string;
      baseUrl?: string;
      flags?: AuditEvaluationFeatureFlags;
      env?: EnvMap;
    } = {},
  ) {
    const env = options.env ?? process.env;
    this.repository = repository;
    this.emailAdapter =
      options.emailAdapter ??
      getAuditEvaluationAccessEmailAdapter(env);
    this.accessSecret =
      options.accessSecret ?? getAuditEvaluationAccessSecret(env);
    this.auditQuoteHashPepper =
      options.auditQuoteHashPepper ??
      env.AUDIT_QUOTE_HASH_PEPPER?.trim() ??
      "";
    this.baseUrl =
      options.baseUrl ??
      resolveAuditEvaluationBaseUrl(env);
    this.allowedEmailHashes = parseEmailHashAllowlist(
      env.AUDIT_EVALUATION_ACCESS_EMAIL_HASH_ALLOWLIST,
    );
    this.flags =
      options.flags ?? getServerFeatureFlags(env).auditEvaluation;
  }

  async requestEmailAccess(
    input: {
      email: string;
      publicReference?: string;
      now: string;
    },
  ): Promise<AuditEvaluationAccessRequestResult> {
    assertAuditEvaluationCapabilityEnabled(
      "customerEntryEnabled",
      this.flags,
    );
    if (
      !this.emailAdapter.available ||
      this.auditQuoteHashPepper.length < 16
    ) {
      return { accepted: true, deliveryAttempted: false };
    }

    const normalizedEmail = normalizeEmail(input.email);
    if (!isNonghyupEmail(normalizedEmail)) {
      return { accepted: true, deliveryAttempted: false };
    }

    const emailHash = hmacEmailHash(
      normalizedEmail,
      this.auditQuoteHashPepper,
    );
    if (!this.isEmailHashAllowed(emailHash)) {
      return { accepted: true, deliveryAttempted: false };
    }
    const eligible = await this.resolveEligibleRequest(
      emailHash,
      input.publicReference,
      input.now,
    );
    if (!eligible) {
      return { accepted: true, deliveryAttempted: false };
    }

    const owner: CustomerAccessOwner = {
      type: "CAPABILITY_SUBJECT",
      subjectId: createAuditEvaluationSubjectId(),
    };
    const evaluationCase = await this.createOrGetEligibleCase(
      eligible,
      owner,
      input.now,
    );
    if (!evaluationCase) {
      return { accepted: true, deliveryAttempted: false };
    }

    const rawToken = createAuditEvaluationAccessToken();
    const tokenHash = hashAuditEvaluationAccessToken(
      rawToken,
      this.accessSecret,
    );
    const subjectId =
      evaluationCase.customerAccessOwner.type === "CAPABILITY_SUBJECT"
        ? evaluationCase.customerAccessOwner.subjectId
        : createAuditEvaluationSubjectId();
    const tokenRecord: AuditEvaluationAccessTokenRecord = {
      tokenHash,
      caseId: evaluationCase.id,
      quoteRequestId: evaluationCase.quoteRequestId,
      emailHash,
      subjectId,
      sessionLifetimeMinutes:
        eligible.config.customerAccessPolicy.sessionLifetimeMinutes,
      expiresAt: addMinutes(
        input.now,
        eligible.config.customerAccessPolicy.magicLinkLifetimeMinutes,
      ),
      issuedAt: input.now,
      usedAt: null,
      revokedAt: null,
      replacedByTokenHash: null,
    };
    await this.repository.issueAccessToken(
      eligible.mappingId,
      tokenRecord,
      input.now,
    );
    const magicLink = new URL(
      "/events/audit-quote/evaluate",
      this.baseUrl,
    );
    magicLink.hash = `access_token=${encodeURIComponent(rawToken)}`;
    try {
      await this.emailAdapter.sendAccessLink({
        recipientEmail: eligible.source.record.email,
        magicLink: magicLink.toString(),
        expiresAt: tokenRecord.expiresAt,
      });
      await this.repository.recordAccessAuditLog?.({
        caseId: evaluationCase.id,
        action: "ACCESS_EMAIL_SENT",
        occurredAt: input.now,
        errorCode: null,
      });
      return { accepted: true, deliveryAttempted: true };
    } catch {
      await this.repository.recordAccessAuditLog?.({
        caseId: evaluationCase.id,
        action: "ACCESS_EMAIL_FAILED",
        occurredAt: input.now,
        errorCode: "EMAIL_PROVIDER_DELIVERY_FAILED",
      });
      return { accepted: true, deliveryAttempted: false };
    }
  }

  async exchangeAccessToken(
    rawToken: string,
    now: string,
  ): Promise<AuditEvaluationSessionGrant | null> {
    assertAuditEvaluationCapabilityEnabled(
      "customerEntryEnabled",
      this.flags,
    );
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return null;
    const tokenHash = hashAuditEvaluationAccessToken(
      rawToken,
      this.accessSecret,
    );
    const rawSessionToken = createAuditEvaluationAccessToken();
    const sessionHash = hashAuditEvaluationSessionToken(
      rawSessionToken,
      this.accessSecret,
    );
    const consumed = await this.repository.consumeAccessToken(
      tokenHash,
      sessionHash,
      now,
    );
    if (consumed.kind !== "success") return null;
    return {
      rawSessionToken,
      session: consumed.session,
      evaluationCase: consumed.evaluationCase,
    };
  }

  async createFirebaseCustomerSession(
    input: {
      uid: string;
      email: string;
      publicReference?: string;
      now: string;
    },
  ): Promise<AuditEvaluationSessionGrant | null> {
    assertAuditEvaluationCapabilityEnabled(
      "customerEntryEnabled",
      this.flags,
    );
    if (this.auditQuoteHashPepper.length < 16) return null;
    const normalizedEmail = normalizeEmail(input.email);
    if (!isNonghyupEmail(normalizedEmail)) return null;
    const emailHash = hmacEmailHash(
      normalizedEmail,
      this.auditQuoteHashPepper,
    );
    if (!this.isEmailHashAllowed(emailHash)) return null;
    const eligible = await this.resolveEligibleRequest(
      emailHash,
      input.publicReference,
      input.now,
    );
    if (!eligible) return null;
    const evaluationCase = await this.createOrGetEligibleCase(
      eligible,
      { type: "FIREBASE_UID", uid: input.uid },
      input.now,
    );
    if (!evaluationCase) return null;

    const rawSessionToken = createAuditEvaluationAccessToken();
    const session: AuditEvaluationSessionRecord = {
      sessionHash: hashAuditEvaluationSessionToken(
        rawSessionToken,
        this.accessSecret,
      ),
      caseId: evaluationCase.id,
      owner: { type: "FIREBASE_UID", uid: input.uid },
      createdAt: input.now,
      expiresAt: earlierIso(
        addMinutes(
          input.now,
          eligible.config.customerAccessPolicy.sessionLifetimeMinutes,
        ),
        evaluationCase.expiresAt,
      ),
      revokedAt: null,
    };
    await this.repository.createSession(session);
    return { rawSessionToken, session, evaluationCase };
  }

  async validateCaseSession(
    rawSessionToken: string,
    caseId: string,
    now: string,
  ) {
    assertAuditEvaluationCapabilityEnabled(
      "customerEntryEnabled",
      this.flags,
    );
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawSessionToken)) return null;
    const session = await this.repository.getSession(
      hashAuditEvaluationSessionToken(
        rawSessionToken,
        this.accessSecret,
      ),
    );
    if (!session || session.caseId !== caseId || session.revokedAt) {
      return null;
    }
    if (Date.parse(session.expiresAt) <= Date.parse(now)) {
      await this.repository.recordAccessAuditLog?.({
        caseId,
        action: "ACCESS_SESSION_EXPIRED",
        occurredAt: now,
        errorCode: null,
      });
      return null;
    }
    const evaluationCase = await this.repository.getCase(caseId);
    if (
      !evaluationCase ||
      evaluationCase.status === "EXPIRED" ||
      evaluationCase.status === "DELETED"
    ) {
      return null;
    }
    if (Date.parse(evaluationCase.expiresAt) <= Date.parse(now)) {
      await this.repository.recordAccessAuditLog?.({
        caseId,
        action: "CASE_ACCESS_EXPIRED",
        occurredAt: now,
        errorCode: null,
      });
      return null;
    }
    const source = await this.repository.getQuoteRequestById(
      evaluationCase.quoteRequestId,
    );
    if (
      !source ||
      source.record.status === "closed" ||
      source.record.status === "invalid"
    ) {
      return null;
    }
    return { session, evaluationCase };
  }

  async revokeSession(rawSessionToken: string, now: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawSessionToken)) return;
    await this.repository.revokeSession(
      hashAuditEvaluationSessionToken(
        rawSessionToken,
        this.accessSecret,
      ),
      now,
    );
  }

  private async resolveEligibleRequest(
    emailHash: string,
    publicReference: string | undefined,
    now: string,
  ) {
    const [source, config] = await Promise.all([
      this.repository.findQuoteRequestByEmailHash(
        emailHash,
        publicReference?.trim() || undefined,
      ),
      this.repository.getActiveEvaluationConfig(now),
    ]);
    if (
      !source ||
      !config ||
      source.record.emailHash !== emailHash ||
      source.record.status === "closed" ||
      source.record.status === "invalid"
    ) {
      return null;
    }
    const standardQuotes =
      await this.repository.listStandardQuotesForRequest(
        source.record.requestId,
      );
    const hasQuote =
      source.record.quoteCount > 0 || standardQuotes.length > 0;
    if (
      !hasQuote &&
      !config.customerAccessPolicy.allowUploadWhenNoRegisteredQuotes
    ) {
      return null;
    }
    return {
      source,
      config,
      standardQuotes,
      mappingId: auditEvaluationCaseMappingId(
        source.record.requestId,
        this.accessSecret,
      ),
    };
  }

  private isEmailHashAllowed(emailHash: string) {
    return this.allowedEmailHashes === null ||
      this.allowedEmailHashes.has(emailHash);
  }

  private async createOrGetEligibleCase(
    eligible: {
      source: AuditQuoteAccessSource;
      config: EvaluationConfig;
      standardQuotes: StandardQuoteDocumentRecord[];
      mappingId: string;
    },
    owner: CustomerAccessOwner,
    now: string,
  ) {
    const existing = await this.repository.getCaseByMappingId(
      eligible.mappingId,
    );
    if (
      existing &&
      (existing.status === "DELETED" ||
        existing.status === "EXPIRED" ||
        Date.parse(existing.expiresAt) <= Date.parse(now))
    ) {
      return null;
    }
    const firstStandardQuote = eligible.standardQuotes[0] ?? null;
    const expiresAt = earlierIso(
      addDays(
        now,
        eligible.config.customerAccessPolicy.caseLifetimeDays,
      ),
      eligible.config.effectiveTo ??
        addDays(
          now,
          eligible.config.customerAccessPolicy.caseLifetimeDays,
        ),
    );
    const value: AuditEvaluationCase = {
      id: createAuditEvaluationCaseId(),
      quoteRequestId: eligible.source.record.requestId,
      cooperativeId: null,
      cooperativeNameSnapshot: "",
      fiscalYear: inferFiscalYear(
        firstStandardQuote,
        eligible.config.effectiveFrom,
        now,
      ),
      customerAccessOwner: owner,
      status: "ACCESS_PENDING",
      quoteTemplateVersion:
        firstStandardQuote?.templateVersion ?? null,
      evaluationConfigVersion: {
        id: eligible.config.id,
        version: eligible.config.version,
      },
      latestReportVersion: null,
      reportRegenerationRequired: false,
      expectedQuoteCount: eligible.config.minimumQuoteCount,
      confirmedQuoteCount: Math.max(
        eligible.source.record.quoteCount,
        eligible.standardQuotes.length,
      ),
      expiresAt,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    return this.repository.createOrGetCase(
      eligible.mappingId,
      value,
    );
  }
}

function resolveAuditEvaluationBaseUrl(env: EnvMap) {
  const configured = env.AUDIT_EVALUATION_BASE_URL?.trim();
  if (env.NODE_ENV !== "production") {
    return configured || "http://localhost:3000";
  }
  for (const candidate of [
    configured,
    env.NH_SUPPORT_BASE_URL?.trim(),
    env.VERCEL_PROJECT_PRODUCTION_URL?.trim(),
    env.VERCEL_URL?.trim(),
  ]) {
    if (!candidate) continue;
    const withProtocol = candidate.includes("://")
      ? candidate
      : `https://${candidate}`;
    try {
      const url = new URL(withProtocol);
      if (
        url.protocol === "https:" &&
        !url.username &&
        !url.password
      ) {
        return url.toString();
      }
    } catch {
      // Try the next trusted deployment URL source.
    }
  }
  throw new Error("audit_evaluation_base_url_not_configured");
}

function parseEmailHashAllowlist(value: string | undefined) {
  if (value === undefined || value.trim() === "") return null;
  return new Set(
    value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => /^[a-f0-9]{64}$/.test(item)),
  );
}

function inferFiscalYear(
  standardQuote: StandardQuoteDocumentRecord | null,
  effectiveFrom: string | null,
  now: string,
) {
  if (standardQuote) return standardQuote.fiscalYear;
  return new Date(effectiveFrom ?? now).getUTCFullYear();
}

function earlierIso(left: string, right: string) {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}
