import { runDeterministicFeeAnalysis } from "@/lib/audit-evaluation/fee-analysis";
import { normalizedQuoteFromPartnerNhAuditQuote } from "@/lib/audit-evaluation/inbox-report-bridge-core";
import { buildNhAuditReportEvaluationSnapshot } from "@/lib/audit-evaluation/nh-audit-report-snapshot";
import { createDefaultNhAuditCustomerWeightsV2 } from "@/lib/audit-evaluation/nh-audit-v2-schemas";
import {
  NH_AUDIT_COOPERATIVE_TYPES_2025,
  type NhAuditCooperativeType2025,
} from "@/lib/audit-evaluation/nh-audit-v2-types";
import {
  auditEvaluationReportViewModelSchema,
  buildDeterministicReportViewModel,
} from "@/lib/audit-evaluation/report-view-model";
import { runDeterministicQualityScoring } from "@/lib/audit-evaluation/scoring-engine";
import {
  createEvaluationConfigSnapshot,
  createQuoteDataSnapshots,
} from "@/lib/audit-evaluation/snapshots";
import { createPublishedReportConfig } from "@/lib/audit-evaluation/testing/report-fixtures";
import type {
  AuditEvaluationCase,
  EvaluationReportRun,
  NormalizedAuditQuote,
} from "@/lib/audit-evaluation/types";
import type { QuoteRecord } from "@/lib/firebase/schema";
import {
  SAMPLE_AUDIT_REPORT_DOWNLOAD_PATH,
  SAMPLE_AUDIT_REPORT_FILE_NAME,
  SAMPLE_AUDIT_REPORT_PREVIEW_SECTION_IDS,
} from "@/lib/audit-quote/sample-audit-report-public";
import {
  buildTrustedNhAuditSubmissionV2,
  createNhAuditEvaluationSnapshotV2,
} from "@/lib/quotes/nh-audit-quote-server";

export {
  SAMPLE_AUDIT_REPORT_DOWNLOAD_PATH,
  SAMPLE_AUDIT_REPORT_FILE_NAME,
  SAMPLE_AUDIT_REPORT_PREVIEW_SECTION_IDS,
};

const SAMPLE_NOW = "2026-08-18T00:00:00.000Z";
const SAMPLE_CASE_ID = "sample-review-case";
const SAMPLE_REPORT_ID = "sample-review-report";
const SAMPLE_REQUEST_ID = "sample-review-request";
const SAMPLE_CUSTOMER_ID = "sample-customer";
const SAMPLE_COOPERATIVE_ID = "sample-cooperative";
const SAMPLE_COOPERATIVE_NAME = "예시농협";
const SAMPLE_FISCAL_YEAR = 2027;
const SAMPLE_EVALUATION_STANDARD_LABEL = "2027평가기준";

type SampleFirmSpec = {
  readonly id: string;
  readonly name: string;
  readonly partnerName: string;
  readonly auditFeeWon: string;
  readonly auditCount: number;
  readonly cpaCount: number;
  readonly revenueWon: string;
  readonly cooperativeTypes: readonly NhAuditCooperativeType2025[];
  readonly taxAgency: boolean;
  readonly subsidySettlement: boolean;
};

/**
 * 감사보수 최저 830만원, 4개 평균 900만원.
 * 제휴 3곳은 순위가 나뉘도록 수행실적·규모 근거를 다르게 넣는다.
 */
const SAMPLE_FIRMS: readonly SampleFirmSpec[] = [
  {
    id: "sample-affiliate-1",
    name: "제휴회계법인1",
    partnerName: "김민수",
    auditFeeWon: "8300000",
    auditCount: 62,
    cpaCount: 28,
    revenueWon: "15000000000",
    cooperativeTypes: NH_AUDIT_COOPERATIVE_TYPES_2025,
    taxAgency: true,
    subsidySettlement: true,
  },
  {
    id: "sample-affiliate-2",
    name: "제휴회계법인2",
    partnerName: "이서연",
    auditFeeWon: "8700000",
    auditCount: 46,
    cpaCount: 18,
    revenueWon: "9200000000",
    cooperativeTypes: NH_AUDIT_COOPERATIVE_TYPES_2025.slice(0, 3),
    taxAgency: true,
    subsidySettlement: true,
  },
  {
    id: "sample-affiliate-3",
    name: "제휴회계법인3",
    partnerName: "박준호",
    auditFeeWon: "9200000",
    auditCount: 34,
    cpaCount: 14,
    revenueWon: "6500000000",
    cooperativeTypes: NH_AUDIT_COOPERATIVE_TYPES_2025.slice(0, 3),
    taxAgency: true,
    subsidySettlement: true,
  },
  {
    id: "sample-other-1",
    name: "기타회계법인",
    partnerName: "최은정",
    auditFeeWon: "9800000",
    auditCount: 16,
    cpaCount: 9,
    revenueWon: "3200000000",
    cooperativeTypes: NH_AUDIT_COOPERATIVE_TYPES_2025.slice(0, 2),
    taxAgency: true,
    subsidySettlement: false,
  },
];

