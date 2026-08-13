import { z } from "zod";
import { formatExactScoreOneDecimal } from "@/lib/audit-evaluation/nh-audit-v2-engine";
import type {
  NhAuditReportEvaluationSnapshot,
  NhAuditReportQuoteResultSnapshot,
} from "@/lib/audit-evaluation/nh-audit-report-snapshot";
import type {
  AuditEvaluationCase,
  AuditQuoteCorrectionRecord,
  CriterionScoreResult,
  EvaluationConfigSnapshot,
  EvaluationReportRun,
  NormalizedAuditQuoteField,
  QuoteDataSnapshot,
  QuoteEvidenceValue,
  QuoteFeeAnalysis,
  QuoteScoreResult,
} from "@/lib/audit-evaluation/types";

export const REPORT_VIEW_MODEL_SCHEMA_VERSION = 1 as const;

export const REPORT_SECTION_IDS = [
  "cover",
  "purpose-scope",
  "executive-summary",
  "quote-comparison",
  "quantitative-evaluation",
  "capability-analysis",
  "fee-analysis",
  "firm-review",
  "overall-opinion",
  "appendix",
] as const;

export type ReportSectionId = (typeof REPORT_SECTION_IDS)[number];

export type ReportKeyValuesBlockViewModel = {
  id: string;
  type: "KEY_VALUES";
  title: string;
  items: Array<{ label: string; value: string }>;
};

export type ReportTableBlockViewModel = {
  id: string;
  type: "TABLE";
  title: string;
  columns: string[];
  rows: string[][];
};

export type ReportBulletsBlockViewModel = {
  id: string;
  type: "BULLETS";
  title: string;
  items: string[];
};

export type ReportParagraphsBlockViewModel = {
  id: string;
  type: "PARAGRAPHS";
  title: string;
  paragraphs: string[];
};

export type AuditEvaluationReportBlockViewModel =
  | ReportKeyValuesBlockViewModel
  | ReportTableBlockViewModel
  | ReportBulletsBlockViewModel
  | ReportParagraphsBlockViewModel;

export type ReportBlockViewModel = AuditEvaluationReportBlockViewModel;

export type AuditEvaluationReportSectionViewModel = {
  id: ReportSectionId;
  title: string;
  order: number;
  blocks: AuditEvaluationReportBlockViewModel[];
};

export type ReportSectionViewModel = AuditEvaluationReportSectionViewModel;

export type AuditEvaluationReportFactViewModel = {
  id: string;
  sectionId: ReportSectionId;
  text: string;
};

export type ReportFactViewModel = AuditEvaluationReportFactViewModel;

export type AuditEvaluationReportViewModel = {
  schemaVersion: typeof REPORT_VIEW_MODEL_SCHEMA_VERSION;
  metadata: {
    case: { id: string };
    report: { id: string };
    version: number;
    config: { id: string; name: string; version: number };
    cooperative: { id: string | null; name: string };
    fiscalYear: number;
    generatedAt: string;
    finalizedAt?: string;
    evaluationStandardVersion?: string;
    center: string;
    reportTitle: string;
    centerContact: string;
    branding: {
      primaryColor: string;
      accentColor: string;
      logoDataUri: string | null;
    };
    downloadFilename: string;
    watermark: { enabled: boolean; text: string };
  };
  sections: AuditEvaluationReportSectionViewModel[];
  facts: AuditEvaluationReportFactViewModel[];
  narrative: {
    mode: "TEMPLATE" | "AI_ASSISTED";
    paragraphs: Array<{
      sectionId: ReportSectionId;
      text: string;
      factIds: string[];
    }>;
  };
};

const DISPLAY_STRING_MAX = 500_000;
const EXTERNAL_STRING_MAX = 4_000;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const FACT_ID = /^fact-[0-9]{4,}$/;
const SAFE_HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const SAFE_LOGO_DATA_URI =
  /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_LOGO_DATA_URI_LENGTH = 2_800_000;
const FALLBACK_REPORT_TITLE = "감사인 견적 평가보고서";
const FALLBACK_CENTER = "농협지원센터";
const FALLBACK_PRIMARY_COLOR = "#1B5E3B";
const FALLBACK_ACCENT_COLOR = "#174C32";

const displayStringSchema = z
  .string()
  .min(1)
  .max(DISPLAY_STRING_MAX)
  .refine((value) => !hasControlCharacters(value), {
    message: "Control characters are not allowed.",
  });
/** 표 셀은 좌측 병합(rowspan)용 빈칸을 허용 */
const tableCellStringSchema = z
  .string()
  .max(DISPLAY_STRING_MAX)
  .refine((value) => !hasControlCharacters(value), {
    message: "Control characters are not allowed.",
  });
const idSchema = z.string().regex(SAFE_ID);
const keyValueBlockSchema = z
  .object({
    id: idSchema,
    type: z.literal("KEY_VALUES"),
    title: displayStringSchema,
    items: z
      .array(
        z
          .object({
            label: displayStringSchema,
            value: displayStringSchema,
          })
          .strict(),
      )
      .max(1_000),
  })
  .strict();
const tableBlockSchema = z
  .object({
    id: idSchema,
    type: z.literal("TABLE"),
    title: displayStringSchema,
    columns: z.array(displayStringSchema).min(1).max(100),
    rows: z.array(z.array(tableCellStringSchema).max(100)).max(20_000),
  })
  .strict()
  .superRefine((block, context) => {
    block.rows.forEach((row, index) => {
      if (row.length !== block.columns.length) {
        context.addIssue({
          code: "custom",
          path: ["rows", index],
          message: "Table row width must match its columns.",
        });
      }
    });
  });
const bulletsBlockSchema = z
  .object({
    id: idSchema,
    type: z.literal("BULLETS"),
    title: displayStringSchema,
    items: z.array(displayStringSchema).max(20_000),
  })
  .strict();
const paragraphsBlockSchema = z
  .object({
    id: idSchema,
    type: z.literal("PARAGRAPHS"),
    title: displayStringSchema,
    paragraphs: z.array(displayStringSchema).max(20_000),
  })
  .strict();
const blockSchema = z.discriminatedUnion("type", [
  keyValueBlockSchema,
  tableBlockSchema,
  bulletsBlockSchema,
  paragraphsBlockSchema,
]);
const sectionSchema = z
  .object({
    id: z.enum(REPORT_SECTION_IDS),
    title: displayStringSchema,
    order: z.number().int().min(0).max(1_000),
    blocks: z.array(blockSchema).min(1).max(100),
  })
  .strict();

export const auditEvaluationReportViewModelSchema: z.ZodType<
  AuditEvaluationReportViewModel
> = z
  .object({
    schemaVersion: z.literal(REPORT_VIEW_MODEL_SCHEMA_VERSION),
    metadata: z
      .object({
        case: z.object({ id: idSchema }).strict(),
        report: z.object({ id: idSchema }).strict(),
        version: z.number().int().positive(),
        config: z
          .object({
            id: idSchema,
            name: displayStringSchema,
            version: z.number().int().positive(),
          })
          .strict(),
        cooperative: z
          .object({
            id: idSchema.nullable(),
            name: displayStringSchema,
          })
          .strict(),
        fiscalYear: z.number().int().min(2_000).max(9_999),
        generatedAt: z.string().datetime({ offset: true }),
        finalizedAt: z.string().datetime({ offset: true }).optional(),
        evaluationStandardVersion: displayStringSchema.max(128).optional(),
        center: displayStringSchema,
        reportTitle: displayStringSchema.max(120)
          .default(FALLBACK_REPORT_TITLE),
        centerContact: displayStringSchema.max(500)
          .default(FALLBACK_CENTER),
        branding: z
          .object({
            primaryColor: z.string().regex(SAFE_HEX_COLOR)
              .default(FALLBACK_PRIMARY_COLOR),
            accentColor: z.string().regex(SAFE_HEX_COLOR)
              .default(FALLBACK_ACCENT_COLOR),
            logoDataUri: z
              .string()
              .max(MAX_LOGO_DATA_URI_LENGTH)
              .regex(SAFE_LOGO_DATA_URI)
              .nullable()
              .default(null),
          })
          .strict()
          .default({
            primaryColor: FALLBACK_PRIMARY_COLOR,
            accentColor: FALLBACK_ACCENT_COLOR,
            logoDataUri: null,
          }),
        downloadFilename: z
          .string()
          .regex(
            /^(?:audit-evaluation-report-(?:(?:[\p{L}\p{N}][\p{L}\p{N}._-]{0,47}-)?FY[0-9]{4}|case-[a-zA-Z0-9][a-zA-Z0-9._-]{0,63})-v[0-9]+\.pdf|[\p{L}\p{N}][\p{L}\p{N} ._-]{0,79}_FY[0-9]{4} 감사인견적평가보고서(?:_v[1-9][0-9]*)?\.pdf)$/u,
          ),
        watermark: z
          .object({
            enabled: z.boolean(),
            text: displayStringSchema,
          })
          .strict(),
      })
      .strict(),
    sections: z.array(sectionSchema).min(4).max(REPORT_SECTION_IDS.length),
    facts: z
      .array(
        z
          .object({
            id: z.string().regex(FACT_ID),
            sectionId: z.enum(REPORT_SECTION_IDS),
            text: displayStringSchema,
          })
          .strict(),
      )
      .max(100_000),
    narrative: z
      .object({
        mode: z.enum(["TEMPLATE", "AI_ASSISTED"]),
        paragraphs: z
          .array(
            z
              .object({
                sectionId: z.enum(REPORT_SECTION_IDS),
                text: displayStringSchema,
                factIds: z.array(z.string().regex(FACT_ID)).min(1).max(100),
              })
              .strict(),
          )
          .max(1_000),
      })
      .strict(),
  })
  .strict()
  .superRefine((viewModel, context) => {
    const sectionIds = viewModel.sections.map(({ id }) => id);
    for (const expected of MANDATORY_REPORT_SECTION_IDS) {
      if (!sectionIds.includes(expected)) {
        context.addIssue({
          code: "custom",
          path: ["sections"],
          message: `Mandatory section ${expected} is missing.`,
        });
      }
    }
    if (new Set(sectionIds).size !== sectionIds.length) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Report section IDs must be unique.",
      });
    }
    viewModel.facts.forEach((fact, index) => {
      const expected = `fact-${String(index + 1).padStart(4, "0")}`;
      if (fact.id !== expected || !sectionIds.includes(fact.sectionId)) {
        context.addIssue({
          code: "custom",
          path: ["facts", index],
          message: "Facts must use contiguous IDs and a valid section ID.",
        });
      }
    });
    const factIds = new Set(viewModel.facts.map(({ id }) => id));
    viewModel.narrative.paragraphs.forEach((paragraph, index) => {
      if (paragraph.factIds.some((id) => !factIds.has(id))) {
        context.addIssue({
          code: "custom",
          path: ["narrative", "paragraphs", index, "factIds"],
          message: "Narrative paragraphs must cite existing facts.",
        });
      }
    });
  });

export class ReportViewModelError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ReportViewModelError";
    this.code = code;
  }
}

export type BuildDeterministicReportViewModelInput = {
  reportRun: EvaluationReportRun;
  evaluationCase: AuditEvaluationCase;
  corrections: readonly AuditQuoteCorrectionRecord[];
  generatedAt: string;
  resolvedLogoDataUri?: string | null;
};

