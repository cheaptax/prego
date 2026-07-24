import "server-only";

import { AUDIT_EVALUATION_COLLECTIONS } from "@/lib/audit-evaluation/collections";
import {
  buildNhAuditReportEvaluationSnapshot,
  nhAuditReportPreviewFromSnapshot,
  type NhAuditReportEvaluationSnapshot,
} from "@/lib/audit-evaluation/nh-audit-report-snapshot";
import {
  auditEvaluationCaseRecordSchema,
  createAuditEvaluationReportRunId,
} from "@/lib/audit-evaluation/review-repository";
import type {
  AuditEvaluationActor,
  AuditEvaluationCase,
} from "@/lib/audit-evaluation/types";
import { adminDb } from "@/lib/firebase/admin";
import type { QuoteRecord } from "@/lib/firebase/schema";

export class NhAuditReportServiceError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "NhAuditReportServiceError";
    this.code = code;
  }
}

export class NhAuditReportEvaluationService {
  async preview(input: {
    caseId: string;
    confirmationVersion: number;
    weights: unknown;
    actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }>;
    now: string;
  }) {
    const loaded = await this.loadAuthorizedInputs(input);
    const snapshot = this.buildSnapshot({
      ...input,
      ...loaded,
      reportId: createAuditEvaluationReportRunId(
        input.caseId,
        input.confirmationVersion,
      ),
    });
    return nhAuditReportPreviewFromSnapshot(snapshot);
  }

  async createSnapshot(input: {
    caseId: string;
    confirmationVersion: number;
    weights: unknown;
    actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }>;
    now: string;
  }): Promise<NhAuditReportEvaluationSnapshot> {
    const loaded = await this.loadAuthorizedInputs(input);
    return this.buildSnapshot({
      ...input,
      ...loaded,
      reportId: createAuditEvaluationReportRunId(
        input.caseId,
        input.confirmationVersion,
      ),
    });
  }

  private buildSnapshot(input: {
    caseId: string;
    weights: unknown;
    actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }>;
    now: string;
    reportId: string;
    evaluationCase: AuditEvaluationCase;
    quotes: QuoteRecord[];
  }) {
    try {
      return buildNhAuditReportEvaluationSnapshot({
        reportId: input.reportId,
        evaluationId: input.caseId,
        quoteRequestId: input.evaluationCase.quoteRequestId,
        customerId: input.actor.subjectId,
        quotes: input.quotes,
        weights: input.weights,
        now: input.now,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "nh_audit_report_requires_quotes"
      ) {
        throw new NhAuditReportServiceError("quotes_not_found");
      }
      throw new NhAuditReportServiceError("invalid_weights");
    }
  }

  private async loadAuthorizedInputs(input: {
    caseId: string;
    confirmationVersion: number;
    actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }>;
  }) {
    const db = adminDb();
    const caseSnapshot = await db
      .collection(AUDIT_EVALUATION_COLLECTIONS.cases)
      .doc(input.caseId)
      .get();
    if (!caseSnapshot.exists) {
      throw new NhAuditReportServiceError("case_not_found");
    }
    const parsedCase = auditEvaluationCaseRecordSchema.safeParse(
      caseSnapshot.data(),
    );
    if (!parsedCase.success || parsedCase.data.id !== input.caseId) {
      throw new NhAuditReportServiceError("case_not_found");
    }
    const evaluationCase = parsedCase.data;
    if (
      !canCustomerAccessNhAuditReportCase(evaluationCase, input.actor) ||
      evaluationCase.confirmationVersion !== input.confirmationVersion
    ) {
      throw new NhAuditReportServiceError("access_denied");
    }
    const quoteSnapshot = await db
      .collection("quotes")
      .where("quoteRequestId", "==", evaluationCase.quoteRequestId)
      .limit(500)
      .get();
    const quotes = quoteSnapshot.docs
      .map((document) => ({
        ...(document.data() as QuoteRecord),
        id: document.id,
      }))
      .filter((quote) =>
        ["finalized", "delivered", "void"].includes(quote.status)
      );
    if (quotes.length === 0) {
      throw new NhAuditReportServiceError("quotes_not_found");
    }
    return { evaluationCase, quotes };
  }
}

export function nhAuditReportServiceErrorStatus(error: unknown) {
  if (!(error instanceof NhAuditReportServiceError)) return 500;
  if (error.code === "access_denied") return 403;
  if (error.code === "case_not_found") return 404;
  if (error.code === "quotes_not_found") return 409;
  if (error.code === "invalid_weights") return 400;
  return 500;
}

function ownerSubjectId(
  evaluationCase: Pick<AuditEvaluationCase, "customerAccessOwner">,
) {
  return evaluationCase.customerAccessOwner.type === "FIREBASE_UID"
    ? evaluationCase.customerAccessOwner.uid
    : evaluationCase.customerAccessOwner.subjectId;
}

export function canCustomerAccessNhAuditReportCase(
  evaluationCase: Pick<AuditEvaluationCase, "customerAccessOwner">,
  actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }>,
) {
  return ownerSubjectId(evaluationCase) === actor.subjectId;
}
