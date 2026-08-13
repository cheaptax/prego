import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { extractPdfText } from "@/lib/audit-evaluation/pdf-text-extractor";
import {
  applyOptionalReportNarrative,
  type ReportNarrativeAdapter,
} from "@/lib/audit-evaluation/report-narrative";
import { AuditEvaluationReportGenerationService } from "@/lib/audit-evaluation/report-generation-service";
import { renderAuditEvaluationReportPdf } from "@/lib/audit-evaluation/report-pdf";
import type {
  AuditEvaluationReportRepository,
  ReportGenerationClaim,
} from "@/lib/audit-evaluation/report-repository";
import {
  AuditEvaluationReportService,
  ReportServiceError,
  reportServiceErrorStatus,
} from "@/lib/audit-evaluation/report-service";
import type {
  AuditEvaluationReportStorage,
} from "@/lib/audit-evaluation/report-storage";
import {
  buildDeterministicReportViewModel,
  REPORT_SECTION_IDS,
  safeReportDownloadFilename,
  scanForbiddenReportPhrases,
} from "@/lib/audit-evaluation/report-view-model";
import type {
  AuditEvaluationActor,
  AuditQuoteCorrectionRecord,
  EvaluationReportRun,
} from "@/lib/audit-evaluation/types";
import {
  createReportFixture,
  REPORT_FIXTURE_NOW,
} from "@/lib/audit-evaluation/testing/report-fixtures";

const ENABLED_FLAGS = {
  enabled: true,
  customerEntryEnabled: true,
  reportDownloadEnabled: true,
  adminEnabled: false,
  aiNarrativeEnabled: false,
} as const;

