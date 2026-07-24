import { z } from "zod";
import { normalizeWonAmount } from "@/lib/audit-evaluation/money";
import { normalizedAuditQuoteSchema } from "@/lib/audit-evaluation/quote-extraction-schemas";
import { evaluationConfigSchema } from "@/lib/audit-evaluation/schemas";
import { runDeterministicQualityScoring } from "@/lib/audit-evaluation/scoring-engine";
import {
  NORMALIZED_AUDIT_QUOTE_FIELDS,
  type EvaluationConfig,
  type NormalizedAuditQuote,
} from "@/lib/audit-evaluation/types";

export type AdminConfigValidationIssue = {
  severity: "error" | "warning";
  path: string;
  message: string;
};

export type AdminConfigPreviewSummary = {
  totalScoreBasisPoints: number;
  totalScorePoints: number;
  criterionCount: number;
  requiredFieldCount: number;
  enabledReportSectionCount: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

export type AdminConfigValidationResult = {
  valid: boolean;
  issues: AdminConfigValidationIssue[];
  preview: AdminConfigPreviewSummary;
};

const instantSchema = z.string().datetime({ offset: true });
const wonSchema = z.string().regex(/^(0|[1-9]\d{0,29})$/);
const stableItemIdSchema = z.string().regex(/^[a-z][a-zA-Z0-9._-]{0,79}$/);
const checklistInputSchema = z
  .object({
    itemId: stableItemIdSchema,
    checked: z.boolean(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const adminConfigPatchPayloadSchema = z
  .object({
    expectedDraftRevision: z.number().int().positive(),
    changes: z
      .object({
        name: z.unknown().optional(),
        effectiveFrom: z.unknown().optional(),
        effectiveTo: z.unknown().optional(),
        criteria: z.unknown().optional(),
        requiredFields: z.unknown().optional(),
        reportSections: z.unknown().optional(),
        reportPhrases: z.unknown().optional(),
        reportRenderingPolicy: z.unknown().optional(),
        retentionPolicy: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();

export const adminConfigActionPayloadSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createDefault") }).strict(),
  z
    .object({
      action: z.literal("cloneVersion"),
      configId: stableItemIdSchema,
      version: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal("republishVersion"),
      configId: stableItemIdSchema,
      version: z.number().int().positive(),
    })
    .strict(),
]);

export const adminConfigPublishPayloadSchema = z
  .object({
    expectedDraftRevision: z.number().int().positive(),
    confirmWarnings: z.boolean().default(false),
  })
  .strict();

export const adminConfigCalculatePayloadSchema = z
  .object({
    config: z.unknown(),
    sample: z
      .object({
        quoteId: stableItemIdSchema.default("preview-quote"),
        accountingFirmName: z.string().trim().min(1).max(300),
        accountingFirmRevenueWon: wonSchema.nullable().default(null),
        recentNonghyupAuditCount: z.number().int().nonnegative().safe().nullable(),
        auditedNonghyupTypes: z.array(z.string().trim().min(1).max(200)).max(100),
        auditedNonghyupTypeCount: z.number().int().min(0).max(100).optional(),
        taxAgencyExperience: z.boolean(),
        subsidySettlementExperience: z.boolean(),
        totalPlannedHours: z.number().int().nonnegative().safe().nullable().default(null),
        partnerHours: z.number().int().nonnegative().safe().nullable().default(null),
        auditPlanChecklist: z.array(checklistInputSchema).max(100).default([]),
        proposalChecklist: z.array(checklistInputSchema).max(100).default([]),
        qualityControlPlan: z.array(z.string().trim().min(1).max(2_000)).max(100).default([]),
      })
      .strict()
      .superRefine((sample, context) => {
        if (
          sample.auditedNonghyupTypeCount !== undefined &&
          sample.auditedNonghyupTypeCount < sample.auditedNonghyupTypes.length
        ) {
          context.addIssue({
            code: "custom",
            path: ["auditedNonghyupTypeCount"],
            message: "선택한 농협 종류 수보다 작을 수 없습니다.",
          });
        }
      }),
  })
  .strict();

export function buildPatchedDraft(input: {
  existing: EvaluationConfig;
  changes: z.infer<typeof adminConfigPatchPayloadSchema>["changes"];
  actorUid: string;
  now: string;
}): EvaluationConfig {
  if (input.existing.status !== "DRAFT") {
    throw new AdminConfigValidationError("published_version_immutable");
  }
  const candidate = {
    ...input.existing,
    ...input.changes,
    id: input.existing.id,
    version: input.existing.version,
    status: input.existing.status,
    minimumQuoteCount: input.existing.minimumQuoteCount,
    maximumQuoteCount: input.existing.maximumQuoteCount,
    uploadLimit: input.existing.uploadLimit,
    permittedMimeTypes: input.existing.permittedMimeTypes,
    maximumFileSize: input.existing.maximumFileSize,
    feeAnalysisPolicy: input.existing.feeAnalysisPolicy,
    requiredFields:
      input.changes.requiredFields ?? input.existing.requiredFields,
    retentionPolicy:
      input.changes.retentionPolicy ?? input.existing.retentionPolicy,
    customerAccessPolicy: input.existing.customerAccessPolicy,
    quoteExtractionPolicy: input.existing.quoteExtractionPolicy,
    customerCorrectionPolicy: input.existing.customerCorrectionPolicy,
    createdBy: input.existing.createdBy,
    createdAt: input.existing.createdAt,
    draftRevision: (input.existing.draftRevision ?? 1) + 1,
    updatedBy: input.actorUid,
    updatedAt: input.now,
    publishedBy: null,
    publishedAt: null,
  };
  const parsed = evaluationConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new AdminConfigValidationError(
      "validation_failed",
      zodIssues(parsed.error.issues),
    );
  }
  return parsed.data;
}

export function validateEvaluationConfigForPublish(
  config: unknown,
  otherPublishedVersions: readonly EvaluationConfig[] = [],
): AdminConfigValidationResult {
  const draftResult = evaluationConfigSchema.safeParse(config);
  const preview = previewSummary(
    draftResult.success ? draftResult.data : config,
  );
  if (!draftResult.success) {
    const issues = zodIssues(draftResult.error.issues);
    return { valid: false, issues, preview };
  }

  const candidate = {
    ...draftResult.data,
    status: "PUBLISHED" as const,
    publishedBy: draftResult.data.publishedBy ?? "validation-preview",
    publishedAt: draftResult.data.publishedAt ?? new Date(0).toISOString(),
  };
  const publishResult = evaluationConfigSchema.safeParse(candidate);
  const issues = publishResult.success
    ? []
    : zodIssues(publishResult.error.issues);

  const mandatorySectionTypes = [
    "COVER",
    "PURPOSE_SCOPE",
    "OVERALL_OPINION",
    "APPENDIX",
  ] as const;
  const usesStructuredReport = candidate.reportSections.some(
    ({ type }) =>
      mandatorySectionTypes.includes(
        type as (typeof mandatorySectionTypes)[number],
      ),
  );
  if (usesStructuredReport) {
    for (const type of mandatorySectionTypes) {
      if (
        !candidate.reportSections.some(
          (section) => section.type === type && section.enabled,
        )
      ) {
        issues.push({
          severity: "error",
          path: "reportSections",
          message: `${type} 필수 보고서 영역은 숨길 수 없습니다.`,
        });
      }
    }
  }
  if (
    new Set(candidate.reportSections.map(({ type }) => type)).size !==
      candidate.reportSections.length
  ) {
    issues.push({
      severity: "error",
      path: "reportSections",
      message: "같은 종류의 보고서 영역을 두 번 등록할 수 없습니다.",
    });
  }

  const primary = candidate.reportRenderingPolicy?.primaryColor;
  const accent = candidate.reportRenderingPolicy?.accentColor;
  if (
    (primary && contrastRatio(primary, "#FFFFFF") < 4.5) ||
    (accent && contrastRatio(accent, "#FFFFFF") < 3)
  ) {
    issues.push({
      severity: "warning",
      path: "reportRenderingPolicy",
      message:
        "선택한 색상은 흰색 배경과의 인쇄 대비가 낮을 수 있습니다. 미리보기를 확인해 주세요.",
    });
  }
  if (candidate.retentionPolicy.deleteAfterExpiry) {
    issues.push({
      severity: "warning",
      path: "retentionPolicy.deleteAfterExpiry",
      message:
        "게시 후 매일 자동 만료 삭제가 실행됩니다. 각 보존기간과 삭제 영향을 확인해 주세요.",
    });
  }
  const customerDownloadDays =
    candidate.reportRenderingPolicy?.customerDownloadDays ?? 30;
  if (candidate.retentionPolicy.reportDays < customerDownloadDays) {
    issues.push({
      severity: "error",
      path: "retentionPolicy.reportDays",
      message:
        "보고서 보존기간은 고객 다운로드 가능 기간보다 짧을 수 없습니다.",
    });
  }

  for (const published of otherPublishedVersions) {
    if (
      (published.id !== candidate.id ||
        published.version !== candidate.version) &&
      published.status === "PUBLISHED" &&
      periodsOverlap(candidate, published)
    ) {
      issues.push({
        severity: published.id === candidate.id ? "warning" : "error",
        path: "effectiveFrom",
        message:
          published.id === candidate.id
            ? `게시 버전 v${published.version}의 적용기간과 겹칩니다. 게시하면 기존 게시 버전은 보관 처리됩니다.`
            : `다른 평가기준 ${published.id} v${published.version}의 적용기간과 겹칩니다. 하나의 기간에는 하나의 평가기준만 게시할 수 있습니다.`,
      });
    }
  }

  return {
    valid: issues.every((issue) => issue.severity !== "error"),
    issues,
    preview: previewSummary(candidate),
  };
}

export function createPublishedCandidate(input: {
  draft: EvaluationConfig;
  actorUid: string;
  now: string;
}): EvaluationConfig {
  return evaluationConfigSchema.parse({
    ...input.draft,
    status: "PUBLISHED",
    updatedBy: input.actorUid,
    updatedAt: input.now,
    publishedBy: input.actorUid,
    publishedAt: input.now,
  });
}

export function calculateEvaluationPreview(
  payload: z.infer<typeof adminConfigCalculatePayloadSchema>,
) {
  const validation = validateEvaluationConfigForPublish(payload.config);
  if (!validation.valid) {
    throw new AdminConfigValidationError("validation_failed", validation.issues);
  }
  const parsed = evaluationConfigSchema.parse(payload.config);
  const published = createPublishedCandidate({
    draft: { ...parsed, status: "DRAFT", publishedBy: null, publishedAt: null },
    actorUid: "calculator-preview",
    now: new Date(0).toISOString(),
  });
  const quote = sampleToNormalizedQuote(payload.sample);
  const result = runDeterministicQualityScoring(published, [quote]);
  return {
    validation,
    score: result.quotes[0],
    engineVersion: result.engineVersion,
    maximumScoreBasisPoints: result.maximumScoreBasisPoints,
  };
}

export class AdminConfigValidationError extends Error {
  constructor(
    readonly code: "validation_failed" | "published_version_immutable",
    readonly issues: AdminConfigValidationIssue[] = [],
  ) {
    super(code);
    this.name = "AdminConfigValidationError";
  }
}

function sampleToNormalizedQuote(
  sample: z.infer<typeof adminConfigCalculatePayloadSchema>["sample"],
): NormalizedAuditQuote {
  const checklist = [...sample.auditPlanChecklist, ...sample.proposalChecklist];
  const auditedNonghyupTypes = [
    ...sample.auditedNonghyupTypes,
    ...Array.from(
      {
        length: Math.max(
          0,
          (sample.auditedNonghyupTypeCount ??
            sample.auditedNonghyupTypes.length) -
            sample.auditedNonghyupTypes.length,
        ),
      },
      (_, index) => `기타 농협 유형 ${index + 1}`,
    ),
  ];
  const requiredProposalItems = Object.fromEntries(
    checklist.map((item) => [
      item.itemId,
      { present: item.checked, value: item.note ?? null },
    ]),
  );
  const missingFields = NORMALIZED_AUDIT_QUOTE_FIELDS.filter((field) => {
    switch (field) {
      case "accountingFirmRevenue":
        return sample.accountingFirmRevenueWon === null;
      case "recentNonghyupAuditCount":
        return sample.recentNonghyupAuditCount === null;
      case "auditedNonghyupTypes":
        return auditedNonghyupTypes.length === 0;
      case "totalPlannedHours":
        return sample.totalPlannedHours === null;
      case "partnerHours":
        return sample.partnerHours === null;
      case "qualityControlPlan":
        return sample.qualityControlPlan.length === 0;
      case "engagementTeam":
        return sample.auditPlanChecklist.length === 0;
      case "requiredProposalItems":
        return sample.proposalChecklist.length === 0;
      case "accountingFirmId":
      case "auditFee":
      case "vatIncluded":
      case "engagementPartner":
      case "auditSchedule":
        return true;
      default:
        return false;
    }
  });
  return normalizedAuditQuoteSchema.parse({
    quoteId: sample.quoteId,
    caseId: "calculator-preview",
    documentId: "calculator-preview",
    accountingFirmId: null,
    accountingFirmName: sample.accountingFirmName,
    auditFee: null,
    vatIncluded: null,
    accountingFirmRevenue: sample.accountingFirmRevenueWon === null
      ? null
      : normalizeWonAmount(sample.accountingFirmRevenueWon),
    recentNonghyupAuditCount: sample.recentNonghyupAuditCount,
    auditedNonghyupTypes,
    taxAgencyExperience: {
      hasExperience: sample.taxAgencyExperience,
      descriptions: [],
    },
    subsidySettlementExperience: {
      hasExperience: sample.subsidySettlementExperience,
      descriptions: [],
    },
    engagementPartner: null,
    engagementTeam: sample.auditPlanChecklist
      .filter((item) => item.checked)
      .map((item) => ({
        name: item.itemId,
        role: item.note ?? "체크 항목",
        plannedHours: null,
      })),
    totalPlannedHours: sample.totalPlannedHours,
    partnerHours: sample.partnerHours,
    auditSchedule: [],
    qualityControlPlan: sample.qualityControlPlan,
    requiredProposalItems,
    missingFields,
    warnings: [],
    confidenceByField: {},
    evidenceByField: {},
    source: {},
    confirmedByCustomer: false,
    confirmedAt: null,
  });
}

export function periodsOverlap(left: EvaluationConfig, right: EvaluationConfig) {
  const leftStart = left.effectiveFrom ? Date.parse(left.effectiveFrom) : -Infinity;
  const leftEnd = left.effectiveTo ? Date.parse(left.effectiveTo) : Infinity;
  const rightStart = right.effectiveFrom ? Date.parse(right.effectiveFrom) : -Infinity;
  const rightEnd = right.effectiveTo ? Date.parse(right.effectiveTo) : Infinity;
  return leftStart < rightEnd && rightStart < leftEnd;
}

function contrastRatio(left: string, right: string) {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) =>
      Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    ).map((channel) =>
      channel <= 0.03928
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    );
    return (
      0.2126 * channels[0] +
      0.7152 * channels[1] +
      0.0722 * channels[2]
    );
  };
  const first = luminance(left);
  const second = luminance(right);
  return (Math.max(first, second) + 0.05) /
    (Math.min(first, second) + 0.05);
}

function previewSummary(value: unknown): AdminConfigPreviewSummary {
  const candidate = value as Partial<EvaluationConfig> | null;
  const criteria = Array.isArray(candidate?.criteria) ? candidate.criteria : [];
  const sections = Array.isArray(candidate?.reportSections)
    ? candidate.reportSections
    : [];
  const requiredFields = Array.isArray(candidate?.requiredFields)
    ? candidate.requiredFields
    : [];
  const totalScoreBasisPoints = criteria.reduce(
    (sum, criterion) =>
      sum +
      (typeof criterion?.weightBasisPoints === "number"
        ? criterion.weightBasisPoints
        : 0),
    0,
  );
  return {
    totalScoreBasisPoints,
    totalScorePoints: totalScoreBasisPoints / 100,
    criterionCount: criteria.length,
    requiredFieldCount: requiredFields.length,
    enabledReportSectionCount: sections.filter(
      (section) => section?.enabled === true,
    ).length,
    effectiveFrom:
      typeof candidate?.effectiveFrom === "string"
        ? candidate.effectiveFrom
        : null,
    effectiveTo:
      typeof candidate?.effectiveTo === "string" ? candidate.effectiveTo : null,
  };
}

function zodIssues(
  issues: readonly z.core.$ZodIssue[],
): AdminConfigValidationIssue[] {
  return issues.map((issue) => ({
    severity: "error",
    path: issue.path.map(String).join(".") || "config",
    message: koreanValidationMessage(issue),
  }));
}

function koreanValidationMessage(issue: z.core.$ZodIssue) {
  const path = issue.path.map(String).join(".");
  if (path === "criteria") {
    return "평가기준의 총 배점은 10,000bp(100점)여야 합니다.";
  }
  if (path === "requiredFields") {
    return "필수 입력 필드는 최소 1개 이상이어야 합니다.";
  }
  if (path.includes(".bands")) {
    if (issue.message.includes("overlap")) {
      return "구간 기준이 서로 중복됩니다.";
    }
    if (issue.message.includes("gaps") || issue.message.includes("cover")) {
      return "게시할 구간 기준에는 공백이 없어야 하며 전체 범위를 포함해야 합니다.";
    }
    return "구간 기준의 시작값과 종료값을 확인해 주세요.";
  }
  if (path.includes("weightBasisPoints") || path.includes("scoreBasisPoints")) {
    return "배점은 음수가 될 수 없으며 허용 범위 안의 정수여야 합니다.";
  }
  if (path === "effectiveTo") {
    return "적용 종료일은 적용 시작일보다 뒤여야 합니다.";
  }
  if (issue.message.includes("Executable markup")) {
    return "HTML, JavaScript 또는 CSS 실행 코드는 입력할 수 없습니다.";
  }
  if (issue.message.includes("Published checklist")) {
    return "게시할 체크리스트는 항목이 있어야 하며 배점 합계가 10,000bp여야 합니다.";
  }
  return `입력값을 확인해 주세요: ${path || "config"}`;
}

export { instantSchema as adminConfigInstantSchema };
