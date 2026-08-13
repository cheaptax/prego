import {
  getServerFeatureFlags,
  isAuditEvaluationCapabilityEnabled,
  type AuditEvaluationFeatureFlags,
} from "@/lib/audit-evaluation/feature-flags";
import {
  AuditEvaluationReportGenerationService,
} from "@/lib/audit-evaluation/report-generation-service";
import {
  FirestoreAuditEvaluationReportRepository,
  type AuditEvaluationReportRepository,
} from "@/lib/audit-evaluation/report-repository";
import {
  FirebaseAuditEvaluationReportStorage,
  type AuditEvaluationReportStorage,
} from "@/lib/audit-evaluation/report-storage";
import { nhAuditReportPreviewFromSnapshot } from "@/lib/audit-evaluation/nh-audit-report-snapshot";
import {
  rebuildNhAuditReportViewModel,
  safeReportDownloadFilename,
} from "@/lib/audit-evaluation/report-view-model";

export class ReportServiceError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ReportServiceError";
    this.code = code;
  }
}

export class AuditEvaluationReportService {
  private readonly repository: AuditEvaluationReportRepository;
  private readonly storage: AuditEvaluationReportStorage;
  private readonly generationService: AuditEvaluationReportGenerationService;
  private readonly flags: AuditEvaluationFeatureFlags;

  constructor(input: {
    repository?: AuditEvaluationReportRepository;
    storage?: AuditEvaluationReportStorage;
    generationService?: AuditEvaluationReportGenerationService;
    flags?: AuditEvaluationFeatureFlags;
  } = {}) {
    this.repository =
      input.repository ?? new FirestoreAuditEvaluationReportRepository();
    this.storage =
      input.storage ?? new FirebaseAuditEvaluationReportStorage();
    this.flags =
      input.flags ?? getServerFeatureFlags().auditEvaluation;
    this.generationService =
      input.generationService ??
      new AuditEvaluationReportGenerationService({
        repository: this.repository,
        storage: this.storage,
        flags: this.flags,
      });
  }

  async getLatestReport(
    caseId: string,
    reportVersion?: number,
    now: string = new Date().toISOString(),
  ) {
    this.assertEnabled();
    const latest = await this.repository.getLatestReport(caseId);
    if (!latest) throw new ReportServiceError("report_not_found");
    const reports = await this.repository.listReports(caseId);
    const report = reportVersion === undefined
      ? latest.report
      : reports.find((candidate) =>
        candidate.reportVersion === reportVersion
      ) ?? null;
    const versions = reports.map((candidate) => ({
      reportVersion: candidate.reportVersion,
      confirmationVersion: candidate.confirmationVersion,
      status: candidate.status,
      requestedAt: candidate.requestedAt ?? null,
      generatedAt: candidate.generatedAt,
    }));
    if (!report) {
      if (reportVersion !== undefined) {
        throw new ReportServiceError("report_not_found");
      }
      return {
        reportVersion: null,
        confirmationVersion:
          latest.evaluationCase.confirmationVersion ?? null,
        status: "NOT_REQUESTED" as const,
        requestedAt: null,
        generatedAt: null,
        failureCode: null,
        downloadAvailable: false,
        downloadExpiresAt: null,
        viewModel: null,
        nhAuditEvaluation: null,
        versions,
      };
    }
    const storedViewModel = report.status === "COMPLETED"
      ? await this.generationService.loadViewModel(report)
      : null;
    let viewModel = storedViewModel;
    if (report.status === "COMPLETED" && report.nhAuditEvaluationSnapshot) {
      try {
        viewModel = rebuildNhAuditReportViewModel({
          reportRun: report,
          evaluationCase: latest.evaluationCase,
          storedViewModel,
        });
      } catch {
        viewModel = storedViewModel;
      }
    }
    if (report.status === "COMPLETED" && !viewModel) {
      throw new ReportServiceError("report_payload_unavailable");
    }
    const downloadWindow = reportDownloadWindow(report);
    return {
      reportVersion: report.reportVersion,
      confirmationVersion: report.confirmationVersion,
      status: report.status,
      requestedAt: report.requestedAt ?? null,
      generatedAt: report.generatedAt,
      failureCode: report.failureCode,
      downloadAvailable:
        report.status === "COMPLETED" &&
        Boolean(report.pdfStoragePath) &&
        downloadWindow !== null &&
        Date.parse(now) < Date.parse(downloadWindow.expiresAt),
      downloadExpiresAt: downloadWindow?.expiresAt ?? null,
      viewModel,
      nhAuditEvaluation: report.nhAuditEvaluationSnapshot
        ? nhAuditReportPreviewFromSnapshot(
            report.nhAuditEvaluationSnapshot,
          )
        : null,
      versions,
    };
  }

