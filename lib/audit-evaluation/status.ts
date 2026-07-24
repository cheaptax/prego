import {
  AUDIT_EVALUATION_CASE_STATUSES,
  type AuditEvaluationCaseStatus,
} from "@/lib/audit-evaluation/types";

const TRANSITIONS: Readonly<
  Record<AuditEvaluationCaseStatus, readonly AuditEvaluationCaseStatus[]>
> = {
  DRAFT: ["ACCESS_PENDING", "DELETED"],
  ACCESS_PENDING: ["UPLOADING", "EXPIRED", "DELETED"],
  UPLOADING: [
    "PARSING",
    "NEEDS_REVIEW",
    "READY",
    "FAILED",
    "EXPIRED",
    "DELETED",
  ],
  PARSING: ["NEEDS_REVIEW", "READY", "FAILED", "EXPIRED", "DELETED"],
  NEEDS_REVIEW: [
    "UPLOADING",
    "PARSING",
    "READY",
    "FAILED",
    "EXPIRED",
    "DELETED",
  ],
  READY: ["GENERATING", "NEEDS_REVIEW", "EXPIRED", "DELETED"],
  GENERATING: ["COMPLETED", "FAILED", "DELETED"],
  COMPLETED: [
    "READY",
    "NEEDS_REVIEW",
    "GENERATING",
    "EXPIRED",
    "DELETED",
  ],
  FAILED: [
    "NEEDS_REVIEW",
    "READY",
    "GENERATING",
    "EXPIRED",
    "DELETED",
  ],
  EXPIRED: ["NEEDS_REVIEW", "COMPLETED", "DELETED"],
  DELETED: [],
};

export class AuditEvaluationTransitionError extends Error {
  readonly code = "invalid_audit_evaluation_status_transition";
  readonly from: AuditEvaluationCaseStatus;
  readonly to: AuditEvaluationCaseStatus;

  constructor(
    from: AuditEvaluationCaseStatus,
    to: AuditEvaluationCaseStatus,
  ) {
    super(`${from} -> ${to}`);
    this.name = "AuditEvaluationTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function isAuditEvaluationCaseStatus(
  value: string,
): value is AuditEvaluationCaseStatus {
  return AUDIT_EVALUATION_CASE_STATUSES.includes(
    value as AuditEvaluationCaseStatus,
  );
}

export function allowedAuditEvaluationNextStatuses(
  from: AuditEvaluationCaseStatus,
): readonly AuditEvaluationCaseStatus[] {
  return TRANSITIONS[from];
}

export function canTransitionAuditEvaluationStatus(
  from: AuditEvaluationCaseStatus,
  to: AuditEvaluationCaseStatus,
) {
  return from === to || TRANSITIONS[from].includes(to);
}

export function assertAuditEvaluationStatusTransition(
  from: AuditEvaluationCaseStatus,
  to: AuditEvaluationCaseStatus,
) {
  if (!canTransitionAuditEvaluationStatus(from, to)) {
    throw new AuditEvaluationTransitionError(from, to);
  }
}