const SECTION_CONFIG_TYPES: Record<ReportSectionId, string> = {
  cover: "COVER",
  "purpose-scope": "PURPOSE_SCOPE",
  "executive-summary": "EXECUTIVE_SUMMARY",
  "quote-comparison": "QUOTE_COMPARISON",
  "quantitative-evaluation": "SCORE_BREAKDOWN",
  "capability-analysis": "CAPABILITY_ANALYSIS",
  "fee-analysis": "FEE_ANALYSIS",
  "firm-review": "FIRM_REVIEW",
  "overall-opinion": "OVERALL_OPINION",
  appendix: "APPENDIX",
};

const FALLBACK_SECTION_TITLES: Record<ReportSectionId, string> = {
  cover: "감사인 견적 평가보고서",
  "purpose-scope": "보고서 목적과 범위",
  "executive-summary": "핵심 요약",
  "quote-comparison": "견적 비교표",
  "quantitative-evaluation": "정량 평가결과",
  "capability-analysis": "감사 수행역량 분석",
  "fee-analysis": "감사보수 적정성 분석",
  "firm-review": "회계법인별 강점 및 검토사항",
  "overall-opinion": "계산 방법",
  appendix: "부록",
};

const MANDATORY_REPORT_SECTION_IDS = [
  "cover",
  "purpose-scope",
  "overall-opinion",
] as const satisfies readonly ReportSectionId[];

const FIELD_LABELS: Record<NormalizedAuditQuoteField, string> = {
  accountingFirmId: "회계법인 식별정보",
  accountingFirmName: "회계법인명",
  auditFee: "감사보수",
  vatIncluded: "부가가치세 포함 여부",
  accountingFirmRevenue: "회계법인 매출액",
  recentNonghyupAuditCount: "최근 농협 감사건수",
  auditedNonghyupTypes: "감사 수행 농협 종류",
  taxAgencyExperience: "농협 세무대리 경험",
  subsidySettlementExperience: "농협 보조금 정산 경험",
  engagementPartner: "업무수행이사",
  engagementTeam: "투입인력",
  totalPlannedHours: "총 예정시간",
  partnerHours: "업무수행이사 예정시간",
  auditSchedule: "감사 일정",
  qualityControlPlan: "품질관리계획",
  requiredProposalItems: "필수 제안항목",
};

export function buildDeterministicReportViewModel(
  input: BuildDeterministicReportViewModelInput,
): AuditEvaluationReportViewModel {
  const { reportRun, evaluationCase, generatedAt } = input;
  assertBuildInput(input);
  const config = reportRun.evaluationConfigSnapshot;
  const quotes = [...reportRun.quoteDataSnapshots].sort((left, right) =>
    compareText(left.quoteId, right.quoteId)
  );
  const quoteById = new Map(quotes.map((quote) => [quote.quoteId, quote]));
  const scoreById = new Map(
    reportRun.scoreResult!.quotes.map((score) => [score.quoteId, score]),
  );
  const feeById = new Map(
    reportRun.feeAnalysis!.quotes.map((fee) => [fee.quoteId, fee]),
  );
  const corrections = validateAndSortCorrections(
    input.corrections,
    evaluationCase.id,
    quoteById,
  );
  const rendering = resolveRenderingMetadata(
    config,
    input.resolvedLogoDataUri,
  );
  const sectionPresentation = resolveSectionPresentation(
    config,
    rendering.reportTitle,
  );
  const context: BuildContext = {
    reportRun,
    evaluationCase,
    config,
    quotes,
    scoreById,
    feeById,
    corrections,
    generatedAt,
    reportTitle: rendering.reportTitle,
    centerContact: rendering.centerContact,
  };
  const sectionBuilders: Record<
    ReportSectionId,
    (context: BuildContext) => AuditEvaluationReportBlockViewModel[]
  > = {
    cover: buildCoverBlocks,
    "purpose-scope": buildPurposeScopeBlocks,
    "executive-summary": buildExecutiveSummaryBlocks,
    "quote-comparison": buildQuoteComparisonBlocks,
    "quantitative-evaluation": buildQuantitativeEvaluationBlocks,
    "capability-analysis": buildCapabilityAnalysisBlocks,
    "fee-analysis": buildFeeAnalysisBlocks,
    "firm-review": buildFirmReviewBlocks,
    "overall-opinion": buildOverallOpinionBlocks,
    appendix: buildAppendixBlocks,
  };
  const sections = REPORT_SECTION_IDS
    .filter((id) => {
      if (!sectionPresentation[id].enabled) return false;
      // NH 감사 평가보고서: 부록 전체 삭제
      if (reportRun.nhAuditEvaluationSnapshot && id === "appendix") {
        return false;
      }
      return true;
    })
    .map((id) => ({
      id,
      title:
        nhAuditSectionTitle(
          id,
          sectionPresentation[id].title,
          Boolean(reportRun.nhAuditEvaluationSnapshot),
        ),
      order: sectionPresentation[id].order,
      blocks: reportRun.nhAuditEvaluationSnapshot
        ? buildNhAuditSectionBlocks(id, context, sectionBuilders[id])
        : sectionBuilders[id](context),
    })).sort((left, right) =>
    left.order - right.order || compareText(left.id, right.id)
  );
  const metadata: AuditEvaluationReportViewModel["metadata"] = {
    case: { id: reportRun.caseId },
    report: { id: reportRun.id },
    version: reportRun.reportVersion,
    config: {
      id: config.id,
      name: cleanExternalText(config.name),
      version: config.version,
    },
    cooperative: {
      id: evaluationCase.cooperativeId,
      name: displayOrUnknown(evaluationCase.cooperativeNameSnapshot),
    },
    fiscalYear: evaluationCase.fiscalYear,
    generatedAt,
    finalizedAt:
      reportRun.nhAuditEvaluationSnapshot?.createdAt ?? generatedAt,
    evaluationStandardVersion:
      reportRun.nhAuditEvaluationSnapshot?.evaluationStandardVersion ??
      `${config.id}-v${config.version}`,
    center: FALLBACK_CENTER,
    reportTitle: rendering.reportTitle,
    centerContact: rendering.centerContact,
    branding: {
      primaryColor: rendering.primaryColor,
      accentColor: rendering.accentColor,
      logoDataUri: rendering.logoDataUri,
    },
    downloadFilename: safeReportDownloadFilename(
      evaluationCase.fiscalYear,
      reportRun.reportVersion,
      config.reportRenderingPolicy?.fileNameRule,
      evaluationCase.id,
      evaluationCase.cooperativeNameSnapshot,
    ),
    watermark: {
      enabled: config.reportRenderingPolicy?.watermarkEnabled ?? false,
      text: displayOrUnknown(
        config.reportRenderingPolicy?.watermarkText ?? "농협지원센터",
      ),
    },
  };
  const facts = createFacts(sections);
  const candidate: AuditEvaluationReportViewModel = {
    schemaVersion: REPORT_VIEW_MODEL_SCHEMA_VERSION,
    metadata,
    sections,
    facts,
    narrative: { mode: "TEMPLATE", paragraphs: [] },
  };
  const violations = scanForbiddenReportPhrases(allStrings(candidate));
  if (violations.length > 0) {
    throw new ReportViewModelError("forbidden_report_phrase");
  }
  try {
    return auditEvaluationReportViewModelSchema.parse(candidate);
  } catch {
    throw new ReportViewModelError("invalid_report_view_model");
  }
}

export function rebuildNhAuditReportViewModel(input: {
  reportRun: EvaluationReportRun;
  evaluationCase: AuditEvaluationCase;
  storedViewModel?: AuditEvaluationReportViewModel | null;
}): AuditEvaluationReportViewModel {
  const stored = input.storedViewModel ?? null;
  const rebuilt = buildDeterministicReportViewModel({
    reportRun: {
      ...input.reportRun,
      status: "GENERATING",
    },
    evaluationCase: input.evaluationCase,
    corrections: [],
    generatedAt:
      stored?.metadata.generatedAt ??
      input.reportRun.generatedAt ??
      new Date().toISOString(),
    resolvedLogoDataUri: stored?.metadata.branding.logoDataUri,
  });
  if (!stored) return rebuilt;
  return auditEvaluationReportViewModelSchema.parse({
    ...rebuilt,
    metadata: {
      ...rebuilt.metadata,
      branding: stored.metadata.branding,
      generatedAt: stored.metadata.generatedAt,
      finalizedAt: stored.metadata.finalizedAt ?? rebuilt.metadata.finalizedAt,
    },
    narrative: stored.narrative,
  });
}

export function parseAuditEvaluationReportViewModel(
  value: unknown,
): AuditEvaluationReportViewModel {
  try {
    const parsed = auditEvaluationReportViewModelSchema.parse(value);
    if (scanForbiddenReportPhrases(allStrings(parsed)).length > 0) {
      throw new ReportViewModelError("forbidden_report_phrase");
    }
    return parsed;
  } catch (error) {
    if (error instanceof ReportViewModelError) throw error;
    throw new ReportViewModelError("invalid_report_view_model");
  }
}

export function scanForbiddenReportPhrases(
  strings: readonly string[],
): string[] {
  const violations: string[] = [];
  for (const value of strings) {
    const candidate = stripAllowedRecommendationLanguage(
      value.replace(CONTROL_CHARACTERS, ""),
    );
    if (
      /부\s*적격/i.test(candidate) ||
      /무\s*조건/i.test(candidate) ||
      /반드시\s*(?:선임|선정)/i.test(candidate) ||
      /(?:독립성)\s*(?:에\s*)?(?:문제|우려)\s*(?:가\s*)?없/i.test(candidate) ||
      /(?:최고|최적)(?:의|인)?\s*(?:감사인|회계법인|선택|후보|업체)/i.test(candidate) ||
      /추천/i.test(candidate)
    ) {
      if (!violations.includes(value)) violations.push(value);
    }
  }
  return violations;
}

export function safeReportDownloadFilename(
  fiscalYear: number,
  version: number,
  rule: "FISCAL_YEAR_VERSION" | "CASE_VERSION" = "FISCAL_YEAR_VERSION",
  caseId?: string,
  cooperativeName?: string,
): string {
  if (
    !Number.isInteger(fiscalYear) ||
    fiscalYear < 2_000 ||
    fiscalYear > 9_999 ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    throw new ReportViewModelError("invalid_download_filename_input");
  }
  const cooperativeLabel = sanitizeReportFileNameSegment(
    cooperativeName,
    "농협",
  );
  if (cooperativeName?.trim()) {
    const koreanBase = `${cooperativeLabel}_FY${fiscalYear} 감사인견적평가보고서`;
    return `${version > 1 ? `${koreanBase}_v${version}` : koreanBase}.pdf`;
  }
  if (
    rule !== "FISCAL_YEAR_VERSION" &&
    rule !== "CASE_VERSION"
  ) {
    throw new ReportViewModelError("invalid_download_filename_input");
  }
  if (rule === "CASE_VERSION") {
    if (
      typeof caseId !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(caseId)
    ) {
      throw new ReportViewModelError("invalid_download_filename_input");
    }
    return `audit-evaluation-report-case-${caseId}-v${version}.pdf`;
  }
  return `audit-evaluation-report-FY${fiscalYear}-v${version}.pdf`;
}

