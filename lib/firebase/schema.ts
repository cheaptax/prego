import type { VisibilityLevel } from "@/lib/platform";

export type UserRecord = {
  uid: string;
  name: string;
  phone: string;
  email: string;
  cooperativeId?: string;
  nh_org_id?: string;
  cooperativeName?: string;
  manualCooperativeName?: string;
  position: string;
  duty: string;
  businessCardUrl?: string;
  businessCardPath?: string;
  consents: {
    terms: boolean;
    privacy: boolean;
    marketing: boolean;
    email: boolean;
    sms: boolean;
    kakao: boolean;
  };
  role: "member" | "admin";
  status: "active" | "pending_cooperative_review" | "rejected";
  rejectedAt?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationRecord = {
  cooperativeId: string;
  nh_org_id?: string;
  cooperativeName: string;
  walletBalance: number;
  users: string[];
  createdAt: string;
  updatedAt: string;
};

export type PointLedgerRecord = {
  id: string;
  cooperativeId: string;
  nh_org_id?: string;
  userId: string;
  event:
    | "first_org_signup"
    | "user_signup"
    | "answer_view"
    | "manual_adjustment"
    | "admin_adjustment_credit"
    | "admin_adjustment_debit";
  type?:
    | "question_answer_usage"
    | "admin_adjustment_credit"
    | "admin_adjustment_debit";
  amount?: number;
  points: number;
  balanceBefore?: number;
  balanceAfter: number;
  balance_before?: number;
  balance_after?: number;
  related_inquiry_id?: string;
  requestId?: string;
  answerId?: string;
  reason?: string;
  createdAt: string;
};

export type PointTransactionRecord = {
  id: string;
  cooperativeId: string;
  nh_org_id?: string;
  user_id: string;
  type:
    | "first_org_signup"
    | "user_signup"
    | "question_answer_usage"
    | "admin_adjustment_credit"
    | "admin_adjustment_debit";
  amount: number;
  balance_before: number;
  balance_after: number;
  related_inquiry_id?: string;
  requestId?: string;
  answerId?: string;
  reason?: string;
  createdAt: string;
};

export type ConsultRequestRecord = {
  id: string;
  uid: string;
  user_id?: string;
  userEmail: string;
  userName?: string;
  cooperativeId?: string;
  nh_org_id?: string;
  cooperativeName?: string;
  cooperativeDisplay?: string;
  manualCooperativeName?: string;
  sido?: string;
  sigungu?: string;
  subject: string;
  visibility: VisibilityLevel | Uppercase<VisibilityLevel> | "ORG_ONLY";
  message: string;
  attachmentNames: string[];
  attachments?: {
    name: string;
    contentType: string;
    size: number;
    path: string;
    url: string;
  }[];
  consent: boolean;
  marketingConsent: boolean;
  status:
    | "submitted"
    | "screening"
    | "assigned"
    | "answered"
    | "completed"
    | "SUBMITTED"
    | "SCREENING"
    | "ASSIGNED"
    | "ANSWERED"
    | "COMPLETED"
    | "ANSWER_READY"
    | "ANSWER_PUBLISHED"
    | "FOLLOWUP";
  internalCategory?: string;
  internal_category?: string;
  adminTags?: string[];
  parentRequestId?: string;
  isFollowUp?: boolean;
  answeredAt?: string;
  requestNumber: string;
  createdAt: string;
  updatedAt: string;
};

export type AnswerRecord = {
  id: string;
  requestId: string;
  body: string;
  pointCost: number;
  status?: "ANSWER_READY" | "ANSWER_PUBLISHED";
  createdBy: string;
  createdByEmail?: string;
  createdAt: string;
  updatedAt: string;
};

export type AnswerViewRecord = {
  id: string;
  requestId: string;
  answerId: string;
  cooperativeId: string;
  nh_org_id?: string;
  uid: string;
  pointCost: number;
  charged: boolean;
  createdAt: string;
};

export type AnswerRatingRecord = {
  id: string;
  requestId: string;
  answerId: string;
  uid: string;
  score: number;
  helpful?: boolean;
  comment?: string;
  createdAt: string;
  updatedAt: string;
};

export type AuditLogRecord = {
  id: string;
  actorUid: string;
  actorEmail?: string;
  action: string;
  targetType:
    | "user"
    | "organization"
    | "request"
    | "answer"
    | "pointLedger"
    | "faq"
    | "auditQuote";
  targetId: string;
  metadata?: Record<string, string | number | boolean | null>;
  createdAt: string;
};

export type FaqRecord = {
  id: string;
  question: string;
  answer: string;
  category: string;
  isPublic: boolean;
  displayStatus: "published" | "draft";
  order: number;
  createdBy: string;
  createdByEmail?: string;
  updatedBy: string;
  updatedByEmail?: string;
  createdAt: string;
  updatedAt: string;
};

export type {
  AuditQuoteRequestRecord,
  AuditQuoteStatus,
} from "@/lib/audit-quote/types";