describe("audit evaluation report view model", () => {
  it("builds ten deterministic sections from confirmed snapshots only", () => {
    const fixture = createReportFixture({ quoteCount: 5 });
    const first = buildDeterministicReportViewModel({
      reportRun: fixture.reportRun,
      evaluationCase: fixture.evaluationCase,
      corrections: [],
      generatedAt: REPORT_FIXTURE_NOW,
    });
    const reorderedRun = {
      ...fixture.reportRun,
      quoteDataSnapshots: [...fixture.reportRun.quoteDataSnapshots].reverse(),
      scoreResult: {
        ...fixture.reportRun.scoreResult!,
        quotes: [...fixture.reportRun.scoreResult!.quotes].reverse(),
      },
      feeAnalysis: {
        ...fixture.reportRun.feeAnalysis!,
        quotes: [...fixture.reportRun.feeAnalysis!.quotes].reverse(),
      },
    };
    const second = buildDeterministicReportViewModel({
      reportRun: reorderedRun,
      evaluationCase: fixture.evaluationCase,
      corrections: [],
      generatedAt: REPORT_FIXTURE_NOW,
    });

    assert.deepEqual(first, second);
    assert.deepEqual(
      new Set(first.sections.map(({ id }) => id)),
      new Set(REPORT_SECTION_IDS),
    );
    assert.equal(first.sections.length, 10);
    assert.equal(scanForbiddenReportPhrases(first.facts.map(({ text }) => text)).length, 0);
    assert.match(
      JSON.stringify(first.sections),
      /감사보수가 가장 낮다는 이유만으로 특정 회계법인을 추천하지 않습니다/,
    );
    assert.match(
      JSON.stringify(first.sections),
      /농협이 선임 안건을 검토하고 설명할 수 있게 돕습니다/,
    );
  });

  it("includes only correction history that belongs to the snapshot revision", () => {
    const fixture = createReportFixture();
    const quote = fixture.reportRun.quoteDataSnapshots[0];
    const included = correction({
      id: "correction-included",
      quoteId: quote.quoteId,
      quoteRevision: quote.revision ?? 1,
      correctedAt: "2026-07-21T01:00:00.000Z",
    });
    const later = correction({
      id: "correction-later",
      quoteId: quote.quoteId,
      quoteRevision: (quote.revision ?? 1) + 1,
      correctedAt: "2026-07-21T02:00:00.000Z",
    });
    const viewModel = buildDeterministicReportViewModel({
      reportRun: fixture.reportRun,
      evaluationCase: fixture.evaluationCase,
      corrections: [later, included],
      generatedAt: REPORT_FIXTURE_NOW,
    });
    const appendix = viewModel.sections.find(({ id }) => id === "appendix");
    const corrections = appendix?.blocks.find(
      ({ id }) => id === "appendix-corrections",
    );
    assert.equal(corrections?.type, "TABLE");
    assert.equal(corrections?.type === "TABLE" ? corrections.rows.length : 0, 1);
    assert.match(JSON.stringify(corrections), /correction-included|고객 확인 후 정정/);
    assert.doesNotMatch(JSON.stringify(corrections), /correction-later/);
  });

  it("applies safe branding, filename presets, and optional section visibility", () => {
    const fixture = createReportFixture();
    const configuredRun: EvaluationReportRun = {
      ...fixture.reportRun,
      evaluationConfigSnapshot: {
        ...fixture.reportRun.evaluationConfigSnapshot,
        reportRenderingPolicy: {
          ...fixture.reportRun.evaluationConfigSnapshot.reportRenderingPolicy!,
          reportTitle: "2027 감사인 검토자료",
          centerContact: "문의 02-0000-0000",
          primaryColor: "#123456",
          accentColor: "#ABCDEF",
          fileNameRule: "CASE_VERSION",
        },
        reportSections:
          fixture.reportRun.evaluationConfigSnapshot.reportSections.map(
            (section) => {
              if (section.type === "FEE_ANALYSIS") {
                return { ...section, enabled: false };
              }
              if (section.type === "COVER") {
                return { ...section, enabled: false, order: 0 };
              }
              if (section.type === "QUOTE_COMPARISON") {
                return { ...section, order: 1 };
              }
              if (section.type === "PURPOSE_SCOPE") {
                return { ...section, order: 2 };
              }
              return section;
            },
          ),
      },
    };
    const viewModel = buildDeterministicReportViewModel({
      reportRun: configuredRun,
      evaluationCase: fixture.evaluationCase,
      corrections: [],
      generatedAt: REPORT_FIXTURE_NOW,
      resolvedLogoDataUri: "data:image/svg+xml;base64,PHN2Zy8+",
    });

    assert.equal(viewModel.metadata.reportTitle, "2027 감사인 검토자료");
    assert.equal(viewModel.metadata.centerContact, "문의 02-0000-0000");
    assert.equal(viewModel.metadata.branding.primaryColor, "#123456");
    assert.equal(viewModel.metadata.branding.accentColor, "#ABCDEF");
    assert.equal(viewModel.metadata.branding.logoDataUri, null);
    assert.equal(
      viewModel.metadata.downloadFilename,
      "테스트농협_FY2027 감사인견적평가보고서.pdf",
    );
    assert.ok(viewModel.sections.some(({ id }) => id === "cover"));
    assert.ok(!viewModel.sections.some(({ id }) => id === "fee-analysis"));
    assert.ok(
      viewModel.sections.findIndex(({ id }) => id === "quote-comparison") <
        viewModel.sections.findIndex(({ id }) => id === "purpose-scope"),
    );
    assert.equal(
      safeReportDownloadFilename(2027, 3),
      "audit-evaluation-report-FY2027-v3.pdf",
    );
    assert.equal(
      safeReportDownloadFilename(
        2027,
        3,
        "CASE_VERSION",
        "case-server-01",
      ),
      "audit-evaluation-report-case-case-server-01-v3.pdf",
    );
    assert.throws(() =>
      safeReportDownloadFilename(
        2027,
        3,
        "CASE_VERSION",
        "고객 입력 농협명",
      )
    );

    const legacyPolicy =
      fixture.reportRun.evaluationConfigSnapshot.reportRenderingPolicy!;
    const fallbackViewModel = buildDeterministicReportViewModel({
      reportRun: {
        ...fixture.reportRun,
        evaluationConfigSnapshot: {
          ...fixture.reportRun.evaluationConfigSnapshot,
          reportRenderingPolicy: {
            watermarkEnabled: legacyPolicy.watermarkEnabled,
            watermarkText: legacyPolicy.watermarkText,
            downloadUrlLifetimeSeconds:
              legacyPolicy.downloadUrlLifetimeSeconds,
          },
        },
      },
      evaluationCase: fixture.evaluationCase,
      corrections: [],
      generatedAt: REPORT_FIXTURE_NOW,
      resolvedLogoDataUri: null,
    });
    assert.equal(
      fallbackViewModel.metadata.reportTitle,
      "감사인 견적 평가보고서",
    );
    assert.equal(
      fallbackViewModel.metadata.branding.primaryColor,
      "#1B5E3B",
    );
  });
});