function sanitizeReportFileNameSegment(
  value: string | undefined,
  fallback: string,
) {
  const cleaned = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

type BuildContext = {
  reportRun: EvaluationReportRun;
  evaluationCase: AuditEvaluationCase;
  config: EvaluationConfigSnapshot;
  quotes: QuoteDataSnapshot[];
  scoreById: Map<string, QuoteScoreResult>;
  feeById: Map<string, QuoteFeeAnalysis>;
  corrections: AuditQuoteCorrectionRecord[];
  generatedAt: string;
  reportTitle: string;
  centerContact: string;
};

function buildCoverBlocks(context: BuildContext) {
  const snapshot = context.reportRun.nhAuditEvaluationSnapshot;
  return [
    keyValues("cover-metadata", "보고서 정보", [
      ["제목", context.reportTitle],
      ["농협명", displayOrUnknown(context.evaluationCase.cooperativeNameSnapshot)],
      ["사업연도", `${context.evaluationCase.fiscalYear}년`],
      [
        snapshot ? "확정일시" : "작성일",
        snapshot
          ? formatReportInstant(snapshot.createdAt)
          : context.generatedAt.slice(0, 10),
      ],
    ]),
  ];
}

function buildPurposeScopeBlocks(context: BuildContext) {
  const snapshot = context.reportRun.nhAuditEvaluationSnapshot;
  if (snapshot) {
    return [
      keyValues("purpose-scope-basis", "비교 범위와 기준", [
        ["수집 견적", `${snapshot.quoteResults.length}개`],
        ["적격 비교대상", `${snapshot.includedQuoteIds.length}개 회계법인`],
        ["사용 자료", "회계법인이 제공한 견적서"],
        [
          "총비용기준",
          "VAT와 예상 제경비를 포함한 예상 총부담액",
        ],
      ]),
    ];
  }
  const phrases = [...context.config.reportPhrases]
    .sort((left, right) => compareText(left.id, right.id))
    .map(({ label, text }) =>
      `${cleanExternalText(label)}: ${cleanExternalText(text)}`
    );
  return [
    keyValues("purpose-scope-basis", "비교 범위와 기준", [
      ["비교대상", `고객 확정 견적 ${context.quotes.length}개 회계법인`],
      ["사용 자료", "고객이 최종 확인한 견적 스냅샷"],
      [
        "평가기준 버전",
        `${cleanExternalText(context.config.name)} v${context.config.version}`,
      ],
      [
        "지원자료 성격",
        "품질평가와 감사보수 분석을 분리하여 제시하는 의사결정 지원자료",
      ],
    ]),
    bullets(
      "purpose-scope-phrases",
      "게시된 보고서 안내문",
      phrases.length > 0 ? phrases : ["추가 게시 안내문 없음"],
    ),
  ];
}

function buildExecutiveSummaryBlocks(context: BuildContext) {
  const rankedScores = orderedScores(context);
  const ranking = rankedScores.map((score) => {
    const quote = quoteFor(context, score.quoteId);
    return [
      displayOrUnknown(quote.accountingFirmName),
      `${score.rank}위`,
      formatBasisPoints(score.totalScoreBasisPoints),
      score.tiedWithQuoteIds.length > 0
        ? score.tiedWithQuoteIds
          .map((id) => displayOrUnknown(quoteFor(context, id).accountingFirmName))
          .join(", ")
        : "동점 없음",
    ];
  });
  const scores = rankedScores.map(({ totalScoreBasisPoints }) =>
    totalScoreBasisPoints
  );
  const fee = context.reportRun.feeAnalysis!;
  const importantReviews = rankedScores.flatMap((score) =>
    score.reviewItems.map((item) =>
      `${displayOrUnknown(quoteFor(context, score.quoteId).accountingFirmName)}: ${mapReviewItem(item)}`
    )
  );
  return [
    keyValues("executive-summary-key-values", "핵심 현황", [
      ["비교 회사 수", `${context.quotes.length}개`],
      [
        "정량 점수 차이",
        scores.length > 0
          ? `${formatBasisPoints(Math.max(...scores) - Math.min(...scores))}`
          : "미확인",
      ],
      [
        "감사보수 범위",
        `${formatWon(fee.minimumWon)} ~ ${formatWon(fee.maximumWon)}`,
      ],
      [
        "중요 검토항목 수",
        `${importantReviews.length + fee.comparisonWarnings.length}건`,
      ],
    ]),
    table(
      "executive-summary-ranking",
      "품질평가 순위와 동점",
      ["회계법인", "순위", "총점", "동점"],
      ranking,
    ),
    bullets(
      "executive-summary-review",
      "주요 차이와 중요 검토사항",
      [
        `정량 점수 상단과 하단의 차이는 ${scores.length > 0 ? formatBasisPoints(Math.max(...scores) - Math.min(...scores)) : "미확인"}입니다.`,
        `정규화 감사보수 범위는 ${formatWon(fee.minimumWon)}부터 ${formatWon(fee.maximumWon)}까지입니다.`,
        ...(importantReviews.length > 0
          ? importantReviews
          : ["정량 평가에서 별도 중요 검토항목이 확인되지 않았습니다."]),
        ...fee.comparisonWarnings.map(mapFeeWarning),
      ],
    ),
  ];
}

function buildQuoteComparisonBlocks(context: BuildContext) {
  const coreRows = context.quotes.map((quote) => [
    displayOrUnknown(quote.accountingFirmName),
    formatWon(quote.auditFee),
    formatVat(quote.vatIncluded),
    formatWon(quote.accountingFirmRevenue),
    formatPartner(quote),
  ]);
  const capabilityRows = context.quotes.map((quote) => [
    displayOrUnknown(quote.accountingFirmName),
    displayNumber(quote.recentNonghyupAuditCount, "건"),
    displayStringList(quote.auditedNonghyupTypes),
    formatExperience(quote.taxAgencyExperience),
    formatExperience(quote.subsidySettlementExperience),
  ]);
  const planRows = context.quotes.map((quote) => [
    displayOrUnknown(quote.accountingFirmName),
    displayNumber(quote.totalPlannedHours, "시간"),
    displayNumber(quote.partnerHours, "시간"),
    displayStringList(quote.qualityControlPlan),
    formatRequiredItems(quote),
    quote.missingFields.length > 0
      ? quote.missingFields.map(fieldLabel).join(", ")
      : "누락 없음",
  ]);
  return [
    table(
      "quote-comparison-core",
      "확정 견적 핵심 필드 비교",
      [
        "회계법인",
        "감사보수(원)",
        "부가가치세",
        "매출액(원)",
        "업무수행이사",
      ],
      coreRows,
    ),
    table(
      "quote-comparison-capability",
      "확정 견적 수행역량 비교",
      [
        "회계법인",
        "최근 농협 감사",
        "농협 종류",
        "세무대리 경험",
        "보조금 정산 경험",
      ],
      capabilityRows,
    ),
    table(
      "quote-comparison-plan",
      "확정 견적 투입·제안 비교",
      [
        "회계법인",
        "총 예정시간",
        "이사 예정시간",
        "품질관리계획",
        "필수 제안항목",
        "누락 필드",
      ],
      planRows,
    ),
    paragraphs("quote-comparison-unit", "표시 기준", [
      "모든 금액은 원 단위로 표시하며, 부가가치세 포함 여부가 확인되지 않은 경우 미확인으로 표시합니다.",
      "값이 없거나 빈 값인 항목은 미확인으로 표시합니다.",
    ]),
  ];
}

function buildQuantitativeEvaluationBlocks(context: BuildContext) {
  const rows = orderedScores(context).flatMap((score) => {
    const quote = quoteFor(context, score.quoteId);
    return score.criteria.map((criterion) => [
      displayOrUnknown(quote.accountingFirmName),
      criterionName(context.config, criterion.criterionId),
      formatBasisPoints(criterion.rawScoreBasisPoints),
      formatAppliedThresholds(criterion),
      `${formatBasisPoints(criterion.scoreBasisPoints)} / ${formatBasisPoints(criterion.maximumBasisPoints)}`,
      formatBasisPoints(score.totalScoreBasisPoints),
      formatEvidence(criterion),
      criterion.missingFields.length > 0
        ? criterion.missingFields.map(fieldLabel).join(", ")
        : "누락 없음",
    ]);
  });
  return [
    table(
      "quantitative-evaluation-scores",
      "원점수·적용기준·가중점수",
      [
        "회계법인",
        "평가기준",
        "원점수",
        "적용 기준",
        "가중점수",
        "총점",
        "근거",
        "누락",
      ],
      rows,
    ),
    keyValues("quantitative-evaluation-policy", "산정 정책", [
      ["점수 엔진", cleanExternalText(context.reportRun.scoreResult!.engineVersion)],
      [
        "배점 합계",
        formatBasisPoints(context.reportRun.scoreResult!.maximumScoreBasisPoints),
      ],
      ["순위 방식", "동점은 동일 순위를 부여하는 경쟁 순위 방식"],
      [
        "동점 처리",
        context.reportRun.scoreResult!.tieBreaksApplied.length === 0
          ? "숨은 동점 결정기준을 적용하지 않음"
          : context.reportRun.scoreResult!.tieBreaksApplied
            .map(cleanExternalText)
            .join(", "),
      ],
      [
        "평가기준 설정",
        `${cleanExternalText(context.config.id)} v${context.config.version}`,
      ],
    ]),
  ];
}

function buildNhAuditSectionBlocks(
  sectionId: ReportSectionId,
  context: BuildContext,
  fallback: (context: BuildContext) => AuditEvaluationReportBlockViewModel[],
) {
  if (sectionId === "cover" || sectionId === "purpose-scope") {
    return fallback(context);
  }
  if (sectionId === "executive-summary") {
    return buildNhAuditSummaryBlocks(context);
  }
  if (sectionId === "quote-comparison") {
    return buildNhAuditCompositeComparisonBlocks(context);
  }
  if (sectionId === "quantitative-evaluation") {
    return buildNhAuditQualityDetailBlocks(context);
  }
  if (sectionId === "capability-analysis") {
    return buildNhAuditCapabilityOverviewBlocks(context);
  }
  if (sectionId === "fee-analysis") {
    return buildNhAuditCostComparisonBlocks(context);
  }
  if (sectionId === "firm-review") {
    return buildNhAuditExcludedQuoteBlocks(context);
  }
  if (sectionId === "overall-opinion") {
    return buildNhAuditMethodExplanationBlocks(context);
  }
  return buildNhAuditAppendixBlocks(context);
}

function buildNhAuditSummaryBlocks(context: BuildContext) {
  const snapshot = requiredNhSnapshot(context);
  const eligibleCount = snapshot.quoteResults.filter(
    ({ eligibilityStatus }) => eligibilityStatus === "ELIGIBLE",
  ).length;
  const firstPlace = orderedNhEligibleResults(snapshot).filter(
    (result) => result.rank === 1,
  );
  return [
    keyValues(
      "nh-audit-final-result",
      "최종 결과",
      nhAuditFinalResultItems(firstPlace),
    ),
    paragraphs("nh-audit-final-result-guidance", "선정 검토 포인트", [
      firstPlace.length === 0
        ? "적격 견적이 없어 최종 종합 1위를 표시하지 않습니다."
        : "최종 종합 1위는 고객이 적용한 품질·가격 비중으로 산출한 결과입니다. 감사인 선임 안건을 검토할 때 이 회계법인의 점수와 예상 총부담액을 우선 참고할 수 있습니다.",
    ]),
    keyValues("nh-audit-report-summary", "보고서 요약", [
      ["대상 농협", displayOrUnknown(context.evaluationCase.cooperativeNameSnapshot)],
      ["대상 사업연도", `${context.evaluationCase.fiscalYear}년`],
      ["보고서 확정일시", formatReportInstant(snapshot.createdAt)],
      ["비교한 적격 견적 수", `${eligibleCount}개`],
      [
        "평가 제외·부적격 견적 수",
        `${snapshot.quoteResults.length - eligibleCount}개`,
      ],
      [
        "품질·가격 비중",
        `품질 ${snapshot.weights.qualityWeightPercent}% · 가격 ${snapshot.weights.priceWeightPercent}%`,
      ],
      ...nhCriterionIds().map((criterionId) => [
        nhCriterionLabel(criterionId),
        `${snapshot.weights.qualityCriterionWeights[criterionId]}점`,
      ] as [string, string]),
    ]),
    paragraphs("nh-audit-weight-guidance", "적용 배점 안내", [
      snapshot.usesDefaultWeights
        ? "기본 평가배점 적용"
        : "본 보고서의 종합점수는 고객이 설정한 가격·품질 비중 및 항목별 배점을 적용하여 산정되었습니다. 각 항목 내부의 평가구간과 인정률은 공통 평가기준을 동일하게 적용하였습니다.",
    ]),
  ];
}

function buildNhAuditCompositeComparisonBlocks(context: BuildContext) {
  const eligible = orderedNhEligibleResults(requiredNhSnapshot(context));
  return [
    paragraphs("nh-audit-total-burden-notice", "비용 비교 기준", [
      "비용 비교의 대표값은 예상 총부담액입니다. 예상 총부담액은 감사보수와 별도 청구 예상 제경비를 합산한 공급가액에 VAT를 반영한 금액입니다.",
    ]),
    // 열 묶음 없이 핵심·비용·점수를 각각 한 표로 배치해 한눈에 비교
    table(
      "nh-audit-composite-comparison-rank",
      "회계법인 종합 비교표",
      [
        "순위",
        "회계법인명",
        "적격여부",
        "담당회계사",
        "예상 총부담액",
        "최종 종합점수",
      ],
      eligible.map((result) => [
        `${result.rank}위`,
        result.lowPriceEngagementRisk
          ? `${result.accountingFirmName} (저가부실수임 우려)`
          : result.accountingFirmName,
        mapNhEligibilityStatus(
          result.eligibilityStatus,
          result.lowPriceEngagementRisk,
        ),
        result.engagementPartnerName ?? "확인 불가",
        formatWon(result.expectedTotalBurdenWon),
        formatNhScore(result.overallScore),
      ]),
    ),
    table(
      "nh-audit-composite-comparison-cost",
      "회계법인 비용 상세",
      [
        "회계법인명",
        "감사보수",
        "예상 제경비",
        "VAT",
        "예상 총부담액",
      ],
      eligible.map((result) => [
        result.accountingFirmName,
        formatWon(result.auditFeeWon),
        formatWon(result.expectedExpenseWon),
        formatWon(result.vatWon),
        formatWon(result.expectedTotalBurdenWon),
      ]),
    ),
    table(
      "nh-audit-composite-comparison-score",
      "회계법인 견적 평가점수 상세",
      [
        "회계법인명",
        "품질 원점수",
        "품질 환산점수",
        "가격 원점수",
        "가격 환산점수",
        "최종 종합점수",
      ],
      eligible.map((result) => [
        result.accountingFirmName,
        formatNhScore(result.qualityScore),
        formatNhScore(result.weightedQualityScore),
        formatNhScore(result.priceBaseScore),
        formatNhScore(result.weightedPriceScore),
        formatNhScore(result.overallScore),
      ]),
    ),
  ];
}

function buildNhAuditQualityDetailBlocks(context: BuildContext) {
  const eligible = orderedNhEligibleResults(requiredNhSnapshot(context));
  const inputRows = eligible.flatMap((result) =>
    result.criteria.map((criterion, index) => [
      index === 0 ? result.accountingFirmName : "",
      nhCriterionLabel(criterion.criterionId),
      formatNhCriterionInput(criterion.criterionId, criterion.inputValue),
      `${criterion.weightPoints}점`,
    ])
  );
  const scoreRows = eligible.flatMap((result) =>
    result.criteria.map((criterion, index) => [
      index === 0 ? result.accountingFirmName : "",
      nhCriterionLabel(criterion.criterionId),
      nhBandLabel(criterion.appliedBandId),
      formatRecognitionRate(criterion.recognitionRateBasisPoints),
      formatNhScore(criterion.earnedScore),
    ])
  );
  return [
    table(
      "nh-audit-quality-detail-input",
      "회계법인별 세부 품질평가 (입력·배점)",
      [
        "회계법인명",
        "평가항목",
        "입력값",
        "고객 적용 배점",
      ],
      inputRows,
    ),
    table(
      "nh-audit-quality-detail-score",
      "회계법인별 세부 품질평가 (구간·점수)",
      [
        "회계법인명",
        "평가항목",
        "적용 평가구간",
        "인정률",
        "획득점수",
      ],
      scoreRows,
    ),
  ];
}

function buildNhAuditCapabilityOverviewBlocks(context: BuildContext) {
  const eligible = orderedNhEligibleResults(requiredNhSnapshot(context));
  const criterionIds = nhCriterionIds();
  const mid = Math.ceil(criterionIds.length / 2);
  const firstHalf = criterionIds.slice(0, mid);
  const secondHalf = criterionIds.slice(mid);
  const rowFor = (
    result: (typeof eligible)[number],
    ids: typeof criterionIds,
  ) => {
    const criteria = new Map(
      result.criteria.map((criterion) => [criterion.criterionId, criterion]),
    );
    return [
      result.accountingFirmName,
      ...ids.map((criterionId) => {
        const criterion = criteria.get(criterionId);
        return criterion
          ? formatNhCriterionInput(criterionId, criterion.inputValue)
          : "확인 불가";
      }),
    ];
  };
  return [
    table(
      "nh-audit-capability-overview-a",
      "회계법인 수행역량 비교",
      ["회계법인명", ...firstHalf.map(nhCriterionLabel)],
      eligible.map((result) => rowFor(result, firstHalf)),
    ),
    table(
      "nh-audit-capability-overview-b",
      "회계법인 농협업무 수행역량 비교",
      ["회계법인명", ...secondHalf.map(nhCriterionLabel)],
      eligible.map((result) => rowFor(result, secondHalf)),
    ),
  ];
}

function buildNhAuditCostComparisonBlocks(context: BuildContext) {
  const eligible = orderedNhEligibleResults(requiredNhSnapshot(context));
  return [
    table(
      "nh-audit-cost-comparison",
      "회계법인 예상 총부담액 비교",
      [
        "회계법인명",
        "감사보수",
        "예상 제경비",
        "공급가액",
        "VAT",
        "예상 총부담액",
      ],
      eligible.map((result) => [
        result.accountingFirmName,
        formatWon(result.auditFeeWon),
        formatWon(result.expectedExpenseWon),
        formatWon(result.supplyAmountWon),
        formatWon(result.vatWon),
        formatWon(result.expectedTotalBurdenWon),
      ]),
    ),
  ];
}

function buildNhAuditExcludedQuoteBlocks(context: BuildContext) {
  const listed = requiredNhSnapshot(context).quoteResults.filter(
    (result) =>
      result.eligibilityStatus !== "ELIGIBLE" ||
      result.lowPriceEngagementRisk === true,
  );
  return [
    table(
      "nh-audit-excluded-quotes",
      "평가제외·부적격·우려·재제출 필요 견적",
      [
        "회계법인명",
        "제안 주체",
        "상태",
        "제외·부적격 사유",
        "누락 필드",
      ],
      listed.map((result) => [
        result.accountingFirmName,
        result.proposerType === "AUDIT_GROUP"
          ? "감사반"
          : result.proposerType === "ACCOUNTING_FIRM"
            ? "회계법인"
            : "확인 불가",
        mapNhEligibilityStatus(
          result.eligibilityStatus,
          result.lowPriceEngagementRisk,
        ),
        result.reasonCodes.length > 0
          ? result.reasonCodes.map(nhReasonLabel).join(", ")
          : result.lowPriceEngagementRisk
            ? "저가부실수임 우려"
            : "사유 확인 필요",
        result.missingFields.length > 0
          ? result.missingFields.map(nhMissingFieldLabel).join(", ")
          : "해당 없음",
      ]),
    ),
    paragraphs("nh-audit-exclusion-note", "순위 제외 안내", [
      "감사반, 재제출 필요 견적, 관리자 평가제외 견적, 서버 검증 실패 또는 비정상 가격 견적은 정상 순위와 최저가격 산정에서 제외됩니다. 저가부실수임 우려 견적은 순위에 포함하되 이 표에 함께 표시합니다. 이 견적들을 0점 업체로 해석하지 않습니다. 저가부실수임 우려 견적은 품질점수에서 감점 반영합니다.",
    ]),
  ];
}

function buildNhAuditMethodExplanationBlocks(context: BuildContext) {
  const snapshot = requiredNhSnapshot(context);
  return [
    bullets("nh-audit-method-explanation", "평가 계산방법", [
      "품질 원점수는 6개 수행역량 항목의 고객 적용 배점에 공통 평가구간별 인정률을 곱하여 합산한 점수입니다.",
      "가격 원점수는 100 × 만점기준 예상 총부담액 ÷ 해당 견적의 예상 총부담액으로 계산하며, 100점을 넘지 않습니다. 만점기준은 적격 견적 중 최저 예상 총부담액입니다.",
      "저가부실수임 우려 견적은(Prego AI가 최소 필수 투입 시간 등 원가를 고려해 검증) 품질 원점수에 감점조정율(1.05 − A/B, 최대 80%)을 적용하여 부실수임을 방지합니다. (A= 부실 우려 해당 기업 제안보수, B=Prego AI 산정 최저수임 가능 가격의 80% 수준)",
      "예상 총부담액에는 감사보수, 별도 청구 예상 제경비 및 VAT가 포함됩니다.",
      `최종 종합점수는 품질 원점수에 ${snapshot.weights.qualityWeightPercent}%, 가격 원점수에 ${snapshot.weights.priceWeightPercent}%를 각각 적용한 합계입니다.`,
      "고객은 항목별 총배점만 조정할 수 있으며 각 항목 내부의 평가구간과 인정률은 모든 견적에 동일한 공통기준을 적용합니다.",
      "순위는 귀 농협이 설정한 배점과 가격과 품질 가중치를 반영한 최종 종합점수, 낮은 예상 총부담액, 감사 수행 건수가 많은 순으로 결정합니다.",
    ]),
  ];
}

function buildNhAuditAppendixBlocks(context: BuildContext) {
  const snapshot = requiredNhSnapshot(context);
  return [
    keyValues("nh-audit-snapshot-metadata", "확정 스냅샷 정보", [
      ["보고서 ID", snapshot.reportId],
      ["평가 ID", snapshot.evaluationId],
      ["견적요청 ID", snapshot.quoteRequestId],
      ["평가기준 버전", snapshot.evaluationStandardVersion],
      ["확정시각", formatReportInstant(snapshot.createdAt)],
      ["포함 견적 ID", snapshot.includedQuoteIds.join(", ") || "없음"],
      [
        "제외 견적 ID",
        snapshot.excludedQuotes.map(({ quoteId }) => quoteId).join(", ") ||
          "없음",
      ],
    ]),
    paragraphs("nh-audit-snapshot-reproduction", "스냅샷 재현 원칙", [
      "이 확정 보고서의 화면과 PDF는 확정 당시 저장한 설정, 포함·제외 견적 및 계산결과 스냅샷을 사용합니다. 현재 견적 원본이 변경되어도 기존 확정본을 덮어쓰지 않습니다.",
    ]),
  ];
}

function requiredNhSnapshot(context: BuildContext) {
  const snapshot = context.reportRun.nhAuditEvaluationSnapshot;
  if (!snapshot) {
    throw new ReportViewModelError("missing_nh_audit_snapshot");
  }
  return snapshot;
}

function nhAuditSectionTitle(
  id: ReportSectionId,
  configuredTitle: string,
  isNhAuditReport: boolean,
) {
  if (!isNhAuditReport) return configuredTitle;
  if (id === "overall-opinion") return "계산 방법";
  if (id === "fee-analysis") return "감사보수 분석";
  if (id === "firm-review") return "부적격·우려 견적 내역";
  return configuredTitle;
}

function orderedNhEligibleResults(snapshot: NhAuditReportEvaluationSnapshot) {
  return snapshot.quoteResults
    .filter(
      (result) =>
        result.eligibilityStatus === "ELIGIBLE" && result.rank !== null,
    )
    .slice()
    .sort((left, right) =>
      (left.rank ?? Number.MAX_SAFE_INTEGER) -
        (right.rank ?? Number.MAX_SAFE_INTEGER) ||
      compareText(left.quoteId, right.quoteId)
    );
}

function uniqueJoined(values: readonly string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))].join(
    ", ",
  );
}