export function createSampleAuditReportViewModel() {
  const quotes = SAMPLE_FIRMS.map(createSampleQuoteRecord);
  const config = createPublishedReportConfig();
  config.id = "sample-evaluation";
  config.name = "2027 회계감사인 선정 평가";
  const normalizedQuotes = quotes.map((quote) =>
    completeSampleNormalizedQuote(
      normalizedQuoteFromPartnerNhAuditQuote({
        quote,
        caseId: SAMPLE_CASE_ID,
        now: SAMPLE_NOW,
      }),
    ),
  );
  const scoreResult = runDeterministicQualityScoring(config, normalizedQuotes);
  const feeAnalysis = runDeterministicFeeAnalysis(
    config.feeAnalysisPolicy,
    normalizedQuotes.map((quote) => ({
      quoteId: quote.quoteId,
      auditFee: quote.auditFee,
      vatIncluded: quote.vatIncluded,
      totalPlannedHours: quote.totalPlannedHours,
      partnerHours: quote.partnerHours,
    })),
  );
  const evaluationCase: AuditEvaluationCase = {
    id: SAMPLE_CASE_ID,
    quoteRequestId: SAMPLE_REQUEST_ID,
    cooperativeId: SAMPLE_COOPERATIVE_ID,
    cooperativeNameSnapshot: SAMPLE_COOPERATIVE_NAME,
    fiscalYear: SAMPLE_FISCAL_YEAR,
    customerAccessOwner: {
      type: "CAPABILITY_SUBJECT",
      subjectId: SAMPLE_CUSTOMER_ID,
    },
    status: "GENERATING",
    quoteTemplateVersion: null,
    evaluationConfigVersion: { id: config.id, version: config.version },
    latestReportVersion: 1,
    expectedQuoteCount: quotes.length,
    confirmedQuoteCount: quotes.length,
    latestConfirmationVersion: 1,
    confirmationVersion: 1,
    reportRequestedConfirmationVersion: 1,
    expiresAt: "2027-12-31T00:00:00.000Z",
    createdAt: SAMPLE_NOW,
    updatedAt: SAMPLE_NOW,
    completedAt: null,
  };
  const nhAuditEvaluationSnapshot = buildNhAuditReportEvaluationSnapshot({
    reportId: SAMPLE_REPORT_ID,
    evaluationId: SAMPLE_CASE_ID,
    quoteRequestId: SAMPLE_REQUEST_ID,
    customerId: SAMPLE_CUSTOMER_ID,
    quotes,
    weights: createDefaultNhAuditCustomerWeightsV2(),
    now: SAMPLE_NOW,
  });
  const reportRun: EvaluationReportRun = {
    id: SAMPLE_REPORT_ID,
    caseId: evaluationCase.id,
    reportVersion: 1,
    confirmationVersion: 1,
    inputHash: "b".repeat(64),
    status: "GENERATING",
    requestedAt: SAMPLE_NOW,
    generationAttempt: 1,
    generationStartedAt: SAMPLE_NOW,
    generationLeaseExpiresAt: "2026-08-18T00:05:00.000Z",
    evaluationConfigSnapshot: createEvaluationConfigSnapshot(config),
    quoteDataSnapshots: createQuoteDataSnapshots(normalizedQuotes),
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
      subjectId: SAMPLE_CUSTOMER_ID,
    },
    failureCode: null,
    failureMessage: null,
    nhAuditEvaluationSnapshot,
  };
  const viewModel = buildDeterministicReportViewModel({
    reportRun,
    evaluationCase,
    corrections: [],
    generatedAt: SAMPLE_NOW,
  });
  return auditEvaluationReportViewModelSchema.parse({
    ...viewModel,
    metadata: {
      ...viewModel.metadata,
      evaluationStandardVersion: SAMPLE_EVALUATION_STANDARD_LABEL,
    },
    sections: viewModel.sections.filter((section) => section.id !== "appendix"),
  });
}