describe("optional report narrative", () => {
  it("accepts only schema-valid cited facts without new numeric claims", async () => {
    const viewModel = fixtureViewModel();
    const fact = viewModel.facts.find(({ text }) => /[0-9]/.test(text));
    assert.ok(fact);
    const adapter: ReportNarrativeAdapter = {
      async generate() {
        return {
          schemaVersion: 1,
          paragraphs: [{
            sectionId: fact.sectionId,
            text: fact.text,
            factIds: [fact.id],
          }],
        };
      },
    };
    const result = await applyOptionalReportNarrative({
      viewModel,
      enabled: true,
      adapter,
    });
    assert.equal(result.narrativeData.mode, "AI_ASSISTED");
    assert.equal(result.narrativeData.aiStatus, "COMPLETED");
    assert.equal(result.viewModel.narrative.paragraphs.length, 1);
  });

  it("falls back to complete templates on invalid facts, phrases, or failures", async () => {
    const viewModel = fixtureViewModel();
    const fact = viewModel.facts[0];
    const adapters: ReportNarrativeAdapter[] = [
      {
        async generate() {
          return {
            schemaVersion: 1,
            paragraphs: [{
              sectionId: fact.sectionId,
              text: "확인되지 않은 999개 사실",
              factIds: [fact.id],
            }],
          };
        },
      },
      {
        async generate() {
          return {
            schemaVersion: 1,
            paragraphs: [{
              sectionId: fact.sectionId,
              text: "이 회계법인은 부적격입니다.",
              factIds: [fact.id],
            }],
          };
        },
      },
      {
        async generate() {
          throw new Error("provider_failed");
        },
      },
    ];
    for (const adapter of adapters) {
      const result = await applyOptionalReportNarrative({
        viewModel,
        enabled: true,
        adapter,
      });
      assert.equal(result.narrativeData.mode, "RULE_BASED");
      assert.equal(result.narrativeData.aiStatus, "FAILED");
      assert.deepEqual(result.viewModel, viewModel);
    }
  });
});

describe("audit evaluation report PDF", () => {
  it("embeds Korean brand metadata and a PNG logo in an actual A4 PDF", async () => {
    const fixture = createReportFixture();
    const viewModel = buildDeterministicReportViewModel({
      reportRun: {
        ...fixture.reportRun,
        evaluationConfigSnapshot: {
          ...fixture.reportRun.evaluationConfigSnapshot,
          reportRenderingPolicy: {
            ...fixture.reportRun.evaluationConfigSnapshot.reportRenderingPolicy!,
            reportTitle: "맞춤 감사인 검토보고서",
            centerContact: "브랜드 문의센터",
            primaryColor: "#234567",
            accentColor: "#B78912",
          },
        },
      },
      evaluationCase: fixture.evaluationCase,
      corrections: [],
      generatedAt: REPORT_FIXTURE_NOW,
      resolvedLogoDataUri:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    });
    const pdf = await renderAuditEvaluationReportPdf(viewModel);
    assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), "%PDF-");
    assert.ok(pdf.byteLength > 20_000);
    const extracted = await extractPdfText(pdf, {
      maximumPages: 100,
      maximumTotalText: 2_000_000,
    });
    const text = extracted.pages.map((page) => page.text).join("\n");
    assert.match(text, /맞춤 감사인 검토보고서/);
    assert.match(text, /테스트농협/);
    assert.match(text, /브랜드 문의센터/);
  });
});