function nhAuditFinalResultItems(
  firstPlace: ReturnType<typeof orderedNhEligibleResults>,
): Array<[string, string]> {
  if (firstPlace.length === 0) {
    return [
      ["1위 회계법인", "해당 없음"],
      ["최종 종합점수", "해당 없음"],
      ["예상 총부담액", "해당 없음"],
    ];
  }
  const names = firstPlace.map((result) =>
    result.lowPriceEngagementRisk
      ? `${result.accountingFirmName} (저가부실수임 우려)`
      : result.accountingFirmName,
  );
  return [
    [
      "1위 회계법인",
      firstPlace.length > 1 ? `${names.join(", ")} (동점)` : names[0]!,
    ],
    ["최종 종합점수", uniqueJoined(firstPlace.map((result) => formatNhScore(result.overallScore)))],
    [
      "예상 총부담액",
      uniqueJoined(
        firstPlace.map((result) => formatWon(result.expectedTotalBurdenWon)),
      ),
    ],
  ];
}

function nhCriterionIds() {
  const criterionLabels = {
    LOCAL_NONGHYUP_AUDIT_COUNT_2025: "감사 수행 건수",
    CERTIFIED_PUBLIC_ACCOUNTANT_COUNT: "공인회계사 수",
    ACCOUNTING_FIRM_REVENUE: "회계법인 매출액",
    AUDITED_NONGHYUP_TYPE_DIVERSITY_2025: "감사유형 다양성",
    NONGHYUP_TAX_AGENCY_PERFORMED_2025: "세무대리 수행 여부",
    NONGHYUP_SUBSIDY_SETTLEMENT_PERFORMED_2025:
      "보조금 정산 수행 여부",
  } as const;
  return Object.keys(criterionLabels) as Array<
    keyof typeof criterionLabels
  >;
}

