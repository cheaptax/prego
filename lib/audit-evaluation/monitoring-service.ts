import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { AUDIT_EVALUATION_COLLECTIONS } from "@/lib/audit-evaluation/collections";
import { adminDb } from "@/lib/firebase/admin";

const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1_000;
const MAX_RECORDS_PER_SOURCE = 10_000;

type MetricRecord = Record<string, unknown>;

export type AuditEvaluationOperationalMetrics = {
  window: { from: string; to: string };
  evaluationStartCount: number;
  upload: {
    attemptCount: number;
    successCount: number;
    successRateBasisPoints: number | null;
  };
  parsing: {
    terminalCount: number;
    successCount: number;
    successRateBasisPoints: number | null;
    customerReviewRequiredCount: number;
    customerReviewRequiredRateBasisPoints: number | null;
  };
  report: {
    terminalCount: number;
    successCount: number;
    successRateBasisPoints: number | null;
    averageGenerationMilliseconds: number | null;
    pdfFailureCount: number;
    pdfFailureRateBasisPoints: number | null;
  };
  authorizationDeniedCount: number;
  expiredCount: number;
  accessExpiredCount: number;
  retentionExpiredCount: number;
  truncated: boolean;
};

export class AuditEvaluationMonitoringError extends Error {
  readonly code: "invalid_window";

  constructor() {
    super("invalid_window");
    this.name = "AuditEvaluationMonitoringError";
    this.code = "invalid_window";
  }
}

export class AuditEvaluationMonitoringService {
  private readonly db: Firestore;

  constructor(db: Firestore = adminDb()) {
    this.db = db;
  }

  async read(input: { from: string; to: string }) {
    const window = parseWindow(input);
    const sources = await Promise.all([
      this.readRange(
        AUDIT_EVALUATION_COLLECTIONS.cases,
        "createdAt",
        window,
      ),
      this.readRange(
        AUDIT_EVALUATION_COLLECTIONS.uploadIntents,
        "createdAt",
        window,
      ),
      this.readRange(
        AUDIT_EVALUATION_COLLECTIONS.extractionRuns,
        "startedAt",
        window,
      ),
      this.readRange(
        AUDIT_EVALUATION_COLLECTIONS.reportRuns,
        "requestedAt",
        window,
      ),
      this.readRange(
        AUDIT_EVALUATION_COLLECTIONS.auditLogs,
        "occurredAt",
        window,
      ),
    ]);
    return buildAuditEvaluationOperationalMetrics({
      window,
      cases: sources[0].records,
      uploadIntents: sources[1].records,
      extractionRuns: sources[2].records,
      reportRuns: sources[3].records,
      auditLogs: sources[4].records,
      truncated: sources.some(({ truncated }) => truncated),
    });
  }

  private async readRange(
    collection: string,
    field: string,
    window: { from: string; to: string },
  ) {
    const snapshot = await this.db
      .collection(collection)
      .where(field, ">=", window.from)
      .where(field, "<", window.to)
      .limit(MAX_RECORDS_PER_SOURCE + 1)
      .get();
    return {
      records: snapshot.docs
        .slice(0, MAX_RECORDS_PER_SOURCE)
        .map(toMetricRecord),
      truncated: snapshot.size > MAX_RECORDS_PER_SOURCE,
    };
  }
}