describe("report delivery security", () => {
  it("retries a failed generation and skips completed duplicate requests", async () => {
    const fixture = createReportFixture();
    const repository = new InMemoryGenerationRepository(
      fixture.evaluationCase,
      {
        ...fixture.reportRun,
        evaluationConfigSnapshot: {
          ...fixture.reportRun.evaluationConfigSnapshot,
          reportRenderingPolicy: {
            ...fixture.reportRun.evaluationConfigSnapshot.reportRenderingPolicy!,
            logoAssetId: "missing-report-logo",
          },
        },
        status: "PENDING",
        generationAttempt: 0,
        generationStartedAt: null,
        generationLeaseExpiresAt: null,
      },
    );
    const storage = new InMemoryReportStorage();
    storage.failNextSave = true;
    const service = new AuditEvaluationReportGenerationService({
      repository,
      storage,
      flags: ENABLED_FLAGS,
      logoResolver: async () => {
        throw new Error("missing_logo");
      },
    });

    const failed = await service.generate({
      caseId: fixture.evaluationCase.id,
      reportVersion: 1,
      now: REPORT_FIXTURE_NOW,
    });
    assert.equal(failed.status, "FAILED");
    assert.equal(repository.report.status, "FAILED");
    assert.equal(repository.report.generationAttempt, 1);

    const completed = await service.generate({
      caseId: fixture.evaluationCase.id,
      reportVersion: 1,
      now: "2026-07-21T01:25:00.000Z",
    });
    assert.equal(completed.status, "COMPLETED");
    assert.equal(repository.report.status, "COMPLETED");
    assert.equal(repository.report.generationAttempt, 2);
    assert.equal(storage.saved.size, 2);
    const saveCount = storage.saveCalls;

    const replay = await service.generate({
      caseId: fixture.evaluationCase.id,
      reportVersion: 1,
      now: "2026-07-21T01:26:00.000Z",
    });
    assert.equal(replay.status, "COMPLETED");
    assert.equal(storage.saveCalls, saveCount);
    const payload = storage.saved.get(
      "audit-evaluation/reports/case-report-fixture/v1/attempt-2/view-model.json",
    );
    assert.ok(payload);
    assert.equal(
      JSON.parse(new TextDecoder().decode(payload))
        .metadata.branding.logoDataUri,
      null,
    );
  });

  it("enforces the customer download window at the exact boundary", async () => {
    const fixture = createReportFixture();
    const completed = completedReport(fixture.reportRun);
    const policy =
      completed.evaluationConfigSnapshot.reportRenderingPolicy!;
    const historicalPolicy = { ...policy };
    delete historicalPolicy.customerDownloadDays;
    const historicalReport: EvaluationReportRun = {
      ...completed,
      evaluationConfigSnapshot: {
        ...completed.evaluationConfigSnapshot,
        reportRenderingPolicy: historicalPolicy,
      },
    };
    const repository = new FakeReportRepository(
      fixture.evaluationCase,
      historicalReport,
    );
    const storage = new FakeReportStorage();
    const service = new AuditEvaluationReportService({
      repository,
      storage,
      generationService: {
        loadViewModel: async () => fixtureViewModel(),
      } as never,
      flags: ENABLED_FLAGS,
    });
    const expiresAt = new Date(
      Date.parse(REPORT_FIXTURE_NOW) + 30 * 24 * 60 * 60 * 1_000,
    ).toISOString();
    const before = new Date(Date.parse(expiresAt) - 1).toISOString();
    const actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }> = {
      type: "CUSTOMER",
      subjectId: "customer-report-fixture",
    };

    const available = await service.getLatestReport(
      fixture.evaluationCase.id,
      undefined,
      before,
    );
    assert.equal(available.downloadAvailable, true);
    assert.equal(available.downloadExpiresAt, expiresAt);
    const expired = await service.getLatestReport(
      fixture.evaluationCase.id,
      undefined,
      expiresAt,
    );
    assert.equal(expired.downloadAvailable, false);
    await service.createDownload({
      caseId: fixture.evaluationCase.id,
      reportVersion: 1,
      actor,
      now: before,
    });
    await assert.rejects(
      service.createDownload({
        caseId: fixture.evaluationCase.id,
        reportVersion: 1,
        actor,
        now: expiresAt,
      }),
      (error: unknown) =>
        error instanceof ReportServiceError &&
        error.code === "report_download_expired",
    );
    assert.equal(
      reportServiceErrorStatus(
        new ReportServiceError("report_download_expired"),
      ),
      410,
    );
  });

  it("blocks incomplete and cross-case downloads, then audits a valid one", async () => {
    const fixture = createReportFixture();
    const completed = completedReport(fixture.reportRun);
    const repository = new FakeReportRepository(
      fixture.evaluationCase,
      completed,
    );
    const storage = new FakeReportStorage();
    const service = new AuditEvaluationReportService({
      repository,
      storage,
      generationService: {
        loadViewModel: async () => null,
      } as never,
      flags: ENABLED_FLAGS,
    });
    const actor: Extract<AuditEvaluationActor, { type: "CUSTOMER" }> = {
      type: "CUSTOMER",
      subjectId: "customer-report-fixture",
    };
    const download = await service.createDownload({
      caseId: fixture.evaluationCase.id,
      reportVersion: 1,
      actor,
      now: REPORT_FIXTURE_NOW,
    });
    assert.match(download.url, /^https:\/\/private\.example\//);
    assert.equal(
      download.fileName,
      "테스트농협_FY2027 감사인견적평가보고서.pdf",
    );
    assert.equal(
      Date.parse(download.expiresAt) - Date.parse(REPORT_FIXTURE_NOW),
      60_000,
    );
    assert.equal(repository.downloads, 1);
    assert.equal(storage.downloadRequests, 1);

    repository.report = { ...completed, status: "GENERATING" };
    await assert.rejects(
      service.createDownload({
        caseId: fixture.evaluationCase.id,
        reportVersion: 1,
        actor,
        now: REPORT_FIXTURE_NOW,
      }),
      (error: unknown) =>
        error instanceof ReportServiceError &&
        error.code === "report_not_ready",
    );

    repository.report = { ...completed, caseId: "case-other-customer" };
    await assert.rejects(
      service.createDownload({
        caseId: fixture.evaluationCase.id,
        reportVersion: 1,
        actor,
        now: REPORT_FIXTURE_NOW,
      }),
      (error: unknown) =>
        error instanceof ReportServiceError &&
        error.code === "report_not_found",
    );
  });

  it("keeps report storage and audit collections server-only", () => {
    const rules = readFileSync(join(process.cwd(), "storage.rules"), "utf8");
    const firestore = readFileSync(
      join(process.cwd(), "firestore.rules"),
      "utf8",
    );
    const route = readFileSync(
      join(
        process.cwd(),
        "app/api/audit-evaluations/[caseId]/reports/[reportVersion]/download/route.ts",
      ),
      "utf8",
    );
    assert.match(
      rules,
      /match \/audit-evaluation\/reports\/{allPaths=\*\*}[\s\S]*?allow read, write: if false;/,
    );
    assert.match(
      firestore,
      /match \/auditEvaluationAuditLogs\/{auditLogId}[\s\S]*?allow read, write: if false;/,
    );
    assert.match(route, /authenticateAuditEvaluationCaseRequest/);
    assert.match(route, /createDownload/);
    assert.match(route, /content-disposition/);
  });
});