function nhCriterionLabel(
  criterionId: ReturnType<typeof nhCriterionIds>[number],
) {
  const labels = {
    LOCAL_NONGHYUP_AUDIT_COUNT_2025: "감사 수행 건수",
    CERTIFIED_PUBLIC_ACCOUNTANT_COUNT: "공인회계사 수",
    ACCOUNTING_FIRM_REVENUE: "회계법인 매출액",
    AUDITED_NONGHYUP_TYPE_DIVERSITY_2025: "농협 유형 다양성",
    NONGHYUP_TAX_AGENCY_PERFORMED_2025: "세무대리 수행 여부",
    NONGHYUP_SUBSIDY_SETTLEMENT_PERFORMED_2025:
      "보조금 정산 수행 여부",
  } as const;
  return labels[criterionId];
}

function formatNhCriterionInput(
  criterionId: NhAuditReportQuoteResultSnapshot["criteria"][number]["criterionId"],
  inputValue: NhAuditReportQuoteResultSnapshot["criteria"][number]["inputValue"],
) {
  if (Array.isArray(inputValue)) {
    const labels = {
      LOCAL_AGRICULTURAL_COOPERATIVE: "지역농협",
      LOCAL_LIVESTOCK_COOPERATIVE: "지역축협",
      ITEM_AGRICULTURAL_OR_LIVESTOCK_COOPERATIVE:
        "품목농협·품목축협(원예농협 포함)",
      GINSENG_COOPERATIVE: "인삼농협",
    } as const;
    return inputValue.length > 0
      ? `${inputValue.length}종 (${inputValue.map((value) => labels[value]).join(", ")})`
      : "0종";
  }
  if (typeof inputValue === "boolean") {
    return inputValue ? "유" : "무";
  }
  if (criterionId === "ACCOUNTING_FIRM_REVENUE") {
    return formatWon(String(inputValue));
  }
  if (criterionId === "CERTIFIED_PUBLIC_ACCOUNTANT_COUNT") {
    return `${inputValue}명`;
  }
  if (criterionId === "LOCAL_NONGHYUP_AUDIT_COUNT_2025") {
    return `${inputValue}건`;
  }
  return String(inputValue);
}

function nhBandLabel(bandId: string) {
  const labels: Record<string, string> = {
    "audit-count-0-4": "0~4건",
    "audit-count-5-9": "5~9건",
    "audit-count-10-19": "10~19건",
    "audit-count-20-29": "20~29건",
    "audit-count-30-39": "30~39건",
    "audit-count-40-49": "40~49건",
    "audit-count-50-plus": "50건 이상",
    "cpa-count-0-6": "0~6명",
    "cpa-count-7-10": "7~10명",
    "cpa-count-11-15": "11~15명",
    "cpa-count-16-19": "16~19명",
    "cpa-count-20-plus": "20명 이상",
    "revenue-up-to-500m": "5억원 이하",
    "revenue-over-500m-up-to-2b": "5억원 초과~20억원 이하",
    "revenue-over-2b-up-to-5b": "20억원 초과~50억원 이하",
    "revenue-over-5b-up-to-8b": "50억원 초과~80억원 이하",
    "revenue-over-8b-up-to-10b": "80억원 초과~100억원 이하",
    "revenue-over-10b": "100억원 초과",
    "type-diversity-0": "0종",
    "type-diversity-1": "1종",
    "type-diversity-2": "2종",
    "type-diversity-3": "3종",
    "type-diversity-4": "4종",
    performed: "수행",
    "not-performed": "미수행",
  };
  return labels[bandId] ?? cleanExternalText(bandId);
}

function formatRecognitionRate(basisPoints: number) {
  const tenths = Math.round(basisPoints / 10);
  return tenths % 10 === 0
    ? `${tenths / 10}%`
    : `${(tenths / 10).toFixed(1)}%`;
}

function nhReasonLabel(
  reason: NhAuditReportQuoteResultSnapshot["reasonCodes"][number],
) {
  const labels = {
    AUDIT_GROUP_PROPOSER: "감사반은 평가기준상 부적격",
    LEGACY_DOCUMENT_MISSING_REQUIRED_FIELDS:
      "신규 평가 필수값 누락으로 재제출 필요",
    SERVER_VALIDATION_FAILED: "서버 검증 실패",
    ADMINISTRATIVELY_EXCLUDED: "관리자 평가제외",
    NON_POSITIVE_TOTAL_BURDEN: "예상 총부담액이 0원 이하",
  } as const;
  return labels[reason];
}

function nhMissingFieldLabel(field: string) {
  const labels: Record<string, string> = {
    engagementPartnerName: "담당회계사 이름",
    proposerType: "제안 주체 유형",
    auditFeeWon: "감사보수",
    expenseBillingMode: "제경비 청구방식",
    expectedExpenseWon: "예상 제경비",
    localNonghyupAuditCount2025: "감사 수행 건수",
    certifiedPublicAccountantCount: "공인회계사 수",
    accountingFirmRevenueWon: "회계법인 매출액",
    auditedNonghyupTypes2025: "수행 농협 유형",
    nonghyupTaxAgencyPerformed2025: "세무대리 수행 여부",
    nonghyupSubsidySettlementPerformed2025: "보조금 정산 수행 여부",
    factsConfirmed: "사실확인 동의",
  };
  return labels[field] ?? cleanExternalText(field);
}

