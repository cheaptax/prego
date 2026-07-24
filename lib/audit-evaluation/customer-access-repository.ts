import type { Firestore, Transaction } from "firebase-admin/firestore";
import { AUDIT_EVALUATION_COLLECTIONS } from "@/lib/audit-evaluation/collections";
import { evaluationConfigSchema } from "@/lib/audit-evaluation/schemas";
import { standardQuoteDocumentRecordSchema } from "@/lib/audit-evaluation/quote-document-schemas";
import type {
  AuditEvaluationAccessTokenRecord,
  AuditEvaluationCase,
  AuditEvaluationSessionRecord,
  EvaluationConfig,
  StandardQuoteDocumentRecord,
} from "@/lib/audit-evaluation/types";
import { AUDIT_QUOTE_REQUESTS } from "@/lib/audit-quote/collections";
import { toIsoTimestamp } from "@/lib/audit-quote/admin";
import type { AuditQuoteRequestRecord } from "@/lib/audit-quote/types";
import { addMinutes } from "@/lib/audit-evaluation/customer-access-token";
import { adminDb } from "@/lib/firebase/admin";

type CaseMappingRecord = {
  quoteRequestId: string;
  caseId: string;
  activeAccessTokenHash: string | null;
  updatedAt: string;
};

export type AuditQuoteAccessSource = {
  record: AuditQuoteRequestRecord;
  createdAt: string;
};

export type ConsumeAccessTokenResult =
  | {
      kind: "success";
      session: AuditEvaluationSessionRecord;
      evaluationCase: AuditEvaluationCase;
    }
  | {
      kind: "invalid" | "expired" | "used" | "revoked";
    };

export interface AuditEvaluationCustomerAccessRepository {
  getQuoteRequestById(
    requestId: string,
  ): Promise<AuditQuoteAccessSource | null>;
  findQuoteRequestByEmailHash(
    emailHash: string,
    publicReference?: string,
  ): Promise<AuditQuoteAccessSource | null>;
  getActiveEvaluationConfig(now: string): Promise<EvaluationConfig | null>;
  listStandardQuotesForRequest(
    quoteRequestId: string,
  ): Promise<StandardQuoteDocumentRecord[]>;
  getCase(caseId: string): Promise<AuditEvaluationCase | null>;
  getCaseByMappingId(mappingId: string): Promise<AuditEvaluationCase | null>;
  createOrGetCase(
    mappingId: string,
    value: AuditEvaluationCase,
  ): Promise<AuditEvaluationCase>;
  issueAccessToken(
    mappingId: string,
    value: AuditEvaluationAccessTokenRecord,
    now: string,
  ): Promise<void>;
  consumeAccessToken(
    tokenHash: string,
    sessionHash: string,
    now: string,
  ): Promise<ConsumeAccessTokenResult>;
  createSession(value: AuditEvaluationSessionRecord): Promise<void>;
  getSession(
    sessionHash: string,
  ): Promise<AuditEvaluationSessionRecord | null>;
  revokeSession(sessionHash: string, now: string): Promise<void>;
  recordAccessAuditLog?(input: {
    caseId: string;
    action:
      | "ACCESS_EMAIL_SENT"
      | "ACCESS_EMAIL_FAILED"
      | "ACCESS_TOKEN_EXPIRED"
      | "ACCESS_SESSION_EXPIRED"
      | "CASE_ACCESS_EXPIRED";
    occurredAt: string;
    errorCode: string | null;
  }): Promise<void>;
}

