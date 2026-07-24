import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { AUDIT_EVALUATION_COLLECTIONS } from "@/lib/audit-evaluation/collections";
import {
  auditEvaluationCaseRecordSchema,
  auditQuoteCorrectionRecordSchema,
  createAuditEvaluationReportRunId,
  evaluationReportRunRecordSchema,
} from "@/lib/audit-evaluation/review-repository";
import { canTransitionAuditEvaluationStatus } from "@/lib/audit-evaluation/status";
import type {
  AuditEvaluationActor,
  AuditEvaluationCase,
  AuditQuoteCorrectionRecord,
  EvaluationReportRun,
  NarrativeData,
  RenderingReference,
} from "@/lib/audit-evaluation/types";
import { adminDb } from "@/lib/firebase/admin";

const GENERATION_LEASE_MILLISECONDS = 5 * 60 * 1_000;

export class ReportRepositoryError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ReportRepositoryError";
    this.code = code;
  }
}

export type ReportGenerationClaim = {
  claimed: boolean;
  report: EvaluationReportRun;
  evaluationCase: AuditEvaluationCase;
  attempt: number;
};

export type RecoverableReportGeneration = {
  caseId: string;
  reportVersion: number;
  status: EvaluationReportRun["status"];
};

export interface AuditEvaluationReportRepository {
  getReport(
    caseId: string,
    reportVersion: number,
  ): Promise<EvaluationReportRun | null>;
  listReports(caseId: string): Promise<EvaluationReportRun[]>;
  listRecoverableGenerations(input: {
    now: string;
    staleAfterMilliseconds: number;
    limit: number;
  }): Promise<RecoverableReportGeneration[]>;
  getLatestReport(caseId: string): Promise<{
    evaluationCase: AuditEvaluationCase;
    report: EvaluationReportRun | null;
  } | null>;
  listCorrections(caseId: string): Promise<AuditQuoteCorrectionRecord[]>;
  claimGeneration(input: {
    caseId: string;
    reportVersion: number;
    now: string;
  }): Promise<ReportGenerationClaim>;
  completeGeneration(input: {
    caseId: string;
    reportVersion: number;
    attempt: number;
    generatedAt: string;
    renderingReference: RenderingReference;
    pdfStoragePath: string;
    narrativeData: NarrativeData;
  }): Promise<EvaluationReportRun>;
  failGeneration(input: {
    caseId: string;
    reportVersion: number;
    attempt: number;
    failedAt: string;
    failureCode: string;
  }): Promise<void>;
  recordDownload(input: {
    caseId: string;
    reportVersion: number;
    actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }>;
    downloadedAt: string;
  }): Promise<void>;
}