function formatReportInstant(value: string) {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return "확인 불가";
  const date = new Date(milliseconds);
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatNhScore(score: { numerator: string; denominator: string } | null) {
  return score ? `${formatExactScoreOneDecimal(score)}점` : "해당 없음";
}

function mapNhEligibilityStatus(
  status:
    | "ELIGIBLE"
    | "INELIGIBLE"
    | "RESUBMISSION_REQUIRED"
    | "EXCLUDED",
  lowPriceEngagementRisk?: boolean,
) {
  if (status === "ELIGIBLE") {
    return lowPriceEngagementRisk ? "우려" : "적격";
  }
  if (status === "INELIGIBLE") return "부적격";
  if (status === "RESUBMISSION_REQUIRED") return "재제출 필요";
  return "평가 제외";
}

function buildCapabilityAnalysisBlocks(context: BuildContext) {
  return [
    table(
      "capability-analysis-comparison",
      "감사 수행역량 비교",
      [
        "회계법인",
        "매출액(원)",
        "농협 감사건수",
        "농협 종류",
        "세무대리 경험",
        "보조금 정산 경험",
        "업무수행이사",
        "투입인력",
        "예정시간",
        "감사 일정",
        "품질관리계획",
        "필수 제안항목",
      ],
      context.quotes.map((quote) => [
        displayOrUnknown(quote.accountingFirmName),
        formatWon(quote.accountingFirmRevenue),
        displayNumber(quote.recentNonghyupAuditCount, "건"),
        displayStringList(quote.auditedNonghyupTypes),
        formatExperience(quote.taxAgencyExperience),
        formatExperience(quote.subsidySettlementExperience),
        formatPartner(quote),
        formatTeam(quote),
        `${displayNumber(quote.totalPlannedHours, "시간")} (이사 ${displayNumber(quote.partnerHours, "시간")})`,
        formatSchedule(quote),
        displayStringList(quote.qualityControlPlan),
        formatRequiredItems(quote),
      ]),
    ),
  ];
}

function buildFeeAnalysisBlocks(context: BuildContext) {
  const result = context.reportRun.feeAnalysis!;
  return [
    keyValues("fee-analysis-summary", "감사보수 비교 기준", [
      ["통화와 단위", "KRW, 원 단위"],
      ["유효 견적 수", `${result.validQuoteCount}개`],
      ["중앙값", formatWon(result.medianWon)],
      ["최솟값", formatWon(result.minimumWon)],
      ["최댓값", formatWon(result.maximumWon)],
      ["비교 기준", `${mapComparisonMethod(result.comparisonBenchmark.method)} ${formatWon(result.comparisonBenchmark.won)}`],
      ["품질점수 포함 여부", "감사보수 분석과 품질점수는 분리"],
    ]),
    table(
      "fee-analysis-quotes",
      "회계법인별 감사보수 분석",
      [
        "회계법인",
        "제출 보수(원)",
        "정규화 보수(원)",
        "VAT",
        "중앙값 편차",
        "시간당 보수(원)",
        "이사시간 비율",
        "보수 위치",
        "검토사항",
      ],
      context.quotes.map((quote) => {
        const fee = feeFor(context, quote.quoteId);
        return [
          displayOrUnknown(quote.accountingFirmName),
          formatWon(fee.originalFeeWon),
          formatWon(fee.normalizedFeeWon),
          `${formatVat(fee.vatIncluded)} / ${mapVatAdjustment(fee.vatAdjustment)}`,
          formatSignedBasisPoints(fee.deviationFromMedianBasisPoints),
          fee.hourlyRate ? formatWon(fee.hourlyRate.roundedWon) : "미확인",
          fee.partnerHoursRatioBasisPoints === null
            ? "미확인"
            : formatPercentBasisPoints(fee.partnerHoursRatioBasisPoints),
          fee.totalFeePosition === null ? "미확인" : `${fee.totalFeePosition}번째`,
          fee.flags.length > 0
            ? fee.flags.map(mapFeeFlag).join(", ")
            : "별도 검토사항 없음",
        ];
      }),
    ),
    bullets(
      "fee-analysis-warnings",
      "보수 분석 유의사항",
      [
        ...result.comparisonWarnings.map(mapFeeWarning),
        "감사보수가 가장 낮다는 이유만으로 특정 회계법인을 추천하지 않습니다.",
      ],
    ),
  ];
}

function buildFirmReviewBlocks(context: BuildContext) {
  return [
    table(
      "firm-review-details",
      "기준별 강점과 중립 검토사항",
      ["회계법인", "평가기준상 강점", "검토사항"],
      orderedScores(context).map((score) => [
        displayOrUnknown(quoteFor(context, score.quoteId).accountingFirmName),
        score.strengths.length > 0
          ? score.strengths
            .map((id) => criterionName(context.config, id))
            .join(", ")
          : "확인된 기준별 강점 없음",
        [
          ...score.reviewItems.map(mapReviewItem),
          ...feeFor(context, score.quoteId).flags.map(mapFeeFlag),
        ].length > 0
          ? [
            ...score.reviewItems.map(mapReviewItem),
            ...feeFor(context, score.quoteId).flags.map(mapFeeFlag),
          ].join(", ")
          : "별도 검토사항 없음",
      ]),
    ),
    paragraphs("firm-review-note", "해석 안내", [
      "강점은 게시된 평가기준에서 높은 원점수가 확인된 항목명만 표시합니다.",
      "검토사항은 누락, 경고, 신뢰도와 감사보수 분석 신호를 사실 중심으로 표시합니다.",
    ]),
  ];
}

function buildOverallOpinionBlocks(context: BuildContext) {
  const ranked = orderedScores(context);
  const prechecks = context.quotes.flatMap((quote) => {
    const score = scoreFor(context, quote.quoteId);
    const items = [
      ...score.missingInformation.map((field) => `${fieldLabel(field)} 미확인`),
      ...(quote.pendingAdminReviewFields ?? []).map(
        (field) => `${fieldLabel(field)} 관리자 검토 대기`,
      ),
      ...quote.warnings.map((warning) => mapQuoteWarning(warning.code)),
    ];
    return items.map((item) =>
      `${displayOrUnknown(quote.accountingFirmName)}: ${item}`
    );
  });
  const relativeStrengths = ranked.map((score) => {
    const quote = quoteFor(context, score.quoteId);
    const strengths = score.strengths.length > 0
      ? score.strengths.map((id) => criterionName(context.config, id)).join(", ")
      : "확인된 기준별 강점 없음";
    return `${displayOrUnknown(quote.accountingFirmName)}: 정량 ${formatBasisPoints(score.totalScoreBasisPoints)}, 기준별 강점 ${strengths}, 정규화 보수 ${formatWon(feeFor(context, score.quoteId).normalizedFeeWon)}`;
  });
  return [
    bullets(
      "overall-opinion-balance",
      "상대적 강점과 품질·보수 균형",
      relativeStrengths,
    ),
    bullets(
      "overall-opinion-prechecks",
      "최종 판단 전 확인사항",
      prechecks.length > 0 ? prechecks : ["추가 확인이 필요한 누락 또는 경고 없음"],
    ),
    paragraphs("overall-opinion-decision", "최종 의사결정 안내", [
      "정량 품질평가와 감사보수 분석은 서로 분리하여 검토해야 합니다.",
      "감사보수가 가장 낮다는 이유만으로 특정 회계법인을 추천하지 않습니다.",
      "보고서는 품질과 보수를 같은 기준으로 비교한 근거를 제공하여, 농협이 선임 안건을 검토하고 설명할 수 있게 돕습니다.",
    ]),
  ];
}

function buildAppendixBlocks(context: BuildContext) {
  const criteriaRows = [...context.config.criteria]
    .sort((left, right) => compareText(left.id, right.id))
    .map((criterion) => [
      cleanExternalText(criterion.id),
      cleanExternalText(criterion.name),
      formatPercentBasisPoints(criterion.weightBasisPoints),
      criterion.required ? "필수" : "참고",
      formatRule(criterion.rule),
    ]);
  const sourceRows = context.quotes.flatMap((quote) =>
    [...new Set([
      ...Object.keys(quote.source),
      ...Object.keys(quote.evidenceByField),
    ])]
      .sort(compareText)
      .map((field) => {
        const normalizedField = field as NormalizedAuditQuoteField;
        const evidence = quote.evidenceByField[normalizedField] ?? [];
        return [
          displayOrUnknown(quote.accountingFirmName),
          fieldLabel(normalizedField),
          mapSource(quote.source[normalizedField] ?? null),
          evidence.length === 0
            ? "근거 상세 미확인"
            : evidence.map((item, index) =>
              `${index + 1}: ${mapSource(item.source)}, 문서 ${cleanExternalText(item.documentId)}, 페이지 ${item.pageNumber ?? "미확인"}, 발췌 ${safeFreeText(item.excerpt)}`
            ).join(" | "),
        ];
      })
  );
  const missingRows = context.quotes.map((quote) => [
    displayOrUnknown(quote.accountingFirmName),
    quote.missingFields.length > 0
      ? quote.missingFields.map(fieldLabel).join(", ")
      : "누락 없음",
  ]);
  const correctionRows = context.corrections.map((correction) => [
    correction.correctedAt,
    correction.quoteId,
    fieldLabel(correction.field),
    formatEvidenceValue(correction.originalExtractedValue),
    formatEvidenceValue(correction.correctedValue),
    safeFreeText(correction.reason),
    mapCorrectionReviewStatus(correction.reviewStatus),
  ]);
  return [
    table(
      "appendix-criteria",
      "평가기준과 가중치",
      ["기준 ID", "기준명", "가중치", "구분", "규칙"],
      criteriaRows,
    ),
    table(
      "appendix-sources",
      "확정 스냅샷 출처와 근거",
      ["회계법인", "필드", "반영 출처", "근거 상세"],
      sourceRows.length > 0
        ? sourceRows
        : [["미확인", "미확인", "미확인", "미확인"]],
    ),
    table(
      "appendix-missing",
      "누락 정보",
      ["회계법인", "누락 필드"],
      missingRows,
    ),
    table(
      "appendix-corrections",
      "고객 수정 이력",
      ["수정시각", "견적 ID", "필드", "원본", "수정값", "사유", "검토상태"],
      correctionRows.length > 0
        ? correctionRows
        : [["미확인", "미확인", "미확인", "미확인", "미확인", "수정 이력 없음", "미확인"]],
    ),
    keyValues("appendix-versions", "생성 버전", [
      ["보고서 스키마", String(REPORT_VIEW_MODEL_SCHEMA_VERSION)],
      ["평가기준", `${cleanExternalText(context.config.id)} v${context.config.version}`],
      ["품질점수 엔진", cleanExternalText(context.reportRun.scoreResult!.engineVersion)],
      ["보수분석 엔진", cleanExternalText(context.reportRun.feeAnalysis!.engineVersion)],
      [
        "견적 추출 프롬프트",
        displayOrUnknown(context.config.quoteExtractionPolicy?.aiPromptVersion ?? null),
      ],
      ["보고서 버전", `v${context.reportRun.reportVersion}`],
      ["확정 버전", `v${context.reportRun.confirmationVersion}`],
    ]),
  ];
}

function assertBuildInput(input: BuildDeterministicReportViewModelInput) {
  const { reportRun, evaluationCase, generatedAt } = input;
  if (!["PENDING", "GENERATING"].includes(reportRun.status)) {
    throw new ReportViewModelError("invalid_report_status");
  }
  if (!reportRun.scoreResult || !reportRun.feeAnalysis) {
    throw new ReportViewModelError("missing_evaluation_result");
  }
  if (reportRun.caseId !== evaluationCase.id) {
    throw new ReportViewModelError("case_mismatch");
  }
  if (reportRun.evaluationConfigSnapshot.status !== "PUBLISHED") {
    throw new ReportViewModelError("evaluation_config_not_published");
  }
  if (!z.string().datetime({ offset: true }).safeParse(generatedAt).success) {
    throw new ReportViewModelError("invalid_generated_at");
  }
  if (
    reportRun.quoteDataSnapshots.length === 0 ||
    reportRun.quoteDataSnapshots.some(
      (quote) =>
        quote.caseId !== evaluationCase.id || !quote.confirmedByCustomer,
    )
  ) {
    throw new ReportViewModelError("unconfirmed_quote_snapshot");
  }
  const quoteIds = reportRun.quoteDataSnapshots.map(({ quoteId }) => quoteId);
  if (new Set(quoteIds).size !== quoteIds.length) {
    throw new ReportViewModelError("duplicate_quote_snapshot");
  }
  assertSameIds(
    quoteIds,
    reportRun.scoreResult.quotes.map(({ quoteId }) => quoteId),
    "score_result_quote_mismatch",
  );
  assertSameIds(
    quoteIds,
    reportRun.feeAnalysis.quotes.map(({ quoteId }) => quoteId),
    "fee_analysis_quote_mismatch",
  );
  if (
    reportRun.scoreResult.tieBreaksApplied.length > 0 ||
    reportRun.scoreResult.rankingPolicy !==
      "COMPETITION_EQUAL_SCORES_SHARE_RANK"
  ) {
    throw new ReportViewModelError("hidden_tie_break_not_allowed");
  }
  const criterionIds = reportRun.evaluationConfigSnapshot.criteria.map(
    ({ id }) => id,
  );
  for (const score of reportRun.scoreResult.quotes) {
    assertSameIds(
      criterionIds,
      score.criteria.map(({ criterionId }) => criterionId),
      "criterion_result_mismatch",
    );
  }
  const configuredStrings = [
    ...reportRun.evaluationConfigSnapshot.reportSections.map(({ name }) => name),
    ...reportRun.evaluationConfigSnapshot.reportPhrases.flatMap(
      ({ label, text }) => [label, text],
    ),
  ];
  if (scanForbiddenReportPhrases(configuredStrings).length > 0) {
    throw new ReportViewModelError("forbidden_report_phrase");
  }
}

function assertSameIds(
  expected: readonly string[],
  actual: readonly string[],
  code: string,
) {
  const left = [...expected].sort(compareText);
  const right = [...actual].sort(compareText);
  if (
    left.length !== right.length ||
    left.some((value, index) => value !== right[index])
  ) {
    throw new ReportViewModelError(code);
  }
}

function validateAndSortCorrections(
  corrections: readonly AuditQuoteCorrectionRecord[],
  caseId: string,
  quoteById: ReadonlyMap<string, QuoteDataSnapshot>,
) {
  return corrections.filter((correction) => {
    const quote = quoteById.get(correction.quoteId);
    return (
      correction.caseId === caseId &&
      quote !== undefined &&
      correction.quoteRevision <= (quote.revision ?? 0)
    );
  }).sort((left, right) =>
    compareText(left.correctedAt, right.correctedAt) ||
    compareText(left.quoteId, right.quoteId) ||
    compareText(left.field, right.field) ||
    compareText(left.id, right.id)
  );
}

function resolveSectionPresentation(
  config: EvaluationConfigSnapshot,
  reportTitle: string,
) {
  const ordered = [...config.reportSections].sort((left, right) =>
    left.order - right.order || compareText(left.id, right.id)
  );
  return Object.fromEntries(
    REPORT_SECTION_IDS.map((id, defaultOrder) => {
      const configured = ordered.find(
        ({ type }) => type === SECTION_CONFIG_TYPES[id],
      );
      return [
        id,
        {
          title: id === "cover"
            ? reportTitle
            : configured
            ? cleanExternalText(configured.name)
            : FALLBACK_SECTION_TITLES[id],
          order: configured?.order ?? defaultOrder,
          enabled:
            MANDATORY_REPORT_SECTION_IDS.includes(
              id as (typeof MANDATORY_REPORT_SECTION_IDS)[number],
            ) || configured?.enabled !== false,
        },
      ];
    }),
  ) as Record<
    ReportSectionId,
    { title: string; order: number; enabled: boolean }
  >;
}

function resolveRenderingMetadata(
  config: EvaluationConfigSnapshot,
  resolvedLogoDataUri: string | null | undefined,
) {
  const policy = config.reportRenderingPolicy;
  return {
    reportTitle: configuredText(
      policy?.reportTitle,
      FALLBACK_REPORT_TITLE,
    ),
    centerContact: configuredText(
      policy?.centerContact,
      FALLBACK_CENTER,
    ),
    primaryColor: safeHexColor(
      policy?.primaryColor,
      FALLBACK_PRIMARY_COLOR,
    ),
    accentColor: safeHexColor(
      policy?.accentColor,
      FALLBACK_ACCENT_COLOR,
    ),
    logoDataUri: safeLogoDataUri(resolvedLogoDataUri),
  };
}

function configuredText(value: string | undefined, fallback: string) {
  if (typeof value !== "string") return fallback;
  const cleaned = cleanExternalText(value);
  return cleaned === "미확인" ? fallback : cleaned;
}

function safeHexColor(value: string | undefined, fallback: string) {
  return typeof value === "string" && SAFE_HEX_COLOR.test(value)
    ? value.toUpperCase()
    : fallback;
}

function safeLogoDataUri(value: string | null | undefined) {
  if (
    typeof value !== "string" ||
    value.length > MAX_LOGO_DATA_URI_LENGTH ||
    !SAFE_LOGO_DATA_URI.test(value)
  ) {
    return null;
  }
  return value;
}

function orderedScores(context: BuildContext) {
  return [...context.scoreById.values()].sort((left, right) =>
    left.rank - right.rank || compareText(left.quoteId, right.quoteId)
  );
}

function quoteFor(context: BuildContext, quoteId: string) {
  const quote = context.quotes.find((item) => item.quoteId === quoteId);
  if (!quote) throw new ReportViewModelError("quote_snapshot_not_found");
  return quote;
}

function scoreFor(context: BuildContext, quoteId: string) {
  const score = context.scoreById.get(quoteId);
  if (!score) throw new ReportViewModelError("score_result_not_found");
  return score;
}

function feeFor(context: BuildContext, quoteId: string) {
  const fee = context.feeById.get(quoteId);
  if (!fee) throw new ReportViewModelError("fee_analysis_not_found");
  return fee;
}

function criterionName(config: EvaluationConfigSnapshot, criterionId: string) {
  const criterion = config.criteria.find(({ id }) => id === criterionId);
  if (!criterion) {
    throw new ReportViewModelError("criterion_result_mismatch");
  }
  return cleanExternalText(criterion.name);
}

function keyValues(
  id: string,
  title: string,
  values: ReadonlyArray<readonly [string, string]>,
): ReportKeyValuesBlockViewModel {
  return {
    id,
    type: "KEY_VALUES",
    title,
    items: values.map(([label, value]) => ({
      label: displayOrUnknown(label),
      value: displayOrUnknown(value),
    })),
  };
}

function table(
  id: string,
  title: string,
  columns: string[],
  rows: string[][],
): ReportTableBlockViewModel {
  return {
    id,
    type: "TABLE",
    title,
    columns: columns.map(displayOrUnknown),
    // 빈 문자열은 회계법인명 rowspan 병합용 자리표시자로 유지한다.
    rows: rows.map((row) => row.map(displayTableCell)),
  };
}

function bullets(
  id: string,
  title: string,
  items: string[],
): ReportBulletsBlockViewModel {
  return {
    id,
    type: "BULLETS",
    title,
    items: items.map(displayOrUnknown),
  };
}

function paragraphs(
  id: string,
  title: string,
  values: string[],
): ReportParagraphsBlockViewModel {
  return {
    id,
    type: "PARAGRAPHS",
    title,
    paragraphs: values.map(displayOrUnknown),
  };
}

function createFacts(
  sections: readonly AuditEvaluationReportSectionViewModel[],
): AuditEvaluationReportFactViewModel[] {
  const facts: AuditEvaluationReportFactViewModel[] = [];
  for (const section of sections) {
    const strings = [section.title, ...section.blocks.flatMap(blockStrings)]
      .filter((text) => text.trim().length > 0);
    for (const text of strings) {
      facts.push({
        id: `fact-${String(facts.length + 1).padStart(4, "0")}`,
        sectionId: section.id,
        text,
      });
    }
  }
  return facts;
}

function blockStrings(block: AuditEvaluationReportBlockViewModel): string[] {
  if (block.type === "KEY_VALUES") {
    return [
      block.title,
      ...block.items.flatMap(({ label, value }) => [label, value]),
    ];
  }
  if (block.type === "TABLE") {
    return [block.title, ...block.columns, ...block.rows.flat()];
  }
  if (block.type === "BULLETS") return [block.title, ...block.items];
  return [block.title, ...block.paragraphs];
}

function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort(compareText)
      .flatMap((key) =>
        allStrings((value as Record<string, unknown>)[key])
      );
  }
  return [];
}