function fixtureViewModel() {
  const fixture = createReportFixture();
  return buildDeterministicReportViewModel({
    reportRun: fixture.reportRun,
    evaluationCase: fixture.evaluationCase,
    corrections: [],
    generatedAt: REPORT_FIXTURE_NOW,
  });
}

function correction(input: {
  id: string;
  quoteId: string;
  quoteRevision: number;
  correctedAt: string;
}): AuditQuoteCorrectionRecord {
  return {
    id: input.id,
    caseId: "case-report-fixture",
    quoteId: input.quoteId,
    documentId: "document-report-01",
    field: "accountingFirmName",
    originalExtractedValue: "수정 전 회계법인명",
    previousValue: "수정 전 회계법인명",
    correctedValue: "수정 후 회계법인명",
    reason: "고객 확인 후 정정",
    correctedBy: {
      type: "CUSTOMER",
      subjectId: "customer-report-fixture",
    },
    correctedAt: input.correctedAt,
    quoteRevision: input.quoteRevision,
    source: "CUSTOMER_CORRECTION",
    requiresAdminReview: false,
    reviewStatus: "NOT_REQUIRED",
  };
}

function completedReport(report: EvaluationReportRun): EvaluationReportRun {
  return {
    ...report,
    status: "COMPLETED",
    generationLeaseExpiresAt: null,
    renderingReference: {
      rendererId: "audit-evaluation-report-pdf",
      rendererVersion: 1,
      payloadStoragePath:
        "audit-evaluation/reports/case-report-fixture/v1/attempt-1/view-model.json",
    },
    pdfStoragePath:
      "audit-evaluation/reports/case-report-fixture/v1/attempt-1/report.pdf",
    generatedAt: REPORT_FIXTURE_NOW,
  };
}