export function buildAuditEvaluationOperationalMetrics(input: {
  window: { from: string; to: string };
  cases: MetricRecord[];
  uploadIntents: MetricRecord[];
  extractionRuns: MetricRecord[];
  reportRuns: MetricRecord[];
  auditLogs: MetricRecord[];
  truncated?: boolean;
}): AuditEvaluationOperationalMetrics {
  const successfulUploads = input.uploadIntents.filter(
    ({ status }) => status === "COMPLETED",
  ).length;
  const terminalExtractions = input.extractionRuns.filter(({ status }) =>
    ["COMPLETED", "NEEDS_REVIEW", "FAILED"].includes(String(status))
  );
  const successfulExtractions = terminalExtractions.filter(
    ({ status }) => status === "COMPLETED",
  ).length;
  const reviewRequired = terminalExtractions.filter(
    ({ status }) => status === "NEEDS_REVIEW",
  ).length;
  const reviewEligible = successfulExtractions + reviewRequired;
  const terminalReports = input.reportRuns.filter(({ status }) =>
    ["COMPLETED", "FAILED"].includes(String(status))
  );
  const successfulReports = terminalReports.filter(
    ({ status }) => status === "COMPLETED",
  );
  const generationDurations = successfulReports.flatMap((report) => {
    const startedAt = readInstant(report.generationStartedAt);
    const generatedAt = readInstant(report.generatedAt);
    return startedAt !== null && generatedAt !== null && generatedAt >= startedAt
      ? [generatedAt - startedAt]
      : [];
  });
  const generationAttempts = input.auditLogs.filter(({ action }) =>
    action === "REPORT_GENERATION_STARTED" ||
    action === "REPORT_GENERATION_RETRIED"
  ).length;
  const pdfFailures = input.auditLogs.filter(
    ({ action, errorCode, detail }) =>
      action === "REPORT_GENERATION_FAILED" &&
      (errorCode === "PDF_RENDER_FAILED" || detail === "PDF_RENDER_FAILED"),
  ).length;
  return {
    window: input.window,
    evaluationStartCount: input.cases.length,
    upload: {
      attemptCount: input.uploadIntents.length,
      successCount: successfulUploads,
      successRateBasisPoints: ratioBasisPoints(
        successfulUploads,
        input.uploadIntents.length,
      ),
    },
    parsing: {
      terminalCount: terminalExtractions.length,
      successCount: successfulExtractions,
      successRateBasisPoints: ratioBasisPoints(
        successfulExtractions,
        terminalExtractions.length,
      ),
      customerReviewRequiredCount: reviewRequired,
      customerReviewRequiredRateBasisPoints: ratioBasisPoints(
        reviewRequired,
        reviewEligible,
      ),
    },
    report: {
      terminalCount: terminalReports.length,
      successCount: successfulReports.length,
      successRateBasisPoints: ratioBasisPoints(
        successfulReports.length,
        terminalReports.length,
      ),
      averageGenerationMilliseconds:
        generationDurations.length > 0
          ? Math.round(
              generationDurations.reduce((sum, value) => sum + value, 0) /
                generationDurations.length,
            )
          : null,
      pdfFailureCount: pdfFailures,
      pdfFailureRateBasisPoints: ratioBasisPoints(
        pdfFailures,
        generationAttempts,
      ),
    },
    authorizationDeniedCount: input.auditLogs.filter(
      ({ action }) => action === "ACCESS_DENIED",
    ).length,
    accessExpiredCount: input.auditLogs.filter(({ action }) =>
      [
        "ACCESS_TOKEN_EXPIRED",
        "ACCESS_SESSION_EXPIRED",
        "CASE_ACCESS_EXPIRED",
      ].includes(String(action))
    ).length,
    retentionExpiredCount: input.auditLogs.filter(
      ({ action }) => action === "RETENTION_EXPIRED",
    ).length,
    expiredCount: input.auditLogs.filter(({ action }) =>
      [
        "ACCESS_TOKEN_EXPIRED",
        "ACCESS_SESSION_EXPIRED",
        "CASE_ACCESS_EXPIRED",
      ].includes(String(action))
    ).length,
    truncated: input.truncated === true,
  };
}

function parseWindow(input: { from: string; to: string }) {
  const from = Date.parse(input.from);
  const to = Date.parse(input.to);
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    to <= from ||
    to - from > MAX_WINDOW_MS
  ) {
    throw new AuditEvaluationMonitoringError();
  }
  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
  };
}

function ratioBasisPoints(numerator: number, denominator: number) {
  return denominator > 0
    ? Math.round((numerator * 10_000) / denominator)
    : null;
}

function readInstant(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toMetricRecord(snapshot: QueryDocumentSnapshot) {
  return snapshot.data() as MetricRecord;
}