function cleanExternalText(value: string): string {
  const cleaned = value.replace(CONTROL_CHARACTERS, "").trim();
  if (cleaned.length === 0) return "미확인";
  if (cleaned.length > EXTERNAL_STRING_MAX) {
    return "[표시 제한: 원문 길이 4000자 초과]";
  }
  return cleaned;
}

function safeFreeText(value: string): string {
  const cleaned = cleanExternalText(value);
  return scanForbiddenReportPhrases([cleaned]).length > 0
    ? "[표시 제한: 추가 확인 필요]"
    : cleaned;
}

function displayOrUnknown(value: string | null | undefined): string {
  if (value === null || value === undefined) return "미확인";
  return cleanExternalText(value);
}

/** 표 셀 전용: 빈칸은 병합 자리표시자로 보존하고, 그 외만 미확인 치환 */
function displayTableCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return "미확인";
  if (value === "") return "";
  return cleanExternalText(value);
}

/** 종합 비교표는 최종 종합점수와 예상 총부담액을 함께 강조한다. */
export function isEmphasizedReportColumn(
  columns: readonly string[],
  column: string,
): boolean {
  return column === "최종 종합점수" || column === "예상 총부담액";
}

export function isAuditCountEmphasis(text: string): boolean {
  return text === "감사 수행 건수";
}

export function isNowrapReportColumn(column: string): boolean {
  return column === "평가항목" || column === "보조금 정산 수행 여부";
}

export function reportTableCellClassName(
  columns: readonly string[],
  column: string,
  cell = column,
): string | undefined {
  const classes: string[] = [];
  if (isEmphasizedReportColumn(columns, column)) {
    classes.push("is-total-burden");
  }
  if (isAuditCountEmphasis(column) || isAuditCountEmphasis(cell)) {
    classes.push("is-audit-count");
  }
  if (isNowrapReportColumn(column)) {
    classes.push("is-nowrap");
  }
  return classes.length > 0 ? classes.join(" ") : undefined;
}

function displayStringList(values: readonly string[]): string {
  return values.length > 0
    ? values.map(safeFreeText).join(", ")
    : "미확인";
}

function displayNumber(
  value: number | null | undefined,
  unit: string,
): string {
  return value === null || value === undefined
    ? "미확인"
    : `${value.toLocaleString("en-US")}${unit}`;
}

function formatWon(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    return "미확인";
  }
  const digits = BigInt(value).toString();
  return `${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}원`;
}

function formatBasisPoints(value: number): string {
  const negative = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  return `${negative}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}점`;
}

function formatPercentBasisPoints(value: number): string {
  const negative = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  return `${negative}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}%`;
}