export class FirestoreAuditEvaluationReportRepository
  implements AuditEvaluationReportRepository
{
  private readonly db: Firestore;

  constructor(db: Firestore = adminDb()) {
    this.db = db;
  }

  async getReport(caseId: string, reportVersion: number) {
    const snapshot = await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.reportRuns)
      .doc(createAuditEvaluationReportRunId(caseId, reportVersion))
      .get();
    if (!snapshot.exists) return null;
    const report = parseReport(snapshot.data());
    return report.caseId === caseId && report.reportVersion === reportVersion
      ? report
      : null;
  }

  async listReports(caseId: string) {
    const snapshot = await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.reportRuns)
      .where("caseId", "==", caseId)
      .get();
    return snapshot.docs
      .map((document) => parseReport(document.data()))
      .filter((report) => report.caseId === caseId)
      .sort((left, right) => right.reportVersion - left.reportVersion);
  }

  async listRecoverableGenerations(input: {
    now: string;
    staleAfterMilliseconds: number;
    limit: number;
  }): Promise<RecoverableReportGeneration[]> {
    const nowMs = Date.parse(input.now);
    if (!Number.isFinite(nowMs)) return [];
    const snapshot = await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.reportRuns)
      .limit(Math.max(1, Math.min(input.limit * 4, 500)))
      .get();
    return snapshot.docs
      .flatMap((document) => {
        const parsed = evaluationReportRunRecordSchema.safeParse(
          document.data(),
        );
        return parsed.success ? [parsed.data] : [];
      })
      .filter((report) => {
        if (report.status === "PENDING") {
          const requestedAt = report.requestedAt
            ? Date.parse(report.requestedAt)
            : NaN;
          return Number.isFinite(requestedAt) &&
            requestedAt <= nowMs - input.staleAfterMilliseconds;
        }
        if (report.status === "GENERATING") {
          const leaseExpiresAt = report.generationLeaseExpiresAt
            ? Date.parse(report.generationLeaseExpiresAt)
            : NaN;
          return !Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= nowMs;
        }
        return false;
      })
      .sort((left, right) =>
        compareText(left.requestedAt ?? "", right.requestedAt ?? "") ||
        left.reportVersion - right.reportVersion
      )
      .slice(0, input.limit)
      .map((report) => ({
        caseId: report.caseId,
        reportVersion: report.reportVersion,
        status: report.status,
      }));
  }

  async getLatestReport(caseId: string) {
    const caseSnapshot = await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.cases)
      .doc(caseId)
      .get();
    if (!caseSnapshot.exists) return null;
    const evaluationCase = parseCase(caseSnapshot.data());
    if (evaluationCase.id !== caseId) {
      throw new ReportRepositoryError("case_mismatch");
    }
    const report = evaluationCase.latestReportVersion
      ? await this.getReport(caseId, evaluationCase.latestReportVersion)
      : null;
    return { evaluationCase, report };
  }

  async listCorrections(caseId: string) {
    const snapshot = await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.corrections)
      .where("caseId", "==", caseId)
      .get();
    return snapshot.docs
      .map((document) => auditQuoteCorrectionRecordSchema.parse(document.data()))
      .sort((left, right) =>
        compareText(left.correctedAt, right.correctedAt) ||
        compareText(left.id, right.id)
      );
  }

  async claimGeneration(input: {
    caseId: string;
    reportVersion: number;
    now: string;
  }): Promise<ReportGenerationClaim> {
    return this.db.runTransaction(async (transaction) => {
      const caseRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.cases)
        .doc(input.caseId);
      const reportRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.reportRuns)
        .doc(createAuditEvaluationReportRunId(
          input.caseId,
          input.reportVersion,
        ));
      const [caseSnapshot, reportSnapshot] = await Promise.all([
        transaction.get(caseRef),
        transaction.get(reportRef),
      ]);
      if (!caseSnapshot.exists || !reportSnapshot.exists) {
        throw new ReportRepositoryError("report_not_found");
      }
      const evaluationCase = parseCase(caseSnapshot.data());
      const report = parseReport(reportSnapshot.data());
      assertReportOwnership(report, input.caseId, input.reportVersion);
      if (report.status === "COMPLETED") {
        return {
          claimed: false,
          report,
          evaluationCase,
          attempt: report.generationAttempt ?? 0,
        };
      }
      const leaseActive =
        report.status === "GENERATING" &&
        report.generationLeaseExpiresAt !== null &&
        report.generationLeaseExpiresAt !== undefined &&
        Date.parse(report.generationLeaseExpiresAt) > Date.parse(input.now);
      if (leaseActive) {
        return {
          claimed: false,
          report,
          evaluationCase,
          attempt: report.generationAttempt ?? 0,
        };
      }
      const attempt = (report.generationAttempt ?? 0) + 1;
      const claimed = evaluationReportRunRecordSchema.parse({
        ...report,
        status: "GENERATING",
        generationAttempt: attempt,
        generationStartedAt: input.now,
        generationLeaseExpiresAt: new Date(
          Date.parse(input.now) + GENERATION_LEASE_MILLISECONDS,
        ).toISOString(),
        failureCode: null,
        failureMessage: null,
      });
      transaction.set(reportRef, claimed, { merge: false });
      if (
        evaluationCase.latestReportVersion === input.reportVersion &&
        evaluationCase.status !== "GENERATING"
      ) {
        if (
          !canTransitionAuditEvaluationStatus(
            evaluationCase.status,
            "GENERATING",
          )
        ) {
          throw new ReportRepositoryError("invalid_case_status");
        }
        transaction.update(caseRef, {
          status: "GENERATING",
          updatedAt: input.now,
          completedAt: null,
        });
      }
      const startedLog = auditLog({
        caseId: input.caseId,
        reportVersion: input.reportVersion,
        action: attempt === 1
          ? "REPORT_GENERATION_STARTED"
          : "REPORT_GENERATION_RETRIED",
        actor: { type: "SYSTEM", service: "audit-report-generator" },
        occurredAt: input.now,
        detail: `attempt:${attempt}`,
      });
      transaction.create(this.auditLogRef(startedLog.id), startedLog);
      return {
        claimed: true,
        report: claimed,
        evaluationCase: {
          ...evaluationCase,
          status:
            evaluationCase.latestReportVersion === input.reportVersion
              ? "GENERATING"
              : evaluationCase.status,
        },
        attempt,
      };
    });
  }

  async completeGeneration(input: {
    caseId: string;
    reportVersion: number;
    attempt: number;
    generatedAt: string;
    renderingReference: RenderingReference;
    pdfStoragePath: string;
    narrativeData: NarrativeData;
  }) {
    return this.db.runTransaction(async (transaction) => {
      const caseRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.cases)
        .doc(input.caseId);
      const reportRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.reportRuns)
        .doc(createAuditEvaluationReportRunId(
          input.caseId,
          input.reportVersion,
        ));
      const [caseSnapshot, reportSnapshot] = await Promise.all([
        transaction.get(caseRef),
        transaction.get(reportRef),
      ]);
      if (!caseSnapshot.exists || !reportSnapshot.exists) {
        throw new ReportRepositoryError("report_not_found");
      }
      const evaluationCase = parseCase(caseSnapshot.data());
      const report = parseReport(reportSnapshot.data());
      assertActiveAttempt(report, input);
      const completed = evaluationReportRunRecordSchema.parse({
        ...report,
        status: "COMPLETED",
        generationLeaseExpiresAt: null,
        narrativeData: input.narrativeData,
        renderingReference: input.renderingReference,
        pdfStoragePath: input.pdfStoragePath,
        generatedAt: input.generatedAt,
        failureCode: null,
        failureMessage: null,
      });
      transaction.set(reportRef, completed, { merge: false });
      if (evaluationCase.latestReportVersion === input.reportVersion) {
        if (
          !canTransitionAuditEvaluationStatus(
            evaluationCase.status,
            "COMPLETED",
          )
        ) {
          throw new ReportRepositoryError("invalid_case_status");
        }
        transaction.update(caseRef, {
          status: "COMPLETED",
          reportRegenerationRequired: false,
          expiresAt: laterInstant(
            evaluationCase.expiresAt,
            reportDownloadExpiresAt(input.generatedAt, completed),
          ),
          updatedAt: input.generatedAt,
          completedAt: input.generatedAt,
        });
      }
      const completedLog = auditLog({
        caseId: input.caseId,
        reportVersion: input.reportVersion,
        action: "REPORT_GENERATED",
        actor: { type: "SYSTEM", service: "audit-report-generator" },
        occurredAt: input.generatedAt,
        detail: `attempt:${input.attempt}`,
      });
      transaction.create(this.auditLogRef(completedLog.id), completedLog);
      return completed;
    });
  }

  async failGeneration(input: {
    caseId: string;
    reportVersion: number;
    attempt: number;
    failedAt: string;
    failureCode: string;
  }) {
    await this.db.runTransaction(async (transaction) => {
      const caseRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.cases)
        .doc(input.caseId);
      const reportRef = this.db
        .collection(AUDIT_EVALUATION_COLLECTIONS.reportRuns)
        .doc(createAuditEvaluationReportRunId(
          input.caseId,
          input.reportVersion,
        ));
      const [caseSnapshot, reportSnapshot] = await Promise.all([
        transaction.get(caseRef),
        transaction.get(reportRef),
      ]);
      if (!caseSnapshot.exists || !reportSnapshot.exists) return;
      const evaluationCase = parseCase(caseSnapshot.data());
      const report = parseReport(reportSnapshot.data());
      if (
        report.status !== "GENERATING" ||
        report.generationAttempt !== input.attempt
      ) {
        return;
      }
      transaction.update(reportRef, {
        status: "FAILED",
        generationLeaseExpiresAt: null,
        failureCode: safeFailureCode(input.failureCode),
        failureMessage: null,
      });
      if (
        evaluationCase.latestReportVersion === input.reportVersion &&
        evaluationCase.status === "GENERATING"
      ) {
        transaction.update(caseRef, {
          status: "FAILED",
          updatedAt: input.failedAt,
          completedAt: null,
        });
      }
      const failedLog = auditLog({
        caseId: input.caseId,
        reportVersion: input.reportVersion,
        action: "REPORT_GENERATION_FAILED",
        actor: { type: "SYSTEM", service: "audit-report-generator" },
        occurredAt: input.failedAt,
        detail: safeFailureCode(input.failureCode),
      });
      transaction.create(this.auditLogRef(failedLog.id), failedLog);
    });
  }

  async recordDownload(input: {
    caseId: string;
    reportVersion: number;
    actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }>;
    downloadedAt: string;
  }) {
    const downloadLog = auditLog({
      caseId: input.caseId,
      reportVersion: input.reportVersion,
      action: "REPORT_DOWNLOADED",
      actor: input.actor,
      occurredAt: input.downloadedAt,
      detail: "signed-url-issued",
    });
    await this.auditLogRef(downloadLog.id).create(downloadLog);
  }

  private auditLogRef(id: string) {
    return this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.auditLogs)
      .doc(id);
  }
}

