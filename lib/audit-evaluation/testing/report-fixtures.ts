import { createDefaultAuditQualityDraft } from "@/lib/audit-evaluation/default-evaluation-draft";
import { runDeterministicFeeAnalysis } from "@/lib/audit-evaluation/fee-analysis";
import { normalizeWonAmount } from "@/lib/audit-evaluation/money";
import { runDeterministicQualityScoring } from "@/lib/audit-evaluation/scoring-engine";
import { evaluationConfigSchema } from "@/lib/audit-evaluation/schemas";
import {
  createEvaluationConfigSnapshot,
  createQuoteDataSnapshots,
} from "@/lib/audit-evaluation/snapshots";
import type {
  AuditEvaluationCase,
  EvaluationConfig,
  EvaluationReportRun,
  NormalizedAuditQuote,
} from "@/lib/audit-evaluation/types";
import { createTrustedStandardQuotePayload } from "@/lib/audit-evaluation/testing/fixtures";

export const REPORT_FIXTURE_NOW = "2026-07-21T01:23:45.000Z";

export type ReportFixtureOptions = {
  quoteCount?: number;
  longContent?: boolean;
  missingInformation?: boolean;
  tied?: boolean;
  largeAmounts?: boolean;
  mixedText?: boolean;
};

export function createPublishedReportConfig(): EvaluationConfig {
  const config = createDefaultAuditQualityDraft({
    createdBy: "admin-report-fixture",
    createdAt: REPORT_FIXTURE_NOW,
  });
  const plan = config.criteria.find(
    ({ id }) => id === "audit-plan-and-staffing",
  );
  if (!plan || plan.rule.type !== "checklist") {
    throw new Error("missing_plan_checklist");
  }
  plan.rule.items = [
    {
      id: "partner",
      label: "업무수행이사 제시",
      required: true,
      scoreBasisPoints: 2_500,
      condition: { type: "FIELD_PRESENT", field: "engagementPartner" },
    },
    {
      id: "team",
      label: "투입인력 제시",
      required: true,
      scoreBasisPoints: 2_500,
      condition: { type: "FIELD_PRESENT", field: "engagementTeam" },
    },
    {
      id: "hours",
      label: "총 투입시간 제시",
      required: true,
      scoreBasisPoints: 2_500,
      condition: {
        type: "MINIMUM_INTEGER",
        field: "totalPlannedHours",
        minimum: 1,
      },
    },
    {
      id: "schedule",
      label: "감사 일정 제시",
      required: true,
      scoreBasisPoints: 2_500,
      condition: { type: "FIELD_PRESENT", field: "auditSchedule" },
    },
  ];
  const proposal = config.criteria.find(
    ({ id }) => id === "proposal-completeness",
  );
  if (!proposal || proposal.rule.type !== "checklist") {
    throw new Error("missing_proposal_checklist");
  }
  proposal.rule.items = [
    {
      id: "independence",
      label: "독립성 확인자료",
      required: true,
      scoreBasisPoints: 10_000,
    },
  ];
  config.status = "PUBLISHED";
  config.publishedBy = "admin-report-fixture";
  config.publishedAt = REPORT_FIXTURE_NOW;
  return evaluationConfigSchema.parse(config);
}

export function createReportFixture(
  options: ReportFixtureOptions = {},
): {
  evaluationCase: AuditEvaluationCase;
  reportRun: EvaluationReportRun;
  quotes: NormalizedAuditQuote[];
} {
  const quoteCount = options.quoteCount ?? 2;
  const config = createPublishedReportConfig();
  const quotes = Array.from({ length: quoteCount }, (_, index) =>
    createReportQuote(index, options)
  );
  const scoreResult = runDeterministicQualityScoring(config, quotes);
  const feeAnalysis = runDeterministicFeeAnalysis(
    config.feeAnalysisPolicy,
    quotes.map((quote) => ({
      quoteId: quote.quoteId,
      auditFee: quote.auditFee,
      vatIncluded: quote.vatIncluded,
      totalPlannedHours: quote.totalPlannedHours,
      partnerHours: quote.partnerHours,
    })),
  );
  const evaluationCase: AuditEvaluationCase = {
    id: "case-report-fixture",
    quoteRequestId: "request-report-fixture",
    cooperativeId: "cooperative-fixture",
    cooperativeNameSnapshot: options.longContent
      ? `테스트농협 ${"장기 설명 ".repeat(20)}`.trim()
      : "테스트농협",
    fiscalYear: 2027,
    customerAccessOwner: {
      type: "CAPABILITY_SUBJECT",
      subjectId: "customer-report-fixture",
    },
    status: "GENERATING",
    quoteTemplateVersion: null,
    evaluationConfigVersion: { id: config.id, version: config.version },
    latestReportVersion: 1,
    expectedQuoteCount: quoteCount,
    confirmedQuoteCount: quoteCount,
    latestConfirmationVersion: 1,
    confirmationVersion: 1,
    reportRequestedConfirmationVersion: 1,
    expiresAt: "2027-12-31T00:00:00.000Z",
    createdAt: REPORT_FIXTURE_NOW,
    updatedAt: REPORT_FIXTURE_NOW,
    completedAt: null,
  };
  const reportRun: EvaluationReportRun = {
    id: "aerr_case-report-fixture_1",
    caseId: evaluationCase.id,
    reportVersion: 1,
    confirmationVersion: 1,
    inputHash: "a".repeat(64),
    status: "GENERATING",
    requestedAt: REPORT_FIXTURE_NOW,
    generationAttempt: 1,
    generationStartedAt: REPORT_FIXTURE_NOW,
    generationLeaseExpiresAt: "2026-07-21T01:28:45.000Z",
    evaluationConfigSnapshot: createEvaluationConfigSnapshot(config),
    quoteDataSnapshots: createQuoteDataSnapshots(quotes),
    scoreResult,
    feeAnalysis,
    narrativeData: {
      mode: "RULE_BASED",
      ruleBasedSections: [],
      aiStatus: "NOT_REQUESTED",
      aiText: null,
    },
    htmlStoragePath: null,
    renderingReference: null,
    pdfStoragePath: null,
    generatedAt: null,
    generatedBy: {
      type: "CUSTOMER",
      subjectId: "customer-report-fixture",
    },
    failureCode: null,
    failureMessage: null,
  };
  return { evaluationCase, reportRun, quotes };
}

