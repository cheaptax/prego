import type { VisibilityLevel } from "@/lib/platform";
import type {
  NormalizedAuditQuote,
  QuoteEvidenceValue,
  QuoteScoreResult,
  TrustedStandardQuotePayload,
} from "@/lib/audit-evaluation/types";
import type {
  NhAuditCostCalculationResult,
  NhAuditEligibilityStatus,
  NhAuditEvaluationReasonCode,
  NhAuditQualityEvaluationResult,
  NhAuditQualityWeights,
  NhAuditQuoteSubmissionV2,
} from "@/lib/audit-evaluation/nh-audit-v2-types";
import type { NhAuditPartnerFormValues } from "@/lib/quotes/nh-audit-quote-form";
import type { DataClassification } from "@/lib/cooperatives/demo-cooperative";
import type { TestDataMetadata } from "@/lib/test-data/root-metadata";

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
  role: "member" | "admin" | "partner";
  adminRole?: AdminRole;
  adminCapabilityAllow?: AdminPermission[];
  adminCapabilityDeny?: AdminPermission[];
  accountStatus?: AdminStatus;
  partnerId?: string;
  status:
    | "active"
    | "temporary_quote_member"
    | "pending_cooperative_review"
    | "rejected";
  temporaryMember?: {
    source: "audit_quote_request";
    sourceRequestIds: string[];
    activatedAt?: string;
    convertedAt?: string;
  };
  rejectedAt?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  dataClassification?: DataClassification;
  sourceInstitutionId?: string;
  testScenarioId?: string;
  testMetadata?: TestDataMetadata;
  createdAt: string;
  updatedAt: string;
};

export type AdminRole =
  | "super_admin"
  | "operations_manager"
  | "partner_manager"
  | "cms_editor"
  | "read_only";

export type AdminPermission =
  | "admin:access"
  | "admin:read"
  | "members:read"
  | "members:write"
  | "cooperatives:read"
  | "cooperatives:write"
  | "operators:read"
  | "operators:write"
  | "operators:create"
  | "operators:update"
  | "operators:disable"
  | "operators:delete"
  | "operators:manageRoles"
  | "operators:resetPassword"
  | "partners:read"
  | "partners:write"
  | "partners:create"
  | "partners:update"
  | "partners:changeStatus"
  | "partners:manageMembers"
  | "partners:manageScope"
  | "inquiries:read"
  | "inquiries:write"
  | "points:read"
  | "points:write"
  | "points:adjust"
  | "faqs:read"
  | "faqs:write"
  | "audit:read"
  | "auditQuotes:read"
  | "auditQuotes:write"
  | "auditEvaluations:read"
  | "auditEvaluations:write"
  | "cms:read"
  | "cms:write";

/** @deprecated Use AdminPermission. Kept while existing APIs migrate. */
export type AdminCapability = AdminPermission;

export type AdminScope =
  | "ALL"
  | "ORGANIZATION"
  | "PARTNER"
  | "ASSIGNED"
  | "OWN";

export type AdminStatus =
  | "invited"
  | "active"
  | "suspended"
  | "disabled";

export type PartnerStatus =
  | "pending"
  | "active"
  | "paused"
  | "terminated";

export type PartnerProfession =
  | "ACCOUNTANT"
  | "TAX_ACCOUNTANT"
  | "ATTORNEY"
  | "JUDICIAL_SCRIVENER"
  | "PATENT_ATTORNEY"
  | "CUSTOMS_BROKER"
  | "LABOR_ATTORNEY"
  | "APPRAISER"
  | "OTHER";

// Partner types are currently CMS/operator-managed free text.
export type PartnerType = string;

export type OperatorProfile = UserRecord & {
  role: "admin";
  adminRole: AdminRole;
  accountStatus?: AdminStatus;
};

export type AuthorizationContext = {
  uid: string;
  email?: string;
  accountType: UserRecord["role"];
  status: AdminStatus;
  adminRole?: AdminRole;
  permissions: AdminPermission[];
  scopes: AdminScope[];
  organizationId?: string;
  partnerId?: string;
};

export type AdminResourceDescriptor = {
  ownerId?: string;
  organizationId?: string;
  partnerId?: string;
  assignedUserIds?: string[];
  assignedPartnerId?: string;
};

