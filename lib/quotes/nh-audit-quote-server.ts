import {
  calculateNhAuditExpectedCostV2,
  calculateNhAuditQualityScoreV2,
} from "@/lib/audit-evaluation/nh-audit-v2-engine";
import {
  createDefaultNhAuditCustomerWeightsV2,
  parseNhAuditPartnerSubmissionInputV2,
  validateNhAuditQuoteSubmissionV2,
} from "@/lib/audit-evaluation/nh-audit-v2-schemas";
import {
  NH_AUDIT_PARTNER_SUBMISSION_FIELDS,
  NH_AUDIT_QUALITY_CRITERION_IDS,
  NH_AUDIT_QUOTE_SUBMISSION_SCHEMA_VERSION,
  type NhAuditPartnerSubmissionInputV2,
  type NhAuditQuoteSubmissionV2,
  type NhAuditSubmissionValidationIssue,
} from "@/lib/audit-evaluation/nh-audit-v2-types";
import type {
  QuoteAssignmentRecord,
  QuoteRecord,
  QuoteRequestRecord,
} from "@/lib/firebase/schema";

export type TrustedNhAuditSubmissionContext = {
  submissionId: string;
  quoteRequestId: string;
  targetCooperativeId: string | null;
  targetCooperativeName: string;
  fiscalYear: number;
  partnerAccountId: string;
  accountingFirmName: string;
  submittedAt: string;
};

export type BuildTrustedNhAuditSubmissionResult =
  | { success: true; submission: NhAuditQuoteSubmissionV2; issues: [] }
  | {
      success: false;
      submission: null;
      issues: NhAuditSubmissionValidationIssue[];
    };

export type NhAuditQuoteCompatibility =
  | {
      status: "CURRENT";
      evaluationStandardVersion: string;
      missingFields: [];
      reasonCodes: string[];
    }
  | {
      status: "RESUBMISSION_REQUIRED";
      evaluationStandardVersion: null;
      missingFields: string[];
      reasonCodes: ["LEGACY_DOCUMENT_MISSING_REQUIRED_FIELDS"] | [
        "SERVER_VALIDATION_FAILED",
      ];
    };

export function buildTrustedNhAuditSubmissionV2(
  clientValue: unknown,
  context: TrustedNhAuditSubmissionContext,
): BuildTrustedNhAuditSubmissionResult {
  const parsedClient = parseNhAuditPartnerSubmissionInputV2(clientValue);
  if (!parsedClient.success) {
    return {
      success: false,
      submission: null,
      issues: parsedClient.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        code: issue.code,
        message: issue.message,
      })),
    };
  }

  const candidate: NhAuditQuoteSubmissionV2 = {
    schemaVersion: NH_AUDIT_QUOTE_SUBMISSION_SCHEMA_VERSION,
    submissionId: context.submissionId,
    quoteRequestId: context.quoteRequestId,
    targetCooperative: {
      id: context.targetCooperativeId,
      name: context.targetCooperativeName,
    },
    fiscalYear: context.fiscalYear,
    partnerAccountId: context.partnerAccountId,
    accountingFirmName: context.accountingFirmName,
    ...parsedClient.data,
    submittedAt: context.submittedAt,
  };
  const validated = validateNhAuditQuoteSubmissionV2(candidate);
  return validated.success
    ? { success: true, submission: validated.data, issues: [] }
    : {
        success: false,
        submission: null,
        issues: validated.issues,
      };
}

export function createNhAuditEvaluationSnapshotV2(
  submission: NhAuditQuoteSubmissionV2,
  evaluatedAt: string,
): NonNullable<QuoteRecord["nhAuditV2"]> {
  const defaultWeights = createDefaultNhAuditCustomerWeightsV2();
  return {
    submission,
    defaultQualityCriterionWeights: {
      ...defaultWeights.qualityCriterionWeights,
    },
    quality: calculateNhAuditQualityScoreV2(submission, defaultWeights),
    cost: calculateNhAuditExpectedCostV2(submission),
    eligibilityStatus:
      submission.proposerType === "AUDIT_GROUP"
        ? "INELIGIBLE"
        : "ELIGIBLE",
    reasonCodes:
      submission.proposerType === "AUDIT_GROUP"
        ? ["AUDIT_GROUP_PROPOSER"]
        : [],
    evaluatedAt,
  };
}