  async createDownload(input: {
    caseId: string;
    reportVersion: number;
    actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }>;
    now: string;
  }) {
    const access = await this.resolveCustomerPdfAccess(input);
    const lifetimeSeconds = Math.min(
      300,
      Math.max(
        30,
        access.report.evaluationConfigSnapshot.reportRenderingPolicy
          ?.downloadUrlLifetimeSeconds ?? 60,
      ),
    );
    const expiresAt = new Date(
      Date.parse(input.now) + lifetimeSeconds * 1_000,
    ).toISOString();
    const url = await this.storage.createDownloadUrl({
      storagePath: access.storagePath,
      expiresAt,
      fileName: access.fileName,
    });
    await this.repository.recordDownload({
      caseId: input.caseId,
      reportVersion: input.reportVersion,
      actor: input.actor,
      downloadedAt: input.now,
    });
    return { url, expiresAt, fileName: access.fileName };
  }

  /** Same PDF bytes as download — for inline browser print (identical layout). */
  async readCustomerPdf(input: {
    caseId: string;
    reportVersion: number;
    actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }>;
    now: string;
  }) {
    const access = await this.resolveCustomerPdfAccess(input);
    const bytes = await this.storage.read(
      access.storagePath,
      20 * 1024 * 1024,
    );
    if (!bytes || bytes.byteLength === 0) {
      throw new ReportServiceError("report_payload_unavailable");
    }
    await this.repository.recordDownload({
      caseId: input.caseId,
      reportVersion: input.reportVersion,
      actor: input.actor,
      downloadedAt: input.now,
    });
    return { bytes, fileName: access.fileName };
  }

  private async resolveCustomerPdfAccess(input: {
    caseId: string;
    reportVersion: number;
    actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }>;
    now: string;
  }) {
    this.assertEnabled();
    const latest = await this.repository.getLatestReport(input.caseId);
    if (!latest) throw new ReportServiceError("report_not_found");
    const report = await this.repository.getReport(
      input.caseId,
      input.reportVersion,
    );
    if (
      !report ||
      report.caseId !== latest.evaluationCase.id ||
      report.reportVersion !== input.reportVersion
    ) {
      throw new ReportServiceError("report_not_found");
    }
    if (report.status !== "COMPLETED" || !report.pdfStoragePath) {
      throw new ReportServiceError("report_not_ready");
    }
    const downloadWindow = reportDownloadWindow(report);
    if (!downloadWindow) {
      throw new ReportServiceError("report_not_ready");
    }
    const nowMilliseconds = Date.parse(input.now);
    if (
      !Number.isFinite(nowMilliseconds) ||
      nowMilliseconds >= Date.parse(downloadWindow.expiresAt)
    ) {
      throw new ReportServiceError("report_download_expired");
    }
    const fileName = safeReportDownloadFilename(
      latest.evaluationCase.fiscalYear,
      report.reportVersion,
      report.evaluationConfigSnapshot.reportRenderingPolicy?.fileNameRule,
      report.caseId,
      latest.evaluationCase.cooperativeNameSnapshot,
    );
    return {
      report,
      fileName,
      storagePath: report.pdfStoragePath,
    };
  }

  private assertEnabled() {
    if (
      !isAuditEvaluationCapabilityEnabled(
        "reportDownloadEnabled",
        this.flags,
      )
    ) {
      throw new ReportServiceError("report_feature_disabled");
    }
  }
}

export function reportServiceErrorStatus(error: unknown) {
  if (!(error instanceof ReportServiceError)) return 500;
  if (error.code === "report_not_found") return 404;
  if (error.code === "report_not_ready") return 409;
  if (error.code === "report_download_expired") return 410;
  if (error.code === "report_feature_disabled") return 404;
  if (error.code === "report_payload_unavailable") return 503;
  return 500;
}

function reportDownloadWindow(report: {
  generatedAt: string | null;
  evaluationConfigSnapshot: {
    reportRenderingPolicy?: { customerDownloadDays?: number };
  };
}) {
  if (!report.generatedAt) return null;
  const generatedAt = Date.parse(report.generatedAt);
  if (!Number.isFinite(generatedAt)) return null;
  const configuredDays =
    report.evaluationConfigSnapshot.reportRenderingPolicy
      ?.customerDownloadDays;
  const days = Number.isInteger(configuredDays) &&
      configuredDays !== undefined &&
      configuredDays >= 1 &&
      configuredDays <= 365
    ? configuredDays
    : 30;
  return {
    expiresAt: new Date(
      generatedAt + days * 24 * 60 * 60 * 1_000,
    ).toISOString(),
  };
}
