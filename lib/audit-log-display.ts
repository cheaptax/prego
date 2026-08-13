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
  "user.cooperative_changed": "회원 소속 농협 변경",
  "member.bulk_cooperative_reassigned": "회원 소속 농협 일괄 재배정",
  "cooperative.created": "농협 마스터 신규 등록",
  "cooperative.updated": "농협 마스터 정보 변경",
  "cooperative.merged": "농협 통합 처리",
  "cooperative.closed": "농협 폐쇄 처리",
  "cooperative.reactivated": "농협 운영 재개",
  "points.adjusted": "포인트 조정",
  "operator.created": "운영자 계정 생성",
  "operator.multi_role_promoted": "테스트 계정 멀티롤 운영자 승격",
  "operator.updated": "운영자 정보 수정",
  "operator.permission_changed": "운영자 권한 변경",
  "operator.password_reset": "운영자 비밀번호 재설정",
  "operator.deleted": "운영자 계정 삭제",
  "faq.created": "FAQ 등록",
  "faq.updated": "FAQ 수정",
  "faq.deleted": "FAQ 삭제",
  "audit_quote.updated": "회계감사 견적 접수 수정",
  "audit_quote.notify_retry": "회계감사 견적 알림 재시도",
  "partner.created": "제휴사 등록",
  "partner.updated": "제휴사 수정",
  "partner.logo_uploaded": "제휴사 로고 등록",
  "partner.seal_uploaded": "제휴사 직인 등록",
  "partner.quote_profile_updated": "제휴사 견적 기본정보 수정",
  "partner.account_created": "제휴사 계정 생성",
  "partner.account_multi_role_attached": "테스트 계정 멀티롤 제휴사 연결",
  "inquiry.assignment.created": "제휴사 문의 배정",
  "inquiry.assignment.revoked": "제휴사 문의 배정 회수",
  "partner.answer.saved": "제휴사 답변 초안 저장",
  "partner.answer.submitted": "제휴사 답변 초안 제출",
  "partner.answer.approved": "제휴사 답변 승인",
  "partner.answer.revision_requested": "제휴사 답변 수정 요청",
  "partner_application.submitted": "제휴 신청 접수",
  "partner_application.approved": "제휴 신청 승인",
  "partner_application.rejected": "제휴 신청 반려",
  "quote.assignment.created": "견적 요청 배정",
  "quote.finalized": "견적서 확정",
  "quote.download_url_created": "견적서 다운로드 URL 발급",
};

export const AUDIT_TARGET_TYPE_LABELS: Record<AuditLogRecord["targetType"], string> = {
  user: "회원",
  organization: "농협",
  request: "문의",
  faq: "FAQ",
  answer: "답변",
  partner: "제휴사",
  partnerApplication: "제휴 신청",
  partnerAssignment: "제휴사 배정",
  partnerAnswerDraft: "제휴사 답변 초안",
  quoteRequest: "견적 요청",
  quote: "견적서",
  quoteEmailDelivery: "견적 메일",
  pointLedger: "포인트",
  auditQuote: "회계감사 견적",
};

export type AuditActivityTone = "blue" | "green" | "amber" | "violet" | "slate";

const ACTIVITY_TONE: Record<AuditLogRecord["targetType"], AuditActivityTone> = {
  user: "blue",
  organization: "blue",
  faq: "violet",
  request: "amber",
  answer: "green",
  partner: "blue",
  partnerApplication: "blue",
  partnerAssignment: "amber",
  partnerAnswerDraft: "green",
  quoteRequest: "amber",
  quote: "green",
  quoteEmailDelivery: "violet",
  pointLedger: "violet",
  auditQuote: "amber",
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
  } else if (log.targetType === "auditQuote") {
    targetLabel =
      metadataString(log.metadata, "publicReference") || "회계감사 견적";
    const fromStatus = metadataString(log.metadata, "fromStatus");
    const toStatus = metadataString(log.metadata, "toStatus");
    if (fromStatus && toStatus) {
      targetSub = `${fromStatus} → ${toStatus}`;
    }
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