export class FirestoreAuditEvaluationCustomerAccessRepository
  implements AuditEvaluationCustomerAccessRepository
{
  private readonly db: Firestore;

  constructor(db: Firestore = adminDb()) {
    this.db = db;
  }

  async getQuoteRequestById(requestId: string) {
    const snapshot = await this.db
      .collection(AUDIT_QUOTE_REQUESTS)
      .doc(requestId)
      .get();
    if (!snapshot.exists) return null;
    const record = snapshot.data() as AuditQuoteRequestRecord;
    return { record, createdAt: toIsoTimestamp(record.createdAt) };
  }

  async findQuoteRequestByEmailHash(
    emailHash: string,
    publicReference?: string,
  ) {
    const snapshot = await this.db
      .collection(AUDIT_QUOTE_REQUESTS)
      .where("emailHash", "==", emailHash)
      .limit(20)
      .get();
    const candidates = snapshot.docs
      .map((document) => document.data() as AuditQuoteRequestRecord)
      .filter(
        (record) =>
          !publicReference || record.publicReference === publicReference,
      )
      .map((record) => ({
        record,
        createdAt: toIsoTimestamp(record.createdAt),
      }))
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      );
    return candidates[0] ?? null;
  }

  async getActiveEvaluationConfig(now: string) {
    const snapshot = await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.configVersions)
      .get();
    const nowMs = Date.parse(now);
    const activeConfigId =
      process.env.AUDIT_EVALUATION_ACTIVE_CONFIG_ID?.trim() || null;
    const candidates = snapshot.docs
      .flatMap((document) => {
        const parsed = evaluationConfigSchema.safeParse(document.data());
        return parsed.success ? [parsed.data] : [];
      })
      .filter(
        (config) =>
          config.status === "PUBLISHED" &&
          (!activeConfigId || config.id === activeConfigId) &&
          (!config.effectiveFrom ||
            Date.parse(config.effectiveFrom) <= nowMs) &&
          (!config.effectiveTo || Date.parse(config.effectiveTo) > nowMs),
      )
      .sort((left, right) =>
        left.id.localeCompare(right.id) || right.version - left.version
      );
    if (activeConfigId) {
      const active = candidates.filter(({ id }) => id === activeConfigId);
      return active.length === 1 ? active[0] : null;
    }
    const activeIds = new Set(candidates.map(({ id }) => id));
    return activeIds.size === 1 && candidates.length === 1
      ? candidates[0]
      : null;
  }

  async listStandardQuotesForRequest(quoteRequestId: string) {
    const snapshot = await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.standardQuoteDocuments)
      .where("quoteRequestId", "==", quoteRequestId)
      .limit(100)
      .get();
    return snapshot.docs.flatMap((document) => {
      const parsed = standardQuoteDocumentRecordSchema.safeParse(
        document.data(),
      );
      return parsed.success && parsed.data.status === "ACTIVE"
        ? [parsed.data]
        : [];
    });
  }

  async getCase(caseId: string) {
    const snapshot = await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.cases)
      .doc(caseId)
      .get();
    return snapshot.exists
      ? (snapshot.data() as AuditEvaluationCase)
      : null;
  }

  async getCaseByMappingId(mappingId: string) {
    const mapping = await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.caseByQuoteRequest)
      .doc(mappingId)
      .get();
    if (!mapping.exists) return null;
    const caseId = (mapping.data() as CaseMappingRecord).caseId;
    return this.getCase(caseId);
  }

  async createOrGetCase(
    mappingId: string,
    value: AuditEvaluationCase,
  ) {
    return this.db.runTransaction(async (transaction) => {
      const mappingRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.caseByQuoteRequest)
        .doc(mappingId);
      const mapping = await transaction.get(mappingRef);
      if (mapping.exists) {
        const existingCaseId = (mapping.data() as CaseMappingRecord).caseId;
        const existingCaseRef = this.db
          .collection(AUDIT_EVALUATION_COLLECTIONS.cases)
          .doc(existingCaseId);
        const existingCase = await transaction.get(existingCaseRef);
        if (existingCase.exists) {
          return existingCase.data() as AuditEvaluationCase;
        }
      }

      const caseRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.cases)
        .doc(value.id);
      transaction.create(caseRef, value);
      transaction.set(mappingRef, {
        quoteRequestId: value.quoteRequestId,
        caseId: value.id,
        activeAccessTokenHash: null,
        updatedAt: value.updatedAt,
      } satisfies CaseMappingRecord);
      createSystemAuditLog(transaction, this.db, {
        caseId: value.id,
        action: "EVALUATION_CASE_CREATED",
        occurredAt: value.createdAt,
        detail: "case_created",
      });
      return value;
    });
  }

  async issueAccessToken(
    mappingId: string,
    value: AuditEvaluationAccessTokenRecord,
    now: string,
  ) {
    await this.db.runTransaction(async (transaction) => {
      const mappingRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.caseByQuoteRequest)
        .doc(mappingId);
      const mapping = await transaction.get(mappingRef);
      if (!mapping.exists) throw new Error("case_mapping_not_found");
      const mappingData = mapping.data() as CaseMappingRecord;
      const previousHash = mappingData.activeAccessTokenHash;
      const previousRef = previousHash
        ? this.db
            .collection(AUDIT_EVALUATION_COLLECTIONS.accessTokens)
            .doc(previousHash)
        : null;
      const previous = previousRef
        ? await transaction.get(previousRef)
        : null;

      if (previousRef && previous?.exists) {
        transaction.set(
          previousRef,
          {
            revokedAt: now,
            replacedByTokenHash: value.tokenHash,
          },
          { merge: true },
        );
      }
      transaction.create(
        this.db
          .collection(AUDIT_EVALUATION_COLLECTIONS.accessTokens)
          .doc(value.tokenHash),
        value,
      );
      transaction.set(
        mappingRef,
        {
          activeAccessTokenHash: value.tokenHash,
          updatedAt: now,
        },
        { merge: true },
      );
      if (previousRef && previous?.exists) {
        createSystemAuditLog(transaction, this.db, {
          caseId: value.caseId,
          action: "ACCESS_LINK_REVOKED",
          occurredAt: now,
          detail: "superseded",
        });
      }
      createSystemAuditLog(transaction, this.db, {
        caseId: value.caseId,
        action: "ACCESS_LINK_ISSUED",
        occurredAt: now,
        detail: "issued",
      });
    });
  }

  async recordAccessAuditLog(input: {
    caseId: string;
    action:
      | "ACCESS_EMAIL_SENT"
      | "ACCESS_EMAIL_FAILED"
      | "ACCESS_TOKEN_EXPIRED"
      | "ACCESS_SESSION_EXPIRED"
      | "CASE_ACCESS_EXPIRED";
    occurredAt: string;
    errorCode: string | null;
  }) {
    const reference = this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.auditLogs)
      .doc();
    await reference.set({
      id: reference.id,
      caseId: input.caseId,
      reportVersion: null,
      action: input.action,
      actor: {
        type: "SYSTEM",
        service: "audit-evaluation-access-email",
      },
      occurredAt: input.occurredAt,
      detail: input.errorCode ?? "sent",
      errorCode: input.errorCode,
      retryCount: null,
    });
  }

  async consumeAccessToken(
    tokenHash: string,
    sessionHash: string,
    now: string,
  ): Promise<ConsumeAccessTokenResult> {
    return this.db.runTransaction(async (transaction) => {
      const tokenRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.accessTokens)
        .doc(tokenHash);
      const tokenSnapshot = await transaction.get(tokenRef);
      if (!tokenSnapshot.exists) return { kind: "invalid" };
      const token =
        tokenSnapshot.data() as AuditEvaluationAccessTokenRecord;
      if (token.revokedAt) return { kind: "revoked" };
      if (token.usedAt) return { kind: "used" };
      if (Date.parse(token.expiresAt) <= Date.parse(now)) {
        createSystemAuditLog(transaction, this.db, {
          caseId: token.caseId,
          action: "ACCESS_TOKEN_EXPIRED",
          occurredAt: now,
          detail: "token_expired",
        });
        return { kind: "expired" };
      }

      const caseRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.cases)
        .doc(token.caseId);
      const caseSnapshot = await transaction.get(caseRef);
      if (!caseSnapshot.exists) return { kind: "invalid" };
      const evaluationCase =
        caseSnapshot.data() as AuditEvaluationCase;
      if (
        evaluationCase.status === "DELETED" ||
        evaluationCase.status === "EXPIRED" ||
        Date.parse(evaluationCase.expiresAt) <= Date.parse(now)
      ) {
        createSystemAuditLog(transaction, this.db, {
          caseId: token.caseId,
          action: "CASE_ACCESS_EXPIRED",
          occurredAt: now,
          detail: "case_expired",
        });
        return { kind: "expired" };
      }

      const session: AuditEvaluationSessionRecord = {
        sessionHash,
        caseId: token.caseId,
        owner: {
          type: "CAPABILITY_SUBJECT",
          subjectId: token.subjectId,
        },
        createdAt: now,
        expiresAt:
          addMinutes(now, token.sessionLifetimeMinutes) <
          evaluationCase.expiresAt
            ? addMinutes(now, token.sessionLifetimeMinutes)
            : evaluationCase.expiresAt,
        revokedAt: null,
      };
      transaction.set(tokenRef, { usedAt: now }, { merge: true });
      transaction.create(
        this.db
          .collection(AUDIT_EVALUATION_COLLECTIONS.sessions)
          .doc(session.sessionHash),
        session,
      );
      return { kind: "success", session, evaluationCase };
    });
  }

  async createSession(value: AuditEvaluationSessionRecord) {
    await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.sessions)
      .doc(value.sessionHash)
      .create(value);
  }

  async getSession(sessionHash: string) {
    const snapshot = await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.sessions)
      .doc(sessionHash)
      .get();
    return snapshot.exists
      ? (snapshot.data() as AuditEvaluationSessionRecord)
      : null;
  }

  async revokeSession(sessionHash: string, now: string) {
    await this.db.runTransaction(async (transaction) => {
      const reference = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.sessions)
        .doc(sessionHash);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) return;
      const session = snapshot.data() as AuditEvaluationSessionRecord;
      transaction.set(reference, { revokedAt: now }, { merge: true });
      createSystemAuditLog(transaction, this.db, {
        caseId: session.caseId,
        action: "ACCESS_SESSION_REVOKED",
        occurredAt: now,
        detail: "session_revoked",
      });
    });
  }
}

function createSystemAuditLog(
  transaction: Transaction,
  db: Firestore,
  input: {
    caseId: string;
    action: string;
    occurredAt: string;
    detail: string;
  },
) {
  const reference = db
    .collection(AUDIT_EVALUATION_COLLECTIONS.auditLogs)
    .doc();
  transaction.create(reference, {
    id: reference.id,
    caseId: input.caseId,
    reportVersion: null,
    documentId: null,
    action: input.action,
    actor: {
      type: "SYSTEM",
      service: "audit-evaluation-access",
    },
    occurredAt: input.occurredAt,
    detail: input.detail,
    errorCode: null,
    retryCount: null,
  });
}