function createReportQuote(
  index: number,
  options: ReportFixtureOptions,
): NormalizedAuditQuote {
  const payload = createTrustedStandardQuotePayload();
  const suffix = String(index + 1).padStart(2, "0");
  const longName = `회계법인 ${"매우긴회사명".repeat(18)} ${suffix}`;
  const largeAmount = "999999999999999";
  const missing = options.missingInformation && index === 0;
  return {
    quoteId: `quote-report-${suffix}`,
    caseId: "case-report-fixture",
    documentId: `document-report-${suffix}`,
    ...payload,
    accountingFirmId: `firm-report-${suffix}`,
    accountingFirmName: options.longContent
      ? longName
      : options.mixedText
        ? `한글 Audit Firm 2027-${suffix}`
        : `테스트 회계법인 ${suffix}`,
    auditFee: normalizeWonAmount(
      options.largeAmounts
        ? largeAmount
        : String(50_000_000 + index * 7_500_000),
    ),
    vatIncluded: index % 2 === 0,
    accountingFirmRevenue: normalizeWonAmount(
      options.largeAmounts ? largeAmount : "10000000000",
    ),
    recentNonghyupAuditCount: missing
      ? null
      : options.tied
        ? 50
        : Math.max(10, 50 - index * 5),
    auditedNonghyupTypes: missing ? [] : ["지역농협", "품목농협", "축협", "인삼협"],
    taxAgencyExperience: {
      hasExperience: !missing,
      descriptions: options.longContent
        ? [`농협 세무대리 ${"확인된 수행 설명 ".repeat(24)}`.trim()]
        : ["농협 세무대리 수행"],
    },
    subsidySettlementExperience: {
      hasExperience: !missing,
      descriptions: options.mixedText
        ? ["보조금 Settlement 3건 FY2027"]
        : ["보조금 정산 검증 수행"],
    },
    engagementPartner: missing ? null : payload.engagementPartner,
    engagementTeam: missing ? [] : payload.engagementTeam,
    totalPlannedHours: missing ? null : 320 + index * 40,
    partnerHours: missing ? null : 40 + index * 5,
    auditSchedule: missing ? [] : payload.auditSchedule,
    qualityControlPlan: options.longContent
      ? Array.from(
          { length: 6 },
          (_, itemIndex) =>
            `품질관리 ${itemIndex + 1}: ${"독립된 검토 절차를 수행합니다. ".repeat(14)}`.trim(),
        )
      : payload.qualityControlPlan,
    requiredProposalItems: {
      independence: {
        present: !missing,
        value: missing ? null : "독립성 확인자료 제시",
      },
    },
    missingFields: missing
      ? [
          "recentNonghyupAuditCount",
          "auditedNonghyupTypes",
          "engagementPartner",
          "engagementTeam",
          "totalPlannedHours",
          "partnerHours",
          "auditSchedule",
        ]
      : [],
    warnings: missing
      ? [{
          code: "LOW_CONFIDENCE",
          field: "recentNonghyupAuditCount",
          message: "fixture",
        }]
      : [],
    confidenceByField: {
      accountingFirmName: 100,
      auditFee: 100,
      recentNonghyupAuditCount: missing ? 20 : 90,
    },
    evidenceByField: {},
    source: {
      accountingFirmName: "TRUSTED_SERVER_RECORD",
      auditFee: "TRUSTED_SERVER_RECORD",
      recentNonghyupAuditCount: missing
        ? "DETERMINISTIC_PARSE"
        : "TRUSTED_SERVER_RECORD",
    },
    confirmedByCustomer: true,
    confirmedAt: REPORT_FIXTURE_NOW,
    revision: 1,
    updatedAt: REPORT_FIXTURE_NOW,
    pendingAdminReviewFields: [],
  };
}