function createSampleQuoteRecord(firm: SampleFirmSpec): QuoteRecord {
  const trusted = buildTrustedNhAuditSubmissionV2(
    {
      engagementPartnerName: firm.partnerName,
      proposerType: "ACCOUNTING_FIRM",
      auditFeeWon: firm.auditFeeWon,
      expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
      expectedExpenseWon: "0",
      localNonghyupAuditCount2025: firm.auditCount,
      certifiedPublicAccountantCount: firm.cpaCount,
      accountingFirmRevenueWon: firm.revenueWon,
      auditedNonghyupTypes2025: [...firm.cooperativeTypes],
      nonghyupTaxAgencyPerformed2025: firm.taxAgency,
      nonghyupSubsidySettlementPerformed2025: firm.subsidySettlement,
      factsConfirmed: true,
    },
    {
      submissionId: firm.id,
      quoteRequestId: SAMPLE_REQUEST_ID,
      targetCooperativeId: SAMPLE_COOPERATIVE_ID,
      targetCooperativeName: SAMPLE_COOPERATIVE_NAME,
      fiscalYear: SAMPLE_FISCAL_YEAR,
      partnerAccountId: `partner-${firm.id}`,
      accountingFirmName: firm.name,
      submittedAt: SAMPLE_NOW,
    },
  );
  if (!trusted.success) {
    throw new Error(`sample_quote_invalid:${firm.id}`);
  }
  const fee = Number(firm.auditFeeWon);
  return {
    id: firm.id,
    quoteRequestId: SAMPLE_REQUEST_ID,
    quoteAssignmentId: `assignment-${firm.id}`,
    partnerId: `partner-${firm.id}`,
    partnerName: firm.name,
    status: "delivered",
    version: 1,
    customerEmail: "sample@nonghyup.example",
    supplierName: firm.name,
    supplierContactEmail: "partner@example.com",
    lineItems: [],
    subtotal: fee,
    taxAmount: 0,
    totalAmount: fee,
    vatIncluded: true,
    createdBy: SAMPLE_CUSTOMER_ID,
    createdAt: SAMPLE_NOW,
    updatedAt: SAMPLE_NOW,
    nhAuditV2: createNhAuditEvaluationSnapshotV2(trusted.submission, SAMPLE_NOW),
  } as QuoteRecord;
}

function completeSampleNormalizedQuote(
  quote: NormalizedAuditQuote,
): NormalizedAuditQuote {
  const typeLabels: Record<NhAuditCooperativeType2025, string> = {
    LOCAL_AGRICULTURAL_COOPERATIVE: "지역농협",
    LOCAL_LIVESTOCK_COOPERATIVE: "지역축협",
    ITEM_AGRICULTURAL_OR_LIVESTOCK_COOPERATIVE:
      "품목농협·품목축협(원예농협 포함)",
    GINSENG_COOPERATIVE: "인삼농협",
  };
  return {
    ...quote,
    auditedNonghyupTypes: quote.auditedNonghyupTypes.map(
      (value) =>
        typeLabels[value as NhAuditCooperativeType2025] ?? value,
    ),
    engagementTeam: [
      {
        name: "담당 회계사",
        role: "매니저",
        plannedHours: 120,
      },
    ],
    totalPlannedHours: 280,
    partnerHours: 36,
    auditSchedule: [
      {
        id: "planning",
        label: "감사 계획",
        startsOn: "2027-01-10",
        endsOn: "2027-01-20",
      },
    ],
    qualityControlPlan: ["독립 품질관리 검토자가 최종 보고서를 검토합니다."],
    requiredProposalItems: {
      independence: {
        present: true,
        value: "독립성 확인자료 제시",
      },
    },
  };
}
