"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { logoutPortalSession } from "@/lib/auth/login-client";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { describeAuditLog } from "@/lib/audit-log-display";
import {
  getMemberStatusTone,
  isActiveMember,
  isInactiveMember,
  isPendingMember,
} from "@/lib/member-status";
import {
  ANSWER_POINT_MAX,
  ANSWER_POINT_MIN,
  formatAnswerPointRangeLabel,
  formatPointInput,
  isValidAnswerPointCost,
  parsePointInput,
} from "@/lib/answer-points";
import {
  getAssignedSupportFieldLabel,
  getCustomerInquiryTypeLabel,
  INQUIRY_SUPPORT_FIELD_OPTIONS,
  isAutoAssignedInquiry,
  isValidSupportFieldLabel,
} from "@/lib/inquiry-categories";
import {
  getRatingSatisfactionTone,
} from "@/lib/rating-display";
import {
  compareAdminInquiryRows,
  getRequestStatusTone,
  matchesRequestStatusFilter,
  resolveRequestStatus,
  type ResolvedRequestStatus,
} from "@/lib/request-status";
import type {
  AnswerRecord,
  AnswerRatingRecord,
  AnswerViewRecord,
  AdminCapability,
  AdminPermission,
  AdminRole,
  AuditLogRecord,
  AuthorizationContext,
  ConsultRequestRecord,
  FaqRecord,
  OrganizationRecord,
  PartnerAnswerDraftRecord,
  PartnerAssignmentRecord,
  PartnerRecord,
  PointLedgerRecord,
  PointTransactionRecord,
  UserRecord,
} from "@/lib/firebase/schema";
import {
  ADMIN_CAPABILITIES,
  ADMIN_ROLE_LABELS,
  ADMIN_ROLES,
  getAdminRole,
} from "@/lib/admin/rbac";
import {
  canShowAdminAction,
  canShowAdminMenu,
} from "@/lib/admin/menu-permissions";
import { PartnerManagementPanel as PartnerManagementApiPanel } from "@/components/admin/PartnerManagementPanel";
import { CmsSupplementalSections } from "@/components/cms/CmsSupplementalSections";
import {
  MANAGEABLE_ADMIN_PERMISSIONS,
  OPERATOR_PAGE_SIZE_OPTIONS,
  dangerousOperatorChanges,
  getAssignableAdminRoles,
  getRolePermissionPreview,
  operatorAccountStatus,
  operatorProtection,
  operatorServerErrorCopyKey,
  permissionCopyKeys,
  validateOperatorForm,
  type OperatorFormErrors,
  type OperatorListItem,
} from "@/lib/admin/operator-ui";
import { AdminAuditQuotesPanel } from "@/components/AdminAuditQuotesPanel";
import {
  ADMIN_FAQ_CATEGORIES,
  ADMIN_FAQ_DISPLAY_FILTERS,
  ADMIN_FAQ_PUBLIC_FILTERS,
  ADMIN_OPERATION_TAB_SECTION_IDS,
  ADMIN_REQUEST_STATUS_FILTERS,
  ADMIN_VISIBILITY_FILTERS,
  createAdminOperationsCopy,
  type AdminOperationTabId,
  type AdminOperationsCopy,
} from "@/lib/cms/admin-operations-content";
import { ADMIN_OPERATIONS_PREVIEW_DATA } from "@/lib/cms/admin-operations-preview";
import {
  cmsEditableSectionProps,
  type CmsSectionEditingOptions,
} from "@/lib/cms/editable-section";
import { getCmsSection } from "@/lib/cms/runtime";
import type { CmsPageContent } from "@/lib/cms/schemas";
import {
  formatCooperativeSearchSubtitle,
  type CooperativeSearchItem,
} from "@/lib/cooperatives/demo-cooperative";
import { partitionAdminDashboardData } from "@/lib/admin/dashboard-classification";
import { CooperativeMasterPanel } from "@/components/admin/CooperativeMasterPanel";
import { CooperativeQuotePriceMasterPanel } from "@/components/admin/CooperativeQuotePriceMasterPanel";
import { PortalSitemap } from "@/components/PortalSitemap";
import type { PortalSitemapModel } from "@/lib/sitemap/portal-sitemap";

const AdminAuditEvaluationPanel = dynamic(
  () =>
    import("@/components/AdminAuditEvaluationPanel").then(
      (module) => module.AdminAuditEvaluationPanel,
    ),
);

type State = "loading" | "ready" | "denied" | "error";

type TabKey = AdminOperationTabId;
const EMPTY_ADMIN_SITEMAP: PortalSitemapModel = {
  role: "admin",
  groups: [],
  routeCount: 0,
};
type MemberSubtab = "members" | "operators" | "cooperatives";
type OperatorEditorState = {
  mode: "create" | "edit";
  operator: UserRecord | null;
  serverError?: string;
};

type OperatorMutationPayload = {
  name: string;
  email: string;
  password?: string;
  position: string;
  duty: string;
  status?: UserRecord["status"];
  adminRole?: AdminRole;
  adminCapabilityAllow?: AdminCapability[];
  adminCapabilityDeny?: AdminCapability[];
};

type OperatorConfirmationState = {
  kind: "permission" | "password" | "delete" | "update";
  operator: UserRecord;
  nextStatus?: UserRecord["status"];
  payload?: OperatorMutationPayload;
  warningKeys?: string[];
};

const AdminOperationsCopyContext =
  createContext<AdminOperationsCopy | null>(null);

function useAdminOperationsCopy() {
  const value = useContext(AdminOperationsCopyContext);
  if (!value) {
    throw new Error("Admin operations copy is unavailable.");
  }
  return value;
}

function useModalFocus<T extends HTMLElement>(
  onClose: () => void,
  locked = false,
) {
  const panelRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (locked) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    panel?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(focusableSelector)];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previous?.focus();
    };
  }, [locked]);
  return panelRef;
}

const LEGACY_NON_ASSIGNEE_TAGS = new Set([
  "자동 배정",
  "세무",
  "회계",
  "법률",
  "노무",
  "등기업무",
  "감정평가",
  "지식재산",
  "관세/통관",
  "감사",
]);

const LEDGER_ITEM_IDS: Record<string, string> = {
  first_org_signup: "ledger.firstOrgSignup",
  user_signup: "ledger.userSignup",
  answer_view: "ledger.answerView",
  question_answer_usage: "ledger.questionAnswerUsage",
  manual_adjustment: "ledger.manualAdjustment",
  admin_adjustment_credit: "ledger.adminCredit",
  admin_adjustment_debit: "ledger.adminDebit",
};

function ledgerLabel(copy: AdminOperationsCopy, eventKey: string) {
  const itemId = LEDGER_ITEM_IDS[eventKey];
  return itemId ? copy.section("points").item(itemId) : eventKey;
}

function memberStatusLabel(
  copy: AdminOperationsCopy,
  status?: string,
  short = false,
) {
  const members = copy.section("members");
  if (status === "active") return members.text("statusActive");
  if (status === "rejected") return members.text("statusInactive");
  return members.text(short ? "statusPendingShort" : "statusPending");
}

function requestStatusLabel(
  copy: AdminOperationsCopy,
  status: ResolvedRequestStatus,
) {
  const itemId: Record<ResolvedRequestStatus, string> = {
    SUBMITTED: "requestStatus.submitted",
    ANSWERED: "requestStatus.answered",
    ANSWER_PUBLISHED: "requestStatus.published",
    FOLLOWUP: "requestStatus.followup",
    COMPLETED: "requestStatus.completed",
  };
  return copy.section("inquiries").item(itemId[status]);
}

function ratingSatisfactionLabel(copy: AdminOperationsCopy, score?: number) {
  const inquiries = copy.section("inquiries");
  if (typeof score !== "number" || Number.isNaN(score)) {
    return inquiries.text("ratingComplete");
  }
  if (score >= 4) return inquiries.text("satisfactionGood");
  if (score >= 3) return inquiries.text("satisfactionAverage");
  return inquiries.text("satisfactionLow");
}

type PointHistoryRow = {
  id: string;
  createdAt: string;
  eventKey: string;
  points: number;
  balanceAfter: number;
  reason?: string;
  cooperativeId?: string;
  nh_org_id?: string;
};

function getOrganizationIdSet(organization: OrganizationRecord) {
  return new Set(
    [organization.cooperativeId, organization.nh_org_id].filter(
      (id): id is string => Boolean(id),
    ),
  );
}

function matchesOrganizationIds(
  ids: Set<string>,
  entry: { cooperativeId?: string; nh_org_id?: string },
) {
  return (
    (entry.cooperativeId && ids.has(entry.cooperativeId)) ||
    (entry.nh_org_id && ids.has(entry.nh_org_id))
  );
}

function toPointHistoryRowFromTransaction(
  entry: PointTransactionRecord,
): PointHistoryRow {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    eventKey: entry.type,
    points: entry.amount,
    balanceAfter: entry.balance_after ?? 0,
    reason: entry.reason,
    cooperativeId: entry.cooperativeId,
    nh_org_id: entry.nh_org_id,
  };
}

function toPointHistoryRowFromLedger(entry: PointLedgerRecord): PointHistoryRow {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    eventKey: entry.event ?? entry.type ?? "",
    points: entry.points ?? entry.amount ?? 0,
    balanceAfter: entry.balanceAfter ?? entry.balance_after ?? 0,
    reason: entry.reason,
    cooperativeId: entry.cooperativeId,
    nh_org_id: entry.nh_org_id,
  };
}

