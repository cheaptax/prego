import type {
  AnswerRecord,
  AuditLogRecord,
  ConsultRequestRecord,
  OrganizationRecord,
  UserRecord,
} from "@/lib/firebase/schema";

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "request.created": "문의 등록",
  "request.completed": "상담 종료",
  "answer.upserted": "답변 등록",
  "answer.viewed": "답변 열람",
  "answer.rating.saved": "답변 평가",
  "signup.submitted": "회원가입 신청",
  "signup.retried": "회원가입 재시도",
  "user.approved": "회원 승인",
  "user.rejected": "가입 거절",
  "user.deactivated": "회원 비활성화",
  "user.reactivated": "회원 재활성화",
  "points.adjusted": "포인트 조정",
  "operator.created": "운영자 계정 생성",
  "operator.updated": "운영자 정보 수정",
  "operator.permission_changed": "운영자 권한 변경",
  "operator.password_reset": "운영자 비밀번호 재설정",
  "operator.deleted": "운영자 계정 삭제",
  "faq.created": "FAQ 등록",
  "faq.updated": "FAQ 수정",
  "faq.deleted": "FAQ 삭제",
};

export const AUDIT_TARGET_TYPE_LABELS: Record<AuditLogRecord["targetType"], string> = {
  user: "회원",
  organization: "농협",
  request: "문의",
  faq: "FAQ",
  answer: "답변",
  pointLedger: "포인트",
};

export type AuditActivityTone = "blue" | "green" | "amber" | "violet" | "slate";

const ACTIVITY_TONE: Record<AuditLogRecord["targetType"], AuditActivityTone> = {
  user: "blue",
  organization: "blue",
  faq: "violet",
  request: "amber",
  answer: "green",
  pointLedger: "violet",
};

export type AuditLogDisplayContext = {
  userByUid: Map<string, UserRecord>;
  requestById: Map<string, ConsultRequestRecord>;
  answerById: Map<string, AnswerRecord>;
  orgById: Map<string, OrganizationRecord>;
  adminEmail?: string;
};

export type AuditLogDetail = {
  actionLabel: string;
  actorName: string;
  targetLabel: string;
  targetSub: string;
  targetTypeLabel: string;
  tone: AuditActivityTone;
};

function metadataString(
  metadata: AuditLogRecord["metadata"] | undefined,
  key: string,
) {
  const value = metadata?.[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function isOperatorAudit(log: AuditLogRecord, targetUser?: UserRecord) {
  return log.action.startsWith("operator.") || targetUser?.role === "admin";
}

function resolveRequest(
  log: AuditLogRecord,
  ctx: AuditLogDisplayContext,
): ConsultRequestRecord | undefined {
  const metadataRequestId = metadataString(log.metadata, "requestId");
  if (metadataRequestId) {
    return ctx.requestById.get(metadataRequestId);
  }
  if (log.targetType === "request") {
    return ctx.requestById.get(log.targetId);
  }
  if (log.targetType === "answer") {
    const answer = ctx.answerById.get(log.targetId);
    if (answer?.requestId) {
      return ctx.requestById.get(answer.requestId);
    }
  }
  return undefined;
}

export function labelAuditAction(action: string) {
  if (AUDIT_ACTION_LABELS[action]) return AUDIT_ACTION_LABELS[action];
  return action
    .split(".")
    .map((part) => part.replace(/_/g, " "))
    .join(" ")
    .trim();
}

export function describeAuditLog(
  log: AuditLogRecord,
  ctx: AuditLogDisplayContext,
): AuditLogDetail {
  const actionLabel = labelAuditAction(log.action);
  const actorUser = ctx.userByUid.get(log.actorUid);
  const actorName =
    actorUser?.name?.trim() ||
    log.actorEmail?.trim() ||
    (log.actorUid ? "운영자" : "시스템");

  let targetLabel = "-";
  let targetSub = "";

  if (log.targetType === "user") {
    const targetUser = ctx.userByUid.get(log.targetId);
    targetLabel =
      targetUser?.name?.trim() ||
      targetUser?.email ||
      metadataString(log.metadata, "targetName") ||
      metadataString(log.metadata, "targetEmail") ||
      "회원";
    targetSub = targetUser?.cooperativeName?.trim() ?? "";
    if (!targetSub && isOperatorAudit(log, targetUser)) {
      targetSub = targetUser?.email ?? metadataString(log.metadata, "targetEmail");
    }
  } else if (log.targetType === "request" || log.targetType === "answer") {
    const request = resolveRequest(log, ctx);
    targetLabel = request?.subject?.trim() || "문의";
    targetSub = request?.requestNumber?.trim() ?? "";
  } else if (log.targetType === "organization") {
    const org = ctx.orgById.get(log.targetId);
    targetLabel = org?.cooperativeName?.trim() || "농협";
  } else if (log.targetType === "pointLedger") {
    const cooperativeId = metadataString(log.metadata, "cooperativeId");
    const org = cooperativeId ? ctx.orgById.get(cooperativeId) : undefined;
    targetLabel = org?.cooperativeName?.trim() || "포인트 변동";
    const points = metadataString(log.metadata, "points");
    const balanceAfter = metadataString(log.metadata, "balanceAfter");
    if (points) {
      const signed = Number(points);
      targetSub = `${signed >= 0 ? "+" : ""}${signed.toLocaleString()}P`;
      if (balanceAfter) {
        targetSub += ` · 잔액 ${Number(balanceAfter).toLocaleString()}P`;
      }
    }
  } else if (log.targetType === "faq") {
    const question = metadataString(log.metadata, "question");
    targetLabel = question || "FAQ";
    const category = metadataString(log.metadata, "category");
    if (category) targetSub = category;
  }

  return {
    actionLabel,
    actorName,
    targetLabel,
    targetSub,
    targetTypeLabel:
      log.targetType === "user" && isOperatorAudit(log, ctx.userByUid.get(log.targetId))
        ? "운영자"
        : AUDIT_TARGET_TYPE_LABELS[log.targetType] ?? "기타",
    tone: ACTIVITY_TONE[log.targetType] ?? "slate",
  };
}
