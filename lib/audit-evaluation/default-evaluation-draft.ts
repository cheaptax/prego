import { evaluationConfigSchema } from "@/lib/audit-evaluation/schemas";
import type {
  EvaluationConfig,
  RangeRule,
  RuleComparableValue,
} from "@/lib/audit-evaluation/types";

export const DEFAULT_AUDIT_QUALITY_DRAFT_ID =
  "audit-quality.default-draft.v1";

export function createDefaultAuditQualityDraft(input: {
  createdBy: string;
  createdAt: string;
}): EvaluationConfig {
  return evaluationConfigSchema.parse({
    id: DEFAULT_AUDIT_QUALITY_DRAFT_ID,
    name: "감사인 품질평가 100점 기준 초안",
    version: 1,
    status: "DRAFT",
    effectiveFrom: null,
    effectiveTo: null,
    minimumQuoteCount: 2,
    maximumQuoteCount: 10,
    uploadLimit: 10,
    permittedMimeTypes: ["application/pdf"],
    maximumFileSize: 10 * 1024 * 1024,
    criteria: [
      {
        id: "nonghyup-audit-performance",
        name: "농협 감사 수행실적",
        description: "최근 농협 감사건수와 수행 농협 종류의 다양성을 평가합니다.",
        weightBasisPoints: 4_000,
        required: true,
        rule: {
          type: "weighted-subcriteria",
          subcriteria: [
            {
              id: "recent-nonghyup-audit-count",
              name: "최근 농협 감사건수",
              relativeWeightBasisPoints: 6_000,
              rule: integerRange(
                "recentNonghyupAuditCount",
                [
                  [null, 10, 0],
                  [10, 30, 1_000],
                  [30, 50, 5_000],
                  [50, null, 10_000],
                ],
              ),
            },
            {
              id: "audited-nonghyup-type-diversity",
              name: "감사 수행 농협 종류의 다양성",
              relativeWeightBasisPoints: 4_000,
              rule: integerRange(
                "auditedNonghyupTypes",
                [
                  [null, 2, 0],
                  [2, 3, 1_000],
                  [3, 4, 5_000],
                  [4, null, 10_000],
                ],
              ),
            },
          ],
        },
      },
      {
        id: "nonghyup-business-understanding",
        name: "농협 업무 이해도",
        description: "농협 세무대리와 보조금 정산 경험을 평가합니다.",
        weightBasisPoints: 2_000,
        required: true,
        rule: {
          type: "weighted-subcriteria",
          subcriteria: [
            {
              id: "tax-agency-experience",
              name: "농협 세무대리 경험",
              relativeWeightBasisPoints: 5_000,
              rule: {
                type: "boolean",
                field: "taxAgencyExperience",
                expected: true,
              },
            },
            {
              id: "subsidy-settlement-experience",
              name: "농협 보조금 정산 경험",
              relativeWeightBasisPoints: 5_000,
              rule: {
                type: "boolean",
                field: "subsidySettlementExperience",
                expected: true,
              },
            },
          ],
        },
      },
      {
        id: "audit-plan-and-staffing",
        name: "감사 수행계획 및 투입인력",
        description:
          "관리자가 게시 전에 체크리스트 항목과 항목별 배점을 구성해야 합니다.",
        weightBasisPoints: 2_000,
        required: true,
        rule: {
          type: "checklist",
          field: "engagementTeam",
          items: [],
        },
      },
      {
        id: "accounting-firm-scale",
        name: "회계법인 규모",
        description: "원 단위로 정규화된 회계법인 매출액을 평가합니다.",
        weightBasisPoints: 1_000,
        required: true,
        rule: decimalRange(
          "accountingFirmRevenue",
          [
            [null, "3000000000", 0],
            ["3000000000", "5000000000", 3_000],
            ["5000000000", "10000000000", 5_000],
            ["10000000000", null, 10_000],
          ],
        ),
      },
      {
        id: "proposal-completeness",
        name: "제안서 충실성",
        description:
          "관리자가 게시 전에 필수 제안항목과 항목별 배점을 구성해야 합니다.",
        weightBasisPoints: 1_000,
        required: true,
        rule: {
          type: "checklist",
          field: "requiredProposalItems",
          items: [],
        },
      },
    ],
    feeAnalysisPolicy: {
      currency: "KRW",
      vatHandling: "PRESERVE_AS_SUBMITTED",
      comparisonMethod: "MEDIAN",
      missingVatPolicy: "NEEDS_REVIEW",
      roundingMode: "HALF_UP",
      twoQuoteMedianPolicy: "MIDPOINT",
    },
    requiredFields: [
      "accountingFirmName",
      "auditFee",
      "vatIncluded",
      "accountingFirmRevenue",
      "recentNonghyupAuditCount",
      "auditedNonghyupTypes",
      "taxAgencyExperience",
      "subsidySettlementExperience",
    ],
    reportSections: [
      {
        id: "cover",
        name: "표지",
        order: 0,
        enabled: true,
        type: "COVER",
      },
      {
        id: "purpose-scope",
        name: "보고서 목적과 범위",
        order: 1,
        enabled: true,
        type: "PURPOSE_SCOPE",
      },
      {
        id: "executive-summary",
        name: "핵심 요약",
        order: 2,
        enabled: true,
        type: "EXECUTIVE_SUMMARY",
      },
      {
        id: "quote-comparison",
        name: "견적 비교표",
        order: 3,
        enabled: true,
        type: "QUOTE_COMPARISON",
      },
      {
        id: "score-breakdown",
        name: "정량 평가결과",
        order: 4,
        enabled: true,
        type: "SCORE_BREAKDOWN",
      },
      {
        id: "capability-analysis",
        name: "감사 수행역량 분석",
        order: 5,
        enabled: true,
        type: "CAPABILITY_ANALYSIS",
      },
      {
        id: "fee-analysis",
        name: "감사보수 적정성 분석",
        order: 6,
        enabled: true,
        type: "FEE_ANALYSIS",
      },
      {
        id: "firm-review",
        name: "회계법인별 강점 및 검토사항",
        order: 7,
        enabled: true,
        type: "FIRM_REVIEW",
      },
      {
        id: "overall-opinion",
        name: "종합 검토의견",
        order: 8,
        enabled: true,
        type: "OVERALL_OPINION",
      },
      {
        id: "appendix",
        name: "부록",
        order: 9,
        enabled: true,
        type: "APPENDIX",
      },
    ],
    reportPhrases: [
      {
        id: "decision-support",
        label: "의사결정 안내",
        text:
          "품질평가와 감사보수 분석은 분리하여 제공하며 최종 선임 판단과 의사결정은 해당 농협이 수행합니다.",
      },
      {
        id: "report-purpose",
        label: "보고서 목적",
        text:
          "확정된 견적자료를 동일 기준으로 비교하고 정량 평가결과와 감사보수 분석을 제공하는 의사결정 지원자료입니다.",
      },
      {
        id: "no-lowest-price-recommendation",
        label: "최저가 비추천 안내",
        text:
          "감사보수가 가장 낮다는 이유만으로 특정 회계법인을 추천하지 않습니다.",
      },
      {
        id: "confirmed-data-only",
        label: "확정자료 사용 안내",
        text:
          "본 보고서는 고객이 최종 확인한 데이터와 게시된 평가기준만 사용합니다.",
      },
    ],
    retentionPolicy: {
      sourceDocumentDays: 365,
      normalizedDataDays: 365,
      reportDays: 1_825,
      expiredAccessTokenDays: 30,
      auditLogDays: 2_555,
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
    reportRenderingPolicy: {
      watermarkEnabled: false,
      watermarkText: "농협지원센터",
      downloadUrlLifetimeSeconds: 60,
      reportTitle: "감사인 선임 검토보고서",
      centerContact: "농협지원센터",
      logoAssetId: null,
      primaryColor: "#1F5D42",
      accentColor: "#D8A93A",
      fileNameRule: "FISCAL_YEAR_VERSION",
      customerDownloadDays: 30,
    },
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    publishedBy: null,
    publishedAt: null,
  });
}

function integerRange(
  field: RangeRule["field"],
  definitions: ReadonlyArray<
    readonly [number | null, number | null, number]
  >,
): RangeRule {
  return rangeRule(
    field,
    definitions.map(([minimum, maximum, score], index) => [
      minimum === null ? null : integerValue(minimum),
      maximum === null ? null : integerValue(maximum),
      score,
      index,
    ]),
  );
}

function decimalRange(
  field: RangeRule["field"],
  definitions: ReadonlyArray<
    readonly [string | null, string | null, number]
  >,
): RangeRule {
  return rangeRule(
    field,
    definitions.map(([minimum, maximum, score], index) => [
      minimum === null ? null : decimalValue(minimum),
      maximum === null ? null : decimalValue(maximum),
      score,
      index,
    ]),
  );
}

function rangeRule(
  field: RangeRule["field"],
  definitions: ReadonlyArray<
    readonly [
      RuleComparableValue | null,
      RuleComparableValue | null,
      number,
      number,
    ]
  >,
): RangeRule {
  return {
    type: "range",
    field,
    bands: definitions.map(([minimum, maximum, score, index]) => ({
      id: `${field}.band-${index + 1}`,
      minimumInclusive: minimum,
      maximumExclusive: maximum,
      scoreBasisPoints: score,
    })),
  };
}

function integerValue(value: number): RuleComparableValue {
  return { kind: "INTEGER", value };
}

function decimalValue(value: string): RuleComparableValue {
  return { kind: "DECIMAL_STRING", value };
}