export type OrganizationRecord = {
  cooperativeId: string;
  nh_org_id?: string;
  cooperativeName: string;
  walletBalance: number;
  users: string[];
  dataClassification?: DataClassification;
  sourceInstitutionId?: string;
  testScenarioId?: string;
  testMetadata?: TestDataMetadata;
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
  dataClassification?: DataClassification;
  sourceInstitutionId?: string;
  testScenarioId?: string;
  testMetadata?: TestDataMetadata;
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
  assignedPartnerId?: string;
  assignedPartnerName?: string;
  partnerAssignmentId?: string;
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
  source?: "admin" | "partner";
  partnerId?: string;
  partnerAssignmentId?: string;
  partnerDraftId?: string;
  createdBy: string;
  createdByEmail?: string;
  createdAt: string;
  updatedAt: string;
};

export type PartnerRecord = {
  id: string;
  name: string;
  displayName: string;
  partnerType: PartnerType;
  profession?: PartnerProfession;
  fields: string[];
  managerName: string;
  contactEmail: string;
  contactPhone: string;
  businessRegistrationNumber?: string;
  businessAddress?: string;
  logoPath?: string;
  logoContentType?: string;
  logoUpdatedAt?: string;
  sealPath?: string;
  sealContentType?: string;
  sealUpdatedAt?: string;
  status: PartnerStatus;
  pointMin: number;
  pointMax: number;
  memo?: string;
  createdBy: string;
  createdByEmail?: string;
  createdAt: string;
  updatedBy: string;
  updatedByEmail?: string;
  updatedAt: string;
  statusChangedAt?: string;
  statusChangedBy?: string;
  statusChangedByEmail?: string;
};

export type PartnerApplicationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "withdrawn";