function parseCase(value: unknown) {
  try {
    return auditEvaluationCaseRecordSchema.parse(value);
  } catch {
    throw new ReportRepositoryError("case_data_integrity_error");
  }
}

function parseReport(value: unknown) {
  try {
    return evaluationReportRunRecordSchema.parse(value);
  } catch {
    throw new ReportRepositoryError("report_data_integrity_error");
  }
}

function assertReportOwnership(
  report: EvaluationReportRun,
  caseId: string,
  reportVersion: number,
) {
  if (report.caseId !== caseId || report.reportVersion !== reportVersion) {
    throw new ReportRepositoryError("report_case_mismatch");
  }
}

function assertActiveAttempt(
  report: EvaluationReportRun,
  input: { caseId: string; reportVersion: number; attempt: number },
) {
  assertReportOwnership(report, input.caseId, input.reportVersion);
  if (
    report.status !== "GENERATING" ||
    report.generationAttempt !== input.attempt
  ) {
    throw new ReportRepositoryError("stale_generation_attempt");
  }
}

function auditLog(input: {
  caseId: string;
  reportVersion: number;
  action: string;
  actor: AuditEvaluationActor;
  occurredAt: string;
  detail: string;
}) {
  return {
    id: `ael_${randomUUID()}`,
    caseId: input.caseId,
    reportVersion: input.reportVersion,
    action: input.action,
    actor: input.actor,
    occurredAt: input.occurredAt,
    detail: input.detail,
  };
}

function safeFailureCode(value: string) {
  return /^[A-Z][A-Z0-9_]{0,99}$/.test(value)
    ? value
    : "REPORT_GENERATION_FAILED";
}

function compareText(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function reportDownloadExpiresAt(
  generatedAt: string,
  report: EvaluationReportRun,
) {
  const days =
    report.evaluationConfigSnapshot.reportRenderingPolicy
      ?.customerDownloadDays ?? 30;
  return new Date(Date.parse(generatedAt) + days * 86_400_000).toISOString();
}

function laterInstant(left: string, right: string) {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}