class FakeReportRepository implements AuditEvaluationReportRepository {
  evaluationCase;
  report;
  downloads = 0;

  constructor(
    evaluationCase: ReturnType<typeof createReportFixture>["evaluationCase"],
    report: EvaluationReportRun,
  ) {
    this.evaluationCase = evaluationCase;
    this.report = report;
  }

  async getReport(caseId: string, reportVersion: number) {
    return this.report.reportVersion === reportVersion ? this.report : null;
  }

  async listReports() {
    return [this.report];
  }

  async listRecoverableGenerations() {
    return [];
  }

  async getLatestReport() {
    return {
      evaluationCase: this.evaluationCase,
      report: this.report,
    };
  }

  async listCorrections() {
    return [];
  }

  async claimGeneration(): Promise<ReportGenerationClaim> {
    throw new Error("not_used");
  }

  async completeGeneration(): Promise<EvaluationReportRun> {
    throw new Error("not_used");
  }

  async failGeneration() {
    throw new Error("not_used");
  }

  async recordDownload() {
    this.downloads += 1;
  }
}

class FakeReportStorage implements AuditEvaluationReportStorage {
  downloadRequests = 0;

  async save() {
    throw new Error("not_used");
  }

  async read() {
    return null;
  }

  async createDownloadUrl() {
    this.downloadRequests += 1;
    return "https://private.example/signed-report";
  }
}

class InMemoryGenerationRepository
  implements AuditEvaluationReportRepository
{
  evaluationCase: ReturnType<typeof createReportFixture>["evaluationCase"];
  report: EvaluationReportRun;

  constructor(
    evaluationCase: ReturnType<typeof createReportFixture>["evaluationCase"],
    report: EvaluationReportRun,
  ) {
    this.evaluationCase = evaluationCase;
    this.report = report;
  }

  async getReport() {
    return this.report;
  }

  async listReports() {
    return [this.report];
  }

  async listRecoverableGenerations() {
    return [];
  }

  async getLatestReport() {
    return { evaluationCase: this.evaluationCase, report: this.report };
  }

  async listCorrections() {
    return [];
  }

  async claimGeneration(input: {
    caseId: string;
    reportVersion: number;
    now: string;
  }): Promise<ReportGenerationClaim> {
    if (this.report.status === "COMPLETED") {
      return {
        claimed: false,
        report: this.report,
        evaluationCase: this.evaluationCase,
        attempt: this.report.generationAttempt ?? 0,
      };
    }
    const attempt = (this.report.generationAttempt ?? 0) + 1;
    this.report = {
      ...this.report,
      status: "GENERATING",
      generationAttempt: attempt,
      generationStartedAt: input.now,
      generationLeaseExpiresAt: "2026-07-21T01:30:00.000Z",
      failureCode: null,
    };
    return {
      claimed: true,
      report: this.report,
      evaluationCase: this.evaluationCase,
      attempt,
    };
  }

  async completeGeneration(
    input: Parameters<
      AuditEvaluationReportRepository["completeGeneration"]
    >[0],
  ) {
    this.report = {
      ...this.report,
      status: "COMPLETED",
      generatedAt: input.generatedAt,
      generationLeaseExpiresAt: null,
      renderingReference: input.renderingReference,
      pdfStoragePath: input.pdfStoragePath,
      narrativeData: input.narrativeData,
    };
    return this.report;
  }

  async failGeneration(
    input: Parameters<
      AuditEvaluationReportRepository["failGeneration"]
    >[0],
  ) {
    this.report = {
      ...this.report,
      status: "FAILED",
      generationLeaseExpiresAt: null,
      failureCode: input.failureCode,
    };
  }

  async recordDownload() {}
}

class InMemoryReportStorage implements AuditEvaluationReportStorage {
  saved = new Map<string, Uint8Array>();
  saveCalls = 0;
  failNextSave = false;

  async save(
    input: Parameters<AuditEvaluationReportStorage["save"]>[0],
  ) {
    this.saveCalls += 1;
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("STORAGE_WRITE_FAILED");
    }
    this.saved.set(input.storagePath, input.bytes);
  }

  async read(storagePath: string) {
    return this.saved.get(storagePath) ?? null;
  }

  async createDownloadUrl() {
    return "https://private.example/signed-report";
  }
}
