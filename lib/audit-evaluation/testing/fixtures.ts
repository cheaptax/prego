import { normalizeWonAmount } from "@/lib/audit-evaluation/money";
import type {
  EvaluationConfig,
  TrustedStandardQuotePayload,
} from "@/lib/audit-evaluation/types";

export function createValidEvaluationConfig(): EvaluationConfig {
  return {
    id: "fy27.default",
    name: "FY27 감사인 견적 평가",
    version: 1,
    status: "DRAFT",
    effectiveFrom: null,
    effectiveTo: null,
    minimumQuoteCount: 2,
    maximumQuoteCount: 5,
    uploadLimit: 10,
    permittedMimeTypes: ["application/pdf", "image/png"],
    maximumFileSize: 10 * 1024 * 1024,
    criteria: [
      {
        id: "firm-scale",
        name: "회계법인 규모",
        description: "확인된 회계법인 매출액을 비교합니다.",
        weightBasisPoints: 6_000,
        required: true,
        rule: {
          type: "range",
          field: "accountingFirmRevenue",
          bands: [
            {
              id: "firm-scale.small",
              minimumInclusive: null,
              maximumExclusive: {
                kind: "DECIMAL_STRING",
                value: "5000000000",
              },
              scoreBasisPoints: 5_000,
            },
            {
              id: "firm-scale.large",
              minimumInclusive: {
                kind: "DECIMAL_STRING",
                value: "5000000000",
              },
              maximumExclusive: null,
              scoreBasisPoints: 10_000,
            },
          ],
        },
      },
      {
        id: "experience",
        name: "농협 감사 경험",
        description: "최근 농협 감사 경험 보유 여부를 확인합니다.",
        weightBasisPoints: 4_000,
        required: true,
        rule: {
          type: "threshold",
          field: "recentNonghyupAuditCount",
          operator: "GTE",
          threshold: { kind: "INTEGER", value: 1 },
        },
      },
      {
        id: "partner",
        name: "업무수행이사 정보",
        description: "업무수행이사 정보를 참고용으로 표시합니다.",
        weightBasisPoints: 0,
        required: false,
        rule: {
          type: "informational-only",
          field: "engagementPartner",
        },
      },
    ],
    feeAnalysisPolicy: {
      currency: "KRW",
      vatHandling: "PRESERVE_AS_SUBMITTED",
      comparisonMethod: "MEDIAN",
      missingVatPolicy: "NEEDS_REVIEW",
      roundingMode: "HALF_UP",
    },
    requiredFields: [
      "accountingFirmName",
      "auditFee",
      "vatIncluded",
      "recentNonghyupAuditCount",
    ],
    reportSections: [
      {
        id: "summary",
        name: "요약",
        order: 0,
        enabled: true,
        type: "SUMMARY",
      },
      {
        id: "scores",
        name: "평가 결과",
        order: 1,
        enabled: true,
        type: "SCORE_BREAKDOWN",
      },
    ],
    reportPhrases: [
      {
        id: "disclaimer",
        label: "면책 문구",
        text: "본 보고서는 확정된 입력 데이터와 게시된 평가기준을 기준으로 생성됩니다.",
      },
    ],
    retentionPolicy: {
      sourceDocumentDays: 365,
      normalizedDataDays: 365,
      reportDays: 1_825,
      deleteAfterExpiry: false,
    },
    customerAccessPolicy: {
      magicLinkLifetimeMinutes: 30,
      sessionLifetimeMinutes: 480,
      caseLifetimeDays: 30,
      allowUploadWhenNoRegisteredQuotes: true,
    },
    quoteExtractionPolicy: {
      deterministicParserEnabled: true,
      ocrEnabled: false,
      aiExtractionEnabled: false,
      aiPromptVersion: "nhsc-quote-extraction-v1",
    },
    customerCorrectionPolicy: {
      coreFieldChangesRequireAdminReview: false,
    },
    createdBy: "admin-test",
    createdAt: "2026-07-21T00:00:00.000Z",
    publishedBy: null,
    publishedAt: null,
  };
}

export function createTrustedStandardQuotePayload(): TrustedStandardQuotePayload {
  return {
    accountingFirmId: "firm-001",
    accountingFirmName: "테스트 회계법인",
    auditFee: normalizeWonAmount("55000000"),
    vatIncluded: true,
    accountingFirmRevenue: normalizeWonAmount("120000000000"),
    recentNonghyupAuditCount: 8,
    auditedNonghyupTypes: ["지역농협", "품목농협"],
    taxAgencyExperience: {
      hasExperience: true,
      descriptions: ["농협 세무대리 수행"],
    },
    subsidySettlementExperience: {
      hasExperience: true,
      descriptions: ["보조금 정산 검증 수행"],
    },
    engagementPartner: {
      name: "책임 회계사",
      title: "파트너",
      yearsOfExperience: 18,
    },
    engagementTeam: [
      {
        name: "담당 회계사",
        role: "매니저",
        plannedHours: 120,
      },
    ],
    totalPlannedHours: 320,
    partnerHours: 40,
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
        value: "독립성 확인 완료",
      },
    },
  };
}