function formatSignedBasisPoints(value: string | null): string {
  if (value === null || !/^-?(?:0|[1-9][0-9]*)$/.test(value)) return "미확인";
  const points = BigInt(value);
  const sign = points > 0n ? "+" : points < 0n ? "-" : "";
  const absolute = points < 0n ? -points : points;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}%`;
}

function formatVat(value: boolean | null): string {
  return value === null ? "미확인" : value ? "포함" : "별도";
}

function formatExperience(value: {
  readonly hasExperience: boolean;
  readonly descriptions: readonly string[];
}) {
  const status = value.hasExperience ? "경험 있음" : "경험 미확인";
  return value.descriptions.length > 0
    ? `${status}: ${value.descriptions.map(safeFreeText).join(", ")}`
    : status;
}

function formatPartner(quote: QuoteDataSnapshot) {
  if (!quote.engagementPartner) return "미확인";
  const partner = quote.engagementPartner;
  return [
    safeFreeText(partner.name),
    partner.title ? safeFreeText(partner.title) : null,
    partner.yearsOfExperience === null
      ? null
      : `경력 ${partner.yearsOfExperience}년`,
  ].filter((value): value is string => value !== null).join(", ");
}

function formatTeam(quote: QuoteDataSnapshot) {
  return quote.engagementTeam.length > 0
    ? quote.engagementTeam.map((member) =>
      `${safeFreeText(member.name)}(${safeFreeText(member.role)}, ${displayNumber(member.plannedHours, "시간")})`
    ).join(", ")
    : "미확인";
}

function formatSchedule(quote: QuoteDataSnapshot) {
  return quote.auditSchedule.length > 0
    ? quote.auditSchedule.map((item) =>
      `${safeFreeText(item.label)}(${item.startsOn ?? "미확인"}~${item.endsOn ?? "미확인"})`
    ).join(", ")
    : "미확인";
}

function formatRequiredItems(quote: QuoteDataSnapshot) {
  const entries = Object.entries(quote.requiredProposalItems)
    .sort(([left], [right]) => compareText(left, right));
  return entries.length > 0
    ? entries.map(([id, item]) =>
      `${safeFreeText(id)}: ${item.present ? "제시" : "미제시"}${item.value ? `(${safeFreeText(item.value)})` : ""}`
    ).join(", ")
    : "미확인";
}

function formatAppliedThresholds(criterion: CriterionScoreResult) {
  return criterion.appliedThresholds.length > 0
    ? criterion.appliedThresholds.map((threshold) =>
      `${fieldLabel(threshold.field)} / ${cleanExternalText(threshold.ruleType)} / 입력 ${displayOrUnknown(threshold.normalizedInput)} / 식 ${cleanExternalText(threshold.expression)}`
    ).join(" | ")
    : "적용 기준 상세 없음";
}

function formatEvidence(criterion: CriterionScoreResult) {
  return criterion.evidence.length > 0
    ? criterion.evidence.map((evidence) =>
      `${fieldLabel(evidence.field)}: 출처 ${evidence.sources.map(mapSource).join(", ") || "미확인"}, 근거 ${evidence.evidenceIndexes.length}건, 신뢰도 ${evidence.confidenceBasisPoints === null ? "미확인" : formatPercentBasisPoints(evidence.confidenceBasisPoints)}`
    ).join(" | ")
    : "근거 상세 없음";
}

function formatEvidenceValue(value: QuoteEvidenceValue): string {
  if (value === null) return "미확인";
  if (typeof value === "string") return safeFreeText(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "미확인";
  if (typeof value === "boolean") return value ? "예" : "아니요";
  if (Array.isArray(value)) {
    return `[${value.map(formatEvidenceValue).join(", ")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, item]) => `${safeFreeText(key)}: ${formatEvidenceValue(item)}`)
    .join(", ")}}`;
}

function formatRule(rule: EvaluationConfigSnapshot["criteria"][number]["rule"]) {
  if (rule.type === "weighted-subcriteria") {
    return rule.subcriteria
      .slice()
      .sort((left, right) => compareText(left.id, right.id))
      .map((item) =>
        `${cleanExternalText(item.name)} ${formatPercentBasisPoints(item.relativeWeightBasisPoints)} ${formatLeafRule(item.rule)}`
      )
      .join(" | ");
  }
  return formatLeafRule(rule);
}

function formatLeafRule(
  rule: Exclude<
    EvaluationConfigSnapshot["criteria"][number]["rule"],
    { type: "weighted-subcriteria" }
  >,
) {
  if (rule.type === "threshold") {
    return `${fieldLabel(rule.field)} ${rule.operator} ${String(rule.threshold.value)}`;
  }
  if (rule.type === "boolean") {
    return `${fieldLabel(rule.field)} = ${rule.expected ? "예" : "아니요"}`;
  }
  if (rule.type === "informational-only") {
    return `${fieldLabel(rule.field)} 참고정보`;
  }
  if (rule.type === "checklist") {
    return `${fieldLabel(rule.field)} 체크리스트 ${rule.items.length}개`;
  }
  return `${fieldLabel(rule.field)} 구간 ${rule.bands.length}개`;
}

function mapReviewItem(code: string): string {
  const [kind, ...details] = code.split(":");
  const detail = details.join(":");
  if (kind === "missing_field" && detail in FIELD_LABELS) {
    return `${fieldLabel(detail as NormalizedAuditQuoteField)} 미확인`;
  }
  if (kind === "low_confidence" && detail in FIELD_LABELS) {
    return `${fieldLabel(detail as NormalizedAuditQuoteField)} 근거 신뢰도 확인 필요`;
  }
  if (kind === "quote_warning") {
    const [warningCode, field] = details;
    const fieldText = field && field in FIELD_LABELS
      ? `${fieldLabel(field as NormalizedAuditQuoteField)}: `
      : "";
    return `${fieldText}${mapQuoteWarning(warningCode ?? "UNKNOWN")}`;
  }
  if (kind === "comparison_kind_mismatch") {
    return `비교값 형식 확인 필요(${safeCode(detail)})`;
  }
  if (kind === "range_boundary_missing") {
    return `평가구간 경계 확인 필요(${safeCode(detail)})`;
  }
  if (kind === "range_band_not_found") {
    return `적용 평가구간 확인 필요(${safeCode(detail)})`;
  }
  if (kind === "missing_proposal_item") {
    return `제안항목 확인 필요(${safeCode(detail)})`;
  }
  return `추가 확인 항목(${safeCode(code)})`;
}

function mapFeeFlag(code: string): string {
  const labels: Record<string, string> = {
    MISSING_FEE: "감사보수 미확인",
    INVALID_FEE: "감사보수 형식 확인 필요",
    ZERO_FEE: "감사보수 0원 확인 필요",
    VAT_MISSING: "부가가치세 포함 여부 미확인",
    VAT_ASSUMED_INCLUDED: "부가가치세 포함으로 가정",
    VAT_ASSUMED_EXCLUDED: "부가가치세 별도로 가정",
    UNREALISTIC_FEE: "설정된 보수 범위 확인 필요",
    MISSING_HOURS: "총 예정시간 미확인",
    INVALID_HOURS: "총 예정시간 형식 확인 필요",
    MISSING_PARTNER_HOURS: "업무수행이사 예정시간 미확인",
    INVALID_PARTNER_HOURS: "업무수행이사 예정시간 형식 확인 필요",
    PARTNER_HOURS_EXCEEDS_TOTAL_HOURS: "이사 예정시간이 총 예정시간보다 큼",
    ABNORMALLY_LOW: "중앙값 대비 낮은 보수 신호",
    ABNORMALLY_HIGH: "중앙값 대비 높은 보수 신호",
  };
  return labels[code] ?? `추가 확인 항목(${safeCode(code)})`;
}

function mapFeeWarning(code: string): string {
  const labels: Record<string, string> = {
    TWO_QUOTE_MIDPOINT: "두 견적의 중앙값은 두 금액의 중간값입니다.",
    VAT_COMPARABILITY_WARNING: "부가가치세 조건이 달라 보수 비교 시 확인이 필요합니다.",
    HOURLY_COMPARISON_INCOMPLETE: "예정시간 누락으로 일부 시간당 보수를 확인할 수 없습니다.",
    TOTAL_FEE_COMPARISON_DISTORTED: "총보수 순서와 시간당 보수 순서가 달라 함께 검토해야 합니다.",
    OUTLIER_POLICY_NOT_CONFIGURED: "보수 이상치 정책이 설정되지 않았습니다.",
    OUTLIER_SAMPLE_TOO_SMALL: "보수 이상치 판단에 필요한 견적 수가 부족합니다.",
  };
  return labels[code] ?? `추가 확인 항목(${safeCode(code)})`;
}

function mapQuoteWarning(code: string): string {
  const labels: Record<string, string> = {
    CUSTOMER_CORRECTION_TRUSTED_VALUE_MISMATCH:
      "고객 수정값과 신뢰 원본값 차이 확인 필요",
    LOW_CONFIDENCE: "추출 근거 신뢰도 확인 필요",
    MISSING_AMOUNT_UNIT: "금액 단위 미확인",
    VAT_NOT_STATED: "부가가치세 포함 여부 미확인",
    AMBIGUOUS_VAT: "부가가치세 표시가 서로 달라 확인 필요",
  };
  return labels[code] ?? `추가 확인 항목(${safeCode(code)})`;
}

function mapSource(source: string | null) {
  const labels: Record<string, string> = {
    TRUSTED_SERVER_RECORD: "검증된 서버 원본",
    EMBEDDED_METADATA: "문서 내장정보",
    DETERMINISTIC_PARSE: "규칙 기반 추출",
    OCR: "문자인식 추출",
    AI_EXTRACTION: "AI 추출",
    CUSTOMER_CORRECTION: "고객 수정",
    ADMIN_CORRECTION: "관리자 수정",
  };
  return source === null ? "미확인" : labels[source] ?? `출처(${safeCode(source)})`;
}

function mapVatAdjustment(value: QuoteFeeAnalysis["vatAdjustment"]) {
  const labels: Record<QuoteFeeAnalysis["vatAdjustment"], string> = {
    NONE: "조정 없음",
    NORMALIZED_TO_INCLUDED: "VAT 포함 기준으로 조정",
    NORMALIZED_TO_EXCLUDED: "VAT 별도 기준으로 조정",
    ASSUMED_INCLUDED: "VAT 포함으로 가정",
    ASSUMED_EXCLUDED: "VAT 별도로 가정",
  };
  return labels[value];
}

function mapComparisonMethod(value: "LOWEST" | "MEDIAN" | "AVERAGE_RATIONAL") {
  if (value === "LOWEST") return "최솟값";
  if (value === "MEDIAN") return "중앙값";
  return "평균값";
}

function mapCorrectionReviewStatus(
  value: AuditQuoteCorrectionRecord["reviewStatus"],
) {
  const labels: Record<AuditQuoteCorrectionRecord["reviewStatus"], string> = {
    NOT_REQUIRED: "별도 검토 불필요",
    PENDING: "검토 대기",
    APPROVED: "검토 승인",
    REJECTED: "검토 반려",
  };
  return labels[value];
}

function fieldLabel(field: NormalizedAuditQuoteField) {
  return FIELD_LABELS[field];
}

function safeCode(code: string) {
  const cleaned = cleanExternalText(code);
  return scanForbiddenReportPhrases([cleaned]).length > 0
    ? "표시 제한"
    : cleaned;
}

function stripAllowedRecommendationLanguage(value: string) {
  return value
    .replace(/^부\s*적격$/g, "")
    .replace(/감사반은 평가기준상 부\s*적격/g, "")
    .replace(/부\s*적격[·\s]*우려\s*견적\s*내역/g, "")
    .replace(/평가\s*제외[·\s]*부\s*적격(?:[·\s]*우려)?(?:[·\s]*재제출\s*필요)?\s*견적(?:\s*수)?/g, "")
    .replace(/제외[·\s]*부\s*적격\s*사유/g, "")
    .replace(/감사보수가 가장 낮다는 이유만으로 특정 회계법인을 추천하지 않습니다[.]?/g, "")
    .replace(/비\s*추천/g, "")
    .replace(/추천하지\s*않(?:습니다|음|는다|도록\s*합니다)/g, "")
    .replace(/추천\s*금지/g, "");
}

function hasControlCharacters(value: string) {
  return /[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function compareText(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