export type PartnerApplicationRecord = {
  id: string;
  organizationName: string;
  displayName: string;
  profession: PartnerProfession;
  partnerType: PartnerType;
  fields: string[];
  managerName: string;
  contactEmail: string;
  contactPhone: string;
  businessRegistrationNumber?: string;
  businessAddress?: string;
  memo?: string;
  privacyConsent: boolean;
  status: PartnerApplicationStatus;
  approvedPartnerId?: string;
  approvedAccountUid?: string;
  reviewNote?: string;
  reviewedBy?: string;
  reviewedByEmail?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type PartnerAssignmentRecord = {
  id: string;
  requestId: string;
  partnerId: string;
  partnerName: string;
  status:
    | "assigned"
    | "drafting"
    | "submitted"
    | "revision_requested"
    | "approved"
    | "revoked";
  assignedBy: string;
  assignedByEmail?: string;
  assignedAt: string;
  revokedBy?: string;
  revokedAt?: string;
  revisionNote?: string;
  createdAt: string;
  updatedAt: string;
};

export type PartnerAnswerDraftRecord = {
  id: string;
  assignmentId: string;
  requestId: string;
  partnerId: string;
  body: string;
  pointCost: number;
  status: "draft" | "submitted" | "revision_requested" | "approved";
  revisionNote?: string;
  submittedAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  createdBy: string;
  createdByEmail?: string;
  createdAt: string;
  updatedAt: string;
};

export type QuoteSourceType = "consult" | "audit_quote";

export type QuoteRequestStatus =
  | "requested"
  | "assigning"
  | "assigned"
  | "quoted"
  | "delivered"
  | "closed"
  | "cancelled";

export type QuoteRequestRecord = {
  id: string;
  sourceType: QuoteSourceType;
  sourceId: string;
  sourceReference?: string;
  customerUid?: string;
  customerEmail: string;
  customerEmailHash?: string;
  customerName?: string;
  customerPhone?: string;
  cooperativeId?: string;
  cooperativeName?: string;
  fiscalYear?: number;
  subject: string;
  message?: string;
  supportField?: string;
  status: QuoteRequestStatus;
  expectedQuoteCount?: number;
  submittedQuoteCount: number;
  createdAt: string;
  updatedAt: string;
};

export type QuoteAssignmentRecord = {
  id: string;
  quoteRequestId: string;
  partnerId: string;
  partnerName: string;
  status: "assigned" | "drafting" | "submitted" | "finalized" | "revoked";
  assignedBy: string;
  assignedByEmail?: string;
  assignedAt: string;
  revokedBy?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type QuoteLineItemRecord = {
  id: string;
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  supplyAmount: number;
};

export type QuoteRecord = {
  id: string;
  quoteRequestId: string;
  quoteAssignmentId: string;
  partnerId: string;
  partnerName: string;
  status: "draft" | "finalized" | "delivered" | "void";
  version: number;
  customerEmail: string;
  supplierName: string;
  supplierBusinessRegistrationNumber?: string;
  supplierAddress?: string;
  supplierContactName?: string;
  supplierContactEmail: string;
  supplierContactPhone?: string;
  logoPath?: string;
  sealPath?: string;
  lineItems: QuoteLineItemRecord[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  vatIncluded: boolean;
  servicePeriod?: string;
  validUntil?: string;
  terms?: string;
  notes?: string;
  auditEvaluation?: {
    configId: string;
    configVersion: number;
    configName: string;
    configSource: "published" | "fallback";
    answers: Record<string, QuoteEvidenceValue>;
    normalizedQuote: NormalizedAuditQuote;
    trustedPayload?: TrustedStandardQuotePayload;
    standardQuoteDocumentId?: string;
    fiscalYear: number;
    score: QuoteScoreResult;
    criteria: Array<{
      id: string;
      name: string;
      description: string;
      weightBasisPoints: number;
      scoreBasisPoints: number;
    }>;
    evaluatedAt: string;
  };
  nhAuditV2?: {
    submission: NhAuditQuoteSubmissionV2;
    defaultQualityCriterionWeights: NhAuditQualityWeights;
    quality: NhAuditQualityEvaluationResult;
    cost: NhAuditCostCalculationResult;
    eligibilityStatus: NhAuditEligibilityStatus;
    reasonCodes: NhAuditEvaluationReasonCode[];
    evaluatedAt: string;
  };
  nhAuditDraft?: NhAuditPartnerFormValues;
  pdfPath?: string;
  pdfFileName?: string;
  finalizedAt?: string;
  deliveredAt?: string;
  createdBy: string;
  createdByEmail?: string;
  createdAt: string;
  updatedAt: string;
};

export type QuoteEmailDeliveryRecord = {
  id: string;
  quoteId: string;
  quoteRequestId: string;
  recipientEmail: string;
  status: "pending" | "sending" | "sent" | "delivered" | "bounced" | "complained" | "failed";
  provider: "resend" | "local";
  providerMessageId?: string | null;
  attemptCount: number;
  lastError?: string;
  nextAttemptAt?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
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

export type AuditLogTargetType =
  | "user"
  | "organization"
  | "request"
  | "answer"
  | "partner"
  | "partnerApplication"
  | "partnerAssignment"
  | "partnerAnswerDraft"
  | "quoteRequest"
  | "quote"
  | "quoteEmailDelivery"
  | "pointLedger"
  | "faq"
  | "auditQuote";

export type AuditLogValue =
  | string
  | number
  | boolean
  | null
  | AuditLogValue[]
  | { [key: string]: AuditLogValue };

export type AuditLogSnapshot = Record<string, AuditLogValue>;

export type AuditLogRecord = {
  id: string;
  actorUid: string;
  actorId?: string;
  actorEmail?: string;
  actorRole?: AdminRole;
  requiredPermission?: AdminPermission;
  action: string;
  targetType: AuditLogTargetType;
  targetId: string;
  before?: AuditLogSnapshot;
  after?: AuditLogSnapshot;
  requestId?: string;
  scope?: AdminScope;
  result?: "success" | "denied" | "failed";
  metadata?: Record<string, string | number | boolean | null>;
  createdAt: string;
};

export type AdminAuditLogInput = {
  actorId: string;
  actorEmail?: string;
  actorRole?: AdminRole;
  requiredPermission?: AdminPermission;
  action: string;
  targetType: AuditLogTargetType;
  targetId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  requestId?: string;
  scope?: AdminScope;
  result?: "success" | "denied" | "failed";
  metadata?: Record<string, string | number | boolean | null>;
  createdAt?: string;
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
