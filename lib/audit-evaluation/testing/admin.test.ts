import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AdminAuditEvaluationError,
  aggregateAdminCaseItems,
  createAdminCorrectionMutation,
  createAdminReportRegeneration,
  filterAdminCaseItems,
} from "@/lib/audit-evaluation/admin-repository";
import type {
  AuditEvaluationCase,
  EvaluationReportRun,
  UploadedQuoteDocument,
} from "@/lib/audit-evaluation/types";
import {
  adminAccessReissueRequestSchema,
} from "@/lib/audit-evaluation/admin-types";
import {
  createReportFixture,
  REPORT_FIXTURE_NOW,
} from "@/lib/audit-evaluation/testing/report-fixtures";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const LATER = "2026-07-22T01:23:45.000Z";

describe("audit-evaluation admin operations", () => {
  it("aggregates case, quote, document, and report filters", () => {
    const fixture = createReportFixture();
    const completedReport: EvaluationReportRun = {
      ...fixture.reportRun,
      status: "COMPLETED",
      generatedAt: LATER,
      generationLeaseExpiresAt: null,
    };
    const failedDocument: UploadedQuoteDocument = {
      id: "document-failed-001",
      caseId: fixture.evaluationCase.id,
      originalFileName: "견적서.pdf",
      safeDisplayName: "견적서.pdf",
      storagePath:
        `audit-evaluation/originals/${fixture.evaluationCase.id}/document-failed-001/quote.pdf`,
      mimeType: "application/pdf",
      size: 100,
      sha256: "a".repeat(64),
      uploadStatus: "UPLOADED",
      scanStatus: "CLEAN",
      parsingStatus: "FAILED",
      matchedQuoteDocumentId: null,
      matchStatus: "UNRECOGNIZED",
      integrityStatus: "VERIFIED",
      uploadedAt: REPORT_FIXTURE_NOW,
      uploadedBy: { type: "ADMIN", uid: "admin-test" },
      deletedAt: null,
      deletedBy: null,
    };
    const items = aggregateAdminCaseItems(
      [{
        ...fixture.evaluationCase,
        status: "COMPLETED",
        cooperativeNameSnapshot: "서울중앙농협",
        updatedAt: LATER,
      }],
      [failedDocument],
      fixture.quotes,
      [completedReport],
    );
    assert.equal(items[0].quoteCount, 2);
    assert.equal(items[0].hasError, true);
    assert.equal(items[0].reportCompleted, true);
    assert.equal(items[0].reportGeneratedAt, LATER);
    assert.deepEqual(
      filterAdminCaseItems(items, {
        status: "COMPLETED",
        fiscalYear: 2027,
        cooperativeName: "중앙",
        hasError: true,
        reportCompleted: true,
      }).map(({ id }) => id),
      [fixture.evaluationCase.id],
    );
    assert.equal(
      filterAdminCaseItems(items, { reportCompleted: false }).length,
      0,
    );
  });

  it("preserves original, before, after, reason, and revision for admin corrections", () => {
    const fixture = createReportFixture();
    const sourceQuote = {
      ...fixture.quotes[0],
      revision: 4,
      evidenceByField: {
        ...fixture.quotes[0].evidenceByField,
        auditFee: [{
          documentId: fixture.quotes[0].documentId,
          extractedValue: "50000000",
          normalizedValue: fixture.quotes[0].auditFee,
          source: "DETERMINISTIC_PARSE" as const,
          confidence: 90,
          pageNumber: 1,
          excerpt: "감사보수 55,000,000원",
          coordinates: null,
          cellAddress: null,
          validationWarnings: [],
        }],
      },
    };
    const first = createAdminCorrectionMutation({
      evaluationCase: {
        ...fixture.evaluationCase,
        status: "COMPLETED",
        completedAt: REPORT_FIXTURE_NOW,
      },
      quote: sourceQuote,
      previousCorrections: [],
      correctionId: "correction-admin-first",
      field: "auditFee",
      correctedValue: "60000000",
      reason: "원본 합계 재검증",
      expectedRevision: 4,
      actorUid: "admin-001",
      now: REPORT_FIXTURE_NOW,
    });
    assert.equal(first.correction.originalExtractedValue, "50000000");
    assert.equal(first.correction.previousValue, fixture.quotes[0].auditFee);
    assert.equal(first.correction.correctedValue, "60000000");
    assert.equal(first.correction.reason, "원본 합계 재검증");
    assert.equal(first.correction.quoteRevision, 5);
    assert.equal(first.correction.source, "ADMIN_CORRECTION");
    assert.deepEqual(first.correction.correctedBy, {
      type: "ADMIN",
      uid: "admin-001",
    });
    assert.equal(first.evaluationCase.status, "READY");
    assert.equal(first.evaluationCase.confirmationVersion, null);
    assert.equal(first.evaluationCase.reportRegenerationRequired, true);

    const second = createAdminCorrectionMutation({
      evaluationCase: first.evaluationCase,
      quote: first.quote,
      previousCorrections: [first.correction],
      correctionId: "correction-admin-second",
      field: "auditFee",
      correctedValue: "61000000",
      reason: "부속 명세 반영",
      expectedRevision: 5,
      actorUid: "admin-001",
      now: LATER,
    });
    assert.equal(second.correction.originalExtractedValue, "50000000");
    assert.equal(second.correction.previousValue, "60000000");
    assert.equal(second.correction.correctedValue, "61000000");
    assert.equal(second.correction.quoteRevision, 6);
  });

  it("rejects cross-case quote correction binding", () => {
    const fixture = createReportFixture();
    assert.throws(
      () => createAdminCorrectionMutation({
        evaluationCase: fixture.evaluationCase,
        quote: { ...fixture.quotes[0], caseId: "case-other" },
        previousCorrections: [],
        correctionId: "correction-cross-case",
        field: "auditFee",
        correctedValue: "60000000",
        reason: "교차 케이스 차단",
        expectedRevision: fixture.quotes[0].revision ?? 0,
        actorUid: "admin-001",
        now: REPORT_FIXTURE_NOW,
      }),
      (error: unknown) =>
        error instanceof AdminAuditEvaluationError &&
        error.code === "quote_not_found",
    );
  });

  it("creates a new immutable report version and rejects a double click", () => {
    const fixture = createReportFixture();
    const source: EvaluationReportRun = {
      ...fixture.reportRun,
      status: "COMPLETED",
      generatedAt: REPORT_FIXTURE_NOW,
      generationLeaseExpiresAt: null,
      pdfStoragePath: "audit-evaluation/reports/case/report-v1.pdf",
    };
    const evaluationCase: AuditEvaluationCase = {
      ...fixture.evaluationCase,
      status: "COMPLETED",
      completedAt: REPORT_FIXTURE_NOW,
      reportRegenerationRequired: false,
    };
    const sourceBefore = structuredClone(source);
    const result = createAdminReportRegeneration({
      evaluationCase,
      source,
      existingReports: [source],
      expectedSourceVersion: 1,
      actorUid: "admin-001",
      now: LATER,
    });
    assert.deepEqual(source, sourceBefore);
    assert.equal(result.report.reportVersion, 2);
    assert.equal(result.report.status, "PENDING");
    assert.equal(result.report.inputHash, source.inputHash);
    assert.deepEqual(
      result.report.evaluationConfigSnapshot,
      source.evaluationConfigSnapshot,
    );
    assert.deepEqual(result.report.quoteDataSnapshots, source.quoteDataSnapshots);
    assert.deepEqual(result.report.scoreResult, source.scoreResult);
    assert.deepEqual(result.report.feeAnalysis, source.feeAnalysis);
    assert.equal(result.report.pdfStoragePath, null);
    assert.equal(result.evaluationCase.latestReportVersion, 2);
    assert.equal(result.evaluationCase.status, "GENERATING");

    assert.throws(
      () => createAdminReportRegeneration({
        evaluationCase: result.evaluationCase,
        source,
        existingReports: [source, result.report],
        expectedSourceVersion: 1,
        actorUid: "admin-001",
        now: LATER,
      }),
      (error: unknown) =>
        error instanceof AdminAuditEvaluationError &&
        error.code === "source_version_conflict",
    );
  });

  it("retries a failed immutable report as a new version", () => {
    const fixture = createReportFixture();
    const source: EvaluationReportRun = {
      ...fixture.reportRun,
      status: "FAILED",
      failureCode: "PDF_GENERATION_FAILED",
      generatedAt: null,
    };
    const result = createAdminReportRegeneration({
      evaluationCase: {
        ...fixture.evaluationCase,
        status: "FAILED",
        reportRegenerationRequired: false,
      },
      source,
      existingReports: [source],
      expectedSourceVersion: source.reportVersion,
      actorUid: "admin-001",
      now: LATER,
    });
    assert.equal(result.report.reportVersion, source.reportVersion + 1);
    assert.equal(result.report.status, "PENDING");
    assert.equal(result.report.failureCode, null);
  });

  it("never regenerates a stale snapshot after quote data changed", () => {
    const fixture = createReportFixture();
    assert.throws(
      () => createAdminReportRegeneration({
        evaluationCase: {
          ...fixture.evaluationCase,
          status: "READY",
          reportRegenerationRequired: true,
          confirmationVersion: 2,
          confirmedQuoteCount: fixture.quotes.length,
        },
        source: { ...fixture.reportRun, status: "COMPLETED" },
        existingReports: [fixture.reportRun],
        expectedSourceVersion: fixture.reportRun.reportVersion,
        actorUid: "admin-001",
        now: LATER,
      }),
      (error: unknown) =>
        error instanceof AdminAuditEvaluationError &&
        error.code === "customer_reconfirmation_required",
    );
  });

  it("requires the current access expiry for idempotent link reissue", () => {
    assert.equal(
      adminAccessReissueRequestSchema.safeParse({
        confirm: true,
        extendDays: 7,
      }).success,
      false,
    );
    assert.equal(
      adminAccessReissueRequestSchema.safeParse({
        confirm: true,
        extendDays: 7,
        expectedExpiresAt: REPORT_FIXTURE_NOW,
      }).success,
      true,
    );
  });

  it("separates read and write authorization before feature flag checks", () => {
    const helper = source("lib/audit-evaluation/admin-api.ts");
    assert.match(
      helper,
      /permission:[\s\S]*?= "auditEvaluations:read"/,
    );
    assert.match(
      helper,
      /requireAdminCapability\(request, permission\)/,
    );
    for (const route of [
      "app/api/admin/audit-evaluations/route.ts",
      "app/api/admin/audit-evaluations/[caseId]/route.ts",
      "app/api/admin/audit-evaluations/errors/route.ts",
      "app/api/admin/audit-evaluations/audit-logs/route.ts",
      "app/api/admin/audit-evaluations/monitoring/route.ts",
    ]) {
      assert.match(source(route), /requireAuditEvaluationAdmin\(request\)/);
    }
    for (const route of [
      "app/api/admin/audit-evaluations/[caseId]/quotes/[quoteId]/corrections/route.ts",
      "app/api/admin/audit-evaluations/[caseId]/documents/[documentId]/reprocess/route.ts",
      "app/api/admin/audit-evaluations/[caseId]/reports/[reportVersion]/regenerate/route.ts",
      "app/api/admin/audit-evaluations/[caseId]/access/reissue/route.ts",
    ]) {
      assert.match(
        source(route),
        /requireAuditEvaluationAdmin\(\s*request,\s*"auditEvaluations:write",\s*\)/,
      );
    }
    assert.match(
      source("app/api/admin/audit-evaluations/retention/route.ts"),
      /requireAuditEvaluationAdmin\(\s*request,\s*"auditEvaluations:write",\s*\)/,
    );
  });
});

function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}
