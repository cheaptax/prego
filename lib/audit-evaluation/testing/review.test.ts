import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeWonAmount } from "@/lib/audit-evaluation/money";
import {
  assertExpectedQuoteRevision,
  requiresAdminReviewForCorrection,
  ReviewServiceError,
} from "@/lib/audit-evaluation/review-repository";
import {
  evaluateAuditEvaluationReadiness,
} from "@/lib/audit-evaluation/review-readiness";
import {
  parseCustomerCorrectionValue,
} from "@/lib/audit-evaluation/review-schemas";
import type {
  AuditEvaluationCase,
  NormalizedAuditQuote,
  UploadedQuoteDocument,
} from "@/lib/audit-evaluation/types";
import {
  createTrustedStandardQuotePayload,
  createValidEvaluationConfig,
} from "@/lib/audit-evaluation/testing/fixtures";

const NOW = "2026-07-21T00:00:00.000Z";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("audit-evaluation customer review", () => {
  it("requires two distinct firms, required values, and an effective published config", () => {
    const first = quote("quote-one", "document-one", "하나 회계법인");
    const second = quote("quote-two", "document-two", "둘 회계법인");
    const result = evaluateAuditEvaluationReadiness({
      evaluationCase: evaluationCase(),
      config: publishedConfig({
        requiredFields: ["accountingFirmName", "auditFee"],
      }),
      quotes: [first, second],
      documents: [
        document("document-one"),
        document("document-two"),
      ],
      now: NOW,
      requireCustomerConfirmation: false,
    });
    assert.equal(result.ready, true);
    assert.equal(result.distinctFirmCount, 2);

    const duplicateFirm = evaluateAuditEvaluationReadiness({
      evaluationCase: evaluationCase(),
      config: publishedConfig(),
      quotes: [first, { ...second, accountingFirmName: " 하나회계법인 " }],
      documents: [
        document("document-one"),
        document("document-two"),
      ],
      now: NOW,
      requireCustomerConfirmation: false,
    });
    assert.ok(
      duplicateFirm.issues.some(
        ({ code }) => code === "NOT_ENOUGH_DISTINCT_FIRMS",
      ),
    );
  });

  it("blocks severe integrity errors, pending admin review, and stale revisions", () => {
    const first = quote("quote-one", "document-one", "하나 회계법인");
    const second: NormalizedAuditQuote = {
      ...quote("quote-two", "document-two", "둘 회계법인"),
      pendingAdminReviewFields: ["auditFee"],
      revision: 3,
    };
    const result = evaluateAuditEvaluationReadiness({
      evaluationCase: evaluationCase(),
      config: publishedConfig(),
      quotes: [first, second],
      documents: [
        document("document-one"),
        {
          ...document("document-two"),
          integrityStatus: "FAILED",
        },
      ],
      now: NOW,
      requireCustomerConfirmation: true,
      expectedQuoteRevisions: {
        "quote-one": 0,
        "quote-two": 2,
      },
    });
    assert.ok(result.issues.some(({ code }) => code === "SEVERE_INTEGRITY_ERROR"));
    assert.ok(result.issues.some(({ code }) => code === "ADMIN_REVIEW_PENDING"));
    assert.ok(result.issues.some(({ code }) => code === "QUOTE_REVISION_CONFLICT"));
    assert.ok(
      result.issues.some(
        ({ code }) => code === "CUSTOMER_CONFIRMATION_REQUIRED",
      ),
    );
  });

  it("blocks customer confirmation while document security scan is incomplete", () => {
    const result = evaluateAuditEvaluationReadiness({
      evaluationCase: evaluationCase(),
      config: publishedConfig(),
      quotes: [
        quote("quote-one", "document-one", "하나 회계법인"),
        quote("quote-two", "document-two", "둘 회계법인"),
      ],
      documents: [
        document("document-one"),
        { ...document("document-two"), scanStatus: "UNAVAILABLE" },
      ],
      now: NOW,
      requireCustomerConfirmation: false,
    });
    assert.ok(
      result.issues.some(
        ({ code }) => code === "DOCUMENT_SECURITY_SCAN_INCOMPLETE",
      ),
    );
  });

  it("normalizes customer corrections without guessing money units", () => {
    assert.equal(
      parseCustomerCorrectionValue("auditFee", "5,500만원"),
      normalizeWonAmount("55000000"),
    );
    assert.equal(
      parseCustomerCorrectionValue("vatIncluded", "부가세 별도"),
      false,
    );
    assert.deepEqual(
      parseCustomerCorrectionValue(
        "engagementTeam",
        "김회계 | 매니저 | 120\n이회계 | 스태프 | 80",
      ),
      [
        { name: "김회계", role: "매니저", plannedHours: 120 },
        { name: "이회계", role: "스태프", plannedHours: 80 },
      ],
    );
    assert.throws(
      () => parseCustomerCorrectionValue("auditFee", "5500"),
      /MISSING_AMOUNT_UNIT/,
    );
  });

  it("rejects stale optimistic-lock revisions", () => {
    assert.doesNotThrow(() => assertExpectedQuoteRevision(4, 4));
    assert.throws(
      () => assertExpectedQuoteRevision(4, 3),
      (error: unknown) =>
        error instanceof ReviewServiceError &&
        error.code === "version_conflict",
    );
  });

  it("cannot clear a required core-field review by resaving the same correction", () => {
    assert.equal(
      requiresAdminReviewForCorrection(
        true,
        "auditFee",
        "60000000",
        "55000000",
      ),
      true,
    );
    assert.equal(
      requiresAdminReviewForCorrection(
        true,
        "auditFee",
        "55000000",
        "55000000",
      ),
      false,
    );
    assert.equal(
      requiresAdminReviewForCorrection(
        false,
        "auditFee",
        "60000000",
        "55000000",
      ),
      false,
    );
  });

  it("keeps review collections server-only and reports confirmation snapshots only", () => {
    const rules = source("firestore.rules");
    const repository = source(
      "lib/audit-evaluation/review-repository.ts",
    );
    const route = source(
      "app/api/audit-evaluations/[caseId]/reports/route.ts",
    );
    assert.match(
      rules,
      /match \/auditEvaluationCorrections\/\{correctionId\}[\s\S]*?allow read, write: if false;/,
    );
    assert.match(
      rules,
      /match \/auditEvaluationConfirmations\/\{confirmationId\}[\s\S]*?allow read, write: if false;/,
    );
    assert.match(
      repository,
      /evaluationConfigSnapshot:\s*confirmation\.evaluationConfigSnapshot/,
    );
    assert.match(
      repository,
      /assertPublishedEffective\(\s*confirmation\.evaluationConfigSnapshot,\s*confirmation\.confirmedAt,\s*\)/,
    );
    assert.match(
      repository,
      /quoteDataSnapshots:\s*confirmation\.quoteDataSnapshots/,
    );
    assert.match(repository, /runDeterministicQualityScoring\(/);
    assert.match(repository, /runDeterministicFeeAnalysis\(/);
    assert.match(repository, /scoreResult,\s*\n\s*feeAnalysis,/);
    assert.match(route, /authenticateAuditEvaluationCaseRequest/);
  });

  it("renders the required comparison and autosave contracts", () => {
    const component = source("components/AuditQuoteReviewWorkspace.tsx");
    for (const field of [
      "accountingFirmName",
      "auditFee",
      "vatIncluded",
      "accountingFirmRevenue",
      "recentNonghyupAuditCount",
      "auditedNonghyupTypes",
      "taxAgencyExperience",
      "subsidySettlementExperience",
      "engagementPartner",
      "engagementTeam",
      "totalPlannedHours",
      "auditSchedule",
      "qualityControlPlan",
      "requiredProposalItems",
    ]) {
      assert.match(component, new RegExp(`"${field}"`));
    }
    assert.match(component, /window\.setTimeout[\s\S]*?1_200/);
    assert.match(component, /expectedRevision/);
    assert.match(component, /<table/);
    assert.match(component, /QuoteComparisonCards/);
  });
});

function evaluationCase(): AuditEvaluationCase {
  return {
    id: "case-review",
    quoteRequestId: "request-review",
    cooperativeId: null,
    cooperativeNameSnapshot: "테스트 농협",
    fiscalYear: 2027,
    customerAccessOwner: {
      type: "CAPABILITY_SUBJECT",
      subjectId: "customer-review",
    },
    status: "NEEDS_REVIEW",
    quoteTemplateVersion: null,
    evaluationConfigVersion: { id: "fy27.default", version: 1 },
    latestReportVersion: null,
    expectedQuoteCount: 2,
    confirmedQuoteCount: 0,
    expiresAt: "2027-01-01T00:00:00.000Z",
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
  };
}

function quote(
  quoteId: string,
  documentId: string,
  accountingFirmName: string,
): NormalizedAuditQuote {
  return {
    ...createTrustedStandardQuotePayload(),
    quoteId,
    caseId: "case-review",
    documentId,
    accountingFirmName,
    missingFields: [],
    warnings: [],
    confidenceByField: {},
    evidenceByField: {},
    source: {},
    confirmedByCustomer: false,
    confirmedAt: null,
    revision: 0,
    updatedAt: NOW,
    pendingAdminReviewFields: [],
  };
}

function document(id: string): UploadedQuoteDocument {
  return {
    id,
    caseId: "case-review",
    originalFileName: `${id}.pdf`,
    safeDisplayName: `${id}.pdf`,
    storagePath: `audit-evaluation/originals/case-review/${id}/quote.pdf`,
    mimeType: "application/pdf",
    size: 100,
    sha256: "a".repeat(64),
    uploadStatus: "UPLOADED",
    scanStatus: "CLEAN",
    parsingStatus: "PARSED",
    matchedQuoteDocumentId: null,
    matchStatus: "LEGACY_DOCUMENT",
    integrityStatus: "PENDING",
    uploadedAt: NOW,
    uploadedBy: { type: "SYSTEM", service: "test" },
    deletedAt: null,
    deletedBy: null,
  };
}

function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function publishedConfig(
  overrides: Partial<ReturnType<typeof createValidEvaluationConfig>> = {},
) {
  return {
    ...createValidEvaluationConfig(),
    status: "PUBLISHED" as const,
    publishedBy: "admin-test",
    publishedAt: NOW,
    ...overrides,
  };
}
