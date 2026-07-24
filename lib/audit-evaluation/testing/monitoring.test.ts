import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildAuditEvaluationOperationalMetrics } from "@/lib/audit-evaluation/monitoring-service";

describe("audit evaluation operational monitoring", () => {
  it("derives privacy-safe rates and generation duration", () => {
    const metrics = buildAuditEvaluationOperationalMetrics({
      window: {
        from: "2026-07-20T00:00:00.000Z",
        to: "2026-07-21T00:00:00.000Z",
      },
      cases: [{ createdAt: "2026-07-20T01:00:00.000Z" }],
      uploadIntents: [
        { status: "COMPLETED" },
        { status: "FAILED" },
      ],
      extractionRuns: [
        { status: "COMPLETED" },
        { status: "NEEDS_REVIEW" },
        { status: "FAILED" },
      ],
      reportRuns: [
        {
          status: "COMPLETED",
          generationStartedAt: "2026-07-20T02:00:00.000Z",
          generatedAt: "2026-07-20T02:00:03.000Z",
        },
        { status: "FAILED" },
      ],
      auditLogs: [
        { action: "REPORT_GENERATION_STARTED" },
        { action: "REPORT_GENERATION_RETRIED" },
        {
          action: "REPORT_GENERATION_FAILED",
          errorCode: "PDF_RENDER_FAILED",
        },
        { action: "ACCESS_DENIED" },
        { action: "ACCESS_TOKEN_EXPIRED" },
        { action: "RETENTION_EXPIRED" },
      ],
    });
    assert.equal(metrics.evaluationStartCount, 1);
    assert.equal(metrics.upload.successRateBasisPoints, 5_000);
    assert.equal(metrics.parsing.successRateBasisPoints, 3_333);
    assert.equal(
      metrics.parsing.customerReviewRequiredRateBasisPoints,
      5_000,
    );
    assert.equal(metrics.report.successRateBasisPoints, 5_000);
    assert.equal(metrics.report.averageGenerationMilliseconds, 3_000);
    assert.equal(metrics.report.pdfFailureRateBasisPoints, 5_000);
    assert.equal(metrics.authorizationDeniedCount, 1);
    assert.equal(metrics.expiredCount, 1);
    assert.equal(metrics.accessExpiredCount, 1);
    assert.equal(metrics.retentionExpiredCount, 1);
  });

  it("returns null rates instead of inventing a zero-data success result", () => {
    const metrics = buildAuditEvaluationOperationalMetrics({
      window: {
        from: "2026-07-20T00:00:00.000Z",
        to: "2026-07-21T00:00:00.000Z",
      },
      cases: [],
      uploadIntents: [],
      extractionRuns: [],
      reportRuns: [],
      auditLogs: [],
    });
    assert.equal(metrics.upload.successRateBasisPoints, null);
    assert.equal(metrics.parsing.successRateBasisPoints, null);
    assert.equal(metrics.report.successRateBasisPoints, null);
    assert.equal(metrics.report.averageGenerationMilliseconds, null);
  });

  it("keeps the endpoint admin-only and no-store", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "app/api/admin/audit-evaluations/monitoring/route.ts",
      ),
      "utf8",
    );
    assert.match(source, /requireAuditEvaluationAdmin\(request\)/);
    assert.match(source, /private, no-store/);
    assert.doesNotMatch(
      source,
      /recipientEmail|magicLink|documentBytes|normalizedQuote/,
    );
  });
});