function buildOrganizationPointHistory(
  organization: OrganizationRecord,
  transactions: PointTransactionRecord[],
  ledgerEntries: PointLedgerRecord[],
  limit?: number,
) {
  const ids = getOrganizationIdSet(organization);
  const fromTransactions = transactions
    .filter((entry) => matchesOrganizationIds(ids, entry))
    .map(toPointHistoryRowFromTransaction);
  const seen = new Set(fromTransactions.map((entry) => entry.id));
  const fromLedger = ledgerEntries
    .filter((entry) => matchesOrganizationIds(ids, entry) && !seen.has(entry.id))
    .map(toPointHistoryRowFromLedger);
  const combined = [...fromTransactions, ...fromLedger].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return typeof limit === "number" ? combined.slice(0, limit) : combined;
}

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatRelative(
  value: string | undefined,
  reference: number,
  copy: AdminOperationsCopy,
) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (!reference) {
    return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(date);
  }
  const diff = reference - date.getTime();
  const minutes = Math.round(diff / 60000);
  const navigation = copy.section("navigation");
  if (minutes < 1) return navigation.text("justNow");
  if (minutes < 60) return `${minutes}${navigation.text("minuteAgoSuffix")}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}${navigation.text("hourAgoSuffix")}`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}${navigation.text("dayAgoSuffix")}`;
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(date);
}

function formatPoints(value: number, copy: AdminOperationsCopy) {
  return `${value.toLocaleString()}${copy.section("points").text("pointUnit")}`;
}

function formatRatingScore(score: number, copy: AdminOperationsCopy) {
  return `${score.toFixed(1)} ${copy.section("inquiries").text("ratingScaleSuffix")}`;
}

type InquiryActionKind = "write" | "edit" | "complete";

function matchesInquirySearch(
  request: ConsultRequestRecord,
  managers: string[],
  answer: AnswerRecord | undefined,
  keyword: string,
) {
  const tokens = keyword.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;

  const fields = [
    request.requestNumber,
    request.subject,
    request.userName,
    request.userEmail,
    request.cooperativeName,
    request.cooperativeDisplay,
    request.manualCooperativeName,
    ...managers,
    answer?.createdByEmail,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  return tokens.every((token) => fields.some((field) => field.includes(token)));
}

function getAnswerRespondedAt(
  answer: AnswerRecord | undefined,
  request: ConsultRequestRecord,
): string | null {
  if (!answer) return null;
  return answer.updatedAt ?? request.answeredAt ?? answer.createdAt ?? null;
}

function getInquiryActionKind(status: ResolvedRequestStatus): InquiryActionKind {
  if (status === "ANSWER_PUBLISHED" || status === "COMPLETED") {
    return "complete";
  }
  if (status === "ANSWERED") {
    return "edit";
  }
  return "write";
}

function parseSignedPointInput(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return 0;
  return (value.trim().startsWith("-") ? -1 : 1) * Number(digits);
}

const signedPointFormatter = new Intl.NumberFormat("ko-KR");

function formatSignedPointInput(value: string | number) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value === 0) return "";
    return `${value < 0 ? "-" : ""}${signedPointFormatter.format(Math.abs(value))}`;
  }
  if (value.trim() === "-") return "-";
  const numericValue = parseSignedPointInput(value);
  if (numericValue === 0) return "";
  return `${numericValue < 0 ? "-" : ""}${signedPointFormatter.format(Math.abs(numericValue))}`;
}

function assignedManagers(request: ConsultRequestRecord) {
  return (request.adminTags ?? [])
    .map((tag) => tag.trim())
    .filter((tag) => tag && !LEGACY_NON_ASSIGNEE_TAGS.has(tag));
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function buildDailySeries<T extends { createdAt?: string }>(
  records: T[],
  days: number,
  reference: number,
): { label: string; value: number; isoDate: string }[] {
  if (!reference) return [];
  const today = startOfDay(new Date(reference));
  const buckets: { label: string; value: number; isoDate: string }[] = [];
  const labelFormatter = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" });
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - offset);
    const iso = day.toISOString().slice(0, 10);
    buckets.push({ label: labelFormatter.format(day), value: 0, isoDate: iso });
  }
  const indexByIso = new Map(buckets.map((bucket, index) => [bucket.isoDate, index]));
  for (const record of records) {
    const created = record.createdAt;
    if (!created) continue;
    const iso = new Date(created).toISOString().slice(0, 10);
    const index = indexByIso.get(iso);
    if (index !== undefined) buckets[index].value += 1;
  }
  return buckets;
}

function deriveDelta<T extends { createdAt?: string }>(
  records: T[],
  reference: number,
  windowDays = 7,
) {
  if (!reference) return { recent: 0, previous: 0 };
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  let recent = 0;
  let previous = 0;
  for (const record of records) {
    if (!record.createdAt) continue;
    const time = new Date(record.createdAt).getTime();
    if (Number.isNaN(time)) continue;
    const age = reference - time;
    if (age <= windowMs) recent += 1;
    else if (age <= windowMs * 2) previous += 1;
  }
  return { recent, previous };
}

function Sparkline({ data }: { data: number[] }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const points = data
    .map((value, index) => {
      const x = (index / Math.max(data.length - 1, 1)) * 100;
      const y = 32 - (value / max) * 28;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const area = `0,32 ${points} 100,32`;
  return (
    <svg className="admin-spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={area} fill="currentColor" opacity="0.12" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function StatusPill({ value }: { value: ResolvedRequestStatus }) {
  const copy = useAdminOperationsCopy();
  return (
    <span className={`admin-pill admin-pill--${getRequestStatusTone(value)}`}>
      <span className="admin-pill__dot" aria-hidden="true" />
      {requestStatusLabel(copy, value)}
    </span>
  );
}

function VisibilityPill({ value }: { value?: string }) {
  const copy = useAdminOperationsCopy().section("inquiries");
  const itemId =
    value === "PUBLIC" || value === "public"
      ? "visibility.public"
      : value === "ORG_ONLY" || value === "nonghyup"
        ? "visibility.organization"
        : value === "PRIVATE" || value === "private"
          ? "visibility.private"
          : "";
  const label = itemId ? copy.item(itemId) : value ?? "-";
  return <span className="admin-chip">{label}</span>;
}

export function AdminDashboard({
  content,
  sitemap = EMPTY_ADMIN_SITEMAP,
  previewMode = false,
  auditEvaluationAdminEnabled = previewMode,
  canManageTestData = false,
  editing = false,
  selectedSectionId,
  onSelectSection,
}: {
  content: CmsPageContent;
  sitemap?: PortalSitemapModel;
  previewMode?: boolean;
  auditEvaluationAdminEnabled?: boolean;
  canManageTestData?: boolean;
} & CmsSectionEditingOptions) {
  const router = useRouter();
  const copy = useMemo(() => createAdminOperationsCopy(content), [content]);
  const FEATURE_TABS = useMemo(
    () =>
      copy.tabs.filter(
        (item) =>
          item.key !== "auditEvaluations" || auditEvaluationAdminEnabled,
      ),
    [auditEvaluationAdminEnabled, copy.tabs],
  );
  const inquiryCopy = copy.section("inquiries");
  const sitemapCopy = copy.section("sitemap");
  const faqCategoryOptions = ADMIN_FAQ_CATEGORIES.map((option) => ({
    value: option.value,
    label: inquiryCopy.item(`faqCategory.${option.id}`),
  }));
  const [state, setState] = useState<State>(previewMode ? "ready" : "loading");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<UserRecord[]>(
    previewMode ? ADMIN_OPERATIONS_PREVIEW_DATA.users : [],
  );
  const [requests, setRequests] = useState<ConsultRequestRecord[]>(
    previewMode ? ADMIN_OPERATIONS_PREVIEW_DATA.requests : [],
  );
  const [answers, setAnswers] = useState<AnswerRecord[]>(
    previewMode ? ADMIN_OPERATIONS_PREVIEW_DATA.answers : [],
  );
  const [answerViews, setAnswerViews] = useState<AnswerViewRecord[]>(
    previewMode ? ADMIN_OPERATIONS_PREVIEW_DATA.answerViews : [],
  );
  const [ratings, setRatings] = useState<AnswerRatingRecord[]>(
    previewMode ? ADMIN_OPERATIONS_PREVIEW_DATA.ratings : [],
  );
  const [organizations, setOrganizations] = useState<OrganizationRecord[]>(
    previewMode ? ADMIN_OPERATIONS_PREVIEW_DATA.organizations : [],
  );
  const [ledger, setLedger] = useState<PointLedgerRecord[]>(
    previewMode ? ADMIN_OPERATIONS_PREVIEW_DATA.ledger : [],
  );
  const [pointTransactions, setPointTransactions] = useState<
    PointTransactionRecord[]
  >(previewMode ? ADMIN_OPERATIONS_PREVIEW_DATA.pointTransactions : []);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>(
    previewMode ? ADMIN_OPERATIONS_PREVIEW_DATA.auditLogs : [],
  );
  const [adminContext, setAdminContext] = useState<AuthorizationContext | null>(
    previewMode
      ? {
          uid: "preview-admin",
          accountType: "admin",
          status: "active",
          adminRole: "super_admin",
          permissions: [...ADMIN_CAPABILITIES],
          scopes: ["ALL"],
        }
      : null,
  );
  const [partners, setPartners] = useState<PartnerRecord[]>([]);
  const [partnerAssignments, setPartnerAssignments] = useState<
    PartnerAssignmentRecord[]
  >([]);
  const [partnerAnswerDrafts, setPartnerAnswerDrafts] = useState<
    PartnerAnswerDraftRecord[]
  >([]);
  const [partnerActionLoading, setPartnerActionLoading] = useState(false);
  const [partnerRevisionNote, setPartnerRevisionNote] = useState("");
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState<{ tone: "info" | "success" | "error"; text: string } | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [memberSubtab, setMemberSubtab] = useState<MemberSubtab>("members");
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedMemberUid, setSelectedMemberUid] = useState<string | null>(null);
  const [operatorSearch, setOperatorSearch] = useState("");
  const [operatorRoleFilter, setOperatorRoleFilter] = useState("");
  const [operatorStatusFilter, setOperatorStatusFilter] = useState("");
  const [operatorPartnerFilter, setOperatorPartnerFilter] = useState("");
  const [operatorPage, setOperatorPage] = useState(1);
  const [operatorPageSize, setOperatorPageSize] = useState(20);
  const [operatorList, setOperatorList] = useState<OperatorListItem[]>([]);
  const [operatorListTotal, setOperatorListTotal] = useState(0);
  const [operatorTotalPages, setOperatorTotalPages] = useState(1);
  const [activeSuperAdminCount, setActiveSuperAdminCount] = useState(0);
  const [operatorListLoading, setOperatorListLoading] = useState(false);
  const [operatorListError, setOperatorListError] = useState("");
  const [operatorRefreshKey, setOperatorRefreshKey] = useState(0);
  const [selectedOperatorUid, setSelectedOperatorUid] = useState<string | null>(null);
  const [operatorEditor, setOperatorEditor] = useState<OperatorEditorState | null>(null);
  const [operatorActionLoading, setOperatorActionLoading] = useState(false);
  const [requestSearch, setRequestSearch] = useState("");
  const [requestCoopFilter, setRequestCoopFilter] = useState("");
  const [requestStatusFilter, setRequestStatusFilter] = useState("");
  const [requestVisibilityFilter, setRequestVisibilityFilter] = useState("");
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [ratingDetailRequestId, setRatingDetailRequestId] = useState<string | null>(null);
  const [inquirySubtab, setInquirySubtab] = useState<"requests" | "faq">(
    "requests"
  );
  const [faqs, setFaqs] = useState<FaqRecord[]>(
    previewMode ? ADMIN_OPERATIONS_PREVIEW_DATA.faqs : [],
  );
  const [faqLoading, setFaqLoading] = useState(false);
  const [faqSearch, setFaqSearch] = useState("");
  const [faqCategoryFilter, setFaqCategoryFilter] = useState("");
  const [faqPublicFilter, setFaqPublicFilter] = useState("");
  const [faqDisplayFilter, setFaqDisplayFilter] = useState("");
  const [faqEditor, setFaqEditor] = useState<{
    mode: "create" | "edit";
    faq: FaqRecord | null;
  } | null>(null);
  const [faqDeleteTarget, setFaqDeleteTarget] = useState<FaqRecord | null>(null);
  const [faqSaving, setFaqSaving] = useState(false);
  const [selectedPointOrgId, setSelectedPointOrgId] = useState("");
  const [pointOrgSearch, setPointOrgSearch] = useState("");
  const [allPointTransactionsOpen, setAllPointTransactionsOpen] = useState(false);
  const [allPointTransactionsFilterOrgId, setAllPointTransactionsFilterOrgId] =
    useState("");
  const [pointAdjustSearch, setPointAdjustSearch] = useState("");
  const [pointAdjustSearchFocused, setPointAdjustSearchFocused] = useState(false);
  const [pointAdjustmentAmount, setPointAdjustmentAmount] = useState("");
  const [pointAdjustmentReason, setPointAdjustmentReason] = useState("");
  const [pointAdjustmentDraft, setPointAdjustmentDraft] = useState<{
    cooperativeId: string;
    cooperativeName: string;
    points: number;
    reason: string;
    balanceBefore: number;
  } | null>(null);
  const [pointAdjustmentLoading, setPointAdjustmentLoading] = useState(false);
  const [memberAction, setMemberAction] = useState<{
    uid: string;
    name: string;
    email: string;
    type: "approve" | "reject" | "deactivate" | "reactivate";
  } | null>(null);
  const [memberActionReason, setMemberActionReason] = useState("");
  const [memberActionLoading, setMemberActionLoading] = useState(false);
  const [memberCooperativeEditor, setMemberCooperativeEditor] =
    useState<UserRecord | null>(null);
  const [operatorConfirmation, setOperatorConfirmation] =
    useState<OperatorConfirmationState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    previewMode ? new Date("2026-07-20T09:30:00.000Z") : null,
  );

  const fetchDashboard = useCallback(async () => {
    if (previewMode) return;
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new Error(copy.message("authRequired"));
    const idToken = await user.getIdToken();
    const res = await fetch("/api/admin/overview", {
      headers: { authorization: `Bearer ${idToken}` },
    });
    const data = (await res.json()) as {
      ok?: boolean;
      users?: UserRecord[];
      requests?: ConsultRequestRecord[];
      answers?: AnswerRecord[];
      answerViews?: AnswerViewRecord[];
      ratings?: AnswerRatingRecord[];
      organizations?: OrganizationRecord[];
      ledger?: PointLedgerRecord[];
      pointTransactions?: PointTransactionRecord[];
      auditLogs?: AuditLogRecord[];
      adminCapabilities?: AdminCapability[];
      adminContext?: AuthorizationContext;
      partners?: PartnerRecord[];
      partnerAssignments?: PartnerAssignmentRecord[];
      partnerAnswerDrafts?: PartnerAnswerDraftRecord[];
      error?: string;
    };

    if (res.status === 401 || res.status === 403) {
      throw new Error("permission_denied");
    }
    if (!res.ok || !data.ok) {
      throw new Error(copy.message("genericError"));
    }

    setUsers(data.users ?? []);
    setRequests(data.requests ?? []);
    setAnswers(data.answers ?? []);
    setAnswerViews(data.answerViews ?? []);
    setRatings(data.ratings ?? []);
    setOrganizations(data.organizations ?? []);
    setLedger(data.ledger ?? []);
    setPointTransactions(data.pointTransactions ?? []);
    setAuditLogs(data.auditLogs ?? []);
    setAdminContext(data.adminContext ?? null);
    if (
      data.adminContext &&
      !canShowAdminAction(data.adminContext, "members:read") &&
      canShowAdminMenu(data.adminContext, "operators")
    ) {
      setMemberSubtab("operators");
    }
    setPartners(data.partners ?? []);
    setPartnerAssignments(data.partnerAssignments ?? []);
    setPartnerAnswerDrafts(data.partnerAnswerDrafts ?? []);
    setLastUpdated(new Date());
  }, [copy, previewMode]);

  const TABS = useMemo(
    () =>
      FEATURE_TABS.filter((item) =>
        canShowAdminMenu(adminContext, item.key),
      ),
    [FEATURE_TABS, adminContext],
  );

  const fetchOperators = useCallback(async () => {
    if (previewMode) {
      const previewOperators = users
        .filter((user) => user.role === "admin")
        .map((user) => ({
          ...user,
          accountStatus: operatorAccountStatus(user),
          scopes: ["ALL"] as OperatorListItem["scopes"],
        }));
      setOperatorList(previewOperators);
      setOperatorListTotal(previewOperators.length);
      setOperatorTotalPages(1);
      setActiveSuperAdminCount(
        previewOperators.filter(
          (operator) =>
            operator.adminRole === "super_admin" &&
            operator.accountStatus === "active",
        ).length,
      );
      return;
    }
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    setOperatorListLoading(true);
    setOperatorListError("");
    try {
      const idToken = await user.getIdToken();
      const params = new URLSearchParams({
        page: String(operatorPage),
        pageSize: String(operatorPageSize),
      });
      if (operatorSearch.trim()) params.set("search", operatorSearch.trim());
      if (operatorRoleFilter) params.set("role", operatorRoleFilter);
      if (operatorStatusFilter) params.set("status", operatorStatusFilter);
      if (operatorPartnerFilter) {
        params.set("partner", operatorPartnerFilter);
      }
      const res = await fetch(`/api/admin/operators?${params.toString()}`, {
        headers: { authorization: `Bearer ${idToken}` },
      });
      const data = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            operators?: OperatorListItem[];
            activeSuperAdminCount?: number;
            pagination?: {
              page: number;
              pageSize: number;
              total: number;
              totalPages: number;
            };
            error?: string;
          }
        | null;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "operator_list_failed");
      }
      setOperatorList(data.operators ?? []);
      setOperatorListTotal(data.pagination?.total ?? 0);
      setOperatorTotalPages(data.pagination?.totalPages ?? 1);
      setActiveSuperAdminCount(data.activeSuperAdminCount ?? 0);
      if (
        data.pagination?.page &&
        data.pagination.page !== operatorPage
      ) {
        setOperatorPage(data.pagination.page);
      }
    } catch {
      setOperatorList([]);
      setOperatorListError(copy.message("operatorListFailed"));
    } finally {
      setOperatorListLoading(false);
    }
  }, [
    copy,
    operatorPage,
    operatorPageSize,
    operatorPartnerFilter,
    operatorRoleFilter,
    operatorSearch,
    operatorStatusFilter,
    previewMode,
    users,
  ]);

  useEffect(() => {
    if (
      state !== "ready" ||
      tab !== "members" ||
      memberSubtab !== "operators" ||
      !canShowAdminMenu(adminContext, "operators")
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void fetchOperators();
    }, operatorSearch ? 250 : 0);
    return () => window.clearTimeout(timeout);
  }, [
    adminContext,
    fetchOperators,
    memberSubtab,
    operatorRefreshKey,
    operatorSearch,
    state,
    tab,
  ]);

  const fetchFaqs = useCallback(async () => {
    if (previewMode) return;
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new Error(copy.message("authRequired"));
    const idToken = await user.getIdToken();
    const res = await fetch("/api/admin/faqs", {
      headers: { authorization: `Bearer ${idToken}` },
    });
    const data = (await res.json()) as {
      ok?: boolean;
      faqs?: FaqRecord[];
      error?: string;
    };
    if (!res.ok || !data.ok) {
      throw new Error(copy.message("faqLoadFailed"));
    }
    setFaqs(data.faqs ?? []);
  }, [copy, previewMode]);

  useEffect(() => {
    if (state !== "ready") return;
    if (tab !== "inquiries" || inquirySubtab !== "faq") return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (cancelled) return undefined;
        setFaqLoading(true);
        return fetchFaqs();
      })
      .catch(() => {
        if (cancelled) return;
        setActionMessage({
          tone: "error",
          text: copy.message("faqLoadFailed"),
        });
      })
      .finally(() => {
        if (!cancelled) setFaqLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [state, tab, inquirySubtab, fetchFaqs, copy]);

  const faqCategories = useMemo(() => {
    const categories = new Set(
      faqs.map((faq) => faq.category).filter((value): value is string => Boolean(value)),
    );
    return Array.from(categories).sort((a, b) => a.localeCompare(b, "ko"));
  }, [faqs]);

  const filteredFaqs = useMemo(() => {
    let list = faqs;
    if (faqCategoryFilter) {
      list = list.filter((faq) => faq.category === faqCategoryFilter);
    }
    if (faqPublicFilter === "public") {
      list = list.filter((faq) => faq.isPublic);
    } else if (faqPublicFilter === "private") {
      list = list.filter((faq) => !faq.isPublic);
    }
    if (faqDisplayFilter === "published") {
      list = list.filter((faq) => faq.displayStatus === "published");
    } else if (faqDisplayFilter === "draft") {
      list = list.filter((faq) => faq.displayStatus === "draft");
    }
    const keyword = faqSearch.trim().toLowerCase();
    if (!keyword) return list;
    return list.filter((faq) =>
      [faq.question, faq.category, faq.answer]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(keyword)),
    );
  }, [faqs, faqSearch, faqCategoryFilter, faqPublicFilter, faqDisplayFilter]);

  const submitFaq = useCallback(
    async (payload: {
      mode: "create" | "edit";
      id?: string;
      question: string;
      answer: string;
      category: string;
      isPublic: boolean;
      displayStatus: "published" | "draft";
    }) => {
      const user = getFirebaseAuth().currentUser;
      if (previewMode) return;
      if (!user) {
        setActionMessage({
          tone: "error",
          text: copy.message("authRequired"),
        });
        return;
      }
      setFaqSaving(true);
      try {
        const idToken = await user.getIdToken();
        const isCreate = payload.mode === "create";
        const url = isCreate
          ? "/api/admin/faqs"
          : `/api/admin/faqs/${payload.id}`;
        const res = await fetch(url, {
          method: isCreate ? "POST" : "PATCH",
          headers: {
            authorization: `Bearer ${idToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            question: payload.question,
            answer: payload.answer,
            category: payload.category,
            isPublic: payload.isPublic,
            displayStatus: payload.displayStatus,
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          faq?: FaqRecord;
          error?: string;
        };
        if (!res.ok || !data.ok || !data.faq) {
          throw new Error(copy.message("faqSaveFailed"));
        }
        const saved = data.faq;
        setFaqs((current) => {
          const exists = current.some((item) => item.id === saved.id);
          const next = exists
            ? current.map((item) => (item.id === saved.id ? saved : item))
            : [...current, saved];
          return next.sort((a, b) => {
            const orderA = typeof a.order === "number" ? a.order : 0;
            const orderB = typeof b.order === "number" ? b.order : 0;
            if (orderA !== orderB) return orderA - orderB;
            return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
          });
        });
        setActionMessage({
          tone: "success",
          text: isCreate
            ? copy.message("faqSaved")
            : copy.message("faqUpdated"),
        });
        setFaqEditor(null);
      } catch {
        setActionMessage({
          tone: "error",
          text: copy.message("faqSaveFailed"),
        });
      } finally {
        setFaqSaving(false);
      }
    },
    [
      copy,
      previewMode,
      setActionMessage,
      setFaqEditor,
      setFaqs,
      setFaqSaving,
    ]
  );

  const deleteFaq = useCallback(async (faq: FaqRecord) => {
    if (previewMode) return;
    const user = getFirebaseAuth().currentUser;
    if (!user) {
      setActionMessage({ tone: "error", text: copy.message("authRequired") });
      return;
    }
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/admin/faqs/${faq.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${idToken}` },
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(copy.message("faqDeleteFailed"));
      }
      setFaqs((current) => current.filter((item) => item.id !== faq.id));
      setActionMessage({ tone: "success", text: copy.message("faqDeleted") });
      setFaqDeleteTarget(null);
    } catch {
      setActionMessage({
        tone: "error",
        text: copy.message("faqDeleteFailed"),
      });
    }
  }, [
    copy,
    previewMode,
    setActionMessage,
    setFaqDeleteTarget,
    setFaqs,
  ]);

  const refreshDashboard = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchDashboard();
      setActionMessage({ tone: "info", text: copy.message("refreshed") });
    } catch {
      setActionMessage({
        tone: "error",
        text: copy.message("refreshFailed"),
      });
    } finally {
      setRefreshing(false);
    }
  }, [fetchDashboard, copy, setActionMessage, setRefreshing]);

  useEffect(() => {
    if (previewMode) return;
    let unsubscribe: (() => void) | undefined;

    const boot = async () => {
      try {
        const auth = getFirebaseAuth();
        unsubscribe = onAuthStateChanged(auth, async (user) => {
          if (!user) {
            setCurrentUser(null);
            router.push("/admin/login");
            return;
          }

          try {
            setCurrentUser(user);
            const tokenResult = await user.getIdTokenResult(true);
            const isAdmin = tokenResult.claims.admin === true;

            if (!isAdmin) {
              setState("denied");
              return;
            }

            await fetchDashboard();
            setState("ready");
          } catch (caught) {
            if (
              caught instanceof Error &&
              caught.message === "permission_denied"
            ) {
              setState("denied");
              return;
            }
            setState("error");
            setError(copy.message("genericError"));
          }
        });
      } catch {
        setState("error");
        setError(copy.message("genericError"));
      }
    };

    void boot();

    return () => unsubscribe?.();
  }, [router, fetchDashboard, previewMode, copy]);

  // -- Derived data ---------------------------------------------------------
  const memberUsers = useMemo(
    () => users.filter((user) => user.role !== "admin"),
    [users],
  );
  const productionDashboard = useMemo(
    () =>
      partitionAdminDashboardData({
        users,
        requests,
        answers,
        ratings,
        answerViews,
        organizations,
        ledger,
        pointTransactions,
        auditLogs,
      }).production,
    [
      answerViews,
      answers,
      auditLogs,
      ledger,
      organizations,
      pointTransactions,
      ratings,
      requests,
      users,
    ],
  );
  const operatorUsers = useMemo<OperatorListItem[]>(
    () =>
      previewMode
        ? users
            .filter((user) => user.role === "admin")
            .map((user) => ({
              ...user,
              accountStatus: operatorAccountStatus(user),
              scopes: ["ALL"] as OperatorListItem["scopes"],
            }))
        : operatorList,
    [operatorList, previewMode, users],
  );

  const filteredMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    if (!query) return memberUsers;
    return memberUsers.filter((user) => {
      const haystack = [
        user.name,
        user.email,
        user.cooperativeName,
        user.manualCooperativeName,
        user.position,
        user.duty,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [memberUsers, memberSearch]);
  const selectedMember = useMemo(() => {
    const selected = memberUsers.find((user) => user.uid === selectedMemberUid);
    return selected ?? filteredMembers[0] ?? null;
  }, [filteredMembers, memberUsers, selectedMemberUid]);
  const filteredOperators = operatorUsers;
  const selectedOperator = useMemo(() => {
    const selected = operatorUsers.find((user) => user.uid === selectedOperatorUid);
    return selected ?? filteredOperators[0] ?? null;
  }, [filteredOperators, operatorUsers, selectedOperatorUid]);
  const selectedOperatorAudits = useMemo(
    () =>
      auditLogs.filter(
        (entry) =>
          entry.actorUid === selectedOperator?.uid ||
          entry.actorEmail === selectedOperator?.email ||
          entry.targetId === selectedOperator?.uid,
      ),
    [auditLogs, selectedOperator],
  );
  const selectedOperatorProtection = selectedOperator
    ? operatorProtection({
        operator: selectedOperator,
        actorUid: currentUser?.uid,
        actorRole: adminContext?.adminRole,
        activeSuperAdminCount,
      })
    : null;
  const selectedOperatorIsProtected = Boolean(
    selectedOperatorProtection?.self,
  );
  const selectedOperatorIsLastSuperAdmin = Boolean(
    selectedOperatorProtection?.lastSuperAdmin,
  );
  const canReadMembers = canShowAdminAction(adminContext, "members:read");
  const canWriteMembers = canShowAdminAction(adminContext, "members:write");
  const canReadCooperatives = canShowAdminAction(
    adminContext,
    "cooperatives:read",
  );
  const canWriteCooperatives = canShowAdminAction(
    adminContext,
    "cooperatives:write",
  );
  const canReadOperators = canShowAdminMenu(adminContext, "operators");
  const canCreateOperators = canShowAdminAction(
    adminContext,
    "operators:create",
  );
  const canUpdateOperators = canShowAdminAction(
    adminContext,
    "operators:update",
  );
  const canDisableOperators = canShowAdminAction(
    adminContext,
    "operators:disable",
  );
  const canDeleteOperators = canShowAdminAction(
    adminContext,
    "operators:delete",
  );
  const canManageOperatorRoles = canShowAdminAction(
    adminContext,
    "operators:manageRoles",
  );
  const canResetOperatorPasswords = canShowAdminAction(
    adminContext,
    "operators:resetPassword",
  );
  const selectedMemberOrganization = useMemo(
    () =>
      organizations.find(
        (organization) =>
          organization.cooperativeId === selectedMember?.cooperativeId ||
          organization.nh_org_id === selectedMember?.nh_org_id,
      ) ?? null,
    [organizations, selectedMember],
  );
  const selectedMemberLedger = useMemo(
    () => ledger.filter((entry) => entry.userId === selectedMember?.uid),
    [ledger, selectedMember],
  );
  const selectedMemberTransactions = useMemo(
    () => pointTransactions.filter((entry) => entry.user_id === selectedMember?.uid),
    [pointTransactions, selectedMember],
  );
  const selectedMemberAudits = useMemo(
    () =>
      auditLogs.filter(
        (entry) =>
          entry.actorUid === selectedMember?.uid ||
          entry.actorEmail === selectedMember?.email ||
          entry.targetId === selectedMember?.uid,
      ),
    [auditLogs, selectedMember],
  );

  const answerByRequestId = useMemo(
    () => new Map(answers.map((answer) => [answer.requestId, answer])),
    [answers],
  );
  const answerViewByRequestId = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const view of answerViews) {
      map.set(view.requestId, true);
    }
    return map;
  }, [answerViews]);
  const resolveAdminRequestStatus = useCallback(
    (request: ConsultRequestRecord) =>
      resolveRequestStatus(request, {
        hasAnswer: answerByRequestId.has(request.id),
        hasAnswerView: answerViewByRequestId.has(request.id),
      }),
    [answerByRequestId, answerViewByRequestId],
  );
  const answerById = useMemo(
    () => new Map(answers.map((answer) => [answer.id, answer])),
    [answers],
  );

  const userByUid = useMemo(
    () => new Map(users.map((user) => [user.uid, user])),
    [users],
  );
  const requestById = useMemo(
    () => new Map(requests.map((request) => [request.id, request])),
    [requests],
  );
  const orgById = useMemo(
    () =>
      new Map(
        organizations.map((organization) => [
          organization.cooperativeId ?? organization.nh_org_id ?? "",
          organization,
        ]),
      ),
    [organizations],
  );

  const auditLogContext = useMemo(
    () => ({
      userByUid,
      requestById,
      answerById,
      orgById,
    }),
    [answerById, orgById, requestById, userByUid],
  );
  const formatAuditLog = useCallback(
    (log: AuditLogRecord) => describeAuditLog(log, auditLogContext),
    [auditLogContext],
  );
  const ratingsByRequestId = useMemo(() => {
    const grouped = new Map<string, AnswerRatingRecord[]>();
    for (const rating of ratings) {
      grouped.set(rating.requestId, [...(grouped.get(rating.requestId) ?? []), rating]);
    }
    for (const [requestId, list] of grouped) {
      grouped.set(
        requestId,
        [...list].sort((a, b) =>
          (b.updatedAt ?? b.createdAt ?? "").localeCompare(
            a.updatedAt ?? a.createdAt ?? "",
          ),
        ),
      );
    }
    return grouped;
  }, [ratings]);

  const filteredRequests = useMemo(
    () =>
      requests
        .filter((request) => {
          const requestOrgId = request.nh_org_id ?? request.cooperativeId ?? "";
          const answer = answerByRequestId.get(request.id);
          const resolvedStatus = resolveAdminRequestStatus(request);
          const managers = assignedManagers(request);
          return (
            matchesInquirySearch(request, managers, answer, requestSearch) &&
            (!requestCoopFilter || requestOrgId === requestCoopFilter) &&
            (!requestStatusFilter ||
              matchesRequestStatusFilter(resolvedStatus, requestStatusFilter)) &&
            (!requestVisibilityFilter || request.visibility === requestVisibilityFilter)
          );
        })
        .sort((a, b) =>
          compareAdminInquiryRows(
            {
              createdAt: a.createdAt,
              requestNumber: a.requestNumber,
              status: resolveAdminRequestStatus(a),
            },
            {
              createdAt: b.createdAt,
              requestNumber: b.requestNumber,
              status: resolveAdminRequestStatus(b),
            },
          ),
        ),
    [
      answerByRequestId,
      requestCoopFilter,
      requestSearch,
      requestStatusFilter,
      requestVisibilityFilter,
      requests,
      resolveAdminRequestStatus,
    ],
  );

  const referenceTime = lastUpdated?.getTime() ?? 0;
  const memberDelta = useMemo(
    () => deriveDelta(productionDashboard.users, referenceTime),
    [productionDashboard.users, referenceTime],
  );
  const requestDelta = useMemo(
    () => deriveDelta(productionDashboard.requests, referenceTime),
    [productionDashboard.requests, referenceTime],
  );
  const answerDelta = useMemo(
    () => deriveDelta(productionDashboard.answers, referenceTime),
    [productionDashboard.answers, referenceTime],
  );
  const ratingDelta = useMemo(
    () => deriveDelta(productionDashboard.ratings, referenceTime),
    [productionDashboard.ratings, referenceTime],
  );

  const inquiriesSeries = useMemo(
    () => buildDailySeries(productionDashboard.requests, 14, referenceTime),
    [productionDashboard.requests, referenceTime],
  );
  const answersSeries = useMemo(
    () => buildDailySeries(productionDashboard.answers, 14, referenceTime),
    [productionDashboard.answers, referenceTime],
  );
  const signupsSeries = useMemo(
    () => buildDailySeries(productionDashboard.users, 14, referenceTime),
    [productionDashboard.users, referenceTime],
  );

  const answeredCount = useMemo(
    () =>
      productionDashboard.requests.filter((request) =>
        answerByRequestId.has(request.id),
      ).length,
    [productionDashboard.requests, answerByRequestId],
  );
  const answerRate =
    productionDashboard.requests.length > 0
      ? answeredCount / productionDashboard.requests.length
      : 0;

  const ratingScoreAvg = useMemo(() => {
    if (!productionDashboard.ratings.length) return 0;
    const sum = productionDashboard.ratings.reduce(
      (total, rating) => total + (rating.score ?? 0),
      0,
    );
    return sum / productionDashboard.ratings.length;
  }, [productionDashboard.ratings]);

  const helpfulRate = useMemo(() => {
    const scored = productionDashboard.ratings.filter(
      (rating) => typeof rating.helpful === "boolean",
    );
    if (!scored.length) return 0;
    return scored.filter((rating) => rating.helpful).length / scored.length;
  }, [productionDashboard.ratings]);

  const dashboardTotalWalletBalance = useMemo(
    () =>
      productionDashboard.organizations.reduce(
        (total, organization) => total + (organization.walletBalance ?? 0),
        0,
      ),
    [productionDashboard.organizations],
  );
  const totalWalletBalance = useMemo(
    () => organizations.reduce((total, organization) => total + (organization.walletBalance ?? 0), 0),
    [organizations],
  );

  const dashboardPointsSpent30d = useMemo(() => {
    if (!referenceTime) return 0;
    const cutoff = referenceTime - 30 * 24 * 60 * 60 * 1000;
    return productionDashboard.ledger
      .filter((entry) => {
        if (!entry.createdAt) return false;
        const time = new Date(entry.createdAt).getTime();
        if (Number.isNaN(time) || time < cutoff) return false;
        return entry.event === "answer_view" || entry.event === "admin_adjustment_debit";
      })
      .reduce((total, entry) => total + Math.abs(entry.points ?? 0), 0);
  }, [productionDashboard.ledger, referenceTime]);

  const orgInquiryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const request of productionDashboard.requests) {
      const key =
        request.cooperativeName ??
        request.cooperativeDisplay ??
        request.manualCooperativeName ??
        copy.section("members").text("unspecified");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [productionDashboard.requests, copy]);

  const organizationsByUpdatedAt = useMemo(
    () =>
      [...organizations].sort((a, b) =>
        (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
      ),
    [organizations],
  );
  const filteredPointOrganizations = useMemo(() => {
    const keyword = pointOrgSearch.trim().toLowerCase();
    if (!keyword) return organizationsByUpdatedAt;
    return organizationsByUpdatedAt.filter((organization) =>
      [
        organization.cooperativeName,
        organization.cooperativeId,
        organization.nh_org_id,
        String(organization.walletBalance ?? 0),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }, [organizationsByUpdatedAt, pointOrgSearch]);
  const effectiveSelectedPointOrgId = useMemo(() => {
    if (organizationsByUpdatedAt.length === 0) return "";
    const hasSelection = organizationsByUpdatedAt.some((organization) => {
      const ids = [organization.cooperativeId, organization.nh_org_id].filter(Boolean);
      return ids.includes(selectedPointOrgId);
    });
    return hasSelection ? selectedPointOrgId : organizationsByUpdatedAt[0].cooperativeId;
  }, [organizationsByUpdatedAt, selectedPointOrgId]);
  const selectedPointOrganization = useMemo(() => {
    if (organizationsByUpdatedAt.length === 0) return null;
    return (
      organizationsByUpdatedAt.find((organization) => {
        const ids = [organization.cooperativeId, organization.nh_org_id].filter(Boolean);
        return ids.includes(effectiveSelectedPointOrgId);
      }) ?? organizationsByUpdatedAt[0]
    );
  }, [effectiveSelectedPointOrgId, organizationsByUpdatedAt]);
  const selectedPointOrganizationId = selectedPointOrganization?.cooperativeId ?? "";
  const selectedPointHistory = useMemo(() => {
    if (!selectedPointOrganization) return [];
    return buildOrganizationPointHistory(
      selectedPointOrganization,
      pointTransactions,
      ledger,
    );
  }, [ledger, pointTransactions, selectedPointOrganization]);
  const allPointHistory = useMemo(() => {
    const fromTransactions = pointTransactions.map(toPointHistoryRowFromTransaction);
    const seen = new Set(fromTransactions.map((entry) => entry.id));
    const fromLedger = ledger
      .filter((entry) => !seen.has(entry.id))
      .map(toPointHistoryRowFromLedger);
    return [...fromTransactions, ...fromLedger].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }, [ledger, pointTransactions]);

  const pointAdjustSuggestions = useMemo(() => {
    const keyword = pointAdjustSearch.trim().toLowerCase();
    const list = keyword
      ? organizationsByUpdatedAt.filter((organization) =>
          [
            organization.cooperativeName,
            organization.cooperativeId,
            organization.nh_org_id,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(keyword),
        )
      : organizationsByUpdatedAt;
    return list.slice(0, 8);
  }, [organizationsByUpdatedAt, pointAdjustSearch]);

  const showPointAdjustSuggestions =
    pointAdjustSearchFocused && pointAdjustSuggestions.length > 0;
  const pointAdjustSearchValue =
    pointAdjustSearchFocused
      ? pointAdjustSearch
      : pointAdjustSearch || selectedPointOrganization?.cooperativeName || "";
  const pointAdjustmentValue = parseSignedPointInput(pointAdjustmentAmount);
  const pointAdjustmentBalanceAfter = selectedPointOrganization
    ? (selectedPointOrganization.walletBalance ?? 0) + pointAdjustmentValue
    : 0;

  const recentActivity = useMemo(
    () =>
      productionDashboard.auditLogs.slice(0, 12).map((log) => ({
        id: log.id,
        time: log.createdAt,
        ...formatAuditLog(log),
      })),
    [productionDashboard.auditLogs, formatAuditLog],
  );

  const activeRequest = useMemo(
    () => requests.find((request) => request.id === activeRequestId) ?? null,
    [requests, activeRequestId],
  );
  const ratingDetailRequest = useMemo(
    () => requests.find((request) => request.id === ratingDetailRequestId) ?? null,
    [requests, ratingDetailRequestId],
  );
  const ratingDetailAnswer = ratingDetailRequest
    ? answerByRequestId.get(ratingDetailRequest.id) ?? null
    : null;
  const ratingDetailRatings = ratingDetailRequest
    ? ratingsByRequestId.get(ratingDetailRequest.id) ?? []
    : [];

  // -- Mutations -------------------------------------------------------------
  const submitAnswer = async (event: React.FormEvent<HTMLFormElement>, requestId: string) => {
    event.preventDefault();
    if (previewMode) return;
    setActionMessage(null);
    const formData = new FormData(event.currentTarget);
    const assignee = String(formData.get("adminTags") ?? "").trim();
    if (!assignee) {
      setActionMessage({
        tone: "error",
        text: copy.message("assigneeRequired"),
      });
      return;
    }
    const pointCost = Number(formData.get("pointCost"));
    if (!isValidAnswerPointCost(pointCost)) {
      setActionMessage({
        tone: "error",
        text: `${inquiryCopy.text("pointRangeErrorPrefix")} ${formatAnswerPointRangeLabel()}${copy.section("points").text("pointUnit")} ${inquiryCopy.text("pointRangeErrorSuffix")}`,
      });
      return;
    }
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    const idToken = await user.getIdToken();
    const res = await fetch(`/api/admin/requests/${requestId}/answer`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        internalCategory: formData.get("internalCategory"),
        adminTags: formData.get("adminTags"),
        pointCost,
        answerBody: formData.get("answerBody"),
      }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      const message =
        data.error === "invalid_point_cost"
          ? `${inquiryCopy.text("pointRangeErrorPrefix")} ${formatPointInput(ANSWER_POINT_MIN)}${copy.section("points").text("pointUnit")} ${inquiryCopy.text("pointMinimumJoin")}, ${formatPointInput(ANSWER_POINT_MAX)}${copy.section("points").text("pointUnit")} ${inquiryCopy.text("pointMaximumJoin")} ${inquiryCopy.text("pointRangeErrorSuffix")}`
          : copy.message("answerSaveFailed");
      setActionMessage({ tone: "error", text: message });
      return;
    }
    setActionMessage({ tone: "success", text: copy.message("answerSaved") });
    setActiveRequestId(null);
    await refreshDashboard();
  };

  const requestPointAdjustment = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (previewMode) return;
    setActionMessage(null);
    if (!selectedPointOrganization) return;
    const points = parseSignedPointInput(pointAdjustmentAmount);
    const reason = pointAdjustmentReason.trim();
    if (!points || !reason) {
      setActionMessage({
        tone: "error",
        text: copy.message("pointFieldsRequired"),
      });
      return;
    }
    if ((selectedPointOrganization.walletBalance ?? 0) + points < 0) {
      setActionMessage({ tone: "error", text: copy.message("negativeBalance") });
      return;
    }
    setPointAdjustmentDraft({
      cooperativeId: selectedPointOrganization.cooperativeId,
      cooperativeName: selectedPointOrganization.cooperativeName,
      points,
      reason,
      balanceBefore: selectedPointOrganization.walletBalance ?? 0,
    });
  };

  const submitPointAdjustment = async () => {
    if (!pointAdjustmentDraft || previewMode) return;
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    setPointAdjustmentLoading(true);
    setActionMessage(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin/points/adjust", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          cooperativeId: pointAdjustmentDraft.cooperativeId,
          points: pointAdjustmentDraft.points,
          reason: pointAdjustmentDraft.reason,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setActionMessage({
          tone: "error",
          text: copy.message("pointAdjustmentFailed"),
        });
        return;
      }
      setActionMessage({ tone: "success", text: copy.message("pointAdjusted") });
      setPointAdjustmentAmount("");
      setPointAdjustmentReason("");
      setPointAdjustmentDraft(null);
      await refreshDashboard();
    } catch {
      setActionMessage({
        tone: "error",
        text: copy.message("pointAdjustmentFailed"),
      });
    } finally {
      setPointAdjustmentLoading(false);
    }
  };

  const requestMemberAction = (
    uid: string,
    type: "approve" | "reject" | "deactivate" | "reactivate",
  ) => {
    const target = users.find((entry) => entry.uid === uid);
    if (!target) return;
    setMemberActionReason("");
    setMemberAction({
      uid,
      type,
      name:
        target.name?.trim() ||
        target.email ||
        copy.section("members").text("memberFallback"),
      email: target.email,
    });
  };

  const closeMemberAction = () => {
    if (memberActionLoading) return;
    setMemberAction(null);
    setMemberActionReason("");
  };

  const submitMemberAction = useCallback(async () => {
    if (!memberAction || previewMode) return;
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    setActionMessage(null);
    setMemberActionLoading(true);
    try {
      const idToken = await user.getIdToken();
      if (memberAction.type === "approve" || memberAction.type === "reactivate") {
        const res = await fetch(`/api/admin/users/${memberAction.uid}/approve`, {
          method: "POST",
          headers: { authorization: `Bearer ${idToken}` },
        });
        const data = (await res.json().catch(() => null)) as
          | {
              ok?: boolean;
              error?: string;
              alreadyActive?: boolean;
              grantedPoints?: number;
              transition?: "approve" | "reactivate" | "noop";
            }
          | null;
        if (!res.ok || !data?.ok) {
          setActionMessage({
            tone: "error",
            text: copy.message("memberStatusFailed"),
          });
          return;
        }
        if (data.alreadyActive) {
          setActionMessage({
            tone: "info",
            text: copy.message("memberAlreadyActive"),
          });
        } else if (data.transition === "reactivate") {
          setActionMessage({
            tone: "success",
            text: copy.message("memberReactivated"),
          });
        } else {
          setActionMessage({
            tone: "success",
            text: `${copy.message("memberApproved")} ${formatPoints(data.grantedPoints ?? 0, copy)}`,
          });
        }
      } else {
        const res = await fetch(`/api/admin/users/${memberAction.uid}/reject`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${idToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ reason: memberActionReason.trim() }),
        });
        const data = (await res.json().catch(() => null)) as
          | {
              ok?: boolean;
              error?: string;
              alreadyRejected?: boolean;
              transition?: "deactivate" | "reject" | "noop";
            }
          | null;
        if (!res.ok || !data?.ok) {
          setActionMessage({
            tone: "error",
            text: copy.message("memberStatusFailed"),
          });
          return;
        }
        if (data.alreadyRejected) {
          setActionMessage({
            tone: "info",
            text: copy.message("memberAlreadyInactive"),
          });
        } else if (data.transition === "deactivate") {
          setActionMessage({
            tone: "success",
            text: copy.message("memberDeactivated"),
          });
        } else {
          setActionMessage({
            tone: "success",
            text: copy.message("memberRejected"),
          });
        }
      }
      setMemberAction(null);
      setMemberActionReason("");
      await refreshDashboard();
    } finally {
      setMemberActionLoading(false);
    }
  }, [
    memberAction,
    memberActionReason,
    refreshDashboard,
    previewMode,
    copy,
    setActionMessage,
    setMemberAction,
    setMemberActionLoading,
    setMemberActionReason,
  ]);

  const saveOperatorMutation = useCallback(
    async (payload: OperatorMutationPayload) => {
      if (!operatorEditor || previewMode) return;
      const user = getFirebaseAuth().currentUser;
      if (!user) return;
      setActionMessage(null);
      setOperatorActionLoading(true);
      let serverError = "";
      try {
        const idToken = await user.getIdToken();
        const isCreate = operatorEditor.mode === "create";
        const res = await fetch(
          isCreate
            ? "/api/admin/operators"
            : `/api/admin/operators/${operatorEditor.operator?.uid}`,
          {
            method: isCreate ? "POST" : "PATCH",
            headers: {
              authorization: `Bearer ${idToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        );
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; error?: string; operator?: UserRecord }
          | null;
        if (!res.ok || !data?.ok) {
          serverError = data?.error ?? "operator_save_failed";
          throw new Error("operator_save_failed");
        }
        setOperatorEditor(null);
        setOperatorConfirmation(null);
        setActionMessage({
          tone: "success",
          text: isCreate
            ? copy.message("operatorSaved")
            : copy.message("operatorUpdated"),
        });
        await refreshDashboard();
        setOperatorRefreshKey((current) => current + 1);
        if (data.operator?.uid) setSelectedOperatorUid(data.operator.uid);
      } catch {
        const errorText = copy.message(
          operatorServerErrorCopyKey(serverError),
        );
        setOperatorEditor((current) =>
          current ? { ...current, serverError: errorText } : current,
        );
        setActionMessage({
          tone: "error",
          text: errorText,
        });
      } finally {
        setOperatorActionLoading(false);
      }
    },
    [
      operatorEditor,
      refreshDashboard,
      previewMode,
      copy,
      setActionMessage,
      setOperatorActionLoading,
      setOperatorConfirmation,
      setOperatorEditor,
      setOperatorRefreshKey,
      setSelectedOperatorUid,
    ],
  );

  const submitOperatorEditor = useCallback(
    (payload: OperatorMutationPayload) => {
      if (
        operatorEditor?.mode === "edit" &&
        operatorEditor.operator
      ) {
        const changes = dangerousOperatorChanges(
          operatorEditor.operator,
          {
            adminRole:
              payload.adminRole ??
              getAdminRole(operatorEditor.operator),
            status:
              payload.status ?? operatorEditor.operator.status,
          },
        );
        const warningKeys = [
          changes.superAdminRoleChange && "operatorConfirmSuperAdminChange",
          changes.roleDemotion && "operatorConfirmRoleDemotion",
          changes.deactivation && "operatorConfirmDeactivation",
        ].filter(Boolean) as string[];
        if (warningKeys.length > 0) {
          setOperatorConfirmation({
            kind: "update",
            operator: operatorEditor.operator,
            payload,
            warningKeys,
          });
          return;
        }
      }
      void saveOperatorMutation(payload);
    },
    [operatorEditor, saveOperatorMutation, setOperatorConfirmation],
  );

  const changeOperatorPermission = useCallback(
    async (operator: UserRecord, nextStatus: UserRecord["status"]) => {
      if (previewMode) return;
      const user = getFirebaseAuth().currentUser;
      if (!user) return;
      setOperatorActionLoading(true);
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(`/api/admin/operators/${operator.uid}`, {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${idToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ status: nextStatus }),
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; error?: string }
          | null;
        if (!res.ok || !data?.ok) {
          throw new Error(copy.message("operatorPermissionFailed"));
        }
        setActionMessage({
          tone: "success",
          text:
            nextStatus === "active"
              ? copy.message("operatorPermissionGranted")
              : copy.message("operatorPermissionRevoked"),
        });
        setOperatorConfirmation(null);
        await refreshDashboard();
        setOperatorRefreshKey((current) => current + 1);
      } catch {
        setActionMessage({
          tone: "error",
          text: copy.message("operatorPermissionFailed"),
        });
      } finally {
        setOperatorActionLoading(false);
      }
    },
    [
      refreshDashboard,
      previewMode,
      copy,
      setActionMessage,
      setOperatorActionLoading,
      setOperatorConfirmation,
      setOperatorRefreshKey,
    ],
  );

  const resetOperatorPassword = useCallback(
    async (operator: UserRecord, password: string) => {
      if (previewMode) return;
      if (!password) return;
      if (password.length < 8) {
        setActionMessage({
          tone: "error",
          text: copy.message("passwordTooShort"),
        });
        return;
      }
      const user = getFirebaseAuth().currentUser;
      if (!user) return;
      setOperatorActionLoading(true);
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(`/api/admin/operators/${operator.uid}`, {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${idToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ password }),
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; error?: string }
          | null;
        if (!res.ok || !data?.ok) {
          throw new Error(copy.message("passwordResetFailed"));
        }
        setActionMessage({
          tone: "success",
          text: copy.message("passwordReset"),
        });
        setOperatorConfirmation(null);
        await refreshDashboard();
        setOperatorRefreshKey((current) => current + 1);
      } catch {
        setActionMessage({
          tone: "error",
          text: copy.message("passwordResetFailed"),
        });
      } finally {
        setOperatorActionLoading(false);
      }
    },
    [
      refreshDashboard,
      previewMode,
      copy,
      setActionMessage,
      setOperatorActionLoading,
      setOperatorConfirmation,
      setOperatorRefreshKey,
    ],
  );

  const deleteOperator = useCallback(
    async (operator: UserRecord) => {
      if (previewMode) return;
      const user = getFirebaseAuth().currentUser;
      if (!user) return;
      setOperatorActionLoading(true);
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(`/api/admin/operators/${operator.uid}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${idToken}` },
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; error?: string }
          | null;
        if (!res.ok || !data?.ok) {
          throw new Error(copy.message("operatorDeleteFailed"));
        }
        setSelectedOperatorUid(null);
        setActionMessage({
          tone: "success",
          text: copy.message("operatorDeleted"),
        });
        setOperatorConfirmation(null);
        await refreshDashboard();
        setOperatorRefreshKey((current) => current + 1);
      } catch {
        setActionMessage({
          tone: "error",
          text: copy.message("operatorDeleteFailed"),
        });
      } finally {
        setOperatorActionLoading(false);
      }
    },
    [
      refreshDashboard,
      previewMode,
      copy,
      setActionMessage,
      setOperatorActionLoading,
      setOperatorConfirmation,
      setOperatorRefreshKey,
      setSelectedOperatorUid,
    ],
  );

  const assignPartnerToRequest = useCallback(
    async (requestId: string, partnerId: string) => {
      if (previewMode) return;
      const user = getFirebaseAuth().currentUser;
      if (!user) return;
      setPartnerActionLoading(true);
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(
          `/api/admin/requests/${requestId}/partner-assignment`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${idToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ partnerId }),
          },
        );
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean }
          | null;
        if (!res.ok || !data?.ok) throw new Error("partner_assign_failed");
        setActionMessage({
          tone: "success",
          text: copy.section("partners").text("partnerAssigned"),
        });
        await refreshDashboard();
      } catch {
        setActionMessage({
          tone: "error",
          text: copy.section("partners").text("partnerAssignFailed"),
        });
      } finally {
        setPartnerActionLoading(false);
      }
    },
    [copy, previewMode, refreshDashboard, setActionMessage],
  );

  const actOnPartnerDraft = useCallback(
    async (
      draft: PartnerAnswerDraftRecord,
      action: "approve" | "request_revision",
    ) => {
      if (previewMode) return;
      const user = getFirebaseAuth().currentUser;
      if (!user) return;
      setPartnerActionLoading(true);
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(`/api/admin/partner-drafts/${draft.id}`, {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${idToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action,
            revisionNote: partnerRevisionNote,
          }),
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean }
          | null;
        if (!res.ok || !data?.ok) throw new Error("partner_draft_failed");
        setPartnerRevisionNote("");
        setActionMessage({
          tone: "success",
          text:
            action === "approve"
              ? copy.section("partners").text("draftApproved")
              : copy.section("partners").text("draftRevisionRequested"),
        });
        await refreshDashboard();
      } catch {
        setActionMessage({
          tone: "error",
          text: copy.section("partners").text("draftActionFailed"),
        });
      } finally {
        setPartnerActionLoading(false);
      }
    },
    [
      copy,
      partnerRevisionNote,
      previewMode,
      refreshDashboard,
      setActionMessage,
    ],
  );

  // -- Loading / Denied / Error ---------------------------------------------
  if (state === "loading") {
    return (
      <div className="admin-state">
        <div className="admin-state__card">
          <div className="admin-state__spinner" aria-hidden="true" />
          <h2>{copy.message("loading")}</h2>
          <p>{copy.message("loadingDescription")}</p>
        </div>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="admin-state">
        <div className="admin-state__card">
          <h2>{copy.message("denied")}</h2>
          <p>{copy.message("deniedDescription")}</p>
          <button
            className="admin-btn admin-btn--primary"
            type="button"
            onClick={() =>
              logoutPortalSession().then(() => router.push("/admin/login"))
            }
          >
            {copy.message("loginAgain")}
          </button>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="admin-state">
        <div className="admin-state__card admin-state__card--error">
          <h2>{copy.message("genericError")}</h2>
          <p>{error}</p>
          <button className="admin-btn" type="button" onClick={() => void refreshDashboard()}>
            {copy.message("retry")}
          </button>
        </div>
      </div>
    );
  }

  // -- Render ---------------------------------------------------------------
  const editingOptions = { editing, selectedSectionId, onSelectSection };
  const navigationSection = getCmsSection(
    content,
    "admin.operations",
    "navigation",
  );
  const activeContentSection = getCmsSection(
    content,
    "admin.operations",
    ADMIN_OPERATION_TAB_SECTION_IDS[tab],
  );
  return (
    <AdminOperationsCopyContext.Provider value={copy}>
    <div className="admin-shell">
      <aside
        {...cmsEditableSectionProps(
          navigationSection,
          "admin-sidebar",
          editingOptions,
        )}
        aria-label={copy.section("navigation").text("navigationAriaLabel")}
      >
        <div className="admin-brand">
          <div className="admin-brand__mark" aria-hidden="true">N</div>
          <div className="admin-brand__meta">
            <strong>{copy.section("navigation").text("brandName")}</strong>
            <span>{copy.section("navigation").text("brandSubtitle")}</span>
          </div>
        </div>

        <nav className="admin-nav">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`admin-nav__item${tab === item.key ? " is-active" : ""}`}
              onClick={() => setTab(item.key)}
            >
              <span className="admin-nav__label">{item.label}</span>
              <span className="admin-nav__desc">{item.description}</span>
            </button>
          ))}
          {canManageTestData ? (
            <button
              type="button"
              className="admin-nav__item"
              onClick={() => router.push("/admin/test-data")}
            >
              <span className="admin-nav__label">
                {copy.section("testDataManagement").text("menuTitle")}
              </span>
              <span className="admin-nav__desc">
                {copy.section("testDataManagement").text("menuDescription")}
              </span>
            </button>
          ) : null}
        </nav>

        <div className="admin-sidebar__footer">
          <div className="admin-user">
            <div className="admin-user__avatar" aria-hidden="true">
              {(currentUser?.email ?? "A").slice(0, 1).toUpperCase()}
            </div>
            <div className="admin-user__meta">
              <strong>{currentUser?.email ?? "admin"}</strong>
              <span>{copy.section("navigation").text("operatorRole")}</span>
            </div>
          </div>
          <button
            className="admin-btn admin-btn--ghost admin-btn--block"
            type="button"
            onClick={() => router.push("/admin")}
          >
            {copy.section("navigation").text("backToContent")}
          </button>
          <button
            className="admin-btn admin-btn--ghost admin-btn--block"
            type="button"
            onClick={() =>
              logoutPortalSession().then(() => router.push("/admin/login"))
            }
          >
            {copy.section("navigation").text("logout")}
          </button>
        </div>
      </aside>

      <section
        {...cmsEditableSectionProps(
          activeContentSection,
          "admin-main",
          editingOptions,
        )}
      >
        <header className="admin-topbar">
          <div>
            <p className="admin-topbar__crumb">
              {copy.section("navigation").text("breadcrumbPrefix")} /{" "}
              {TABS.find((item) => item.key === tab)?.label}
            </p>
            <h1 className="admin-topbar__title">{TABS.find((item) => item.key === tab)?.label}</h1>
            <p className="admin-topbar__hint">{TABS.find((item) => item.key === tab)?.description}</p>
          </div>
          <div className="admin-topbar__actions">
            <span className="admin-topbar__updated">
              {copy.section("navigation").text("lastSynced")}{" "}
              {lastUpdated
                ? formatRelative(lastUpdated.toISOString(), referenceTime, copy)
                : "-"}
            </span>
            <button
              type="button"
              className="admin-btn"
              onClick={() => void refreshDashboard()}
              disabled={refreshing}
            >
              {refreshing
                ? copy.section("navigation").text("refreshing")
                : copy.section("navigation").text("refresh")}
            </button>
          </div>
        </header>

        {actionMessage && (
          <div className={`admin-toast admin-toast--${actionMessage.tone}`} role="status">
            {actionMessage.text}
            <button
              type="button"
              className="admin-toast__close"
              aria-label={copy.section("navigation").text("closeAriaLabel")}
              onClick={() => setActionMessage(null)}
            >
              ×
            </button>
          </div>
        )}

        {tab === "overview" && (
          <div className="admin-grid">
            <div
              className="admin-toast admin-toast--info admin-card--span-3"
              role="status"
            >
              {copy.section("overview").text("productionDataNotice")}
            </div>
            <div className="admin-kpi-grid">
              <KpiCard
                label={copy.section("overview").text("memberKpi")}
                value={productionDashboard.users.length.toLocaleString()}
                suffix={copy.section("overview").text("peopleUnit")}
                delta={memberDelta}
                series={signupsSeries.map((point) => point.value)}
                tone="blue"
              />
              <KpiCard
                label={copy.section("overview").text("requestKpi")}
                value={productionDashboard.requests.length.toLocaleString()}
                suffix={copy.section("overview").text("countUnit")}
                delta={requestDelta}
                series={inquiriesSeries.map((point) => point.value)}
                tone="amber"
              />
              <KpiCard
                label={copy.section("overview").text("answerKpi")}
                value={productionDashboard.answers.length.toLocaleString()}
                suffix={copy.section("overview").text("countUnit")}
                delta={answerDelta}
                series={answersSeries.map((point) => point.value)}
                tone="green"
              />
              <KpiCard
                label={copy.section("overview").text("ratingKpi")}
                value={productionDashboard.ratings.length ? ratingScoreAvg.toFixed(2) : "-"}
                suffix={productionDashboard.ratings.length ? "/5.0" : ""}
                delta={ratingDelta}
                helper={`${copy.section("overview").text("helpfulPrefix")} ${(helpfulRate * 100).toFixed(0)}% · ${productionDashboard.ratings.length}${copy.section("overview").text("countUnit")}`}
                tone="violet"
              />
            </div>

            <div className="admin-card admin-card--span-2">
              <header className="admin-card__head">
                <div>
                  <h2>{copy.section("overview").text("trendTitle")}</h2>
                  <p>{copy.section("overview").text("trendDescription")}</p>
                </div>
                <span className="admin-card__legend">
                  <i className="dot dot--blue" />{" "}
                  {copy.section("overview").text("signupLegend")}
                  <i className="dot dot--amber" />{" "}
                  {copy.section("overview").text("inquiryLegend")}
                  <i className="dot dot--green" />{" "}
                  {copy.section("overview").text("answerLegend")}
                </span>
              </header>
              <TrendChart
                series={[
                  { name: copy.section("overview").text("signupLegend"), color: "#3b82f6", values: signupsSeries.map((point) => point.value) },
                  { name: copy.section("overview").text("inquiryLegend"), color: "#f59e0b", values: inquiriesSeries.map((point) => point.value) },
                  { name: copy.section("overview").text("answerLegend"), color: "#10b981", values: answersSeries.map((point) => point.value) },
                ]}
                labels={inquiriesSeries.map((point) => point.label)}
              />
            </div>

            <div className="admin-card">
              <header className="admin-card__head">
                <div>
                  <h2>{copy.section("overview").text("metricsTitle")}</h2>
                  <p>{copy.section("overview").text("metricsDescription")}</p>
                </div>
              </header>
              <ul className="admin-stat-list">
                <li>
                  <span>{copy.section("overview").text("answerRate")}</span>
                  <strong>{(answerRate * 100).toFixed(1)}%</strong>
                  <em>
                    {answeredCount}/{productionDashboard.requests.length}{" "}
                    {copy.section("overview").text("countUnit")}
                  </em>
                </li>
                <li>
                  <span>{copy.section("overview").text("activeOrganizations")}</span>
                  <strong>{organizations.length.toLocaleString()}</strong>
                  <em>{copy.section("overview").text("walletOrganizations")}</em>
                </li>
                <li>
                  <span>{copy.section("overview").text("totalWalletBalance")}</span>
                  <strong>{formatPoints(dashboardTotalWalletBalance, copy)}</strong>
                  <em>{productionDashboard.organizations.length}{copy.section("overview").text("organizationTotalSuffix")}</em>
                </li>
                <li>
                  <span>{copy.section("overview").text("recentSpend")}</span>
                  <strong>{formatPoints(dashboardPointsSpent30d, copy)}</strong>
                  <em>{copy.section("overview").text("recentSpendHelp")}</em>
                </li>
              </ul>
            </div>

            <div className="admin-card admin-card--span-2">
              <header className="admin-card__head">
                <div>
                  <h2>{copy.section("overview").text("recentActivityTitle")}</h2>
                  <p>{copy.section("overview").text("recentActivityDescription")}</p>
                </div>
                <button type="button" className="admin-link" onClick={() => setTab("audit")}>
                  {copy.section("overview").text("viewAll")}
                </button>
              </header>
              <ul className="admin-activity admin-activity--detailed">
                {recentActivity.map((item) => (
                  <li key={item.id}>
                    <span
                      className={`admin-activity__dot admin-activity__dot--${item.tone}`}
                      aria-hidden="true"
                    />
                    <div className="admin-activity__body">
                      <div className="admin-activity__headline">
                        <strong>{item.actionLabel}</strong>
                        <span className="admin-activity__target">
                          <span className="admin-activity__label">{copy.section("overview").text("targetLabel")}</span>
                          <span>{item.targetLabel}</span>
                          {item.targetSub && (
                            <span className="admin-cell-sub">{item.targetSub}</span>
                          )}
                        </span>
                      </div>
                      <div className="admin-activity__context">
                        <span className="admin-chip admin-chip--muted">
                          {item.targetTypeLabel}
                        </span>
                        <span>{copy.section("overview").text("actorLabel")} {item.actorName}</span>
                        <time title={formatDate(item.time)}>
                          <span className="admin-activity__label">{copy.section("overview").text("occurredAtLabel")}</span>
                          {formatRelative(item.time, referenceTime, copy)}
                        </time>
                      </div>
                    </div>
                  </li>
                ))}
                {recentActivity.length === 0 && (
                  <li className="admin-empty">{copy.section("overview").text("noActivity")}</li>
                )}
              </ul>
            </div>

            <div className="admin-card">
              <header className="admin-card__head">
                <div>
                  <h2>{copy.section("overview").text("topOrganizationsTitle")}</h2>
                  <p>{copy.section("overview").text("topOrganizationsDescription")}</p>
                </div>
              </header>
              <ul className="admin-rank">
                {orgInquiryCounts.map((row, index) => (
                  <li key={row.name}>
                    <span className="admin-rank__index">{index + 1}</span>
                    <span className="admin-rank__name">{row.name}</span>
                    <span className="admin-rank__value">
                      {row.count}
                      {copy.section("overview").text("countUnit")}
                    </span>
                  </li>
                ))}
                {orgInquiryCounts.length === 0 && <li className="admin-empty">{copy.section("overview").text("noData")}</li>}
              </ul>
            </div>
          </div>
        )}

        {tab === "members" && (
          <>
            <div className="admin-subtabs" role="tablist" aria-label={copy.section("members").text("subtabsAriaLabel")}>
              {canReadMembers && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={memberSubtab === "members"}
                  className={`admin-subtab${memberSubtab === "members" ? " is-active" : ""}`}
                  onClick={() => setMemberSubtab("members")}
                >
                  <span>{copy.section("members").item("members")}</span>
                  <em>{copy.section("members").text("memberTabDescription")}</em>
                </button>
              )}
              {canReadCooperatives && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={memberSubtab === "cooperatives"}
                  className={`admin-subtab${memberSubtab === "cooperatives" ? " is-active" : ""}`}
                  onClick={() => setMemberSubtab("cooperatives")}
                >
                  <span>{copy.section("members").item("cooperatives")}</span>
                  <em>{copy.section("members").text("cooperativeMasterTabDescription")}</em>
                </button>
              )}
              {canReadOperators && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={memberSubtab === "operators"}
                  className={`admin-subtab${memberSubtab === "operators" ? " is-active" : ""}`}
                  onClick={() => setMemberSubtab("operators")}
                >
                  <span>{copy.section("members").item("operators")}</span>
                  <em>{copy.section("members").text("operatorTabDescription")}</em>
                </button>
              )}
            </div>

            {memberSubtab === "members" && canReadMembers && (
              <div className="admin-grid admin-grid--members">
                <div className="admin-card admin-card--span-2">
                  <header className="admin-card__head">
                    <div>
                      <h2>{copy.section("members").text("memberListTitle")}</h2>
                      <p>{copy.section("inquiries").text("totalPrefix")} {memberUsers.length.toLocaleString()}{copy.section("members").text("memberListSuffix")}</p>
                    </div>
                    <input
                      type="search"
                      className="admin-search"
                      placeholder={copy.section("members").text("memberSearchPlaceholder")}
                      value={memberSearch}
                      onChange={(event) => setMemberSearch(event.target.value)}
                    />
                  </header>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>{copy.section("members").text("memberColumn")}</th>
                          <th>{copy.section("members").text("organizationColumn")}</th>
                          <th>{copy.section("members").text("roleColumn")}</th>
                          <th>{copy.section("members").text("statusColumn")}</th>
                          <th>{copy.section("members").text("marketingColumn")}</th>
                          <th>{copy.section("members").text("joinedColumn")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMembers.map((user) => {
                          const initial = (user.name ?? user.email ?? "?").slice(0, 1).toUpperCase();
                          return (
                            <tr
                              key={user.uid}
                              className={`admin-row-clickable${
                                selectedMember?.uid === user.uid ? " is-selected" : ""
                              }`}
                              tabIndex={0}
                              onClick={() => setSelectedMemberUid(user.uid)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  setSelectedMemberUid(user.uid);
                                }
                              }}
                              aria-label={`${user.name || user.email} ${copy.section("members").text("memberDetailAriaSuffix")}`}
                            >
                              <td>
                                <div className="admin-cell-user">
                                  <span className="admin-avatar" aria-hidden="true">{initial}</span>
                                  <div>
                                    <strong>{user.name || copy.section("members").text("unnamed")}</strong>
                                    <span>{user.email}</span>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <strong>{user.cooperativeName ?? user.manualCooperativeName ?? copy.section("members").text("unspecified")}</strong>
                                <span className="admin-cell-sub">
                                  {user.cooperativeId
                                    ? `${copy.section("members").text("organizationCode")} ${user.cooperativeId}`
                                    : copy.section("members").text("organizationCodeMissing")}
                                </span>
                              </td>
                              <td>
                                <strong>{user.position || "-"}</strong>
                                <span className="admin-cell-sub">{user.duty || ""}</span>
                              </td>
                              <td>
                                <span
                                  className={`admin-pill admin-pill--${getMemberStatusTone(user.status)}`}
                                >
                                  <span className="admin-pill__dot" aria-hidden="true" />
                                  {memberStatusLabel(copy, user.status, true)}
                                </span>
                              </td>
                              <td>
                                <span className="admin-cell-sub">
                                  {[
                                    user.consents?.email &&
                                      copy.section("members").text("emailChannel"),
                                    user.consents?.sms &&
                                      copy.section("members").text("smsChannel"),
                                    user.consents?.kakao &&
                                      copy.section("members").text("kakaoChannel"),
                                  ]
                                    .filter(Boolean)
                                    .join(" · ") || copy.section("members").text("optedOut")}
                                </span>
                              </td>
                              <td>{formatDate(user.createdAt)}</td>
                            </tr>
                          );
                        })}
                        {filteredMembers.length === 0 && (
                          <tr>
                            <td colSpan={6} className="admin-empty">{copy.section("members").text("memberEmpty")}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <MemberDetailPanel
                  user={selectedMember}
                  organization={selectedMemberOrganization}
                  ledger={selectedMemberLedger}
                  transactions={selectedMemberTransactions}
                  auditLogs={selectedMemberAudits}
                  formatAuditLog={formatAuditLog}
                  onAction={requestMemberAction}
                  canChangeCooperative={canWriteMembers}
                  onChangeCooperative={setMemberCooperativeEditor}
                />
              </div>
            )}

            {memberSubtab === "cooperatives" && canReadCooperatives && (
              <CooperativeMasterPanel
                copy={copy}
                canWrite={canWriteCooperatives}
              />
            )}

            {memberSubtab === "operators" && canReadOperators && (
              <div className="admin-grid admin-grid--members">
                <div className="admin-card admin-card--span-2">
                  <header className="admin-card__head">
                    <div>
                      <h2>{copy.section("members").text("operatorListTitle")}</h2>
                      <p>{copy.section("inquiries").text("totalPrefix")} {operatorListTotal.toLocaleString()}{copy.section("members").text("operatorListSuffix")}</p>
                    </div>
                    <div className="admin-card__tools">
                      <button
                        type="button"
                        className="admin-btn"
                        onClick={() =>
                          setOperatorRefreshKey((current) => current + 1)}
                        disabled={operatorListLoading}
                      >
                        {operatorListLoading
                          ? copy.section("navigation").text("refreshing")
                          : copy.section("navigation").text("refresh")}
                      </button>
                      {canCreateOperators && (
                        <button
                          type="button"
                          className="admin-btn admin-btn--primary"
                          onClick={() =>
                            setOperatorEditor({
                              mode: "create",
                              operator: null,
                            })}
                        >
                          {copy.section("members").text("addOperator")}
                        </button>
                      )}
                    </div>
                  </header>
                  <div className="admin-operator-filters">
                    <label>
                      <span>{copy.section("members").text("operatorSearchLabel")}</span>
                      <input
                        type="search"
                        className="admin-input"
                        placeholder={copy.section("members").text("operatorSearchPlaceholder")}
                        value={operatorSearch}
                        onChange={(event) => {
                          setOperatorSearch(event.target.value);
                          setOperatorPage(1);
                        }}
                      />
                    </label>
                    <label>
                      <span>{copy.section("members").text("operatorRoleFilterLabel")}</span>
                      <select
                        className="admin-input"
                        value={operatorRoleFilter}
                        onChange={(event) => {
                          setOperatorRoleFilter(event.target.value);
                          setOperatorPage(1);
                        }}
                      >
                        <option value="">{copy.section("members").text("filterAll")}</option>
                        {ADMIN_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ADMIN_ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{copy.section("members").text("operatorStatusFilterLabel")}</span>
                      <select
                        className="admin-input"
                        value={operatorStatusFilter}
                        onChange={(event) => {
                          setOperatorStatusFilter(event.target.value);
                          setOperatorPage(1);
                        }}
                      >
                        <option value="">{copy.section("members").text("filterAll")}</option>
                        <option value="active">{copy.section("members").text("statusActive")}</option>
                        <option value="invited">{copy.section("members").text("statusInvited")}</option>
                        <option value="suspended">{copy.section("members").text("statusSuspended")}</option>
                        <option value="disabled">{copy.section("members").text("statusDisabled")}</option>
                      </select>
                    </label>
                    <label>
                      <span>{copy.section("members").text("operatorPartnerFilterLabel")}</span>
                      <select
                        className="admin-input"
                        value={operatorPartnerFilter}
                        onChange={(event) => {
                          setOperatorPartnerFilter(event.target.value);
                          setOperatorPage(1);
                        }}
                      >
                        <option value="">{copy.section("members").text("filterAll")}</option>
                        <option value="internal">{copy.section("members").text("internalOperatorAffiliation")}</option>
                      </select>
                    </label>
                    <label>
                      <span>{copy.section("members").text("pageSizeLabel")}</span>
                      <select
                        className="admin-input"
                        value={operatorPageSize}
                        onChange={(event) => {
                          setOperatorPageSize(Number(event.target.value));
                          setOperatorPage(1);
                        }}
                      >
                        {OPERATOR_PAGE_SIZE_OPTIONS.map((size) => (
                          <option key={size} value={size}>
                            {size}{copy.section("members").text("pageSizeSuffix")}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {operatorListError && (
                    <div className="admin-inline-state admin-inline-state--error" role="alert">
                      <span>{operatorListError}</span>
                      <button
                        type="button"
                        className="admin-btn admin-btn--sm"
                        onClick={() =>
                          setOperatorRefreshKey((current) => current + 1)}
                      >
                        {copy.message("retry")}
                      </button>
                    </div>
                  )}
                  <div className="admin-table-wrap admin-table-wrap--operators">
                    <table className="admin-table admin-table--operators">
                      <thead>
                        <tr>
                          <th>{copy.section("members").text("operatorColumn")}</th>
                          <th>{copy.section("members").text("positionDutyColumn")}</th>
                          <th>{copy.section("members").text("adminRoleColumn")}</th>
                          <th>{copy.section("members").text("affiliationColumn")}</th>
                          <th>{copy.section("members").text("scopeColumn")}</th>
                          <th>{copy.section("members").text("statusColumn")}</th>
                          <th>{copy.section("members").text("lastLoginColumn")}</th>
                          <th>{copy.section("members").text("updatedColumn")}</th>
                          <th>{copy.section("members").text("manageColumn")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {operatorListLoading && (
                          <tr>
                            <td colSpan={9} className="admin-empty" aria-live="polite">
                              {copy.section("members").text("operatorLoading")}
                            </td>
                          </tr>
                        )}
                        {filteredOperators.map((operator) => {
                          const initial = (operator.name ?? operator.email ?? "?").slice(0, 1).toUpperCase();
                          const status = operatorAccountStatus(operator);
                          return (
                            <tr
                              key={operator.uid}
                              className={`admin-row-clickable${
                                selectedOperator?.uid === operator.uid ? " is-selected" : ""
                              }`}
                              tabIndex={0}
                              onClick={() => setSelectedOperatorUid(operator.uid)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  setSelectedOperatorUid(operator.uid);
                                }
                              }}
                              aria-label={`${operator.name || operator.email} ${copy.section("members").text("operatorDetailAriaSuffix")}`}
                            >
                              <td>
                                <div className="admin-cell-user">
                                  <span className="admin-avatar" aria-hidden="true">{initial}</span>
                                  <div className="admin-cell-user__text">
                                    <strong>{operator.name || copy.section("members").text("unnamed")}</strong>
                                    <span title={operator.email}>{operator.email}</span>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <strong>{operator.position || copy.section("members").text("operatorRoleFallback")}</strong>
                                <span className="admin-cell-sub">{operator.duty || copy.section("members").text("administratorFallback")}</span>
                              </td>
                              <td>
                                <span className="admin-chip">
                                  {ADMIN_ROLE_LABELS[getAdminRole(operator)]}
                                </span>
                              </td>
                              <td>{operator.partnerName || copy.section("members").text("internalOperatorAffiliation")}</td>
                              <td>{operator.scopes.map((scope) => copy.section("members").text(`scope.${scope}`)).join(", ")}</td>
                              <td>
                                <span
                                  className={`admin-pill admin-pill--${getMemberStatusTone(status === "active" ? "active" : "rejected")}`}
                                >
                                  <span className="admin-pill__dot" aria-hidden="true" />
                                  {copy.section("members").text(`status.${status}`)}
                                </span>
                              </td>
                              <td>{operator.lastLoginAt ? formatDate(operator.lastLoginAt) : copy.section("members").text("noLoginRecord")}</td>
                              <td>{formatDate(operator.updatedAt ?? operator.createdAt)}</td>
                              <td>
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--sm"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedOperatorUid(operator.uid);
                                  }}
                                >
                                  {copy.section("members").text("viewDetails")}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                        {!operatorListLoading && filteredOperators.length === 0 && !operatorListError && (
                          <tr>
                            <td colSpan={9} className="admin-empty">{copy.section("members").text("operatorEmpty")}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <nav
                    className="admin-pagination"
                    aria-label={copy.section("members").text("operatorPaginationAriaLabel")}
                  >
                    <button
                      type="button"
                      className="admin-btn admin-btn--sm"
                      onClick={() =>
                        setOperatorPage((current) => Math.max(1, current - 1))}
                      disabled={operatorPage <= 1 || operatorListLoading}
                    >
                      {copy.section("members").text("previousPage")}
                    </button>
                    <span>
                      {operatorPage.toLocaleString()} / {operatorTotalPages.toLocaleString()}
                    </span>
                    <button
                      type="button"
                      className="admin-btn admin-btn--sm"
                      onClick={() =>
                        setOperatorPage((current) =>
                          Math.min(operatorTotalPages, current + 1))}
                      disabled={
                        operatorPage >= operatorTotalPages ||
                        operatorListLoading
                      }
                    >
                      {copy.section("members").text("nextPage")}
                    </button>
                  </nav>
                </div>
                <OperatorDetailPanel
                  operator={selectedOperator}
                  auditLogs={selectedOperatorAudits}
                  formatAuditLog={formatAuditLog}
                  isProtected={selectedOperatorIsProtected}
                  isLastSuperAdmin={selectedOperatorIsLastSuperAdmin}
                  actorCanReachTarget={
                    selectedOperatorProtection?.actorCanReachTarget ?? false
                  }
                  canUpdate={canUpdateOperators}
                  canDisable={canDisableOperators}
                  canDelete={canDeleteOperators}
                  canManageRoles={canManageOperatorRoles}
                  canResetPassword={canResetOperatorPasswords}
                  loading={operatorActionLoading}
                  onEdit={(operator) => setOperatorEditor({ mode: "edit", operator })}
                  onChangePermission={(operator, status) =>
                    setOperatorConfirmation({
                      kind: "permission",
                      operator,
                      nextStatus: status,
                    })
                  }
                  onResetPassword={(operator) =>
                    setOperatorConfirmation({ kind: "password", operator })
                  }
                  onDelete={(operator) =>
                    setOperatorConfirmation({ kind: "delete", operator })
                  }
                />
              </div>
            )}
          </>
        )}

        {tab === "partners" && (
          <PartnerManagementApiPanel
            copy={copy}
            adminContext={adminContext}
            auditLogs={auditLogs}
            previewMode={previewMode}
            previewPartners={partners}
            assignments={partnerAssignments}
            drafts={partnerAnswerDrafts}
            requests={requests}
            workflowLoading={partnerActionLoading}
            revisionNote={partnerRevisionNote}
            refreshVersion={String(referenceTime)}
            onRevisionNoteChange={setPartnerRevisionNote}
            onAssignPartner={assignPartnerToRequest}
            onDraftAction={actOnPartnerDraft}
          />
        )}

        {tab === "inquiries" && (
          <div className="admin-subtabs" role="tablist" aria-label={inquiryCopy.text("subtabsAriaLabel")}>
            <button
              type="button"
              role="tab"
              aria-selected={inquirySubtab === "requests"}
              className={`admin-subtab${inquirySubtab === "requests" ? " is-active" : ""}`}
              onClick={() => setInquirySubtab("requests")}
            >
              <span>{inquiryCopy.item("requests")}</span>
              <em>{inquiryCopy.text("requestTabDescription")}</em>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inquirySubtab === "faq"}
              className={`admin-subtab${inquirySubtab === "faq" ? " is-active" : ""}`}
              onClick={() => setInquirySubtab("faq")}
            >
              <span>{inquiryCopy.item("faq")}</span>
              <em>{inquiryCopy.text("faqTabDescription")}</em>
            </button>
          </div>
        )}

        {tab === "inquiries" && inquirySubtab === "requests" && (
          <div className="admin-grid admin-grid--inquiries">
            <div className="admin-card admin-card--full admin-inquiries-card">
              <header className="admin-card__head admin-card__head--column">
                <div>
                  <h2>{inquiryCopy.text("requestListTitle")}</h2>
                  <p>
                    {inquiryCopy.text("totalPrefix")}{" "}
                    {requests.length.toLocaleString()}
                    {inquiryCopy.text("countUnit")} ·{" "}
                    {inquiryCopy.text("filteredPrefix")}{" "}
                    {filteredRequests.length.toLocaleString()}
                    {inquiryCopy.text("countUnit")}
                    {requestSearch.trim() && (
                      <>
                        {" "}
                        · {inquiryCopy.text("searchPrefix")} &quot;
                        {requestSearch.trim()}&quot;
                      </>
                    )}
                    <span className="admin-inquiry-sort-hint">
                      · {inquiryCopy.text("sortHint")}
                    </span>
                  </p>
                </div>
                <div className="admin-inquiry-filters">
                  <div className="admin-inquiry-search">
                    <label className="admin-inquiry-search__label" htmlFor="admin-inquiry-search">
                      {inquiryCopy.text("unifiedSearch")}
                    </label>
                    <div className="admin-inquiry-search__field">
                      <input
                        id="admin-inquiry-search"
                        className="admin-input"
                        type="search"
                        placeholder={inquiryCopy.text("requestSearchPlaceholder")}
                        value={requestSearch}
                        onChange={(event) => setRequestSearch(event.target.value)}
                        aria-label={inquiryCopy.text("requestSearchAriaLabel")}
                        autoComplete="off"
                      />
                      {requestSearch.trim() && (
                        <button
                          type="button"
                          className="admin-inquiry-search__clear"
                          onClick={() => setRequestSearch("")}
                          aria-label={inquiryCopy.text("clearSearchAriaLabel")}
                        >
                          {inquiryCopy.text("clearSearch")}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="admin-filter-row admin-filter-row--inquiry">
                  <select
                    className="admin-input"
                    value={requestCoopFilter}
                    onChange={(event) => setRequestCoopFilter(event.target.value)}
                  >
                    <option value="">{inquiryCopy.text("allOrganizations")}</option>
                    {organizations.map((organization) => (
                      <option
                        key={organization.cooperativeId}
                        value={organization.nh_org_id ?? organization.cooperativeId}
                      >
                        {organization.cooperativeName}
                      </option>
                    ))}
                  </select>
                  <select
                    className="admin-input"
                    value={requestStatusFilter}
                    onChange={(event) => setRequestStatusFilter(event.target.value)}
                  >
                    {ADMIN_REQUEST_STATUS_FILTERS.map((option) => (
                      <option key={option.id} value={option.value}>
                        {inquiryCopy.item(`requestStatus.${option.id}`)}
                      </option>
                    ))}
                  </select>
                  <select
                    className="admin-input"
                    value={requestVisibilityFilter}
                    onChange={(event) => setRequestVisibilityFilter(event.target.value)}
                  >
                    {ADMIN_VISIBILITY_FILTERS.map((option) => (
                      <option key={option.id} value={option.value}>
                        {inquiryCopy.item(`visibility.${option.id}`)}
                      </option>
                    ))}
                  </select>
                  </div>
                </div>
              </header>
              <div className="admin-table-wrap admin-table-wrap--inquiries">
                <table className="admin-table admin-table--inquiries">
                  <thead>
                    <tr>
                      <th>{inquiryCopy.text("referenceTitleColumn")}</th>
                      <th>{inquiryCopy.text("authorOrganizationColumn")}</th>
                      <th>{inquiryCopy.text("visibilityColumn")}</th>
                      <th>{inquiryCopy.text("statusColumn")}</th>
                      <th>{inquiryCopy.text("assigneeColumn")}</th>
                      <th>{inquiryCopy.text("usedPointsColumn")}</th>
                      <th>{inquiryCopy.text("ratingColumn")}</th>
                      <th>{inquiryCopy.text("receivedAtColumn")}</th>
                      <th>{inquiryCopy.text("answeredAtColumn")}</th>
                      <th aria-label={inquiryCopy.text("actionColumnAriaLabel")} />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map((request) => {
                      const answer = answerByRequestId.get(request.id);
                      const resolvedStatus = resolveAdminRequestStatus(request);
                      const requestRatings = ratingsByRequestId.get(request.id) ?? [];
                      const topRating = requestRatings[0];
                      const managers = assignedManagers(request);
                      return (
                        <tr key={request.id}>
                          <td>
                            <div className="admin-cell-stack">
                              <span className="admin-cell-sub">{request.requestNumber}</span>
                              <strong>{request.subject}</strong>
                              {(request.attachments?.length ?? 0) > 0 && (
                                <span className="admin-cell-sub">
                                  {inquiryCopy.text("attachmentPrefix")}{" "}
                                  {request.attachments?.length ?? 0}
                                  {inquiryCopy.text("attachmentUnit")}
                                </span>
                              )}
                              {request.isFollowUp && (
                                <span className="admin-cell-sub">
                                  ↳ {inquiryCopy.text("followupPrefix")}{" "}
                                  {request.parentRequestId}
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            <strong>{request.userName || request.userEmail}</strong>
                            <span className="admin-cell-sub">
                              {request.cooperativeName ??
                                request.cooperativeDisplay ??
                                request.manualCooperativeName ??
                                "-"}
                            </span>
                          </td>
                          <td><VisibilityPill value={request.visibility} /></td>
                          <td><StatusPill value={resolvedStatus} /></td>
                          <td className="admin-inquiry-assignee">
                            {managers.length > 0 ? (
                              <div className="admin-cell-stack">
                                <strong>{managers[0]}</strong>
                                {managers.length > 1 && (
                                  <span className="admin-cell-sub">
                                    {inquiryCopy.text("additionalAssigneePrefix")}{" "}
                                    {managers.length - 1}
                                    {inquiryCopy.text("peopleUnit")}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="admin-pill admin-pill--slate">{inquiryCopy.text("unassigned")}</span>
                            )}
                          </td>
                          <td className="admin-inquiry-response">
                            {!answer ? (
                              <span className="admin-inquiry-response__empty">
                                -
                              </span>
                            ) : (
                              <span className="admin-inquiry-response__points">
                                {formatPoints(answer.pointCost ?? 0, copy)}
                              </span>
                            )}
                          </td>
                          <td className="admin-inquiry-rating">
                            <CustomerRatingCell
                              hasAnswer={Boolean(answer)}
                              rating={topRating ?? null}
                              onOpen={() => setRatingDetailRequestId(request.id)}
                            />
                          </td>
                          <td>{formatDate(request.createdAt)}</td>
                          <td className="admin-inquiry-answered-at">
                            {answer ? (
                              <div className="admin-cell-stack">
                                <strong>
                                  {formatDate(
                                    getAnswerRespondedAt(answer, request) ?? undefined,
                                  )}
                                </strong>
                                <span className="admin-cell-sub">
                                  {inquiryCopy.text("finalAnswer")}
                                </span>
                              </div>
                            ) : (
                              <span className="admin-cell-sub">-</span>
                            )}
                          </td>
                          <td className="admin-table__actions">
                            {(() => {
                              const actionKind = getInquiryActionKind(resolvedStatus);
                              if (actionKind === "complete") {
                                return (
                                  <button
                                    type="button"
                                    className="admin-btn admin-btn--answer-complete admin-btn--sm"
                                    onClick={() => setActiveRequestId(request.id)}
                                    aria-label={`${request.subject} ${inquiryCopy.text("detailAriaSuffix")}`}
                                  >
                                    {inquiryCopy.text("answerComplete")}
                                  </button>
                                );
                              }
                              if (actionKind === "edit") {
                                return (
                                  <button
                                    type="button"
                                    className="admin-btn admin-btn--answer-edit admin-btn--sm"
                                    onClick={() => setActiveRequestId(request.id)}
                                  >
                                    {inquiryCopy.text("editAnswer")}
                                  </button>
                                );
                              }
                              return (
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--answer-write admin-btn--sm"
                                  onClick={() => setActiveRequestId(request.id)}
                                >
                                  {inquiryCopy.text("writeAnswer")}
                                </button>
                              );
                            })()}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredRequests.length === 0 && (
                      <tr>
                        <td colSpan={10} className="admin-empty">{inquiryCopy.text("inquiryEmpty")}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === "inquiries" && inquirySubtab === "faq" && (
          <div className="admin-grid admin-grid--faq">
            <div className="admin-card admin-card--full admin-faq-card">
              <header className="admin-card__head admin-card__head--column">
                <div>
                  <h2>{inquiryCopy.text("faqTitle")}</h2>
                  <p>
                    {inquiryCopy.text("faqDescription")}
                    {inquiryCopy.text("totalPrefix")}{" "}
                    {faqs.length.toLocaleString()}
                    {inquiryCopy.text("countUnit")} ·{" "}
                    {inquiryCopy.text("filteredPrefix")}{" "}
                    {filteredFaqs.length.toLocaleString()}
                    {inquiryCopy.text("countUnit")}
                  </p>
                </div>
                <div className="admin-filter-row">
                  <input
                    className="admin-input admin-input--wide"
                    type="search"
                    placeholder={inquiryCopy.text("faqSearchPlaceholder")}
                    value={faqSearch}
                    onChange={(event) => setFaqSearch(event.target.value)}
                    aria-label={inquiryCopy.text("faqSearchAriaLabel")}
                  />
                  <select
                    className="admin-input"
                    value={faqCategoryFilter}
                    onChange={(event) => setFaqCategoryFilter(event.target.value)}
                    aria-label={inquiryCopy.text("faqCategoryAriaLabel")}
                  >
                    <option value="">{inquiryCopy.text("allCategories")}</option>
                    {faqCategories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                  <select
                    className="admin-input"
                    value={faqPublicFilter}
                    onChange={(event) => setFaqPublicFilter(event.target.value)}
                    aria-label={inquiryCopy.text("faqPublicAriaLabel")}
                  >
                    {ADMIN_FAQ_PUBLIC_FILTERS.map((option) => (
                      <option key={option.id} value={option.value}>
                        {inquiryCopy.item(`faqPublic.${option.id}`)}
                      </option>
                    ))}
                  </select>
                  <select
                    className="admin-input"
                    value={faqDisplayFilter}
                    onChange={(event) => setFaqDisplayFilter(event.target.value)}
                    aria-label={inquiryCopy.text("faqDisplayAriaLabel")}
                  >
                    {ADMIN_FAQ_DISPLAY_FILTERS.map((option) => (
                      <option key={option.id} value={option.value}>
                        {inquiryCopy.item(`faqDisplay.${option.id}`)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="admin-btn admin-btn--solid"
                    onClick={() =>
                      setFaqEditor({ mode: "create", faq: null })
                    }
                  >
                    {inquiryCopy.text("addFaq")}
                  </button>
                </div>
              </header>
              <div className="admin-table-wrap admin-table-wrap--faq">
                <table className="admin-table admin-table--faq">
                  <thead>
                    <tr>
                      <th>{inquiryCopy.text("faqQuestionColumn")}</th>
                      <th>{inquiryCopy.text("faqCategoryColumn")}</th>
                      <th>{inquiryCopy.text("faqPublicColumn")}</th>
                      <th>{inquiryCopy.text("faqDisplayColumn")}</th>
                      <th>{inquiryCopy.text("faqUpdatedColumn")}</th>
                      <th>{inquiryCopy.text("faqManagerColumn")}</th>
                      <th aria-label={inquiryCopy.text("actionColumnAriaLabel")} />
                    </tr>
                  </thead>
                  <tbody>
                    {faqLoading && faqs.length === 0 && (
                      <tr>
                        <td colSpan={7} className="admin-empty">
                          {inquiryCopy.text("faqLoading")}
                        </td>
                      </tr>
                    )}
                    {!faqLoading && filteredFaqs.length === 0 && (
                      <tr>
                        <td colSpan={7} className="admin-empty">
                          {faqs.length === 0
                            ? inquiryCopy.text("faqEmpty")
                            : inquiryCopy.text("faqFilteredEmpty")}
                        </td>
                      </tr>
                    )}
                    {filteredFaqs.map((faq) => (
                      <tr key={faq.id}>
                        <td>
                          <div className="admin-cell-stack">
                            <strong>{faq.question}</strong>
                            <span className="admin-cell-sub">
                              {faq.answer.length > 60
                                ? `${faq.answer.slice(0, 60)}...`
                                : faq.answer}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="admin-pill admin-pill--slate">
                            {faq.category}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`admin-pill admin-pill--${faq.isPublic ? "green" : "slate"}`}
                          >
                            {faq.isPublic
                              ? inquiryCopy.item("faqPublic.public")
                              : inquiryCopy.item("faqPublic.private")}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`admin-pill admin-pill--${faq.displayStatus === "published" ? "blue" : "amber"}`}
                          >
                            {faq.displayStatus === "published"
                              ? inquiryCopy.item("faqDisplay.published")
                              : inquiryCopy.item("faqDisplay.draft")}
                          </span>
                        </td>
                        <td>{formatDate(faq.updatedAt)}</td>
                        <td>
                          <div className="admin-cell-stack">
                            <strong>
                              {faq.updatedByEmail ?? faq.createdByEmail ?? "-"}
                            </strong>
                          </div>
                        </td>
                        <td className="admin-table__actions">
                          <button
                            type="button"
                            className="admin-btn admin-btn--ghost admin-btn--sm"
                            onClick={() =>
                              setFaqEditor({ mode: "edit", faq })
                            }
                          >
                            {inquiryCopy.text("edit")}
                          </button>
                          <button
                            type="button"
                            className="admin-btn admin-btn--danger admin-btn--sm"
                            onClick={() => setFaqDeleteTarget(faq)}
                          >
                            {inquiryCopy.text("delete")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === "auditQuotes" && (
          <AdminAuditQuotesPanel
            onMessage={setActionMessage}
            content={content}
            previewMode={previewMode}
          />
        )}

        {tab === "quotePriceMaster" && (
          <CooperativeQuotePriceMasterPanel
            canWrite={canShowAdminAction(adminContext, "auditQuotes:write")}
            onMessage={setActionMessage}
          />
        )}

        {auditEvaluationAdminEnabled && tab === "auditEvaluations" && (
          <AdminAuditEvaluationPanel
            onMessage={setActionMessage}
            content={content}
            previewMode={previewMode}
          />
        )}

        {tab === "points" && (
          <div className="admin-grid admin-grid--points">
            <div className="admin-card admin-points-list">
              <header className="admin-card__head">
                <div>
                  <h2>{copy.section("points").text("walletListTitle")}</h2>
                  <p>
                    {inquiryCopy.text("totalPrefix")}{" "}
                    {organizations.length.toLocaleString()}
                    {copy.section("points").text("organizationUnit")} ·{" "}
                    {copy.section("points").text("searchPrefix")}{" "}
                    {filteredPointOrganizations.length.toLocaleString()}
                    {copy.section("points").text("organizationUnit")} ·{" "}
                    {copy.section("points").text("totalBalancePrefix")}{" "}
                    {formatPoints(totalWalletBalance, copy)}
                  </p>
                </div>
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  onClick={() => {
                    setAllPointTransactionsFilterOrgId("");
                    setAllPointTransactionsOpen(true);
                  }}
                >
                  {copy.section("points").text("allTransactions")}
                </button>
              </header>
              <input
                className="admin-input"
                type="search"
                placeholder={copy.section("points").text("walletSearchPlaceholder")}
                value={pointOrgSearch}
                onChange={(event) => setPointOrgSearch(event.target.value)}
                aria-label={copy.section("points").text("walletSearchAriaLabel")}
              />
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>{copy.section("points").text("organizationColumn")}</th>
                      <th>{copy.section("points").text("memberCountColumn")}</th>
                      <th>{copy.section("points").text("balanceColumn")}</th>
                      <th>{copy.section("points").text("updatedColumn")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPointOrganizations.map((organization) => (
                      <tr
                        key={organization.cooperativeId}
                        className={`admin-row-clickable${
                          selectedPointOrganizationId === organization.cooperativeId ? " is-selected" : ""
                        }`}
                        tabIndex={0}
                        onClick={() => {
                          setSelectedPointOrgId(organization.cooperativeId);
                          setPointAdjustSearch(organization.cooperativeName);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedPointOrgId(organization.cooperativeId);
                            setPointAdjustSearch(organization.cooperativeName);
                          }
                        }}
                        aria-label={`${organization.cooperativeName} ${copy.section("points").text("pointDetailAriaSuffix")}`}
                      >
                        <td>
                          <strong>{organization.cooperativeName}</strong>
                          <span className="admin-cell-sub">
                            {copy.section("points").text("organizationCode")}{" "}
                            {organization.cooperativeId || organization.nh_org_id || "-"}
                          </span>
                        </td>
                        <td>
                          {organization.users?.length ?? 0}
                          {copy.section("points").text("peopleUnit")}
                        </td>
                        <td><strong>{formatPoints(organization.walletBalance ?? 0, copy)}</strong></td>
                        <td>{formatDate(organization.updatedAt)}</td>
                      </tr>
                    ))}
                    {filteredPointOrganizations.length === 0 && (
                      <tr>
                        <td colSpan={4} className="admin-empty">
                          {organizations.length === 0
                            ? copy.section("points").text("walletEmpty")
                            : copy.section("points").text("walletFilteredEmpty")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="admin-card admin-point-detail">
              <header className="admin-card__head">
                <div>
                  <h2>{copy.section("points").text("selectedDetailTitle")}</h2>
                  <p>
                    {selectedPointOrganization
                      ? `${selectedPointOrganization.cooperativeName} · ${copy.section("points").text("selectedDetailSuffix")}`
                      : copy.section("points").text("selectOrganization")}
                  </p>
                </div>
              </header>
              {selectedPointOrganization ? (
                <>
                  <dl className="admin-point-summary">
                    <div>
                      <dt>{copy.section("points").text("currentBalance")}</dt>
                      <dd>{formatPoints(selectedPointOrganization.walletBalance ?? 0, copy)}</dd>
                    </div>
                    <div>
                      <dt>{copy.section("points").text("organizationMembers")}</dt>
                      <dd>
                        {selectedPointOrganization.users?.length ?? 0}
                        {copy.section("points").text("peopleUnit")}
                      </dd>
                    </div>
                    <div>
                      <dt>{copy.section("points").text("updatedColumn")}</dt>
                      <dd>{formatDate(selectedPointOrganization.updatedAt)}</dd>
                    </div>
                  </dl>

                  <section className="admin-point-section">
                    <h3>{copy.section("points").text("manualAdjustmentTitle")}</h3>
                    <p className="admin-point-adjust-lede">
                      {copy.section("points").text("adjustmentHelp")}
                    </p>
                    <form className="admin-form admin-form--adjust" onSubmit={requestPointAdjustment}>
                      <label className="admin-form__full admin-coop-search">
                        <span>{copy.section("points").text("targetOrganization")}</span>
                        <input
                          className="admin-input"
                          type="search"
                          value={pointAdjustSearchValue}
                          onChange={(event) => {
                            setPointAdjustSearch(event.target.value);
                            setPointAdjustSearchFocused(true);
                          }}
                          onFocus={() => setPointAdjustSearchFocused(true)}
                          onBlur={() => {
                            window.setTimeout(() => setPointAdjustSearchFocused(false), 150);
                          }}
                          placeholder={copy.section("points").text("walletSearchPlaceholder")}
                          autoComplete="off"
                          required
                        />
                        {showPointAdjustSuggestions && (
                          <div
                            className="admin-coop-search-results"
                            role="listbox"
                            aria-label={copy.section("points").text("searchResultsAriaLabel")}
                          >
                            {pointAdjustSuggestions.map((organization) => (
                              <button
                                key={organization.cooperativeId}
                                type="button"
                                role="option"
                                aria-selected={
                                  selectedPointOrganizationId === organization.cooperativeId
                                }
                                className={
                                  selectedPointOrganizationId === organization.cooperativeId
                                    ? "is-selected"
                                    : undefined
                                }
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                  setSelectedPointOrgId(organization.cooperativeId);
                                  setPointAdjustSearch(organization.cooperativeName);
                                  setPointAdjustSearchFocused(false);
                                }}
                              >
                                <strong>{organization.cooperativeName}</strong>
                                <span>
                                  {copy.section("points").text("organizationCode")}{" "}
                                  {organization.cooperativeId || organization.nh_org_id || "-"}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </label>

                      <div className="admin-point-balance-card">
                        <span className="admin-point-balance-card__label">{copy.section("points").text("currentWalletBalance")}</span>
                        <strong>
                          {formatPoints(selectedPointOrganization.walletBalance ?? 0, copy)}
                        </strong>
                      </div>

                      <label>
                        <span>{copy.section("points").text("adjustmentPoints")}</span>
                        <input
                          className="admin-input admin-input--point"
                          type="text"
                          inputMode="numeric"
                          placeholder={copy.section("points").text("adjustmentPlaceholder")}
                          value={pointAdjustmentAmount}
                          onChange={(event) =>
                            setPointAdjustmentAmount(formatSignedPointInput(event.target.value))
                          }
                          onBlur={() =>
                            setPointAdjustmentAmount((current) =>
                              formatSignedPointInput(current),
                            )
                          }
                          required
                        />
                        <small className="admin-form__hint">
                          {copy.section("points").text("commaHelp")}
                        </small>
                      </label>
                      <label>
                        <span>{copy.section("points").text("reason")}</span>
                        <input
                          className="admin-input"
                          placeholder={copy.section("points").text("reasonPlaceholder")}
                          value={pointAdjustmentReason}
                          onChange={(event) => setPointAdjustmentReason(event.target.value)}
                          required
                        />
                      </label>
                      <dl className="admin-point-preview admin-point-preview--after">
                        <div>
                          <dt>{copy.section("points").text("expectedBalance")}</dt>
                          <dd
                            className={
                              pointAdjustmentBalanceAfter < 0 ? "is-danger" : undefined
                            }
                          >
                            {formatPoints(pointAdjustmentBalanceAfter, copy)}
                          </dd>
                        </div>
                      </dl>
                      <button className="admin-btn admin-btn--primary admin-btn--block" type="submit">
                        {copy.section("points").text("reviewAdjustment")}
                      </button>
                    </form>
                  </section>

                  <section className="admin-point-section">
                    <div className="admin-point-section__head">
                      <h3>{copy.section("points").text("recentTransactions")}</h3>
                      <span className="admin-cell-sub">
                        {selectedPointHistory.length.toLocaleString()}
                        {copy.section("points").text("countUnit")}
                      </span>
                    </div>
                    <PointHistoryTable
                      rows={selectedPointHistory.slice(0, 12)}
                      className="admin-point-history-scroll"
                    />
                    {selectedPointHistory.length > 12 && (
                      <button
                        type="button"
                        className="admin-btn admin-btn--ghost admin-btn--sm admin-btn--block"
                        onClick={() => {
                          setAllPointTransactionsFilterOrgId(
                            selectedPointOrganization?.cooperativeId ?? "",
                          );
                          setAllPointTransactionsOpen(true);
                        }}
                      >
                        {copy.section("points").text("moreTransactions")}
                      </button>
                    )}
                  </section>
                </>
              ) : (
                <div className="admin-empty">{copy.section("points").text("walletEmpty")}</div>
              )}
            </div>
          </div>
        )}

        {tab === "sitemap" && (
          <PortalSitemap
            sitemap={sitemap}
            copy={{
              title: sitemapCopy.title,
              description: sitemapCopy.description,
              publicGroupTitle: sitemapCopy.text("publicGroupTitle"),
              roleGroupTitle: sitemapCopy.text("roleGroupTitle"),
              countPrefix: sitemapCopy.text("countPrefix"),
              countSuffix: sitemapCopy.text("countSuffix"),
              automaticUpdateLabel: sitemapCopy.text("automaticUpdateLabel"),
              openLabel: sitemapCopy.text("openLabel"),
            }}
          />
        )}

        {tab === "audit" && (
          <div className="admin-grid">
            <div className="admin-card admin-card--span-2">
              <header className="admin-card__head">
                <div>
                  <h2>{copy.section("auditLog").text("title")}</h2>
                  <p>{copy.section("auditLog").text("recentPrefix")} {auditLogs.length}{copy.section("auditLog").text("recentSuffix")}</p>
                </div>
              </header>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>{copy.section("auditLog").text("activityColumn")}</th>
                      <th>{copy.section("auditLog").text("targetColumn")}</th>
                      <th>{copy.section("auditLog").text("actorColumn")}</th>
                      <th>{copy.section("auditLog").text("occurredAtColumn")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => {
                      const detail = formatAuditLog(log);
                      return (
                        <tr key={log.id}>
                          <td>
                            <div className="admin-cell-stack">
                              <strong>{detail.actionLabel}</strong>
                              <span className="admin-chip admin-chip--muted">
                                {detail.targetTypeLabel}
                              </span>
                            </div>
                          </td>
                          <td>
                            <div className="admin-cell-stack">
                              <strong>{detail.targetLabel}</strong>
                              {detail.targetSub && (
                                <span className="admin-cell-sub">{detail.targetSub}</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <strong>{detail.actorName}</strong>
                          </td>
                          <td>
                            <div className="admin-cell-stack">
                              <strong>{formatRelative(log.createdAt, referenceTime, copy)}</strong>
                              <span className="admin-cell-sub">{formatDate(log.createdAt)}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {auditLogs.length === 0 && (
                      <tr>
                        <td colSpan={4} className="admin-empty">{copy.section("auditLog").text("empty")}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}
      </section>

      {activeRequest && (
        <AnswerEditor
          request={activeRequest}
          answer={answerByRequestId.get(activeRequest.id) ?? null}
          readOnly={getInquiryActionKind(resolveAdminRequestStatus(activeRequest)) === "complete"}
          onClose={() => setActiveRequestId(null)}
          onSubmit={(event) => submitAnswer(event, activeRequest.id)}
        />
      )}

      {ratingDetailRequest && (
        <RatingDetailModal
          request={ratingDetailRequest}
          answer={ratingDetailAnswer}
          ratings={ratingDetailRatings}
          customerName={
            ratingDetailRequest.userName ||
            userByUid.get(ratingDetailRequest.uid)?.name ||
            ratingDetailRequest.userEmail ||
            "-"
          }
          onClose={() => setRatingDetailRequestId(null)}
        />
      )}

      {allPointTransactionsOpen && (
        <AllPointTransactionsModal
          key={allPointTransactionsFilterOrgId}
          rows={allPointHistory}
          organizations={organizations}
          initialFilterOrgId={allPointTransactionsFilterOrgId}
          onClose={() => setAllPointTransactionsOpen(false)}
        />
      )}

      {pointAdjustmentDraft && (
        <PointAdjustmentConfirmModal
          draft={pointAdjustmentDraft}
          loading={pointAdjustmentLoading}
          onClose={() => {
            if (!pointAdjustmentLoading) setPointAdjustmentDraft(null);
          }}
          onConfirm={() => void submitPointAdjustment()}
        />
      )}

      {memberAction && (
        <MemberActionModal
          action={memberAction}
          reason={memberActionReason}
          onChangeReason={setMemberActionReason}
          loading={memberActionLoading}
          onClose={closeMemberAction}
          onConfirm={() => void submitMemberAction()}
        />
      )}

      {memberCooperativeEditor && (
        <MemberCooperativeEditorModal
          user={memberCooperativeEditor}
          onClose={() => setMemberCooperativeEditor(null)}
          onChanged={async (unchanged) => {
            setMemberCooperativeEditor(null);
            setActionMessage({
              tone: unchanged ? "info" : "success",
              text: copy
                .section("members")
                .text(
                  unchanged
                    ? "cooperativeChangeUnchanged"
                    : "cooperativeChangeSuccess",
                ),
            });
            await refreshDashboard();
          }}
        />
      )}

      {operatorEditor && (
        <OperatorEditorModal
          mode={operatorEditor.mode}
          operator={operatorEditor.operator}
          loading={operatorActionLoading}
          suspended={operatorConfirmation?.kind === "update"}
          serverError={operatorEditor.serverError}
          actorUid={currentUser?.uid}
          actorRole={adminContext?.adminRole}
          activeSuperAdminCount={activeSuperAdminCount}
          canUpdate={canUpdateOperators}
          canManageRoles={canManageOperatorRoles}
          canDisable={canDisableOperators}
          onClose={() => {
            if (!operatorActionLoading) setOperatorEditor(null);
          }}
          onSubmit={submitOperatorEditor}
        />
      )}

      {faqEditor && (
        <FaqEditorModal
          mode={faqEditor.mode}
          faq={faqEditor.faq}
          loading={faqSaving}
          categories={faqCategoryOptions}
          onClose={() => setFaqEditor(null)}
          onSubmit={(payload) =>
            submitFaq({
              mode: faqEditor.mode,
              id: faqEditor.faq?.id,
              ...payload,
            })
          }
        />
      )}
      {faqDeleteTarget && (
        <AdminConfirmationModal
          title={copy.section("dialogs").text("deleteFaqDialogTitle")}
          description={`“${faqDeleteTarget.question}”`}
          warning={copy.section("dialogs").text("irreversibleWarning")}
          confirmLabel={copy.section("inquiries").text("delete")}
          loading={faqSaving}
          onClose={() => setFaqDeleteTarget(null)}
          onConfirm={() => void deleteFaq(faqDeleteTarget)}
        />
      )}
      {operatorConfirmation && (
        <OperatorActionConfirmModal
          confirmation={operatorConfirmation}
          loading={operatorActionLoading}
          onClose={() => setOperatorConfirmation(null)}
          onPermissionConfirm={(operator, status) =>
            void changeOperatorPermission(operator, status)
          }
          onPasswordConfirm={(operator, password) =>
            void resetOperatorPassword(operator, password)
          }
          onDeleteConfirm={(operator) => void deleteOperator(operator)}
          onUpdateConfirm={(payload) =>
            void saveOperatorMutation(payload)
          }
        />
      )}
      <CmsSupplementalSections
        pageKey="admin.operations"
        content={content}
        editing={editing}
        selectedSectionId={selectedSectionId}
        onSelectSection={onSelectSection}
      />
    </div>
    </AdminOperationsCopyContext.Provider>
  );
}

function PointAdjustmentConfirmModal({
  draft,
  loading,
  onClose,
  onConfirm,
}: {
  draft: {
    cooperativeId: string;
    cooperativeName: string;
    points: number;
    reason: string;
    balanceBefore: number;
  };
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const copy = useAdminOperationsCopy();
  const dialogCopy = copy.section("dialogs");
  const pointsCopy = copy.section("points");
  const balanceAfter = draft.balanceBefore + draft.points;

  return (
    <div className="admin-modal" role="dialog" aria-modal="true" aria-label={dialogCopy.text("pointConfirmAriaLabel")}>
      <button
        type="button"
        className="admin-modal__backdrop"
        aria-label={dialogCopy.text("close")}
        onClick={onClose}
        disabled={loading}
      />
      <div className="admin-modal__panel admin-modal__panel--sm">
        <header className="admin-modal__head">
          <div>
            <p className="admin-modal__eyebrow">{dialogCopy.text("pointConfirmTitle")}</p>
            <h2>{draft.cooperativeName}</h2>
            <p className="admin-cell-sub">
              {pointsCopy.text("organizationCode")} {draft.cooperativeId}
            </p>
          </div>
        </header>
        <div className="admin-modal__body">
          <p className="admin-modal__lede">
            {dialogCopy.text("pointConfirmDescription")}
          </p>
          <dl className="admin-point-preview admin-point-preview--modal">
            <div>
              <dt>{pointsCopy.text("currentBalance")}</dt>
              <dd>{formatPoints(draft.balanceBefore, copy)}</dd>
            </div>
            <div>
              <dt>{dialogCopy.text("adjustmentAmount")}</dt>
              <dd className={draft.points >= 0 ? "is-credit" : "is-debit"}>
                {draft.points >= 0 ? "+" : ""}
                {formatPoints(draft.points, copy)}
              </dd>
            </div>
            <div>
              <dt>{pointsCopy.text("expectedBalance")}</dt>
              <dd className={balanceAfter < 0 ? "is-danger" : undefined}>
                {formatPoints(balanceAfter, copy)}
              </dd>
            </div>
          </dl>
          {balanceAfter < 0 && (
            <p className="admin-modal__warning">
              {pointsCopy.text("negativeBalanceWarning")}
            </p>
          )}
          <section className="admin-modal__quote">
            <h3>{pointsCopy.text("adjustmentReasonTitle")}</h3>
            <p>{draft.reason}</p>
          </section>
          <div className="admin-modal__actions">
            <button type="button" className="admin-btn admin-btn--ghost" onClick={onClose} disabled={loading}>
              {dialogCopy.text("cancel")}
            </button>
            <button type="button" className="admin-btn admin-btn--primary" onClick={onConfirm} disabled={loading}>
              {loading
                ? dialogCopy.text("processing")
                : dialogCopy.text("executeAdjustment")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CustomerRatingCell({
  hasAnswer,
  rating,
  onOpen,
}: {
  hasAnswer: boolean;
  rating: AnswerRatingRecord | null;
  onOpen: () => void;
}) {
  const copy = useAdminOperationsCopy();
  const inquiries = copy.section("inquiries");
  if (!hasAnswer) {
    return <span className="admin-cell-sub">-</span>;
  }
  if (!rating) {
    return (
      <button
        type="button"
        className="admin-satisfaction-btn admin-satisfaction-btn--wait"
        onClick={onOpen}
        aria-label={inquiries.text("ratingWaitingAriaLabel")}
      >
        <strong>{inquiries.text("ratingWaiting")}</strong>
      </button>
    );
  }

  const tone = getRatingSatisfactionTone(rating.score);
  const satisfaction = ratingSatisfactionLabel(copy, rating.score);

  return (
    <button
      type="button"
      className={`admin-satisfaction-btn admin-satisfaction-btn--${tone}`}
      onClick={onOpen}
      aria-label={`${inquiries.text("ratingCompleteAriaPrefix")} · ${satisfaction} ${formatRatingScore(rating.score, copy)}`}
    >
      <strong>{inquiries.text("ratingComplete")}</strong>
    </button>
  );
}

function RatingDetailModal({
  request,
  answer,
  ratings,
  customerName,
  onClose,
}: {
  request: ConsultRequestRecord;
  answer: AnswerRecord | null;
  ratings: AnswerRatingRecord[];
  customerName: string;
  onClose: () => void;
}) {
  const copy = useAdminOperationsCopy();
  const inquiries = copy.section("inquiries");
  const dialogs = copy.section("dialogs");
  const latestRating = ratings[0] ?? null;
  const satisfaction = latestRating
    ? ratingSatisfactionLabel(copy, latestRating.score)
    : null;
  const tone = latestRating ? getRatingSatisfactionTone(latestRating.score) : "slate";
  const isCompleted = String(request.status ?? "").toUpperCase() === "COMPLETED";

  return (
    <div className="admin-modal" role="dialog" aria-modal="true" aria-label={inquiries.text("ratingDetailTitle")}>
      <button type="button" className="admin-modal__backdrop" aria-label={dialogs.text("close")} onClick={onClose} />
      <div className="admin-modal__panel admin-modal__panel--sm">
        <header className="admin-modal__head">
          <div>
            <p className="admin-modal__eyebrow">{inquiries.text("ratingDetailTitle")}</p>
            <h2>
              {latestRating
                ? inquiries.text("ratingComplete")
                : inquiries.text("ratingWaiting")}
            </h2>
            <p className="admin-cell-sub">
              {request.requestNumber} · {request.subject}
            </p>
          </div>
          <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={onClose}>
            {dialogs.text("close")}
          </button>
        </header>
        <div className="admin-modal__body">
          {latestRating ? (
            <div
              className={`admin-rating-hero admin-rating-hero--${tone}`}
            >
              <span className="admin-rating-hero__label">
                {inquiries.text("ratingComplete")}
              </span>
              <strong className="admin-rating-hero__score">
                {formatRatingScore(latestRating.score, copy)}
              </strong>
              <p className="admin-rating-hero__meta">
                {customerName} · {formatDate(latestRating.updatedAt ?? latestRating.createdAt)}
              </p>
            </div>
          ) : (
            <p className="admin-rating-empty">{inquiries.text("ratingEmpty")}</p>
          )}

          <dl className="admin-rating-detail">
            <div>
              <dt>{inquiries.text("satisfactionLabel")}</dt>
              <dd>
                {latestRating ? (
                  <span className={`admin-pill admin-pill--${tone}`}>
                    {satisfaction}
                  </span>
                ) : (
                  "-"
                )}
              </dd>
            </div>
            <div>
              <dt>{inquiries.text("consultationStatusLabel")}</dt>
              <dd>
                {isCompleted
                  ? inquiries.text("consultationCompleted")
                  : inquiries.text("consultationInProgress")}
              </dd>
            </div>
            <div>
              <dt>{inquiries.text("helpfulLabel")}</dt>
              <dd>
                {latestRating
                  ? latestRating.helpful === false
                    ? inquiries.text("helpfulNo")
                    : latestRating.helpful === true
                      ? inquiries.text("helpfulYes")
                      : inquiries.text("noResponse")
                  : "-"}
              </dd>
            </div>
            <div>
              <dt>{inquiries.text("usedPointsColumn")}</dt>
              <dd>{answer ? formatPoints(answer.pointCost ?? 0, copy) : "-"}</dd>
            </div>
          </dl>

          <section className="admin-modal__quote admin-modal__quote--emphasis">
            <h3>{inquiries.text("additionalCommentTitle")}</h3>
            <p>
              {latestRating?.comment?.trim() ||
                inquiries.text("noAdditionalComment")}
            </p>
          </section>

          <section className="admin-modal__quote">
            <h3>{inquiries.text("answerSummaryTitle")}</h3>
            <p>{answer?.body?.trim() || inquiries.text("noAnswer")}</p>
          </section>
        </div>
      </div>
    </div>
  );
}

type MemberActionType = "approve" | "reject" | "deactivate" | "reactivate";

const MEMBER_ACTION_CONFIG: Record<
  MemberActionType,
  {
    copyKey: "approve" | "reject" | "deactivate" | "reactivate";
    confirmTone: "primary" | "danger";
    askReason: boolean;
    warn?: boolean;
  }
> = {
  approve: {
    copyKey: "approve",
    confirmTone: "primary",
    askReason: false,
  },
  reject: {
    copyKey: "reject",
    confirmTone: "danger",
    askReason: true,
    warn: true,
  },
  deactivate: {
    copyKey: "deactivate",
    confirmTone: "danger",
    askReason: true,
    warn: true,
  },
  reactivate: {
    copyKey: "reactivate",
    confirmTone: "primary",
    askReason: false,
    warn: false,
  },
};

function MemberActionModal({
  action,
  reason,
  onChangeReason,
  loading,
  onClose,
  onConfirm,
}: {
  action: { uid: string; name: string; email: string; type: MemberActionType };
  reason: string;
  onChangeReason: (value: string) => void;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const cmsCopy = useAdminOperationsCopy();
  const members = cmsCopy.section("members");
  const dialogs = cmsCopy.section("dialogs");
  const config = MEMBER_ACTION_CONFIG[action.type];
  const title = members.text(`${config.copyKey}Title`);
  const intro = members.text(`${config.copyKey}Intro`);
  const confirmLabel = members.text(`${config.copyKey}Confirm`);
  return (
    <div
      className="admin-modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        className="admin-modal__backdrop"
        aria-label={dialogs.text("close")}
        onClick={onClose}
        disabled={loading}
      />
      <div className="admin-modal__panel admin-modal__panel--sm">
        <header className="admin-modal__head">
          <div>
            <p className="admin-modal__eyebrow">{members.text("memberActionEyebrow")}</p>
            <h2>{title}</h2>
          </div>
        </header>
        <div className="admin-modal__body">
          <section className="admin-modal__quote">
            <h3>{members.text("targetMemberTitle")}</h3>
            <p>
              <strong>{action.name}</strong>
              {action.email && (
                <span className="admin-cell-sub"> · {action.email}</span>
              )}
            </p>
          </section>
          <p className="admin-modal__lede">{intro}</p>
          {config.warn && (
            <p className="admin-modal__warning" role="alert">
              {members.text("accountRestrictionWarning")}
            </p>
          )}
          {config.askReason && (
            <label className="admin-modal__field">
              <span>
                {members.text(`${config.copyKey}ReasonLabel`) ||
                  members.text("reasonLabel")}
              </span>
              <textarea
                className="admin-input admin-input--area"
                rows={3}
                value={reason}
                onChange={(event) => onChangeReason(event.target.value)}
                placeholder={members.text(
                  `${config.copyKey}ReasonPlaceholder`,
                )}
                disabled={loading}
              />
            </label>
          )}
          <div className="admin-modal__actions">
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={onClose}
              disabled={loading}
            >
              {dialogs.text("cancel")}
            </button>
            <button
              type="button"
              className={`admin-btn admin-btn--${config.confirmTone}`}
              onClick={onConfirm}
              disabled={loading}
            >
              {loading ? dialogs.text("processing") : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MemberCooperativeEditorModal({
  user,
  onClose,
  onChanged,
}: {
  user: UserRecord;
  onClose: () => void;
  onChanged: (unchanged: boolean) => Promise<void>;
}) {
  const copy = useAdminOperationsCopy();
  const members = copy.section("members");
  const dialogs = copy.section("dialogs");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CooperativeSearchItem[]>([]);
  const [selected, setSelected] = useState<CooperativeSearchItem | null>(null);
  const [reason, setReason] = useState("");
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(
          `/api/cooperatives/search?q=${encodeURIComponent(normalized)}`,
          { signal: controller.signal },
        );
        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; results?: CooperativeSearchItem[] }
          | null;
        setResults(
          response.ok && payload?.ok && Array.isArray(payload.results)
            ? payload.results
            : [],
        );
      } catch (searchError) {
        if (
          !(searchError instanceof DOMException) ||
          searchError.name !== "AbortError"
        ) {
          setResults([]);
        }
      } finally {
        setSearching(false);
      }
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const submit = async () => {
    if (!selected || reason.trim().length < 2 || saving) return;
    const currentUser = getFirebaseAuth().currentUser;
    if (!currentUser) {
      setError(members.text("cooperativeChangeFailed"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const idToken = await currentUser.getIdToken();
      const response = await fetch(
        `/api/admin/users/${user.uid}/cooperative`,
        {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${idToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            cooperativeId: selected.cooperative_id,
            reason: reason.trim(),
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; unchanged?: boolean }
        | null;
      if (!response.ok || !payload?.ok) {
        setError(members.text("cooperativeChangeFailed"));
        return;
      }
      await onChanged(payload.unchanged === true);
    } catch {
      setError(members.text("cooperativeChangeFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="admin-modal"
      role="dialog"
      aria-modal="true"
      aria-label={members.text("cooperativeEditorAriaLabel")}
    >
      <button
        type="button"
        className="admin-modal__backdrop"
        aria-label={dialogs.text("close")}
        onClick={onClose}
        disabled={saving}
      />
      <div className="admin-modal__panel admin-modal__panel--sm">
        <header className="admin-modal__head">
          <div>
            <p className="admin-modal__eyebrow">
              {members.text("cooperativeEditorEyebrow")}
            </p>
            <h2>{members.text("cooperativeEditorTitle")}</h2>
          </div>
        </header>
        <div className="admin-modal__body">
          <p className="admin-modal__lede">
            {members.text("cooperativeEditorDescription")}
          </p>
          <section className="admin-modal__quote">
            <h3>{members.text("currentCooperativeLabel")}</h3>
            <p>
              <strong>
                {user.cooperativeName ??
                  user.manualCooperativeName ??
                  members.text("unspecified")}
              </strong>
              {user.cooperativeId ? (
                <span className="admin-cell-sub"> · {user.cooperativeId}</span>
              ) : null}
            </p>
          </section>
          <label className="admin-modal__field">
            <span>{members.text("newCooperativeSearchLabel")}</span>
            <input
              className="admin-input"
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected(null);
              }}
              placeholder={members.text("newCooperativeSearchPlaceholder")}
              disabled={saving}
            />
          </label>
          {searching ? (
            <p className="admin-cell-sub">
              {members.text("cooperativeSearchLoading")}
            </p>
          ) : null}
          {!searching && query.trim() && results.length === 0 ? (
            <p className="admin-cell-sub">
              {members.text("cooperativeSearchEmpty")}
            </p>
          ) : null}
          {results.length > 0 ? (
            <ul className="admin-mini-feed">
              {results.map((cooperative) => (
                <li key={cooperative.cooperative_id}>
                  <button
                    type="button"
                    className={`admin-btn${
                      selected?.cooperative_id === cooperative.cooperative_id
                        ? " admin-btn--primary"
                        : ""
                    }`}
                    onClick={() => setSelected(cooperative)}
                    disabled={saving}
                  >
                    {cooperative.cooperative_name}
                  </button>
                  <span>
                    {formatCooperativeSearchSubtitle(
                      cooperative,
                      cooperative.isDemoInstitution ? "테스트" : undefined,
                    ) || cooperative.cooperative_id}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <label className="admin-modal__field">
            <span>{members.text("cooperativeChangeReasonLabel")}</span>
            <textarea
              className="admin-input admin-input--area"
              rows={3}
              maxLength={300}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={members.text("cooperativeChangeReasonPlaceholder")}
              disabled={saving}
            />
          </label>
          {error ? (
            <p className="admin-modal__warning" role="alert">{error}</p>
          ) : null}
          <div className="admin-modal__actions">
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={onClose}
              disabled={saving}
            >
              {members.text("cooperativeChangeCancel")}
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              onClick={() => void submit()}
              disabled={!selected || reason.trim().length < 2 || saving}
            >
              {saving
                ? members.text("cooperativeChangeSaving")
                : members.text("cooperativeChangeConfirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  suffix,
  delta,
  series,
  helper,
  tone,
}: {
  label: string;
  value: string;
  suffix?: string;
  delta?: { recent: number; previous: number };
  series?: number[];
  helper?: string;
  tone: "blue" | "amber" | "green" | "violet";
}) {
  const overviewCopy = useAdminOperationsCopy().section("overview");
  const trend = delta
    ? delta.previous === 0
      ? delta.recent > 0
        ? 100
        : 0
      : ((delta.recent - delta.previous) / delta.previous) * 100
    : null;
  const trendDirection = trend === null ? "flat" : trend > 0 ? "up" : trend < 0 ? "down" : "flat";

  return (
    <article className={`admin-kpi admin-kpi--${tone}`}>
      <header>
        <span>{label}</span>
        {trend !== null && (
          <span className={`admin-trend admin-trend--${trendDirection}`}>
            {trendDirection === "up" ? "▲" : trendDirection === "down" ? "▼" : "·"} {Math.abs(trend).toFixed(0)}%
          </span>
        )}
      </header>
      <p className="admin-kpi__value">
        {value}
        {suffix && <span className="admin-kpi__suffix">{suffix}</span>}
      </p>
      {helper && <p className="admin-kpi__helper">{helper}</p>}
      {!helper && delta && (
        <p className="admin-kpi__helper">
          {overviewCopy.text("recentPeriod")} {delta.recent.toLocaleString()} ·{" "}
          {overviewCopy.text("previousPeriod")} {delta.previous.toLocaleString()}
        </p>
      )}
      {series && (
        <div className="admin-kpi__spark">
          <Sparkline data={series} />
        </div>
      )}
    </article>
  );
}

function MemberBusinessCardPreview({ user }: { user: UserRecord }) {
  const members = useAdminOperationsCopy().section("members");
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [contentType, setContentType] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ready" | "missing" | "error">(
    "idle",
  );

  const hasAttachment = Boolean(
    user.businessCardPath?.trim() || user.businessCardUrl?.trim(),
  );

  useEffect(() => {
    if (!hasAttachment) return;

    let cancelled = false;

    (async () => {
      setState("loading");
      setViewUrl(null);
      try {
        const currentUser = getFirebaseAuth().currentUser;
        if (!currentUser) {
          if (!cancelled) setState("error");
          return;
        }
        const idToken = await currentUser.getIdToken();
        const res = await fetch(`/api/admin/users/${user.uid}/business-card`, {
          headers: { authorization: `Bearer ${idToken}` },
        });
        const data = (await res.json()) as {
          ok?: boolean;
          url?: string;
          contentType?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.ok || !data.url) {
          setState("error");
          setViewUrl(null);
          return;
        }
        setViewUrl(data.url);
        setContentType(data.contentType ?? "");
        setState("ready");
      } catch {
        if (!cancelled) {
          setState("error");
          setViewUrl(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasAttachment, user.uid, user.businessCardPath, user.businessCardUrl]);

  if (!hasAttachment) {
    return (
      <span className="admin-business-card__empty">
        {members.text("noBusinessCard")}
      </span>
    );
  }

  if (state === "loading" || state === "idle") {
    return (
      <span className="admin-business-card__loading">
        {members.text("businessCardLoading")}
      </span>
    );
  }

  if (state === "error" || !viewUrl) {
    return (
      <span className="admin-business-card__empty">
        {members.text("businessCardError")}
      </span>
    );
  }

  const isImage = contentType.startsWith("image/");

  return (
    <div className="admin-business-card">
      {isImage ? (
        <a
          className="admin-business-card__preview"
          href={viewUrl}
          target="_blank"
          rel="noreferrer"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={viewUrl}
            alt={`${user.name || user.email} ${members.text("businessCardAltSuffix")}`}
          />
        </a>
      ) : (
        <div className="admin-business-card__file">
          <span>{members.text("pdfBusinessCard")}</span>
        </div>
      )}
      <a className="admin-link" href={viewUrl} target="_blank" rel="noreferrer">
        {isImage ? members.text("viewOriginal") : members.text("openPdf")}
      </a>
    </div>
  );
}

function OperatorDetailPanel({
  operator,
  auditLogs,
  formatAuditLog,
  isProtected,
  isLastSuperAdmin,
  actorCanReachTarget,
  canUpdate,
  canDisable,
  canDelete,
  canManageRoles,
  canResetPassword,
  loading,
  onEdit,
  onChangePermission,
  onResetPassword,
  onDelete,
}: {
  operator: UserRecord | null;
  auditLogs: AuditLogRecord[];
  formatAuditLog: (log: AuditLogRecord) => ReturnType<typeof describeAuditLog>;
  isProtected: boolean;
  isLastSuperAdmin: boolean;
  actorCanReachTarget: boolean;
  canUpdate: boolean;
  canDisable: boolean;
  canDelete: boolean;
  canManageRoles: boolean;
  canResetPassword: boolean;
  loading: boolean;
  onEdit: (operator: UserRecord) => void;
  onChangePermission: (operator: UserRecord, status: UserRecord["status"]) => void;
  onResetPassword: (operator: UserRecord) => void;
  onDelete: (operator: UserRecord) => void;
}) {
  const members = useAdminOperationsCopy().section("members");
  if (!operator) {
    return (
      <aside className="admin-card admin-member-detail">
        <header className="admin-card__head">
          <div>
            <h2>{members.text("operatorDetailTitle")}</h2>
            <p>{members.text("selectOperator")}</p>
          </div>
        </header>
        <div className="admin-empty">{members.text("noOperatorSelected")}</div>
      </aside>
    );
  }

  const status = operatorAccountStatus(operator);
  const isActive = status === "active";
  const targetBlocked = !actorCanReachTarget && !isProtected;
  const protectionMessage = isProtected
    ? members.text("operatorSelfProtectionDescription")
    : isLastSuperAdmin
      ? members.text("operatorLastSuperAdminDescription")
      : targetBlocked
        ? members.text("operatorHigherRoleDescription")
        : "";

  return (
    <aside className="admin-card admin-member-detail">
      <header className="admin-member-detail__hero">
        <span className="admin-member-detail__avatar" aria-hidden="true">
          {(operator.name || operator.email || "?").slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h2>{operator.name || members.text("unnamed")}</h2>
          <p>{operator.email}</p>
        </div>
        <span
          className={`admin-pill admin-pill--${getMemberStatusTone(operator.status)}`}
        >
          <span className="admin-pill__dot" aria-hidden="true" />
          {members.text(`status.${status}`)}
        </span>
      </header>

      <section className="admin-member-block">
        <h3>{members.text("operatorAccountTitle")}</h3>
        <dl className="admin-detail-list">
          <div>
            <dt>{members.text("nameLabel")}</dt>
            <dd>{operator.name || "-"}</dd>
          </div>
          <div>
            <dt>{members.text("emailLabel")}</dt>
            <dd>{operator.email}</dd>
          </div>
          <div>
            <dt>{members.text("roleColumn")}</dt>
            <dd>{operator.position || members.text("operatorRoleFallback")}</dd>
          </div>
          <div>
            <dt>{members.text("permissionGroupLabel")}</dt>
            <dd>{operator.duty || members.text("administratorFallback")}</dd>
          </div>
          <div>
            <dt>{members.text("adminRoleColumn")}</dt>
            <dd>{ADMIN_ROLE_LABELS[getAdminRole(operator)]}</dd>
          </div>
          <div>
            <dt>{members.text("affiliationColumn")}</dt>
            <dd>{members.text("internalOperatorAffiliation")}</dd>
          </div>
          <div>
            <dt>{members.text("scopeColumn")}</dt>
            <dd>{members.text("scope.ALL")}</dd>
          </div>
          <div>
            <dt>{members.text("lastLoginColumn")}</dt>
            <dd>
              {"lastLoginAt" in operator && typeof operator.lastLoginAt === "string"
                ? formatDate(operator.lastLoginAt)
                : members.text("noLoginRecord")}
            </dd>
          </div>
          <div>
            <dt>{members.text("createdAtLabel")}</dt>
            <dd>{formatDate(operator.createdAt)}</dd>
          </div>
          <div>
            <dt>{members.text("modifiedAtLabel")}</dt>
            <dd>{formatDate(operator.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="admin-member-block">
        <h3>{members.text("operatorActionsTitle")}</h3>
        <p className="admin-cell-sub">
          {members.text("operatorActionsDescription")}
          {protectionMessage ? ` ${protectionMessage}` : ""}
        </p>
        <div className="admin-operator-actions">
          {(canUpdate || canManageRoles) && (
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              onClick={() => onEdit(operator)}
              disabled={loading || targetBlocked}
            >
              {members.text("editOperator")}
            </button>
          )}
          {canResetPassword && (
            <button
              type="button"
              className="admin-btn"
              onClick={() => onResetPassword(operator)}
              disabled={loading || targetBlocked}
            >
              {members.text("resetPassword")}
            </button>
          )}
          {canDisable && (
            <button
              type="button"
              className={isActive ? "admin-btn admin-btn--danger" : "admin-btn"}
              onClick={() => onChangePermission(operator, isActive ? "rejected" : "active")}
              disabled={
                loading ||
                targetBlocked ||
                (isActive && (isProtected || isLastSuperAdmin))
              }
            >
              {isActive
                ? members.text("deactivateOperator")
                : members.text("activateOperator")}
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="admin-btn admin-btn--danger"
              onClick={() => onDelete(operator)}
              disabled={
                loading ||
                targetBlocked ||
                isProtected ||
                isLastSuperAdmin
              }
            >
              {members.text("deleteAccount")}
            </button>
          )}
        </div>
      </section>

      <section className="admin-member-block">
        <h3>{members.text("relatedHistoryTitle")}</h3>
        <ul className="admin-mini-feed">
          {auditLogs.slice(0, 5).map((entry) => {
            const detail = formatAuditLog(entry);
            return (
              <li key={entry.id}>
                <strong>{detail.actionLabel}</strong>
                <time>{formatDate(entry.createdAt)}</time>
              </li>
            );
          })}
          {auditLogs.length === 0 && (
            <li className="admin-empty">{members.text("noRelatedHistory")}</li>
          )}
        </ul>
      </section>
    </aside>
  );
}

function OperatorEditorModal({
  mode,
  operator,
  loading,
  suspended,
  serverError,
  actorUid,
  actorRole,
  activeSuperAdminCount,
  canUpdate,
  canManageRoles,
  canDisable,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  operator: UserRecord | null;
  loading: boolean;
  suspended: boolean;
  serverError?: string;
  actorUid?: string;
  actorRole?: AdminRole;
  activeSuperAdminCount: number;
  canUpdate: boolean;
  canManageRoles: boolean;
  canDisable: boolean;
  onClose: () => void;
  onSubmit: (payload: OperatorMutationPayload) => void;
}) {
  const copy = useAdminOperationsCopy();
  const members = copy.section("members");
  const dialogs = copy.section("dialogs");
  const isCreate = mode === "create";
  const assignableRoles = getAssignableAdminRoles(actorRole);
  const currentRole = operator?.adminRole ?? "super_admin";
  const roleOptions = Array.from(
    new Set<AdminRole>([
      ...(!isCreate ? [currentRole] : []),
      ...assignableRoles,
    ]),
  );
  const [name, setName] = useState(operator?.name ?? "");
  const [email, setEmail] = useState(operator?.email ?? "");
  const [position, setPosition] = useState(
    operator?.position || members.text("operatorPositionDefault"),
  );
  const [duty, setDuty] = useState(
    operator?.duty || members.text("operatorDutyDefault"),
  );
  const [status, setStatus] = useState<UserRecord["status"]>(
    operator?.status === "rejected" ? "rejected" : "active",
  );
  const [adminRole, setAdminRole] = useState<AdminRole>(
    operator?.adminRole ?? assignableRoles[0] ?? "operations_manager",
  );
  const [adminCapabilityAllow, setAdminCapabilityAllow] = useState<
    AdminCapability[]
  >(operator?.adminCapabilityAllow ?? []);
  const [adminCapabilityDeny, setAdminCapabilityDeny] = useState<
    AdminCapability[]
  >(operator?.adminCapabilityDeny ?? []);
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<OperatorFormErrors>({});
  const panelRef = useModalFocus<HTMLFormElement>(
    onClose,
    loading || suspended,
  );
  const protection = operator
    ? operatorProtection({
        operator,
        actorUid,
        actorRole,
        activeSuperAdminCount,
      })
    : null;
  const sensitiveChangeBlocked = Boolean(
    !isCreate && protection?.blocksSensitiveChange,
  );
  const canEditProfile = isCreate || canUpdate;
  const canEditRole =
    roleOptions.length > 0 &&
    (isCreate || (canManageRoles && !sensitiveChangeBlocked));
  const canEditStatus =
    isCreate || (canDisable && !sensitiveChangeBlocked);
  const canEditOverrides =
    canManageRoles && (isCreate || !sensitiveChangeBlocked);

  const permissionLabel = (permission: AdminPermission) => {
    const keys = permissionCopyKeys(permission);
    return `${members.text(keys.resource)} · ${members.text(keys.action)}`;
  };

  const fieldErrorText = (
    field: keyof OperatorFormErrors,
    code: string | undefined,
  ) => {
    if (!code) return "";
    if (field === "email" && code === "invalid") {
      return members.text("operatorEmailInvalidError");
    }
    if (field === "password") {
      return members.text("operatorPasswordPolicyError");
    }
    if (field === "adminRole") {
      return members.text("operatorRoleError");
    }
    return members.text("operatorFieldRequiredError");
  };

  const toggleCapability = (
    capability: AdminCapability,
    kind: "allow" | "deny",
  ) => {
    const setter =
      kind === "allow" ? setAdminCapabilityAllow : setAdminCapabilityDeny;
    const oppositeSetter =
      kind === "allow" ? setAdminCapabilityDeny : setAdminCapabilityAllow;
    setter((current) =>
      current.includes(capability)
        ? current.filter((item) => item !== capability)
        : [...current, capability],
    );
    oppositeSetter((current) => current.filter((item) => item !== capability));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();
    const errors = validateOperatorForm({
      mode,
      name: trimmedName,
      email: trimmedEmail,
      password: isCreate ? trimmedPassword : undefined,
      adminRole,
    });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    const payload: OperatorMutationPayload = {
      name: trimmedName,
      email: trimmedEmail,
      password: isCreate ? trimmedPassword : undefined,
      position: position.trim() || members.text("operatorPositionDefault"),
      duty: duty.trim() || ADMIN_ROLE_LABELS[adminRole],
    };
    if (isCreate || adminRole !== currentRole) {
      payload.adminRole = adminRole;
    }
    if (isCreate || status !== operator?.status) {
      payload.status = status;
    }
    const currentAllow = operator?.adminCapabilityAllow ?? [];
    const currentDeny = operator?.adminCapabilityDeny ?? [];
    const samePermissions = (
      left: AdminCapability[],
      right: AdminCapability[],
    ) =>
      [...left].sort().join("|") === [...right].sort().join("|");
    if (
      isCreate ||
      !samePermissions(adminCapabilityAllow, currentAllow)
    ) {
      payload.adminCapabilityAllow = adminCapabilityAllow;
    }
    if (
      isCreate ||
      !samePermissions(adminCapabilityDeny, currentDeny)
    ) {
      payload.adminCapabilityDeny = adminCapabilityDeny;
    }
    onSubmit(payload);
  };

  return (
    <div
      className={`admin-modal${suspended ? " is-suspended" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-hidden={suspended || undefined}
      aria-labelledby="operator-editor-title"
    >
      <button
        type="button"
        className="admin-modal__backdrop"
        aria-label={dialogs.text("close")}
        onClick={onClose}
        disabled={loading || suspended}
      />
      <form
        ref={panelRef}
        className="admin-modal__panel admin-modal__panel--operator"
        onSubmit={submit}
      >
        <header className="admin-modal__head">
          <div>
            <p className="admin-modal__eyebrow">{members.text("operatorEditorEyebrow")}</p>
            <h2 id="operator-editor-title">
              {isCreate
                ? members.text("operatorEditorCreateTitle")
                : members.text("operatorEditorEditTitle")}
            </h2>
          </div>
          <button
            type="button"
            className="admin-modal__close"
            aria-label={dialogs.text("close")}
            onClick={onClose}
            disabled={loading || suspended}
          >
            ×
          </button>
        </header>
        <div className="admin-modal__body">
          <div className="admin-operator-form-grid">
            <label className="admin-modal__field">
              {members.text("nameLabel")}
              <input
                className="admin-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={loading || !canEditProfile}
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={fieldErrors.name ? "operator-name-error" : undefined}
                data-autofocus
              />
              {fieldErrors.name && (
                <small id="operator-name-error" className="admin-field-error">
                  {fieldErrorText("name", fieldErrors.name)}
                </small>
              )}
            </label>
            <label className="admin-modal__field">
              {members.text("emailLabel")}
              <input
                className="admin-input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={loading || !canEditProfile}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? "operator-email-error" : undefined}
              />
              {fieldErrors.email && (
                <small id="operator-email-error" className="admin-field-error">
                  {fieldErrorText("email", fieldErrors.email)}
                </small>
              )}
            </label>
            <label className="admin-modal__field">
              {members.text("positionLabel")}
              <input
                className="admin-input"
                value={position}
                onChange={(event) => setPosition(event.target.value)}
                disabled={loading || !canEditProfile}
              />
            </label>
            <label className="admin-modal__field">
              {members.text("dutyLabel")}
              <input
                className="admin-input"
                value={duty}
                onChange={(event) => setDuty(event.target.value)}
                disabled={loading || !canEditProfile}
              />
            </label>
            <label className="admin-modal__field">
              {members.text("adminRolePresetLabel")}
              <select
                className="admin-input"
                value={adminRole}
                onChange={(event) => {
                  const nextRole = event.target.value as AdminRole;
                  setAdminRole(nextRole);
                  setDuty(ADMIN_ROLE_LABELS[nextRole]);
                }}
                disabled={loading || !canEditRole}
                aria-invalid={Boolean(fieldErrors.adminRole)}
              >
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {ADMIN_ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
              <small className="admin-form__hint">
                {members.text(`roleDescription.${adminRole}`)}
              </small>
            </label>
            <label className="admin-modal__field">
              {members.text("permissionStatusLabel")}
              <select
                className="admin-input"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as UserRecord["status"])}
                disabled={loading || !canEditStatus}
              >
                <option value="active">{members.text("statusActive")}</option>
                <option value="rejected">{members.text("statusDisabled")}</option>
              </select>
            </label>
            <label className="admin-modal__field">
              {members.text("affiliationColumn")}
              <select className="admin-input" value="internal" disabled>
                <option value="internal">
                  {members.text("internalOperatorAffiliation")}
                </option>
              </select>
              <small className="admin-form__hint">
                {members.text("operatorAffiliationHelp")}
              </small>
            </label>
            <label className="admin-modal__field">
              {members.text("scopeColumn")}
              <select className="admin-input" value="ALL" disabled>
                <option value="ALL">{members.text("scope.ALL")}</option>
              </select>
              <small className="admin-form__hint">
                {members.text("operatorScopeHelp")}
              </small>
            </label>
          </div>

          <section className="admin-role-preview" aria-live="polite">
            <div>
              <strong>{members.text("rolePreviewTitle")}</strong>
              <span>{ADMIN_ROLE_LABELS[adminRole]}</span>
            </div>
            <p>{members.text(`roleDescription.${adminRole}`)}</p>
            <ul>
              {getRolePermissionPreview(adminRole).map((permission) => (
                <li key={permission}>{permissionLabel(permission)}</li>
              ))}
            </ul>
          </section>

          {canManageRoles && (
            <details className="admin-operator-permissions">
              <summary>{members.text("permissionOverridesTitle")}</summary>
              <p>{members.text("permissionOverridesDescription")}</p>
              <div className="admin-permission-list">
                {MANAGEABLE_ADMIN_PERMISSIONS.map((permission) => (
                  <div key={permission} className="admin-permission-row">
                    <span>{permissionLabel(permission)}</span>
                    <label>
                      <input
                        type="checkbox"
                        checked={adminCapabilityAllow.includes(permission)}
                        onChange={() => toggleCapability(permission, "allow")}
                        disabled={loading || !canEditOverrides}
                      />
                      {members.text("permissionAllow")}
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={adminCapabilityDeny.includes(permission)}
                        onChange={() => toggleCapability(permission, "deny")}
                        disabled={loading || !canEditOverrides}
                      />
                      {members.text("permissionDeny")}
                    </label>
                  </div>
                ))}
              </div>
            </details>
          )}

          {isCreate && (
            <section className="admin-operator-invitation">
              <label className="admin-modal__field">
                {members.text("invitationMethodLabel")}
                <select className="admin-input" value="temporary_password" disabled>
                  <option value="temporary_password">
                    {members.text("temporaryPasswordMethod")}
                  </option>
                </select>
              </label>
              <label className="admin-modal__field">
                {members.text("temporaryPasswordLabel")}
                <input
                  className="admin-input"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={members.text("temporaryPasswordPlaceholder")}
                  disabled={loading}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby="operator-password-help"
                />
                <small id="operator-password-help" className="admin-form__hint">
                  {members.text("passwordPolicyHelp")}
                </small>
                {fieldErrors.password && (
                  <small className="admin-field-error">
                    {fieldErrorText("password", fieldErrors.password)}
                  </small>
                )}
              </label>
              <p className="admin-form__hint">
                {members.text("invitationMethodHelp")}
              </p>
            </section>
          )}

          {sensitiveChangeBlocked && (
            <p className="admin-modal__warning" role="status">
              {protection?.self
                ? members.text("operatorSelfProtectionDescription")
                : protection?.lastSuperAdmin
                  ? members.text("operatorLastSuperAdminDescription")
                  : members.text("operatorHigherRoleDescription")}
            </p>
          )}
          {serverError && (
            <p className="admin-form__error" role="alert">
              {serverError}
            </p>
          )}
          <div className="admin-modal__actions">
            <button type="button" className="admin-btn" onClick={onClose} disabled={loading || suspended}>
              {dialogs.text("cancel")}
            </button>
            <button
              type="submit"
              className="admin-btn admin-btn--primary"
              disabled={loading || suspended || !canEditProfile}
            >
              {loading ? dialogs.text("saving") : dialogs.text("save")}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function MemberDetailPanel({
  user,
  organization,
  ledger,
  transactions,
  auditLogs,
  formatAuditLog,
  onAction,
  canChangeCooperative,
  onChangeCooperative,
}: {
  user: UserRecord | null;
  organization: OrganizationRecord | null;
  ledger: PointLedgerRecord[];
  transactions: PointTransactionRecord[];
  auditLogs: AuditLogRecord[];
  formatAuditLog: (log: AuditLogRecord) => ReturnType<typeof describeAuditLog>;
  onAction: (
    uid: string,
    type: "approve" | "reject" | "deactivate" | "reactivate",
  ) => void;
  canChangeCooperative: boolean;
  onChangeCooperative: (user: UserRecord) => void;
}) {
  const copy = useAdminOperationsCopy();
  const members = copy.section("members");
  if (!user) {
    return (
      <aside className="admin-card admin-member-detail">
        <header className="admin-card__head">
          <div>
            <h2>{members.text("memberDetailTitle")}</h2>
            <p>{members.text("selectMember")}</p>
          </div>
        </header>
        <div className="admin-empty">{members.text("noMemberSelected")}</div>
      </aside>
    );
  }

  const marketingChannels = [
    user.consents?.marketing && members.text("marketingChannel"),
    user.consents?.email && members.text("emailChannel"),
    user.consents?.sms && members.text("smsChannel"),
    user.consents?.kakao && members.text("kakaoChannel"),
  ].filter(Boolean);
  const totalSignupPoints = transactions
    .filter((entry) => entry.type === "first_org_signup" || entry.type === "user_signup")
    .reduce((total, entry) => total + (entry.amount ?? 0), 0);

  return (
    <aside className="admin-card admin-member-detail">
      <header className="admin-member-detail__hero">
        <span className="admin-member-detail__avatar" aria-hidden="true">
          {(user.name || user.email || "?").slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h2>{user.name || members.text("unnamed")}</h2>
          <p>{user.email}</p>
        </div>
        <span
          className={`admin-pill admin-pill--${getMemberStatusTone(user.status)}`}
        >
          <span className="admin-pill__dot" aria-hidden="true" />
          {memberStatusLabel(copy, user.status)}
        </span>
      </header>

      {isPendingMember(user.status) && (
        <section className="admin-member-block">
          <h3>{members.text("approvalTitle")}</h3>
          <p className="admin-cell-sub">
            {members.text("approvalDescription")}
          </p>
          <div className="admin-approval-file">
            <div className="admin-approval-file__head">
              <strong>{members.text("approvalCardTitle")}</strong>
              <span>{members.text("approvalCardDescription")}</span>
            </div>
            <MemberBusinessCardPreview user={user} />
          </div>
          <div className="admin-member-actions">
            <button
              type="button"
              className="admin-btn admin-btn--primary admin-btn--block"
              onClick={() => onAction(user.uid, "approve")}
            >
              {members.text("approveMember")}
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--danger admin-btn--block"
              onClick={() => onAction(user.uid, "reject")}
            >
              {members.text("rejectMember")}
            </button>
          </div>
        </section>
      )}

      {isActiveMember(user.status) && (
        <section className="admin-member-block admin-member-block--danger">
          <h3>{members.text("memberStatusTitle")}</h3>
          <p className="admin-cell-sub">
            {members.text("memberStatusDescription")}
          </p>
          <button
            type="button"
            className="admin-btn admin-btn--danger admin-btn--block"
            onClick={() => onAction(user.uid, "deactivate")}
          >
            {members.text("deactivateMember")}
          </button>
        </section>
      )}

      {isInactiveMember(user.status) && (
        <section className="admin-member-block admin-member-block--muted">
          <h3>{members.text("inactiveMemberTitle")}</h3>
          <p className="admin-cell-sub">
            {members.text("inactiveMemberDescription")}
            {user.rejectionReason
              ? ` ${members.text("reasonPrefix")}: ${user.rejectionReason}`
              : ""}
            {user.rejectedAt
              ? ` (${formatDate(user.rejectedAt)})`
              : ""}
          </p>
          <button
            type="button"
            className="admin-btn admin-btn--primary admin-btn--block"
            onClick={() => onAction(user.uid, "reactivate")}
          >
            {members.text("reactivateMember")}
          </button>
        </section>
      )}

      <section className="admin-member-block">
        <h3>{members.text("basicInfoTitle")}</h3>
        <dl className="admin-detail-list">
          <div>
            <dt>{members.text("nameLabel")}</dt>
            <dd>{user.name || "-"}</dd>
          </div>
          <div>
            <dt>{members.text("emailLabel")}</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>{members.text("phoneLabel")}</dt>
            <dd>{user.phone || "-"}</dd>
          </div>
          <div>
            <dt>{members.text("positionLabel")}</dt>
            <dd>{user.position || "-"}</dd>
          </div>
          <div>
            <dt>{members.text("dutyLabel")}</dt>
            <dd>{user.duty || "-"}</dd>
          </div>
          <div>
            <dt>{members.text("joinedAtLabel")}</dt>
            <dd>{formatDate(user.createdAt)}</dd>
          </div>
          <div>
            <dt>{members.text("modifiedAtLabel")}</dt>
            <dd>{formatDate(user.updatedAt)}</dd>
          </div>
          {!isPendingMember(user.status) && (
            <div>
              <dt>{members.text("businessCardLabel")}</dt>
              <dd>
                <MemberBusinessCardPreview user={user} />
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className="admin-member-block">
        <h3>{members.text("organizationInfoTitle")}</h3>
        <dl className="admin-detail-list">
          <div>
            <dt>{members.text("organizationNameLabel")}</dt>
            <dd>
              {user.cooperativeName ??
                user.manualCooperativeName ??
                "-"}
            </dd>
          </div>
          <div>
            <dt>{members.text("organizationCodeLabel")}</dt>
            <dd>{user.cooperativeId || "-"}</dd>
          </div>
          <div>
            <dt>{members.text("organizationIdLabel")}</dt>
            <dd>{user.nh_org_id || user.cooperativeId || "-"}</dd>
          </div>
          <div>
            <dt>{members.text("organizationMemberCountLabel")}</dt>
            <dd>
              {organization?.users?.length ?? 0}
              {copy.section("points").text("peopleUnit")}
            </dd>
          </div>
          <div>
            <dt>{members.text("organizationCreatedAtLabel")}</dt>
            <dd>{organization ? formatDate(organization.createdAt) : "-"}</dd>
          </div>
        </dl>
        {canChangeCooperative && user.role === "member" && (
          <button
            type="button"
            className="admin-btn admin-btn--block"
            onClick={() => onChangeCooperative(user)}
          >
            {members.text("changeCooperativeButton")}
          </button>
        )}
      </section>

      <section className="admin-member-block">
        <h3>{members.text("walletInfoTitle")}</h3>
        <dl className="admin-detail-list">
          <div>
            <dt>{members.text("walletBalanceLabel")}</dt>
            <dd>
              {organization
                ? formatPoints(organization.walletBalance ?? 0, copy)
                : "-"}
            </dd>
          </div>
          <div>
            <dt>{members.text("signupPointsLabel")}</dt>
            <dd>{formatPoints(totalSignupPoints, copy)}</dd>
          </div>
          <div>
            <dt>{members.text("recentTransactionLabel")}</dt>
            <dd>
              {transactions[0]
                ? `${ledgerLabel(copy, transactions[0].type)} · ${formatDate(transactions[0].createdAt)}`
                : ledger[0]
                  ? `${ledgerLabel(copy, ledger[0].event)} · ${formatDate(ledger[0].createdAt)}`
                  : members.text("noTransaction")}
            </dd>
          </div>
        </dl>
        <h4 className="admin-member-block__subhead">
          {members.text("recentPointsTitle")}
        </h4>
        <ul className="admin-mini-feed">
          {transactions.slice(0, 5).map((entry) => (
            <li key={entry.id}>
              <strong>{ledgerLabel(copy, entry.type)}</strong>
              <span>
                {entry.amount >= 0 ? "+" : ""}
                {formatPoints(entry.amount, copy)} · {formatDate(entry.createdAt)}
              </span>
            </li>
          ))}
          {transactions.length === 0 &&
            ledger.slice(0, 5).map((entry) => (
              <li key={entry.id}>
                <strong>{ledgerLabel(copy, entry.event)}</strong>
                <span>
                  {entry.points >= 0 ? "+" : ""}
                  {formatPoints(entry.points, copy)} · {formatDate(entry.createdAt)}
                </span>
              </li>
            ))}
          {transactions.length === 0 && ledger.length === 0 && (
            <li className="admin-empty">{members.text("noPoints")}</li>
          )}
        </ul>
      </section>

      <section className="admin-member-block">
        <h3>{members.text("consentInfoTitle")}</h3>
        <div className="admin-consent-grid">
          <span className={user.consents?.terms ? "is-on" : ""}>{members.text("termsConsent")}</span>
          <span className={user.consents?.privacy ? "is-on" : ""}>{members.text("privacyConsent")}</span>
          <span className={user.consents?.marketing ? "is-on" : ""}>{members.text("marketingChannel")}</span>
          <span className={user.consents?.email ? "is-on" : ""}>{members.text("emailChannel")}</span>
          <span className={user.consents?.sms ? "is-on" : ""}>{members.text("smsChannel")}</span>
          <span className={user.consents?.kakao ? "is-on" : ""}>{members.text("kakaoChannel")}</span>
        </div>
        <p className="admin-cell-sub">
          {members.text("receivedChannelsLabel")}:{" "}
          {marketingChannels.join(" · ") || members.text("optedOut")}
        </p>
      </section>

      <section className="admin-member-block">
        <h3>{members.text("relatedHistoryTitle")}</h3>
        <ul className="admin-mini-feed">
          {auditLogs.slice(0, 3).map((entry) => {
            const detail = formatAuditLog(entry);
            return (
              <li key={entry.id}>
                <strong>{detail.actionLabel}</strong>
                <span>
                  {detail.targetLabel}
                  {detail.targetSub ? ` · ${detail.targetSub}` : ""}
                </span>
                <em>{detail.actorName}</em>
                <time>{formatDate(entry.createdAt)}</time>
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}

function TrendChart({
  series,
  labels,
}: {
  series: { name: string; color: string; values: number[] }[];
  labels: string[];
}) {
  const allValues = series.flatMap((entry) => entry.values);
  const max = Math.max(1, ...allValues);
  const width = 100;
  const height = 100;
  const stepX = labels.length > 1 ? width / (labels.length - 1) : width;

  return (
    <div className="admin-trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            key={ratio}
            x1="0"
            x2={width}
            y1={height - height * ratio}
            y2={height - height * ratio}
            stroke="#eef0f3"
            strokeWidth="0.4"
          />
        ))}
        {series.map((line) => {
          const points = line.values
            .map((value, index) => {
              const x = index * stepX;
              const y = height - (value / max) * (height - 8) - 4;
              return `${x.toFixed(2)},${y.toFixed(2)}`;
            })
            .join(" ");
          return (
            <polyline
              key={line.name}
              points={points}
              fill="none"
              stroke={line.color}
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      </svg>
      <div className="admin-trend-chart__axis">
        {labels.map((label, index) => (
          <span key={`${label}-${index}`}>{index % 2 === 0 ? label : ""}</span>
        ))}
      </div>
    </div>
  );
}

function resolvePointHistoryOrganizationName(
  organizations: OrganizationRecord[],
  row: PointHistoryRow,
) {
  const organization = organizations.find((entry) => {
    const ids = [entry.cooperativeId, entry.nh_org_id].filter(Boolean);
    return ids.includes(row.cooperativeId ?? "") || ids.includes(row.nh_org_id ?? "");
  });
  return organization?.cooperativeName ?? row.cooperativeId ?? "-";
}

function PointHistoryTable({
  rows,
  showTarget = false,
  organizations = [],
  className = "",
}: {
  rows: PointHistoryRow[];
  showTarget?: boolean;
  organizations?: OrganizationRecord[];
  className?: string;
}) {
  const copy = useAdminOperationsCopy();
  const pointsCopy = copy.section("points");
  const colSpan = showTarget ? 6 : 5;

  return (
    <div className={`admin-table-wrap${className ? ` ${className}` : ""}`}>
      <table className="admin-table">
        <thead>
          <tr>
            <th>{pointsCopy.text("transactionTimeColumn")}</th>
            {showTarget && <th>{pointsCopy.text("targetColumn")}</th>}
            <th>{pointsCopy.text("eventColumn")}</th>
            <th>{pointsCopy.text("changeColumn")}</th>
            <th>{pointsCopy.text("transactionBalanceColumn")}</th>
            <th>{pointsCopy.text("reasonColumn")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => (
            <tr key={entry.id}>
              <td>{formatDate(entry.createdAt)}</td>
              {showTarget && (
                <td>{resolvePointHistoryOrganizationName(organizations, entry)}</td>
              )}
              <td>
                <strong>{ledgerLabel(copy, entry.eventKey)}</strong>
              </td>
              <td>
                <span
                  className={`admin-amount ${entry.points >= 0 ? "is-credit" : "is-debit"}`}
                >
                  {entry.points >= 0 ? "+" : ""}
                  {formatPoints(entry.points, copy)}
                </span>
              </td>
              <td>{formatPoints(entry.balanceAfter, copy)}</td>
              <td className="admin-cell-sub">{entry.reason ?? ""}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="admin-empty">
                {pointsCopy.text("transactionEmpty")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AllPointTransactionsModal({
  rows,
  organizations,
  initialFilterOrgId = "",
  onClose,
}: {
  rows: PointHistoryRow[];
  organizations: OrganizationRecord[];
  initialFilterOrgId?: string;
  onClose: () => void;
}) {
  const copy = useAdminOperationsCopy();
  const pointsCopy = copy.section("points");
  const dialogCopy = copy.section("dialogs");
  const inquiryCopy = copy.section("inquiries");
  const [filterOrgId, setFilterOrgId] = useState(initialFilterOrgId);

  const filteredRows = useMemo(() => {
    if (!filterOrgId) return rows;
    const organization = organizations.find(
      (entry) =>
        entry.cooperativeId === filterOrgId || entry.nh_org_id === filterOrgId,
    );
    if (!organization) return rows;
    const ids = getOrganizationIdSet(organization);
    return rows.filter((entry) => matchesOrganizationIds(ids, entry));
  }, [filterOrgId, organizations, rows]);

  return (
    <div
      className="admin-modal"
      role="dialog"
      aria-modal="true"
      aria-label={pointsCopy.text("allTransactionsAriaLabel")}
    >
      <button
        type="button"
        className="admin-modal__backdrop"
        aria-label={dialogCopy.text("close")}
        onClick={onClose}
      />
      <div className="admin-modal__panel admin-modal__panel--wide">
        <header className="admin-modal__head">
          <div>
            <p className="admin-modal__eyebrow">{pointsCopy.text("transactionLogEyebrow")}</p>
            <h2>{pointsCopy.text("allTransactionsTitle")}</h2>
            <p className="admin-cell-sub">
              {inquiryCopy.text("totalPrefix")}{" "}
              {rows.length.toLocaleString()}
              {pointsCopy.text("countUnit")} ·{" "}
              {pointsCopy.text("displayedPrefix")}{" "}
              {filteredRows.length.toLocaleString()}
              {pointsCopy.text("countUnit")}
            </p>
          </div>
          <button
            type="button"
            className="admin-btn admin-btn--ghost admin-btn--sm"
            onClick={onClose}
          >
            {dialogCopy.text("close")}
          </button>
        </header>
        <div className="admin-modal__body">
          <div className="admin-filter-row">
            <select
              className="admin-input"
              value={filterOrgId}
              onChange={(event) => setFilterOrgId(event.target.value)}
              aria-label={pointsCopy.text("transactionFilterAriaLabel")}
            >
              <option value="">{inquiryCopy.text("allOrganizations")}</option>
              {organizations.map((organization) => (
                <option
                  key={organization.cooperativeId}
                  value={organization.cooperativeId}
                >
                  {organization.cooperativeName}
                </option>
              ))}
            </select>
          </div>
          <PointHistoryTable
            rows={filteredRows}
            showTarget
            organizations={organizations}
          />
        </div>
      </div>
    </div>
  );
}

function AnswerEditor({
  request,
  answer,
  readOnly = false,
  onClose,
  onSubmit,
}: {
  request: ConsultRequestRecord;
  answer: AnswerRecord | null;
  readOnly?: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const copy = useAdminOperationsCopy();
  const inquiryCopy = copy.section("inquiries");
  const dialogCopy = copy.section("dialogs");
  const isEdit = Boolean(answer);
  const customerInquiryType = getCustomerInquiryTypeLabel(request);
  const autoAssigned = isAutoAssignedInquiry(request);
  const assignedField = getAssignedSupportFieldLabel(request);
  const legacyField =
    assignedField && !isValidSupportFieldLabel(assignedField) ? assignedField : "";
  const defaultSupportField =
    assignedField && isValidSupportFieldLabel(assignedField) ? assignedField : "";

  const [pointCostDisplay, setPointCostDisplay] = useState(() =>
    formatPointInput(answer?.pointCost ?? ANSWER_POINT_MIN),
  );
  const [pointCostError, setPointCostError] = useState("");
  const pointCostValue = parsePointInput(pointCostDisplay);
  const pointUnit = copy.section("points").text("pointUnit");
  const pointRangeText = `${formatPointInput(ANSWER_POINT_MIN)}${pointUnit} ${inquiryCopy.text("pointMinimumJoin")} ${formatPointInput(ANSWER_POINT_MAX)}${pointUnit} ${inquiryCopy.text("pointMaximumJoin")}`;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    if (!isValidAnswerPointCost(pointCostValue)) {
      event.preventDefault();
      setPointCostError(
        `${inquiryCopy.text("pointRangeErrorPrefix")} ${pointRangeText} ${inquiryCopy.text("pointRangeErrorSuffix")}`,
      );
      return;
    }
    setPointCostError("");
    onSubmit(event);
  };

  return (
    <div
      className="admin-modal"
      role="dialog"
      aria-modal="true"
      aria-label={
        readOnly
          ? inquiryCopy.text("answerDetailAriaLabel")
          : isEdit
            ? inquiryCopy.text("editAnswer")
            : inquiryCopy.text("writeAnswer")
      }
    >
      <button type="button" className="admin-modal__backdrop" aria-label={dialogCopy.text("close")} onClick={onClose} />
      <div className="admin-modal__panel">
        <header className="admin-modal__head">
          <div>
            <span className="admin-cell-sub">
              {request.requestNumber} ·{" "}
              {request.visibility === "PUBLIC" || request.visibility === "public"
                ? inquiryCopy.item("visibility.public")
                : request.visibility === "ORG_ONLY" ||
                    request.visibility === "nonghyup"
                  ? inquiryCopy.item("visibility.organization")
                  : inquiryCopy.item("visibility.private")}
            </span>
            <h2>
              {readOnly
                ? inquiryCopy.text("answerDetailTitle")
                : request.subject}
            </h2>
            <p className="admin-cell-sub">
              {readOnly ? `${request.subject} · ` : ""}
              {inquiryCopy.text("authorLabel")}{" "}
              {request.userName || request.userEmail} ·{" "}
              {request.cooperativeName ?? request.cooperativeDisplay ?? "-"}
            </p>
          </div>
          <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={onClose}>
            {dialogCopy.text("close")}
          </button>
        </header>
        <div className="admin-modal__body">
          <section className="admin-modal__quote">
            <h3>{inquiryCopy.text("customerInquiryTitle")}</h3>
            <p>{request.message}</p>
            {(request.attachments?.length ?? 0) > 0 && (
              <ul className="attachment-grid attachment-grid--compact">
                {request.attachments?.map((attachment) => (
                  <li key={attachment.path} className="attachment-card">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={attachment.url} alt={attachment.name} />
                    <a href={attachment.url} target="_blank" rel="noreferrer">
                      {attachment.name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {readOnly && (
            <>
              <dl className="admin-rating-detail admin-answer-detail">
                <div>
                  <dt>{inquiryCopy.text("supportFieldLabel")}</dt>
                  <dd>{request.internalCategory ?? request.internal_category ?? "-"}</dd>
                </div>
                <div>
                  <dt>{inquiryCopy.text("assigneeColumn")}</dt>
                  <dd>{assignedManagers(request).join(", ") || "-"}</dd>
                </div>
                <div>
                  <dt>{inquiryCopy.text("usedPointsColumn")}</dt>
                  <dd>{answer ? formatPoints(answer.pointCost ?? 0, copy) : "-"}</dd>
                </div>
                <div>
                  <dt>{inquiryCopy.text("answeredAtColumn")}</dt>
                  <dd>{formatDate(getAnswerRespondedAt(answer ?? undefined, request) ?? undefined)}</dd>
                </div>
              </dl>
              <section className="admin-modal__quote admin-modal__quote--emphasis">
                <h3>{inquiryCopy.text("answerBodyTitle")}</h3>
                <p>{answer?.body?.trim() || inquiryCopy.text("noAnswer")}</p>
              </section>
            </>
          )}

          {!readOnly && (
            <>
          <div
            className={`admin-answer-type-banner${autoAssigned ? " is-auto" : ""}`}
          >
            <span className="admin-answer-type-banner__label">
              {inquiryCopy.text("inquiryTypeLabel")}
            </span>
            <strong>{customerInquiryType}</strong>
            <p>
              {autoAssigned
                ? inquiryCopy.text("autoInquiryDescription")
                : inquiryCopy.text("selectedInquiryDescription")}
            </p>
          </div>

          <form className="admin-form admin-form--grid" onSubmit={submit}>
            <label className="admin-form__full">
              <span>{inquiryCopy.text("supportAssignmentLabel")}</span>
              <select
                className="admin-input"
                name="internalCategory"
                defaultValue={defaultSupportField || legacyField || ""}
                required
              >
                <option value="" disabled>
                  {autoAssigned
                    ? inquiryCopy.text("selectAutoSupportField")
                    : inquiryCopy.text("selectSupportField")}
                </option>
                {legacyField && (
                  <option value={legacyField}>
                    {legacyField} {inquiryCopy.text("legacySupportSuffix")}
                  </option>
                )}
                {INQUIRY_SUPPORT_FIELD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.label}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small className="admin-form__hint">
                {inquiryCopy.text("supportAssignmentHelp")}
              </small>
            </label>
            <label className="admin-form__full">
              <span>{inquiryCopy.text("assigneeColumn")}</span>
              <input
                className="admin-input"
                name="adminTags"
                placeholder={inquiryCopy.text("assigneePlaceholder")}
                defaultValue={assignedManagers(request).join(", ")}
                required
                aria-required="true"
              />
              <small className="admin-form__hint">
                {inquiryCopy.text("assigneeHelp")}
              </small>
            </label>
            <label>
              <span>
                {inquiryCopy.text("answerPointsLabel")} (
                {formatAnswerPointRangeLabel()}
                {pointUnit})
              </span>
              <input
                className={`admin-input admin-input--point${pointCostError ? " is-invalid" : ""}`}
                type="text"
                inputMode="numeric"
                value={pointCostDisplay}
                onChange={(event) => {
                  const nextValue = formatPointInput(event.target.value);
                  setPointCostDisplay(nextValue);
                  if (isValidAnswerPointCost(parsePointInput(nextValue))) {
                    setPointCostError("");
                  }
                }}
                onBlur={() =>
                  setPointCostDisplay((current) => formatPointInput(current))
                }
                placeholder={formatPointInput(ANSWER_POINT_MIN)}
                required
                aria-invalid={Boolean(pointCostError)}
                aria-describedby="answer-point-hint"
              />
              <input type="hidden" name="pointCost" value={pointCostValue || ""} />
              {pointCostError && (
                <small className="admin-form__error" role="alert">
                  {pointCostError}
                </small>
              )}
              <small className="admin-form__hint" id="answer-point-hint">
                {pointRangeText} {inquiryCopy.text("pointRangeHelpSuffix")}
              </small>
            </label>
            <label className="admin-form__full">
              <span>{inquiryCopy.text("answerBodyTitle")}</span>
              <textarea
                className="admin-input admin-input--area"
                name="answerBody"
                rows={8}
                placeholder={inquiryCopy.text("answerPlaceholder")}
                defaultValue={answer?.body ?? ""}
              />
            </label>
            <div className="admin-modal__actions">
              <button type="button" className="admin-btn admin-btn--ghost" onClick={onClose}>
                {dialogCopy.text("cancel")}
              </button>
              <button
                type="submit"
                className={`admin-btn admin-btn--${isEdit ? "answer-edit" : "answer-write"}`}
              >
                {isEdit
                  ? inquiryCopy.text("updateAnswer")
                  : inquiryCopy.text("registerAnswer")}
              </button>
            </div>
          </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AdminConfirmationModal({
  title,
  description,
  warning,
  confirmLabel,
  loading,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  warning?: string;
  confirmLabel: string;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialogCopy = useAdminOperationsCopy().section("dialogs");
  const panelRef = useModalFocus<HTMLDivElement>(onClose, loading);
  return (
    <div className="admin-modal" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        className="admin-modal__backdrop"
        aria-label={dialogCopy.text("close")}
        onClick={onClose}
        disabled={loading}
      />
      <div
        ref={panelRef}
        className="admin-modal__panel admin-modal__panel--sm"
      >
        <header className="admin-modal__head">
          <h2>{title}</h2>
        </header>
        <div className="admin-modal__body">
          <p className="admin-modal__lede">{description}</p>
          {warning && (
            <p className="admin-modal__warning" role="alert">
              {warning}
            </p>
          )}
          <div className="admin-modal__actions">
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={onClose}
              disabled={loading}
              data-autofocus
            >
              {dialogCopy.text("cancel")}
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--danger"
              onClick={onConfirm}
              disabled={loading}
            >
              {loading ? dialogCopy.text("processing") : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OperatorActionConfirmModal({
  confirmation,
  loading,
  onClose,
  onPermissionConfirm,
  onPasswordConfirm,
  onDeleteConfirm,
  onUpdateConfirm,
}: {
  confirmation: OperatorConfirmationState;
  loading: boolean;
  onClose: () => void;
  onPermissionConfirm: (
    operator: UserRecord,
    status: UserRecord["status"],
  ) => void;
  onPasswordConfirm: (operator: UserRecord, password: string) => void;
  onDeleteConfirm: (operator: UserRecord) => void;
  onUpdateConfirm: (payload: OperatorMutationPayload) => void;
}) {
  const copy = useAdminOperationsCopy();
  const dialogs = copy.section("dialogs");
  const members = copy.section("members");
  const [password, setPassword] = useState("");
  const [validation, setValidation] = useState("");
  const operatorName =
    confirmation.operator.name || confirmation.operator.email;

  if (confirmation.kind === "update" && confirmation.payload) {
    return (
      <AdminConfirmationModal
        title={dialogs.text("operatorUpdateConfirmTitle")}
        description={`${operatorName} · ${dialogs.text("operatorUpdateConfirmDescription")}`}
        warning={confirmation.warningKeys
          ?.map((key) => members.text(key))
          .join(" ")}
        confirmLabel={dialogs.text("saveChanges")}
        loading={loading}
        onClose={onClose}
        onConfirm={() => onUpdateConfirm(confirmation.payload!)}
      />
    );
  }

  if (confirmation.kind === "password") {
    return (
      <div
        className="admin-modal"
        role="dialog"
        aria-modal="true"
        aria-label={dialogs.text("passwordDialogTitle")}
      >
        <button
          type="button"
          className="admin-modal__backdrop"
          aria-label={dialogs.text("close")}
          onClick={onClose}
          disabled={loading}
        />
        <form
          className="admin-modal__panel admin-modal__panel--sm"
          onSubmit={(event) => {
            event.preventDefault();
            if (password.length < 8) {
              setValidation(copy.message("passwordTooShort"));
              return;
            }
            onPasswordConfirm(confirmation.operator, password);
          }}
        >
          <header className="admin-modal__head">
            <div>
              <p className="admin-modal__eyebrow">{operatorName}</p>
              <h2>{dialogs.text("passwordDialogTitle")}</h2>
            </div>
          </header>
          <div className="admin-modal__body">
            <p className="admin-modal__lede">
              {dialogs.text("passwordDialogDescription")}
            </p>
            <label className="admin-modal__field">
              <span>{dialogs.text("passwordLabel")}</span>
              <input
                className="admin-input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={dialogs.text("passwordPlaceholder")}
                disabled={loading}
                autoComplete="new-password"
              />
            </label>
            {validation && (
              <p className="admin-form__error" role="alert">
                {validation}
              </p>
            )}
            <div className="admin-modal__actions">
              <button type="button" className="admin-btn" onClick={onClose}>
                {dialogs.text("cancel")}
              </button>
              <button
                type="submit"
                className="admin-btn admin-btn--primary"
                disabled={loading}
              >
                {loading
                  ? dialogs.text("processing")
                  : dialogs.text("resetPassword")}
              </button>
            </div>
          </div>
        </form>
      </div>
    );
  }

  const isDelete = confirmation.kind === "delete";
  const nextStatus = confirmation.nextStatus ?? "rejected";
  const confirmLabel = isDelete
    ? members.text("deleteAccount")
    : nextStatus === "active"
      ? members.text("activateOperator")
      : members.text("deactivateOperator");
  return (
    <AdminConfirmationModal
      title={
        isDelete
          ? dialogs.text("deleteOperatorDialogTitle")
          : dialogs.text("permissionDialogTitle")
      }
      description={`${operatorName} · ${confirmLabel}`}
      warning={isDelete ? dialogs.text("irreversibleWarning") : undefined}
      confirmLabel={confirmLabel}
      loading={loading}
      onClose={onClose}
      onConfirm={() => {
        if (isDelete) {
          onDeleteConfirm(confirmation.operator);
        } else {
          onPermissionConfirm(confirmation.operator, nextStatus);
        }
      }}
    />
  );
}

function FaqEditorModal({
  mode,
  faq,
  loading,
  categories,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  faq: FaqRecord | null;
  loading: boolean;
  categories: { value: string; label: string }[];
  onClose: () => void;
  onSubmit: (payload: {
    question: string;
    answer: string;
    category: string;
    isPublic: boolean;
    displayStatus: "published" | "draft";
  }) => void;
}) {
  const copy = useAdminOperationsCopy();
  const dialogCopy = copy.section("dialogs");
  const inquiryCopy = copy.section("inquiries");
  const [question, setQuestion] = useState(faq?.question ?? "");
  const [answer, setAnswer] = useState(faq?.answer ?? "");
  const [category, setCategory] = useState(
    faq?.category ?? categories[0]?.value ?? "",
  );
  const [isPublic, setIsPublic] = useState(faq?.isPublic ?? true);
  const [displayStatus, setDisplayStatus] = useState<"published" | "draft">(
    faq?.displayStatus ?? "published"
  );
  const [validation, setValidation] = useState("");

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!question.trim() || !answer.trim()) {
      setValidation(dialogCopy.text("faqValidation"));
      return;
    }
    setValidation("");
    onSubmit({
      question: question.trim(),
      answer: answer.trim(),
      category: category.trim() || categories[0]?.value || "",
      isPublic,
      displayStatus,
    });
  };

  return (
    <div className="admin-modal" role="dialog" aria-modal="true">
      <div className="admin-modal__backdrop" onClick={onClose} />
      <div className="admin-modal__panel admin-modal__panel--wide">
        <header className="admin-modal__head">
          <div>
            <span className="admin-modal__eyebrow">
              {mode === "create"
                ? dialogCopy.text("faqCreate")
                : dialogCopy.text("faqEdit")}
            </span>
            <h2 className="admin-modal__title">{dialogCopy.text("faqEditorTitle")}</h2>
            <p className="admin-modal__lede">
              {dialogCopy.text("faqEditorDescription")}
            </p>
          </div>
          <button
            type="button"
            className="admin-modal__close"
            onClick={onClose}
            aria-label={dialogCopy.text("close")}
          >
            ×
          </button>
        </header>
        <div className="admin-modal__body">
          <form className="admin-form admin-form--grid" onSubmit={handleSubmit}>
            <label className="admin-form__full">
              <span>{dialogCopy.text("faqQuestion")}</span>
              <input
                className="admin-input"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                maxLength={200}
                placeholder={dialogCopy.text("faqQuestionPlaceholder")}
              />
            </label>
            <label>
              <span>{dialogCopy.text("faqCategory")}</span>
              <select
                className="admin-input"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                {categories.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{dialogCopy.text("faqPublic")}</span>
              <select
                className="admin-input"
                value={isPublic ? "public" : "private"}
                onChange={(event) =>
                  setIsPublic(event.target.value === "public")
                }
              >
                <option value="public">{inquiryCopy.item("faqPublic.public")}</option>
                <option value="private">{inquiryCopy.item("faqPublic.private")}</option>
              </select>
            </label>
            <label>
              <span>{dialogCopy.text("faqDisplay")}</span>
              <select
                className="admin-input"
                value={displayStatus}
                onChange={(event) =>
                  setDisplayStatus(
                    event.target.value === "published" ? "published" : "draft"
                  )
                }
              >
                <option value="published">{inquiryCopy.item("faqDisplay.published")}</option>
                <option value="draft">{inquiryCopy.item("faqDisplay.draft")}</option>
              </select>
            </label>
            <label className="admin-form__full">
              <span>{dialogCopy.text("faqBody")}</span>
              <textarea
                className="admin-input admin-input--area"
                rows={8}
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                maxLength={5000}
                placeholder={dialogCopy.text("faqBodyPlaceholder")}
              />
            </label>
            {validation && (
              <p className="admin-form__error admin-form__full">{validation}</p>
            )}
            <div className="admin-modal__actions admin-form__full">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={onClose}
                disabled={loading}
              >
                {dialogCopy.text("cancel")}
              </button>
              <button
                type="submit"
                className="admin-btn admin-btn--primary"
                disabled={loading}
              >
                {loading
                  ? dialogCopy.text("saving")
                  : mode === "create"
                    ? dialogCopy.text("faqCreate")
                    : dialogCopy.text("faqSaveChanges")}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