export function resolveNhAuditQuoteCompatibility(
  quote: QuoteRecord,
  sourceType: QuoteRequestRecord["sourceType"],
): NhAuditQuoteCompatibility | null {
  if (sourceType !== "audit_quote") return null;
  if (!quote.nhAuditV2) {
    return {
      status: "RESUBMISSION_REQUIRED",
      evaluationStandardVersion: null,
      missingFields: [...NH_AUDIT_PARTNER_SUBMISSION_FIELDS],
      reasonCodes: ["LEGACY_DOCUMENT_MISSING_REQUIRED_FIELDS"],
    };
  }
  const validation = validateNhAuditQuoteSubmissionV2(
    quote.nhAuditV2.submission,
  );
  if (!validation.success) {
    const issueFields = validation.issues
      .map((issue) => issue.path.split(".")[0])
      .filter(Boolean);
    return {
      status: "RESUBMISSION_REQUIRED",
      evaluationStandardVersion: null,
      missingFields: [
        ...new Set([...validation.missingFields, ...issueFields]),
      ],
      reasonCodes: ["SERVER_VALIDATION_FAILED"],
    };
  }
  if (!hasCompleteEvaluationSnapshot(quote.nhAuditV2)) {
    return {
      status: "RESUBMISSION_REQUIRED",
      evaluationStandardVersion: null,
      missingFields: ["evaluationSnapshot"],
      reasonCodes: ["SERVER_VALIDATION_FAILED"],
    };
  }
  return {
    status: "CURRENT",
    evaluationStandardVersion:
      quote.nhAuditV2.quality.evaluationStandardVersion,
    missingFields: [],
    reasonCodes: [...quote.nhAuditV2.reasonCodes],
  };
}

export function canPartnerMutateQuoteAssignment(input: {
  authenticatedPartnerId: string;
  assignment: Pick<QuoteAssignmentRecord, "partnerId" | "status">;
  quoteRequest: Pick<QuoteRequestRecord, "status">;
}) {
  return (
    input.assignment.partnerId === input.authenticatedPartnerId &&
    ["assigned", "drafting"].includes(input.assignment.status) &&
    !["closed", "cancelled"].includes(input.quoteRequest.status)
  );
}

export function nextImmutableQuoteVersion(
  versions: readonly number[],
): number {
  const valid = versions.filter(
    (version) => Number.isSafeInteger(version) && version > 0,
  );
  return (valid.length > 0 ? Math.max(...valid) : 0) + 1;
}

export function pickPartnerSubmissionFields(
  submission: NhAuditQuoteSubmissionV2,
): NhAuditPartnerSubmissionInputV2 {
  return Object.fromEntries(
    NH_AUDIT_PARTNER_SUBMISSION_FIELDS.map((field) => [
      field,
      submission[field],
    ]),
  ) as NhAuditPartnerSubmissionInputV2;
}

function hasCompleteEvaluationSnapshot(
  snapshot: NonNullable<QuoteRecord["nhAuditV2"]>,
) {
  const weights = snapshot.defaultQualityCriterionWeights;
  const weightValues = weights
    ? NH_AUDIT_QUALITY_CRITERION_IDS.map((criterionId) =>
        Number(weights[criterionId]),
      )
    : [];
  return Boolean(
    weights &&
      weightValues.length === NH_AUDIT_QUALITY_CRITERION_IDS.length &&
      weightValues.every(
        (weight) => Number.isSafeInteger(weight) && weight >= 0,
      ) &&
      weightValues.reduce((total, weight) => total + weight, 0) === 100 &&
      snapshot.quality?.criteria?.length ===
        NH_AUDIT_QUALITY_CRITERION_IDS.length &&
      snapshot.quality.qualityScore &&
      snapshot.cost?.supplyAmountWon &&
      snapshot.cost.vatWon &&
      snapshot.cost.expectedTotalBurdenWon &&
      ["ELIGIBLE", "INELIGIBLE", "EXCLUDED"].includes(
        snapshot.eligibilityStatus,
      ) &&
      !Number.isNaN(Date.parse(snapshot.evaluatedAt)),
  );
}
