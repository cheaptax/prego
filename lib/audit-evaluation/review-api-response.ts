import {
  ReviewServiceError,
  reviewServiceErrorStatus,
} from "@/lib/audit-evaluation/review-service";
import { AuditEvaluationFeatureDisabledError } from "@/lib/audit-evaluation/feature-flags";

const PUBLIC_CODES = new Set([
  "invalid_input",
  "invalid_amount",
  "INVALID_AMOUNT_FORMAT",
  "MISSING_AMOUNT_UNIT",
  "NON_INTEGER_WON_AMOUNT",
  "AMOUNT_OUT_OF_RANGE",
  "invalid_vat",
  "AMBIGUOUS_VAT",
  "VAT_NOT_STATED",
  "invalid_integer",
  "invalid_partner",
  "invalid_team",
  "invalid_schedule",
  "invalid_required_proposal_item",
  "invalid_firm_id",
  "invalid_list",
  "unsupported_correction_field",
  "invalid_correction_value",
  "version_conflict",
  "case_not_editable",
  "case_not_ready",
  "readiness_failed",
  "config_not_published",
  "config_not_effective",
  "confirmation_version_conflict",
]);

export function auditEvaluationReviewApiError(error: unknown) {
  if (error instanceof AuditEvaluationFeatureDisabledError) {
    return { status: 404, error: "review_failed", issues: [] };
  }
  if (!(error instanceof ReviewServiceError)) {
    return { status: 500, error: "review_failed", issues: [] };
  }
  const status = reviewServiceErrorStatus(error.code);
  return {
    status,
    error: PUBLIC_CODES.has(error.code) ? error.code : "review_failed",
    issues: error.issues.map(({ code, quoteId, field }) => ({
      code,
      quoteId,
      field,
    })),
  };
}
