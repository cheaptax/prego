"use client";

import { FirebaseError } from "firebase/app";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { describeAuditLog } from "@/lib/audit-log-display";
import {
  getMemberStatusLabel,
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
  formatRatingScore,
  getRatingSatisfactionLabel,
  getRatingSatisfactionTone,
} from "@/lib/rating-display";
import {
  compareAdminInquiryRows,
  getRequestStatusLabel,
  getRequestStatusTone,
  matchesRequestStatusFilter,
  REQUEST_STATUS_FILTER_OPTIONS,
  resolveRequestStatus,
  type ResolvedRequestStatus,
} from "@/lib/request-status";
import type {
  AnswerRecord,
  AnswerRatingRecord,
  AnswerViewRecord,
  AuditLogRecord,
  ConsultRequestRecord,
  FaqRecord,
  OrganizationRecord,
  PointLedgerRecord,
  PointTransactionRecord,
  UserRecord,
} from "@/lib/firebase/schema";

const ADMIN_EMAIL = "admin@gmail.com";

type State = "loading" | "ready" | "denied" | "error";

type TabKey = "overview" | "members" | "inquiries" | "points" | "audit";
type MemberSubtab = "members" | "operators";
type OperatorEditorState = {
  mode: "create" | "edit";
  operator: UserRecord | null;
};

const TABS: { key: TabKey; label: string; description: string }[] = [
  { key: "overview", label: "Overview", description: "운영 지표 한눈에 보기" },
  { key: "members", label: "Members", description: "회원 및 운영자 계정 관리" },
  { key: "inquiries", label: "Inquiries", description: "문의 접수와 답변 처리" },
  { key: "points", label: "Points", description: "농협 지갑과 포인트 정산" },
  { key: "audit", label: "Audit log", description: "주요 변경 이력" },
];

const VISIBILITY_LABELS: Record<string, string> = {
  PUBLIC: "전체 공개",
  public: "전체 공개",
  ORG_ONLY: "농협 공개",
  nonghyup: "농협 공개",
  PRIVATE: "비공개",
  private: "비공개",
};

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

const LEDGER_LABELS: Record<string, string> = {
  first_org_signup: "농협 최초 가입 보너스",
  user_signup: "회원 가입 적립",
  answer_view: "답변 열람 사용",
  question_answer_usage: "답변 열람 사용",
  manual_adjustment: "수동 조정",
  admin_adjustment_credit: "운영자 적립",
  admin_adjustment_debit: "운영자 차감",
};

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

const FAQ_CATEGORY_OPTIONS = [
  "일반",
  "회원가입",
  "문의 진행",
  "포인트",
  "정산",
  "기타",
];

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatRelative(value: string | undefined, reference: number) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (!reference) {
    return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(date);
  }
  const diff = reference - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(date);
}

function formatPoints(value: number) {
  return `${value.toLocaleString()}P`;
}

type InquiryActionKind = "write" | "edit" | "complete";

/** 접수번호 · 제목 · 작성자 · 담당자 통합 검색 (공백으로 여러 키워드) */
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

/** 답변 최초 등록 또는 최종 수정 시각 */
function getAnswerRespondedAt(
  answer: AnswerRecord | undefined,
  request: ConsultRequestRecord,
): string | null {
  if (!answer) return null;
  return answer.updatedAt ?? request.answeredAt ?? answer.createdAt ?? null;
}

/** 문의 목록 우측 액션 버튼 종류 (고객 열람 후에만 완료 상태) */
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
  return (
    <span className={`admin-pill admin-pill--${getRequestStatusTone(value)}`}>
      <span className="admin-pill__dot" aria-hidden="true" />
      {getRequestStatusLabel(value)}
    </span>
  );
}

function VisibilityPill({ value }: { value?: string }) {
  const label = VISIBILITY_LABELS[value ?? ""] ?? value ?? "-";
  return <span className="admin-chip">{label}</span>;
}

export function AdminDashboard() {
  const router = useRouter();
  const [state, setState] = useState<State>("loading");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [requests, setRequests] = useState<ConsultRequestRecord[]>([]);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [answerViews, setAnswerViews] = useState<AnswerViewRecord[]>([]);
  const [ratings, setRatings] = useState<AnswerRatingRecord[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationRecord[]>([]);
  const [ledger, setLedger] = useState<PointLedgerRecord[]>([]);
  const [pointTransactions, setPointTransactions] = useState<PointTransactionRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState<{ tone: "info" | "success" | "error"; text: string } | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [memberSubtab, setMemberSubtab] = useState<MemberSubtab>("members");
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedMemberUid, setSelectedMemberUid] = useState<string | null>(null);
  const [operatorSearch, setOperatorSearch] = useState("");
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
  const [faqs, setFaqs] = useState<FaqRecord[]>([]);
  const [faqLoading, setFaqLoading] = useState(false);
  const [faqSearch, setFaqSearch] = useState("");
  const [faqCategoryFilter, setFaqCategoryFilter] = useState("");
  const [faqPublicFilter, setFaqPublicFilter] = useState("");
  const [faqDisplayFilter, setFaqDisplayFilter] = useState("");
  const [faqEditor, setFaqEditor] = useState<{
    mode: "create" | "edit";
    faq: FaqRecord | null;
  } | null>(null);
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
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchDashboard = useCallback(async () => {
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new Error("로그인이 필요합니다.");
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
      error?: string;
    };

    if (!res.ok || !data.ok) {
      throw new Error(data.error ?? "관리자 데이터를 불러오지 못했습니다.");
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
    setLastUpdated(new Date());
  }, []);

  const fetchFaqs = useCallback(async () => {
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new Error("로그인이 필요합니다.");
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
      throw new Error(data.error ?? "FAQ를 불러오지 못했습니다.");
    }
    setFaqs(data.faqs ?? []);
  }, []);

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
      .catch((err) => {
        if (cancelled) return;
        setActionMessage({
          tone: "error",
          text:
            err instanceof Error ? err.message : "FAQ를 불러오지 못했습니다.",
        });
      })
      .finally(() => {
        if (!cancelled) setFaqLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [state, tab, inquirySubtab, fetchFaqs]);

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
      if (!user) {
        setActionMessage({ tone: "error", text: "로그인이 필요합니다." });
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
          throw new Error(data.error ?? "FAQ 저장에 실패했습니다.");
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
          text: isCreate ? "FAQ를 등록했습니다." : "FAQ를 수정했습니다.",
        });
        setFaqEditor(null);
      } catch (err) {
        setActionMessage({
          tone: "error",
          text:
            err instanceof Error ? err.message : "FAQ 저장에 실패했습니다.",
        });
      } finally {
        setFaqSaving(false);
      }
    },
    []
  );

  const deleteFaq = useCallback(async (faq: FaqRecord) => {
    const confirmed =
      typeof window !== "undefined" &&
      window.confirm(`정말 "${faq.question}" 항목을 삭제하시겠습니까?`);
    if (!confirmed) return;
    const user = getFirebaseAuth().currentUser;
    if (!user) {
      setActionMessage({ tone: "error", text: "로그인이 필요합니다." });
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
        throw new Error(data.error ?? "FAQ 삭제에 실패했습니다.");
      }
      setFaqs((current) => current.filter((item) => item.id !== faq.id));
      setActionMessage({ tone: "success", text: "FAQ를 삭제했습니다." });
    } catch (err) {
      setActionMessage({
        tone: "error",
        text:
          err instanceof Error ? err.message : "FAQ 삭제에 실패했습니다.",
      });
    }
  }, []);

  const refreshDashboard = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchDashboard();
      setActionMessage({ tone: "info", text: "데이터를 새로 불러왔습니다." });
    } catch (err) {
      setActionMessage({
        tone: "error",
        text: err instanceof Error ? err.message : "새로고침에 실패했습니다.",
      });
    } finally {
      setRefreshing(false);
    }
  }, [fetchDashboard]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const boot = async () => {
      try {
        const auth = getFirebaseAuth();
        unsubscribe = onAuthStateChanged(auth, async (user) => {
          if (!user) {
            setCurrentUser(null);
            router.push("/login");
            return;
          }

          try {
            setCurrentUser(user);
            const tokenResult = await user.getIdTokenResult(true);
            const isAdmin =
              user.email?.toLowerCase() === ADMIN_EMAIL ||
              tokenResult.claims.admin === true;

            if (!isAdmin) {
              setState("denied");
              return;
            }

            await fetchDashboard();
            setState("ready");
          } catch (err) {
            setState("error");
            setError(
              err instanceof FirebaseError
                ? `${err.code}: ${err.message}`
                : err instanceof Error
                  ? err.message
                  : "관리자 데이터를 불러오지 못했습니다."
            );
          }
        });
      } catch (err) {
        setState("error");
        setError(err instanceof Error ? err.message : "Firebase 설정을 확인해 주세요.");
      }
    };

    void boot();

    return () => unsubscribe?.();
  }, [router, fetchDashboard]);

  // -- Derived data ---------------------------------------------------------
  const memberUsers = useMemo(
    () => users.filter((user) => user.role !== "admin"),
    [users],
  );
  const operatorUsers = useMemo(
    () =>
      users
        .filter(
          (user) =>
            user.role === "admin" ||
            user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase(),
        )
        .sort((a, b) => (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? "")),
    [users],
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
  const filteredOperators = useMemo(() => {
    const query = operatorSearch.trim().toLowerCase();
    if (!query) return operatorUsers;
    return operatorUsers.filter((user) =>
      [user.name, user.email, user.position, user.duty, getMemberStatusLabel(user.status)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [operatorSearch, operatorUsers]);
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
  const selectedOperatorIsProtected = Boolean(
    selectedOperator &&
      (selectedOperator.uid === currentUser?.uid ||
        selectedOperator.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()),
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
      adminEmail: ADMIN_EMAIL,
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
    () => deriveDelta(memberUsers, referenceTime),
    [memberUsers, referenceTime],
  );
  const requestDelta = useMemo(
    () => deriveDelta(requests, referenceTime),
    [requests, referenceTime],
  );
  const answerDelta = useMemo(
    () => deriveDelta(answers, referenceTime),
    [answers, referenceTime],
  );
  const ratingDelta = useMemo(
    () => deriveDelta(ratings, referenceTime),
    [ratings, referenceTime],
  );

  const inquiriesSeries = useMemo(
    () => buildDailySeries(requests, 14, referenceTime),
    [requests, referenceTime],
  );
  const answersSeries = useMemo(
    () => buildDailySeries(answers, 14, referenceTime),
    [answers, referenceTime],
  );
  const signupsSeries = useMemo(
    () => buildDailySeries(memberUsers, 14, referenceTime),
    [memberUsers, referenceTime],
  );

  const answeredCount = useMemo(
    () => requests.filter((request) => answerByRequestId.has(request.id)).length,
    [requests, answerByRequestId],
  );
  const answerRate = requests.length > 0 ? answeredCount / requests.length : 0;

  const ratingScoreAvg = useMemo(() => {
    if (!ratings.length) return 0;
    const sum = ratings.reduce((total, rating) => total + (rating.score ?? 0), 0);
    return sum / ratings.length;
  }, [ratings]);

  const helpfulRate = useMemo(() => {
    const scored = ratings.filter((rating) => typeof rating.helpful === "boolean");
    if (!scored.length) return 0;
    return scored.filter((rating) => rating.helpful).length / scored.length;
  }, [ratings]);

  const totalWalletBalance = useMemo(
    () => organizations.reduce((total, organization) => total + (organization.walletBalance ?? 0), 0),
    [organizations],
  );

  const pointsSpent30d = useMemo(() => {
    if (!referenceTime) return 0;
    const cutoff = referenceTime - 30 * 24 * 60 * 60 * 1000;
    return ledger
      .filter((entry) => {
        if (!entry.createdAt) return false;
        const time = new Date(entry.createdAt).getTime();
        if (Number.isNaN(time) || time < cutoff) return false;
        return entry.event === "answer_view" || entry.event === "admin_adjustment_debit";
      })
      .reduce((total, entry) => total + Math.abs(entry.points ?? 0), 0);
  }, [ledger, referenceTime]);

  const orgInquiryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const request of requests) {
      const key = request.cooperativeName ?? request.cooperativeDisplay ?? request.manualCooperativeName ?? "미지정";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [requests]);

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
      auditLogs.slice(0, 12).map((log) => ({
        id: log.id,
        time: log.createdAt,
        ...formatAuditLog(log),
      })),
    [auditLogs, formatAuditLog],
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
    setActionMessage(null);
    const formData = new FormData(event.currentTarget);
    const assignee = String(formData.get("adminTags") ?? "").trim();
    if (!assignee) {
      setActionMessage({
        tone: "error",
        text: "담당자를 입력해야 답변을 등록할 수 있습니다.",
      });
      return;
    }
    const pointCost = Number(formData.get("pointCost"));
    if (!isValidAnswerPointCost(pointCost)) {
      setActionMessage({
        tone: "error",
        text: `답변 포인트는 ${formatAnswerPointRangeLabel()}P 범위로 입력해 주세요.`,
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
          ? `답변 포인트는 최소 ${formatPointInput(ANSWER_POINT_MIN)}P 이상, 최대 ${formatPointInput(ANSWER_POINT_MAX)}P 이하로 입력해 주세요.`
          : data.error ?? "답변 등록에 실패했습니다.";
      setActionMessage({ tone: "error", text: message });
      return;
    }
    setActionMessage({ tone: "success", text: "답변이 저장되었습니다." });
    setActiveRequestId(null);
    await refreshDashboard();
  };

  const requestPointAdjustment = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionMessage(null);
    if (!selectedPointOrganization) return;
    const points = parseSignedPointInput(pointAdjustmentAmount);
    const reason = pointAdjustmentReason.trim();
    if (!points || !reason) {
      setActionMessage({ tone: "error", text: "조정 포인트와 사유를 입력해 주세요." });
      return;
    }
    if ((selectedPointOrganization.walletBalance ?? 0) + points < 0) {
      setActionMessage({ tone: "error", text: "조정 후 잔액이 음수가 될 수 없습니다." });
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
    if (!pointAdjustmentDraft) return;
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
        setActionMessage({ tone: "error", text: data.error ?? "포인트 조정에 실패했습니다." });
        return;
      }
      setActionMessage({ tone: "success", text: "포인트가 조정되었습니다." });
      setPointAdjustmentAmount("");
      setPointAdjustmentReason("");
      setPointAdjustmentDraft(null);
      await refreshDashboard();
    } catch (err) {
      setActionMessage({
        tone: "error",
        text: err instanceof Error ? err.message : "포인트 조정에 실패했습니다.",
      });
    } finally {
      setPointAdjustmentLoading(false);
    }
  };

  const requestMemberAction = useCallback(
    (uid: string, type: "approve" | "reject" | "deactivate" | "reactivate") => {
      const target = users.find((entry) => entry.uid === uid);
      if (!target) return;
      setMemberActionReason("");
      setMemberAction({
        uid,
        type,
        name: target.name?.trim() || target.email || "회원",
        email: target.email,
      });
    },
    [users],
  );

  const closeMemberAction = useCallback(() => {
    if (memberActionLoading) return;
    setMemberAction(null);
    setMemberActionReason("");
  }, [memberActionLoading]);

  const submitMemberAction = useCallback(async () => {
    if (!memberAction) return;
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
            text: data?.error ?? "회원 상태 변경에 실패했습니다.",
          });
          return;
        }
        if (data.alreadyActive) {
          setActionMessage({ tone: "info", text: "이미 활성화된 회원입니다." });
        } else if (data.transition === "reactivate") {
          setActionMessage({
            tone: "success",
            text: "회원이 활성 상태로 재활성화되었습니다.",
          });
        } else {
          setActionMessage({
            tone: "success",
            text: `회원 승인이 완료되었습니다. ${formatPoints(data.grantedPoints ?? 0)} 지급`,
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
            text: data?.error ?? "회원 상태 변경에 실패했습니다.",
          });
          return;
        }
        if (data.alreadyRejected) {
          setActionMessage({ tone: "info", text: "이미 비활성 상태인 회원입니다." });
        } else if (data.transition === "deactivate") {
          setActionMessage({
            tone: "success",
            text: "회원을 비활성 상태로 전환했습니다.",
          });
        } else {
          setActionMessage({
            tone: "success",
            text: "가입을 거절했습니다. 회원 상태가 비활성으로 전환되었습니다.",
          });
        }
      }
      setMemberAction(null);
      setMemberActionReason("");
      await refreshDashboard();
    } finally {
      setMemberActionLoading(false);
    }
  }, [memberAction, memberActionReason, refreshDashboard]);

  const submitOperatorEditor = useCallback(
    async (payload: {
      name: string;
      email: string;
      password?: string;
      position: string;
      duty: string;
      status: UserRecord["status"];
    }) => {
      if (!operatorEditor) return;
      const user = getFirebaseAuth().currentUser;
      if (!user) return;
      setActionMessage(null);
      setOperatorActionLoading(true);
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
          throw new Error(data?.error ?? "운영자 계정 저장에 실패했습니다.");
        }
        setOperatorEditor(null);
        setActionMessage({
          tone: "success",
          text: isCreate ? "운영자 계정을 추가했습니다." : "운영자 정보를 수정했습니다.",
        });
        await refreshDashboard();
        if (data.operator?.uid) setSelectedOperatorUid(data.operator.uid);
      } catch (err) {
        setActionMessage({
          tone: "error",
          text: err instanceof Error ? err.message : "운영자 계정 저장에 실패했습니다.",
        });
      } finally {
        setOperatorActionLoading(false);
      }
    },
    [operatorEditor, refreshDashboard],
  );

  const changeOperatorPermission = useCallback(
    async (operator: UserRecord, nextStatus: UserRecord["status"]) => {
      const label = nextStatus === "active" ? "권한을 부여" : "권한을 회수";
      const confirmed =
        typeof window !== "undefined" &&
        window.confirm(`${operator.name || operator.email} 운영자의 ${label}하시겠습니까?`);
      if (!confirmed) return;
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
          throw new Error(data?.error ?? "운영자 권한 변경에 실패했습니다.");
        }
        setActionMessage({
          tone: "success",
          text: nextStatus === "active" ? "운영자 권한을 부여했습니다." : "운영자 권한을 회수했습니다.",
        });
        await refreshDashboard();
      } catch (err) {
        setActionMessage({
          tone: "error",
          text: err instanceof Error ? err.message : "운영자 권한 변경에 실패했습니다.",
        });
      } finally {
        setOperatorActionLoading(false);
      }
    },
    [refreshDashboard],
  );

  const resetOperatorPassword = useCallback(
    async (operator: UserRecord) => {
      const password =
        typeof window !== "undefined"
          ? window.prompt("새 임시 비밀번호를 입력하세요. 8자 이상이어야 합니다.")
          : null;
      if (!password) return;
      if (password.length < 8) {
        setActionMessage({ tone: "error", text: "비밀번호는 8자 이상이어야 합니다." });
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
          throw new Error(data?.error ?? "비밀번호 재설정에 실패했습니다.");
        }
        setActionMessage({ tone: "success", text: "운영자 비밀번호를 재설정했습니다." });
        await refreshDashboard();
      } catch (err) {
        setActionMessage({
          tone: "error",
          text: err instanceof Error ? err.message : "비밀번호 재설정에 실패했습니다.",
        });
      } finally {
        setOperatorActionLoading(false);
      }
    },
    [refreshDashboard],
  );

  const deleteOperator = useCallback(
    async (operator: UserRecord) => {
      const confirmed =
        typeof window !== "undefined" &&
        window.confirm(`${operator.name || operator.email} 운영자 계정을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`);
      if (!confirmed) return;
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
          throw new Error(data?.error ?? "운영자 계정 삭제에 실패했습니다.");
        }
        setSelectedOperatorUid(null);
        setActionMessage({ tone: "success", text: "운영자 계정을 삭제했습니다." });
        await refreshDashboard();
      } catch (err) {
        setActionMessage({
          tone: "error",
          text: err instanceof Error ? err.message : "운영자 계정 삭제에 실패했습니다.",
        });
      } finally {
        setOperatorActionLoading(false);
      }
    },
    [refreshDashboard],
  );

  // -- Loading / Denied / Error ---------------------------------------------
  if (state === "loading") {
    return (
      <div className="admin-state">
        <div className="admin-state__card">
          <div className="admin-state__spinner" aria-hidden="true" />
          <h2>관리자 콘솔을 준비하고 있습니다</h2>
          <p>Firebase 인증 상태와 데이터 권한을 확인 중입니다.</p>
        </div>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="admin-state">
        <div className="admin-state__card">
          <h2>접근 권한이 없습니다</h2>
          <p>관리자 권한이 부여된 계정으로만 접근할 수 있습니다.</p>
          <button
            className="admin-btn admin-btn--primary"
            type="button"
            onClick={() => signOut(getFirebaseAuth()).then(() => router.push("/login"))}
          >
            관리자 계정으로 다시 로그인
          </button>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="admin-state">
        <div className="admin-state__card admin-state__card--error">
          <h2>데이터를 불러오지 못했습니다</h2>
          <p>{error}</p>
          <button className="admin-btn" type="button" onClick={() => void refreshDashboard()}>
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  // -- Render ---------------------------------------------------------------
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar" aria-label="관리자 콘솔 내비게이션">
        <div className="admin-brand">
          <div className="admin-brand__mark" aria-hidden="true">N</div>
          <div className="admin-brand__meta">
            <strong>농협지원센터</strong>
            <span>Admin Console</span>
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
        </nav>

        <div className="admin-sidebar__footer">
          <div className="admin-user">
            <div className="admin-user__avatar" aria-hidden="true">
              {(currentUser?.email ?? "A").slice(0, 1).toUpperCase()}
            </div>
            <div className="admin-user__meta">
              <strong>{currentUser?.email ?? "admin"}</strong>
              <span>운영자 · 슈퍼관리자</span>
            </div>
          </div>
          <button
            className="admin-btn admin-btn--ghost admin-btn--block"
            type="button"
            onClick={() => signOut(getFirebaseAuth()).then(() => router.push("/login"))}
          >
            로그아웃
          </button>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div>
            <p className="admin-topbar__crumb">Console / {TABS.find((item) => item.key === tab)?.label}</p>
            <h1 className="admin-topbar__title">{TABS.find((item) => item.key === tab)?.label}</h1>
            <p className="admin-topbar__hint">{TABS.find((item) => item.key === tab)?.description}</p>
          </div>
          <div className="admin-topbar__actions">
            <span className="admin-topbar__updated">
              마지막 동기화 {lastUpdated ? formatRelative(lastUpdated.toISOString(), referenceTime) : "-"}
            </span>
            <button
              type="button"
              className="admin-btn"
              onClick={() => void refreshDashboard()}
              disabled={refreshing}
            >
              {refreshing ? "새로고침 중..." : "새로고침"}
            </button>
          </div>
        </header>

        {actionMessage && (
          <div className={`admin-toast admin-toast--${actionMessage.tone}`} role="status">
            {actionMessage.text}
            <button
              type="button"
              className="admin-toast__close"
              aria-label="닫기"
              onClick={() => setActionMessage(null)}
            >
              ×
            </button>
          </div>
        )}

        {tab === "overview" && (
          <div className="admin-grid">
            <div className="admin-kpi-grid">
              <KpiCard
                label="가입 회원"
                value={memberUsers.length.toLocaleString()}
                suffix="명"
                delta={memberDelta}
                series={signupsSeries.map((point) => point.value)}
                tone="blue"
              />
              <KpiCard
                label="문의 접수"
                value={requests.length.toLocaleString()}
                suffix="건"
                delta={requestDelta}
                series={inquiriesSeries.map((point) => point.value)}
                tone="amber"
              />
              <KpiCard
                label="등록 답변"
                value={answers.length.toLocaleString()}
                suffix="건"
                delta={answerDelta}
                series={answersSeries.map((point) => point.value)}
                tone="green"
              />
              <KpiCard
                label="고객 평가"
                value={ratings.length ? ratingScoreAvg.toFixed(2) : "-"}
                suffix={ratings.length ? "/5.0" : ""}
                delta={ratingDelta}
                helper={`도움됨 ${(helpfulRate * 100).toFixed(0)}% · ${ratings.length}건`}
                tone="violet"
              />
            </div>

            <div className="admin-card admin-card--span-2">
              <header className="admin-card__head">
                <div>
                  <h2>운영 추이</h2>
                  <p>최근 14일간 회원가입 · 문의 · 답변 흐름</p>
                </div>
                <span className="admin-card__legend">
                  <i className="dot dot--blue" /> 가입
                  <i className="dot dot--amber" /> 문의
                  <i className="dot dot--green" /> 답변
                </span>
              </header>
              <TrendChart
                series={[
                  { name: "가입", color: "#3b82f6", values: signupsSeries.map((point) => point.value) },
                  { name: "문의", color: "#f59e0b", values: inquiriesSeries.map((point) => point.value) },
                  { name: "답변", color: "#10b981", values: answersSeries.map((point) => point.value) },
                ]}
                labels={inquiriesSeries.map((point) => point.label)}
              />
            </div>

            <div className="admin-card">
              <header className="admin-card__head">
                <div>
                  <h2>주요 지표</h2>
                  <p>응답률과 포인트 사용을 한눈에</p>
                </div>
              </header>
              <ul className="admin-stat-list">
                <li>
                  <span>답변률</span>
                  <strong>{(answerRate * 100).toFixed(1)}%</strong>
                  <em>{answeredCount}/{requests.length} 건</em>
                </li>
                <li>
                  <span>활성 농협</span>
                  <strong>{organizations.length.toLocaleString()}</strong>
                  <em>지갑 보유 조직</em>
                </li>
                <li>
                  <span>전체 지갑 잔액</span>
                  <strong>{formatPoints(totalWalletBalance)}</strong>
                  <em>{organizations.length}개 조직 합계</em>
                </li>
                <li>
                  <span>최근 30일 사용</span>
                  <strong>{formatPoints(pointsSpent30d)}</strong>
                  <em>답변 열람 · 운영자 차감</em>
                </li>
              </ul>
            </div>

            <div className="admin-card admin-card--span-2">
              <header className="admin-card__head">
                <div>
                  <h2>최근 활동</h2>
                  <p>운영자 작업 · 시스템 변경 이력</p>
                </div>
                <button type="button" className="admin-link" onClick={() => setTab("audit")}>
                  전체 보기 →
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
                          <span className="admin-activity__label">대상</span>
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
                        <span>작업자 {item.actorName}</span>
                        <time title={formatDate(item.time)}>
                          <span className="admin-activity__label">발생 시각</span>
                          {formatRelative(item.time, referenceTime)}
                        </time>
                      </div>
                    </div>
                  </li>
                ))}
                {recentActivity.length === 0 && (
                  <li className="admin-empty">기록된 활동이 없습니다.</li>
                )}
              </ul>
            </div>

            <div className="admin-card">
              <header className="admin-card__head">
                <div>
                  <h2>문의 상위 농협</h2>
                  <p>접수 건수 기준 Top 6</p>
                </div>
              </header>
              <ul className="admin-rank">
                {orgInquiryCounts.map((row, index) => (
                  <li key={row.name}>
                    <span className="admin-rank__index">{index + 1}</span>
                    <span className="admin-rank__name">{row.name}</span>
                    <span className="admin-rank__value">{row.count}건</span>
                  </li>
                ))}
                {orgInquiryCounts.length === 0 && <li className="admin-empty">데이터 없음</li>}
              </ul>
            </div>
          </div>
        )}

        {tab === "members" && (
          <>
            <div className="admin-subtabs" role="tablist" aria-label="회원 및 운영자 관리 보기">
              <button
                type="button"
                role="tab"
                aria-selected={memberSubtab === "members"}
                className={`admin-subtab${memberSubtab === "members" ? " is-active" : ""}`}
                onClick={() => setMemberSubtab("members")}
              >
                <span>회원 관리</span>
                <em>가입 승인, 회원 상태, 소속 농협과 포인트 정보를 관리합니다.</em>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={memberSubtab === "operators"}
                className={`admin-subtab${memberSubtab === "operators" ? " is-active" : ""}`}
                onClick={() => setMemberSubtab("operators")}
              >
                <span>운영자 관리</span>
                <em>운영자 계정, 권한, 비밀번호와 삭제 이력을 관리합니다.</em>
              </button>
            </div>

            {memberSubtab === "members" && (
              <div className="admin-grid admin-grid--members">
                <div className="admin-card admin-card--span-2">
                  <header className="admin-card__head">
                    <div>
                      <h2>회원 목록</h2>
                      <p>전체 {memberUsers.length.toLocaleString()}명 · 최근 가입 순</p>
                    </div>
                    <input
                      type="search"
                      className="admin-search"
                      placeholder="이름, 이메일, 농협, 직책 검색"
                      value={memberSearch}
                      onChange={(event) => setMemberSearch(event.target.value)}
                    />
                  </header>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>회원</th>
                          <th>소속 농협</th>
                          <th>직책 · 담당</th>
                          <th>상태</th>
                          <th>마케팅</th>
                          <th>가입일</th>
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
                              aria-label={`${user.name || user.email} 회원 상세 보기`}
                            >
                              <td>
                                <div className="admin-cell-user">
                                  <span className="admin-avatar" aria-hidden="true">{initial}</span>
                                  <div>
                                    <strong>{user.name || "이름 미입력"}</strong>
                                    <span>{user.email}</span>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <strong>{user.cooperativeName ?? user.manualCooperativeName ?? "미지정"}</strong>
                                <span className="admin-cell-sub">
                                  {user.cooperativeId
                                    ? `농협 코드 ${user.cooperativeId}`
                                    : "농협 코드 미지정"}
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
                                  {getMemberStatusLabel(user.status, "short")}
                                </span>
                              </td>
                              <td>
                                <span className="admin-cell-sub">
                                  {[user.consents?.email && "이메일", user.consents?.sms && "SMS", user.consents?.kakao && "카카오"]
                                    .filter(Boolean)
                                    .join(" · ") || "수신 거부"}
                                </span>
                              </td>
                              <td>{formatDate(user.createdAt)}</td>
                            </tr>
                          );
                        })}
                        {filteredMembers.length === 0 && (
                          <tr>
                            <td colSpan={6} className="admin-empty">조건에 맞는 회원이 없습니다.</td>
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
                />
              </div>
            )}

            {memberSubtab === "operators" && (
              <div className="admin-grid admin-grid--members">
                <div className="admin-card admin-card--span-2">
                  <header className="admin-card__head">
                    <div>
                      <h2>운영자 목록</h2>
                      <p>전체 {operatorUsers.length.toLocaleString()}명 · 권한 상태 관리</p>
                    </div>
                    <div className="admin-card__tools">
                      <input
                        type="search"
                        className="admin-search"
                        placeholder="이름, 이메일, 역할 검색"
                        value={operatorSearch}
                        onChange={(event) => setOperatorSearch(event.target.value)}
                      />
                      <button
                        type="button"
                        className="admin-btn admin-btn--primary"
                        onClick={() => setOperatorEditor({ mode: "create", operator: null })}
                      >
                        운영자 추가
                      </button>
                    </div>
                  </header>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>운영자</th>
                          <th>역할</th>
                          <th>권한 상태</th>
                          <th>최근 수정</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOperators.map((operator) => {
                          const initial = (operator.name ?? operator.email ?? "?").slice(0, 1).toUpperCase();
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
                              aria-label={`${operator.name || operator.email} 운영자 상세 보기`}
                            >
                              <td>
                                <div className="admin-cell-user">
                                  <span className="admin-avatar" aria-hidden="true">{initial}</span>
                                  <div>
                                    <strong>{operator.name || "이름 미입력"}</strong>
                                    <span>{operator.email}</span>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <strong>{operator.position || "운영자"}</strong>
                                <span className="admin-cell-sub">{operator.duty || "관리자"}</span>
                              </td>
                              <td>
                                <span
                                  className={`admin-pill admin-pill--${getMemberStatusTone(operator.status)}`}
                                >
                                  <span className="admin-pill__dot" aria-hidden="true" />
                                  {operator.status === "active" ? "권한 부여" : "권한 회수"}
                                </span>
                              </td>
                              <td>{formatDate(operator.updatedAt ?? operator.createdAt)}</td>
                            </tr>
                          );
                        })}
                        {filteredOperators.length === 0 && (
                          <tr>
                            <td colSpan={4} className="admin-empty">조건에 맞는 운영자가 없습니다.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <OperatorDetailPanel
                  operator={selectedOperator}
                  auditLogs={selectedOperatorAudits}
                  formatAuditLog={formatAuditLog}
                  isProtected={selectedOperatorIsProtected}
                  loading={operatorActionLoading}
                  onEdit={(operator) => setOperatorEditor({ mode: "edit", operator })}
                  onChangePermission={(operator, status) =>
                    void changeOperatorPermission(operator, status)
                  }
                  onResetPassword={(operator) => void resetOperatorPassword(operator)}
                  onDelete={(operator) => void deleteOperator(operator)}
                />
              </div>
            )}
          </>
        )}

        {tab === "inquiries" && (
          <div className="admin-subtabs" role="tablist" aria-label="문의 영역 보기">
            <button
              type="button"
              role="tab"
              aria-selected={inquirySubtab === "requests"}
              className={`admin-subtab${inquirySubtab === "requests" ? " is-active" : ""}`}
              onClick={() => setInquirySubtab("requests")}
            >
              <span>문의 관리</span>
              <em>접수된 상담을 확인하고 답변을 등록합니다.</em>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inquirySubtab === "faq"}
              className={`admin-subtab${inquirySubtab === "faq" ? " is-active" : ""}`}
              onClick={() => setInquirySubtab("faq")}
            >
              <span>FAQ 관리</span>
              <em>홈페이지에 노출되는 자주 묻는 질문을 관리합니다.</em>
            </button>
          </div>
        )}

        {tab === "inquiries" && inquirySubtab === "requests" && (
          <div className="admin-grid admin-grid--inquiries">
            <div className="admin-card admin-card--full admin-inquiries-card">
              <header className="admin-card__head admin-card__head--column">
                <div>
                  <h2>상담 · 견적 요청</h2>
                  <p>
                    전체 {requests.length.toLocaleString()}건 · 필터 적용 결과{" "}
                    {filteredRequests.length.toLocaleString()}건
                    {requestSearch.trim() && (
                      <>
                        {" "}
                        · 검색 &quot;{requestSearch.trim()}&quot;
                      </>
                    )}
                    <span className="admin-inquiry-sort-hint">
                      · 정렬: 답변 대기 우선, 접수일 오래된 순
                    </span>
                  </p>
                </div>
                <div className="admin-inquiry-filters">
                  <div className="admin-inquiry-search">
                    <label className="admin-inquiry-search__label" htmlFor="admin-inquiry-search">
                      통합 검색
                    </label>
                    <div className="admin-inquiry-search__field">
                      <input
                        id="admin-inquiry-search"
                        className="admin-input"
                        type="search"
                        placeholder="접수번호 / 문의 제목 / 작성자 / 담당자 검색"
                        value={requestSearch}
                        onChange={(event) => setRequestSearch(event.target.value)}
                        aria-label="접수번호, 문의 제목, 작성자, 담당자 통합 검색"
                        autoComplete="off"
                      />
                      {requestSearch.trim() && (
                        <button
                          type="button"
                          className="admin-inquiry-search__clear"
                          onClick={() => setRequestSearch("")}
                          aria-label="검색어 지우기"
                        >
                          지우기
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
                    <option value="">전체 농협</option>
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
                    {REQUEST_STATUS_FILTER_OPTIONS.map((option) => (
                      <option key={option.value || "all"} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    className="admin-input"
                    value={requestVisibilityFilter}
                    onChange={(event) => setRequestVisibilityFilter(event.target.value)}
                  >
                    <option value="">전체 공개범위</option>
                    <option value="PUBLIC">전체 공개</option>
                    <option value="ORG_ONLY">농협 공개</option>
                    <option value="PRIVATE">비공개</option>
                  </select>
                  </div>
                </div>
              </header>
              <div className="admin-table-wrap admin-table-wrap--inquiries">
                <table className="admin-table admin-table--inquiries">
                  <thead>
                    <tr>
                      <th>접수번호 · 제목</th>
                      <th>작성자 · 농협</th>
                      <th>공개범위</th>
                      <th>상태</th>
                      <th>담당자</th>
                      <th>사용 포인트</th>
                      <th>고객 평가</th>
                      <th>접수일</th>
                      <th>답변일</th>
                      <th aria-label="작업" />
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
                                  첨부 {request.attachments?.length ?? 0}장
                                </span>
                              )}
                              {request.isFollowUp && (
                                <span className="admin-cell-sub">↳ 추가 질문 · 원 문의 {request.parentRequestId}</span>
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
                                    외 {managers.length - 1}명
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="admin-pill admin-pill--slate">미배정</span>
                            )}
                          </td>
                          <td className="admin-inquiry-response">
                            {!answer ? (
                              <span className="admin-inquiry-response__empty">
                                -
                              </span>
                            ) : (
                              <span className="admin-inquiry-response__points">
                                {(answer.pointCost ?? 0).toLocaleString()}P
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
                                <span className="admin-cell-sub">최종 답변</span>
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
                                    aria-label={`${request.subject} 문의와 답변 상세 보기`}
                                  >
                                    답변 완료
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
                                    답변 수정
                                  </button>
                                );
                              }
                              return (
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--answer-write admin-btn--sm"
                                  onClick={() => setActiveRequestId(request.id)}
                                >
                                  답변 작성
                                </button>
                              );
                            })()}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredRequests.length === 0 && (
                      <tr>
                        <td colSpan={10} className="admin-empty">조건에 맞는 문의가 없습니다.</td>
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
                  <h2>FAQ 관리</h2>
                  <p>
                    홈페이지 자주 묻는 질문 영역에 노출되는 콘텐츠를 관리합니다.
                    전체 {faqs.length.toLocaleString()}건 · 필터 적용 결과{" "}
                    {filteredFaqs.length.toLocaleString()}건
                  </p>
                </div>
                <div className="admin-filter-row">
                  <input
                    className="admin-input admin-input--wide"
                    type="search"
                    placeholder="제목, 카테고리, 본문 검색"
                    value={faqSearch}
                    onChange={(event) => setFaqSearch(event.target.value)}
                    aria-label="FAQ 검색"
                  />
                  <select
                    className="admin-input"
                    value={faqCategoryFilter}
                    onChange={(event) => setFaqCategoryFilter(event.target.value)}
                    aria-label="FAQ 카테고리"
                  >
                    <option value="">전체 카테고리</option>
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
                    aria-label="FAQ 공개 여부"
                  >
                    <option value="">전체 공개 여부</option>
                    <option value="public">공개</option>
                    <option value="private">비공개</option>
                  </select>
                  <select
                    className="admin-input"
                    value={faqDisplayFilter}
                    onChange={(event) => setFaqDisplayFilter(event.target.value)}
                    aria-label="FAQ 노출 상태"
                  >
                    <option value="">전체 노출 상태</option>
                    <option value="published">노출 중</option>
                    <option value="draft">임시 저장</option>
                  </select>
                  <button
                    type="button"
                    className="admin-btn admin-btn--solid"
                    onClick={() =>
                      setFaqEditor({ mode: "create", faq: null })
                    }
                  >
                    + FAQ 추가
                  </button>
                </div>
              </header>
              <div className="admin-table-wrap admin-table-wrap--faq">
                <table className="admin-table admin-table--faq">
                  <thead>
                    <tr>
                      <th>제목</th>
                      <th>카테고리</th>
                      <th>공개 여부</th>
                      <th>노출 상태</th>
                      <th>최종 수정일</th>
                      <th>담당자</th>
                      <th aria-label="작업" />
                    </tr>
                  </thead>
                  <tbody>
                    {faqLoading && faqs.length === 0 && (
                      <tr>
                        <td colSpan={7} className="admin-empty">
                          FAQ를 불러오는 중입니다...
                        </td>
                      </tr>
                    )}
                    {!faqLoading && filteredFaqs.length === 0 && (
                      <tr>
                        <td colSpan={7} className="admin-empty">
                          {faqs.length === 0
                            ? "등록된 FAQ가 없습니다. 우측 상단의 “+ FAQ 추가” 버튼으로 작성해 주세요."
                            : "검색 조건에 맞는 FAQ가 없습니다."}
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
                            {faq.isPublic ? "공개" : "비공개"}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`admin-pill admin-pill--${faq.displayStatus === "published" ? "blue" : "amber"}`}
                          >
                            {faq.displayStatus === "published"
                              ? "노출 중"
                              : "임시 저장"}
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
                            수정
                          </button>
                          <button
                            type="button"
                            className="admin-btn admin-btn--danger admin-btn--sm"
                            onClick={() => void deleteFaq(faq)}
                          >
                            삭제
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

        {tab === "points" && (
          <div className="admin-grid admin-grid--points">
            <div className="admin-card admin-points-list">
              <header className="admin-card__head">
                <div>
                  <h2>농협 지갑 목록</h2>
                  <p>
                    전체 {organizations.length.toLocaleString()}개 · 검색{" "}
                    {filteredPointOrganizations.length.toLocaleString()}개 · 합계{" "}
                    {formatPoints(totalWalletBalance)}
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
                  전체 거래 내역 보기
                </button>
              </header>
              <input
                className="admin-input"
                type="search"
                placeholder="농협명 또는 조직 ID 검색"
                value={pointOrgSearch}
                onChange={(event) => setPointOrgSearch(event.target.value)}
                aria-label="농협 지갑 검색"
              />
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>농협</th>
                      <th>회원 수</th>
                      <th>잔액</th>
                      <th>최근 업데이트</th>
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
                        aria-label={`${organization.cooperativeName} 포인트 상세 보기`}
                      >
                        <td>
                          <strong>{organization.cooperativeName}</strong>
                          <span className="admin-cell-sub">
                            농협 코드 {organization.cooperativeId || organization.nh_org_id || "-"}
                          </span>
                        </td>
                        <td>{organization.users?.length ?? 0}명</td>
                        <td><strong>{formatPoints(organization.walletBalance ?? 0)}</strong></td>
                        <td>{formatDate(organization.updatedAt)}</td>
                      </tr>
                    ))}
                    {filteredPointOrganizations.length === 0 && (
                      <tr>
                        <td colSpan={4} className="admin-empty">
                          {organizations.length === 0
                            ? "등록된 농협 지갑이 없습니다."
                            : "검색 조건에 맞는 농협이 없습니다."}
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
                  <h2>선택 농협 상세</h2>
                  <p>
                    {selectedPointOrganization
                      ? `${selectedPointOrganization.cooperativeName} · 잔액 확인 · 조정 · 거래 내역`
                      : "왼쪽 목록에서 농협을 선택하세요."}
                  </p>
                </div>
              </header>
              {selectedPointOrganization ? (
                <>
                  <dl className="admin-point-summary">
                    <div>
                      <dt>현재 잔액</dt>
                      <dd>{formatPoints(selectedPointOrganization.walletBalance ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>소속 회원</dt>
                      <dd>{selectedPointOrganization.users?.length ?? 0}명</dd>
                    </div>
                    <div>
                      <dt>최근 업데이트</dt>
                      <dd>{formatDate(selectedPointOrganization.updatedAt)}</dd>
                    </div>
                  </dl>

                  <section className="admin-point-section">
                    <h3>포인트 수동 조정</h3>
                    <p className="admin-point-adjust-lede">
                      적립은 양수, 차감은 음수로 입력해 주세요.
                    </p>
                    <form className="admin-form admin-form--adjust" onSubmit={requestPointAdjustment}>
                      <label className="admin-form__full admin-coop-search">
                        <span>대상 농협</span>
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
                          placeholder="농협명 또는 조직 ID 검색"
                          autoComplete="off"
                          required
                        />
                        {showPointAdjustSuggestions && (
                          <div
                            className="admin-coop-search-results"
                            role="listbox"
                            aria-label="농협 검색 결과"
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
                                  농협 코드{" "}
                                  {organization.cooperativeId || organization.nh_org_id || "-"}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </label>

                      <div className="admin-point-balance-card">
                        <span className="admin-point-balance-card__label">현재 지갑 잔액</span>
                        <strong>
                          {formatPoints(selectedPointOrganization.walletBalance ?? 0)}
                        </strong>
                      </div>

                      <label>
                        <span>조정 포인트</span>
                        <input
                          className="admin-input admin-input--point"
                          type="text"
                          inputMode="numeric"
                          placeholder="예: 10,000 또는 -10,000"
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
                          천 단위 콤마가 자동으로 표시됩니다.
                        </small>
                      </label>
                      <label>
                        <span>사유</span>
                        <input
                          className="admin-input"
                          placeholder="조정 사유를 입력하세요"
                          value={pointAdjustmentReason}
                          onChange={(event) => setPointAdjustmentReason(event.target.value)}
                          required
                        />
                      </label>
                      <dl className="admin-point-preview admin-point-preview--after">
                        <div>
                          <dt>조정 후 예상 잔액</dt>
                          <dd
                            className={
                              pointAdjustmentBalanceAfter < 0 ? "is-danger" : undefined
                            }
                          >
                            {formatPoints(pointAdjustmentBalanceAfter)}
                          </dd>
                        </div>
                      </dl>
                      <button className="admin-btn admin-btn--primary admin-btn--block" type="submit">
                        조정 내용 확인
                      </button>
                    </form>
                  </section>

                  <section className="admin-point-section">
                    <div className="admin-point-section__head">
                      <h3>최근 거래 내역</h3>
                      <span className="admin-cell-sub">
                        {selectedPointHistory.length.toLocaleString()}건
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
                        이 농협 거래 더 보기
                      </button>
                    )}
                  </section>
                </>
              ) : (
                <div className="admin-empty">등록된 농협 지갑이 없습니다.</div>
              )}
            </div>
          </div>
        )}

        {tab === "audit" && (
          <div className="admin-grid">
            <div className="admin-card admin-card--span-2">
              <header className="admin-card__head">
                <div>
                  <h2>감사 로그</h2>
                  <p>최근 {auditLogs.length}건의 운영자 활동</p>
                </div>
              </header>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>활동명</th>
                      <th>대상</th>
                      <th>작업자</th>
                      <th>발생 시각</th>
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
                              <strong>{formatRelative(log.createdAt, referenceTime)}</strong>
                              <span className="admin-cell-sub">{formatDate(log.createdAt)}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {auditLogs.length === 0 && (
                      <tr>
                        <td colSpan={4} className="admin-empty">기록된 로그가 없습니다.</td>
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

      {operatorEditor && (
        <OperatorEditorModal
          mode={operatorEditor.mode}
          operator={operatorEditor.operator}
          loading={operatorActionLoading}
          onClose={() => {
            if (!operatorActionLoading) setOperatorEditor(null);
          }}
          onSubmit={(payload) => void submitOperatorEditor(payload)}
        />
      )}

      {faqEditor && (
        <FaqEditorModal
          mode={faqEditor.mode}
          faq={faqEditor.faq}
          loading={faqSaving}
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
    </div>
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
  const balanceAfter = draft.balanceBefore + draft.points;

  return (
    <div className="admin-modal" role="dialog" aria-modal="true" aria-label="포인트 조정 확인">
      <button
        type="button"
        className="admin-modal__backdrop"
        aria-label="닫기"
        onClick={onClose}
        disabled={loading}
      />
      <div className="admin-modal__panel admin-modal__panel--sm">
        <header className="admin-modal__head">
          <div>
            <p className="admin-modal__eyebrow">포인트 조정 확인</p>
            <h2>{draft.cooperativeName}</h2>
            <p className="admin-cell-sub">농협 코드 {draft.cooperativeId}</p>
          </div>
        </header>
        <div className="admin-modal__body">
          <p className="admin-modal__lede">
            아래 내용으로 지갑 잔액을 조정합니다. 실행 후 포인트 원장과 감사 로그에 기록됩니다.
          </p>
          <dl className="admin-point-preview admin-point-preview--modal">
            <div>
              <dt>현재 잔액</dt>
              <dd>{formatPoints(draft.balanceBefore)}</dd>
            </div>
            <div>
              <dt>조정 금액</dt>
              <dd className={draft.points >= 0 ? "is-credit" : "is-debit"}>
                {draft.points >= 0 ? "+" : ""}
                {formatPoints(draft.points)}
              </dd>
            </div>
            <div>
              <dt>조정 후 잔액</dt>
              <dd className={balanceAfter < 0 ? "is-danger" : undefined}>
                {formatPoints(balanceAfter)}
              </dd>
            </div>
          </dl>
          {balanceAfter < 0 && (
            <p className="admin-modal__warning">
              조정 후 잔액이 0 미만입니다. 금액을 다시 확인해 주세요.
            </p>
          )}
          <section className="admin-modal__quote">
            <h3>조정 사유</h3>
            <p>{draft.reason}</p>
          </section>
          <div className="admin-modal__actions">
            <button type="button" className="admin-btn admin-btn--ghost" onClick={onClose} disabled={loading}>
              취소
            </button>
            <button type="button" className="admin-btn admin-btn--primary" onClick={onConfirm} disabled={loading}>
              {loading ? "처리 중..." : "포인트 조정 실행"}
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
  if (!hasAnswer) {
    return <span className="admin-cell-sub">-</span>;
  }
  if (!rating) {
    return (
      <button
        type="button"
        className="admin-satisfaction-btn admin-satisfaction-btn--wait"
        onClick={onOpen}
        aria-label="고객 평가 대기 · 상세 보기"
      >
        <strong>평가 대기</strong>
      </button>
    );
  }

  const tone = getRatingSatisfactionTone(rating.score);
  const satisfaction = getRatingSatisfactionLabel(rating.score);

  return (
    <button
      type="button"
      className={`admin-satisfaction-btn admin-satisfaction-btn--${tone}`}
      onClick={onOpen}
      aria-label={`고객 평가 상세 보기 · 평가완료 · ${satisfaction} ${formatRatingScore(rating.score)}`}
    >
      <strong>평가완료</strong>
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
  const latestRating = ratings[0] ?? null;
  const satisfaction = latestRating
    ? getRatingSatisfactionLabel(latestRating.score)
    : null;
  const tone = latestRating ? getRatingSatisfactionTone(latestRating.score) : "slate";
  const isCompleted = String(request.status ?? "").toUpperCase() === "COMPLETED";

  return (
    <div className="admin-modal" role="dialog" aria-modal="true" aria-label="고객 평가 상세">
      <button type="button" className="admin-modal__backdrop" aria-label="닫기" onClick={onClose} />
      <div className="admin-modal__panel admin-modal__panel--sm">
        <header className="admin-modal__head">
          <div>
            <p className="admin-modal__eyebrow">고객 평가 상세</p>
            <h2>{latestRating ? "평가완료" : "평가 대기"}</h2>
            <p className="admin-cell-sub">
              {request.requestNumber} · {request.subject}
            </p>
          </div>
          <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={onClose}>
            닫기
          </button>
        </header>
        <div className="admin-modal__body">
          {latestRating ? (
            <div
              className={`admin-rating-hero admin-rating-hero--${tone}`}
            >
              <span className="admin-rating-hero__label">
                평가완료
              </span>
              <strong className="admin-rating-hero__score">
                {formatRatingScore(latestRating.score)}
              </strong>
              <p className="admin-rating-hero__meta">
                {customerName} · {formatDate(latestRating.updatedAt ?? latestRating.createdAt)}
              </p>
            </div>
          ) : (
            <p className="admin-rating-empty">아직 고객 평가가 등록되지 않았습니다.</p>
          )}

          <dl className="admin-rating-detail">
            <div>
              <dt>만족도</dt>
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
              <dt>상담 종료</dt>
              <dd>{isCompleted ? "완료 (평가 후 종료)" : "진행 중"}</dd>
            </div>
            <div>
              <dt>도움 여부</dt>
              <dd>
                {latestRating
                  ? latestRating.helpful === false
                    ? "도움 안 됨"
                    : latestRating.helpful === true
                      ? "도움 됨"
                      : "미응답"
                  : "-"}
              </dd>
            </div>
            <div>
              <dt>사용 포인트</dt>
              <dd>{answer ? formatPoints(answer.pointCost ?? 0) : "-"}</dd>
            </div>
          </dl>

          <section className="admin-modal__quote admin-modal__quote--emphasis">
            <h3>추가 의견</h3>
            <p>{latestRating?.comment?.trim() || "등록된 추가 의견이 없습니다."}</p>
          </section>

          <section className="admin-modal__quote">
            <h3>답변 요약</h3>
            <p>{answer?.body?.trim() || "등록된 답변이 없습니다."}</p>
          </section>
        </div>
      </div>
    </div>
  );
}

type MemberActionType = "approve" | "reject" | "deactivate" | "reactivate";

const MEMBER_ACTION_COPY: Record<
  MemberActionType,
  {
    title: string;
    intro: string;
    confirmLabel: string;
    confirmTone: "primary" | "danger";
    askReason: boolean;
    reasonLabel?: string;
    reasonPlaceholder?: string;
    reasonRequired?: boolean;
    warn?: boolean;
  }
> = {
  approve: {
    title: "가입 승인",
    intro: "이 회원의 가입을 승인하면 로그인 및 문의 작성이 가능해지고 가입 혜택 포인트가 지급됩니다.",
    confirmLabel: "가입 승인",
    confirmTone: "primary",
    askReason: false,
  },
  reject: {
    title: "가입 거절",
    intro: "이 회원의 가입을 거절하면 회원 상태가 비활성으로 전환됩니다. 변경 즉시 서비스 이용이 제한됩니다.",
    confirmLabel: "가입 거절",
    confirmTone: "danger",
    askReason: true,
    reasonLabel: "거절 사유 (선택)",
    reasonPlaceholder: "예) 소속 농협 정보 확인 불가",
    warn: true,
  },
  deactivate: {
    title: "회원 비활성화",
    intro:
      "이 회원을 비활성으로 전환하면 즉시 로그인·문의 작성·마이페이지 이용이 제한됩니다. 실수로 처리하지 않도록 내용을 확인한 뒤 진행해 주세요.",
    confirmLabel: "비활성으로 전환",
    confirmTone: "danger",
    askReason: true,
    reasonLabel: "비활성 사유 (선택)",
    reasonPlaceholder: "예) 퇴사 처리, 오등록 계정 정리",
    warn: true,
  },
  reactivate: {
    title: "회원 재활성화",
    intro:
      "비활성 상태를 해제하고 활성 회원으로 되돌립니다. 재활성화 후 다시 로그인하여 서비스를 이용할 수 있습니다.",
    confirmLabel: "재활성화",
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
  const copy = MEMBER_ACTION_COPY[action.type];
  return (
    <div
      className="admin-modal"
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
    >
      <button
        type="button"
        className="admin-modal__backdrop"
        aria-label="닫기"
        onClick={onClose}
        disabled={loading}
      />
      <div className="admin-modal__panel admin-modal__panel--sm">
        <header className="admin-modal__head">
          <div>
            <p className="admin-modal__eyebrow">회원 상태 변경</p>
            <h2>{copy.title}</h2>
          </div>
        </header>
        <div className="admin-modal__body">
          <section className="admin-modal__quote">
            <h3>대상 회원</h3>
            <p>
              <strong>{action.name}</strong>
              {action.email && (
                <span className="admin-cell-sub"> · {action.email}</span>
              )}
            </p>
          </section>
          <p className="admin-modal__lede">{copy.intro}</p>
          {copy.warn && (
            <p className="admin-modal__warning" role="alert">
              계정 접근이 즉시 제한됩니다. 변경 내역은 감사 로그에 기록됩니다.
            </p>
          )}
          {copy.askReason && (
            <label className="admin-modal__field">
              <span>{copy.reasonLabel ?? "사유"}</span>
              <textarea
                className="admin-input admin-input--area"
                rows={3}
                value={reason}
                onChange={(event) => onChangeReason(event.target.value)}
                placeholder={copy.reasonPlaceholder}
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
              취소
            </button>
            <button
              type="button"
              className={`admin-btn admin-btn--${copy.confirmTone}`}
              onClick={onConfirm}
              disabled={loading}
            >
              {loading ? "처리 중..." : copy.confirmLabel}
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
          최근 7일 {delta.recent.toLocaleString()} · 이전 {delta.previous.toLocaleString()}
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
    return <span className="admin-business-card__empty">첨부 없음</span>;
  }

  if (state === "loading" || state === "idle") {
    return <span className="admin-business-card__loading">명함 불러오는 중...</span>;
  }

  if (state === "error" || !viewUrl) {
    return <span className="admin-business-card__empty">명함을 불러오지 못했습니다.</span>;
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
          <img src={viewUrl} alt={`${user.name || user.email} 명함`} />
        </a>
      ) : (
        <div className="admin-business-card__file">
          <span>PDF 명함 파일</span>
        </div>
      )}
      <a className="admin-link" href={viewUrl} target="_blank" rel="noreferrer">
        {isImage ? "원본 보기" : "PDF 열기"}
      </a>
    </div>
  );
}

function OperatorDetailPanel({
  operator,
  auditLogs,
  formatAuditLog,
  isProtected,
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
  loading: boolean;
  onEdit: (operator: UserRecord) => void;
  onChangePermission: (operator: UserRecord, status: UserRecord["status"]) => void;
  onResetPassword: (operator: UserRecord) => void;
  onDelete: (operator: UserRecord) => void;
}) {
  if (!operator) {
    return (
      <aside className="admin-card admin-member-detail">
        <header className="admin-card__head">
          <div>
            <h2>운영자 상세</h2>
            <p>왼쪽 목록에서 운영자를 선택하세요.</p>
          </div>
        </header>
        <div className="admin-empty">선택된 운영자가 없습니다.</div>
      </aside>
    );
  }

  const isActive = operator.status === "active";

  return (
    <aside className="admin-card admin-member-detail">
      <header className="admin-member-detail__hero">
        <span className="admin-member-detail__avatar" aria-hidden="true">
          {(operator.name || operator.email || "?").slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h2>{operator.name || "이름 미입력"}</h2>
          <p>{operator.email}</p>
        </div>
        <span
          className={`admin-pill admin-pill--${getMemberStatusTone(operator.status)}`}
        >
          <span className="admin-pill__dot" aria-hidden="true" />
          {isActive ? "권한 부여" : "권한 회수"}
        </span>
      </header>

      <section className="admin-member-block">
        <h3>운영자 계정 정보</h3>
        <dl className="admin-detail-list">
          <div>
            <dt>이름</dt>
            <dd>{operator.name || "-"}</dd>
          </div>
          <div>
            <dt>이메일</dt>
            <dd>{operator.email}</dd>
          </div>
          <div>
            <dt>역할</dt>
            <dd>{operator.position || "운영자"}</dd>
          </div>
          <div>
            <dt>권한 그룹</dt>
            <dd>{operator.duty || "관리자"}</dd>
          </div>
          <div>
            <dt>생성일</dt>
            <dd>{formatDate(operator.createdAt)}</dd>
          </div>
          <div>
            <dt>수정일</dt>
            <dd>{formatDate(operator.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="admin-member-block">
        <h3>운영자 계정 작업</h3>
        <p className="admin-cell-sub">
          계정 정보, 권한, 비밀번호, 삭제 작업은 감사 로그에 기록됩니다.
          {isProtected ? " 현재 계정 또는 기본 관리자 계정은 권한 회수와 삭제가 제한됩니다." : ""}
        </p>
        <div className="admin-operator-actions">
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            onClick={() => onEdit(operator)}
            disabled={loading}
          >
            정보 수정
          </button>
          <button
            type="button"
            className="admin-btn"
            onClick={() => onResetPassword(operator)}
            disabled={loading}
          >
            비밀번호 재설정
          </button>
          <button
            type="button"
            className={isActive ? "admin-btn admin-btn--danger" : "admin-btn"}
            onClick={() => onChangePermission(operator, isActive ? "rejected" : "active")}
            disabled={loading || (isActive && isProtected)}
          >
            {isActive ? "권한 회수" : "권한 부여"}
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--danger"
            onClick={() => onDelete(operator)}
            disabled={loading || isProtected}
          >
            계정 삭제
          </button>
        </div>
      </section>

      <section className="admin-member-block">
        <h3>관련 운영 이력</h3>
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
            <li className="admin-empty">관련 이력이 없습니다.</li>
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
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  operator: UserRecord | null;
  loading: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    name: string;
    email: string;
    password?: string;
    position: string;
    duty: string;
    status: UserRecord["status"];
  }) => void;
}) {
  const [name, setName] = useState(operator?.name ?? "");
  const [email, setEmail] = useState(operator?.email ?? "");
  const [position, setPosition] = useState(operator?.position || "운영자");
  const [duty, setDuty] = useState(operator?.duty || "관리자");
  const [status, setStatus] = useState<UserRecord["status"]>(
    operator?.status === "rejected" ? "rejected" : "active",
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const isCreate = mode === "create";

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();
    if (!trimmedName || !trimmedEmail) {
      setError("이름과 이메일을 입력해 주세요.");
      return;
    }
    if (isCreate && trimmedPassword.length < 8) {
      setError("새 운영자의 임시 비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (!isCreate && trimmedPassword && trimmedPassword.length < 8) {
      setError("비밀번호를 변경하려면 8자 이상 입력해 주세요.");
      return;
    }
    setError("");
    onSubmit({
      name: trimmedName,
      email: trimmedEmail,
      password: trimmedPassword || undefined,
      position: position.trim() || "운영자",
      duty: duty.trim() || "관리자",
      status,
    });
  };

  return (
    <div className="admin-modal" role="dialog" aria-modal="true" aria-label="운영자 계정 편집">
      <button
        type="button"
        className="admin-modal__backdrop"
        aria-label="닫기"
        onClick={onClose}
        disabled={loading}
      />
      <form className="admin-modal__panel admin-modal__panel--sm" onSubmit={submit}>
        <header className="admin-modal__head">
          <div>
            <p className="admin-modal__eyebrow">운영자 관리</p>
            <h2>{isCreate ? "운영자 추가" : "운영자 정보 수정"}</h2>
          </div>
          <button
            type="button"
            className="admin-modal__close"
            aria-label="닫기"
            onClick={onClose}
            disabled={loading}
          >
            ×
          </button>
        </header>
        <div className="admin-modal__body">
          <label className="admin-modal__field">
            이름
            <input
              className="auth-field__input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={loading}
            />
          </label>
          <label className="admin-modal__field">
            이메일
            <input
              className="auth-field__input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={loading}
            />
          </label>
          <label className="admin-modal__field">
            역할
            <input
              className="auth-field__input"
              value={position}
              onChange={(event) => setPosition(event.target.value)}
              disabled={loading}
            />
          </label>
          <label className="admin-modal__field">
            권한 그룹
            <input
              className="auth-field__input"
              value={duty}
              onChange={(event) => setDuty(event.target.value)}
              disabled={loading}
            />
          </label>
          <label className="admin-modal__field">
            권한 상태
            <select
              className="auth-field__input"
              value={status}
              onChange={(event) => setStatus(event.target.value as UserRecord["status"])}
              disabled={loading}
            >
              <option value="active">권한 부여</option>
              <option value="rejected">권한 회수</option>
            </select>
          </label>
          <label className="admin-modal__field">
            {isCreate ? "임시 비밀번호" : "새 비밀번호"}
            <input
              className="auth-field__input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={isCreate ? "8자 이상 입력" : "변경 시에만 입력"}
              disabled={loading}
            />
          </label>
          {error && <p className="admin-form__error">{error}</p>}
          <div className="admin-modal__actions">
            <button type="button" className="admin-btn" onClick={onClose} disabled={loading}>
              취소
            </button>
            <button type="submit" className="admin-btn admin-btn--primary" disabled={loading}>
              {loading ? "저장 중..." : "저장"}
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
}) {
  if (!user) {
    return (
      <aside className="admin-card admin-member-detail">
        <header className="admin-card__head">
          <div>
            <h2>회원 상세</h2>
            <p>왼쪽 목록에서 회원을 선택하세요.</p>
          </div>
        </header>
        <div className="admin-empty">선택된 회원이 없습니다.</div>
      </aside>
    );
  }

  const marketingChannels = [
    user.consents?.marketing && "마케팅",
    user.consents?.email && "이메일",
    user.consents?.sms && "SMS",
    user.consents?.kakao && "카카오톡",
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
          <h2>{user.name || "이름 미입력"}</h2>
          <p>{user.email}</p>
        </div>
        <span
          className={`admin-pill admin-pill--${getMemberStatusTone(user.status)}`}
        >
          <span className="admin-pill__dot" aria-hidden="true" />
          {getMemberStatusLabel(user.status)}
        </span>
      </header>

      {isPendingMember(user.status) && (
        <section className="admin-member-block">
          <h3>가입 처리</h3>
          <p className="admin-cell-sub">
            소속 농협과 가입 정보를 확인한 뒤 승인하면 로그인 및 문의 작성이
            가능해지고 가입 혜택 포인트가 지급됩니다. 정보가 부적절한 경우
            가입을 거절하면 회원이 비활성 상태로 전환됩니다.
          </p>
          <div className="admin-approval-file">
            <div className="admin-approval-file__head">
              <strong>가입 승인 명함</strong>
              <span>회원가입 시 업로드한 직원 인증 파일입니다.</span>
            </div>
            <MemberBusinessCardPreview user={user} />
          </div>
          <div className="admin-member-actions">
            <button
              type="button"
              className="admin-btn admin-btn--primary admin-btn--block"
              onClick={() => onAction(user.uid, "approve")}
            >
              가입 승인하기
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--danger admin-btn--block"
              onClick={() => onAction(user.uid, "reject")}
            >
              가입 거절
            </button>
          </div>
        </section>
      )}

      {isActiveMember(user.status) && (
        <section className="admin-member-block admin-member-block--danger">
          <h3>회원 상태 관리</h3>
          <p className="admin-cell-sub">
            퇴사·문제 계정·오등록 등 즉시 접근을 차단해야 하는 경우 회원을
            비활성으로 전환할 수 있습니다. 처리 전 확인 모달이 표시됩니다.
          </p>
          <button
            type="button"
            className="admin-btn admin-btn--danger admin-btn--block"
            onClick={() => onAction(user.uid, "deactivate")}
          >
            회원 비활성화
          </button>
        </section>
      )}

      {isInactiveMember(user.status) && (
        <section className="admin-member-block admin-member-block--muted">
          <h3>비활성 회원</h3>
          <p className="admin-cell-sub">
            관리자가 비활성으로 전환한 회원입니다.
            {user.rejectionReason
              ? ` 사유: ${user.rejectionReason}`
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
            회원 재활성화
          </button>
        </section>
      )}

      <section className="admin-member-block">
        <h3>회원 기본 정보</h3>
        <dl className="admin-detail-list">
          <div>
            <dt>이름</dt>
            <dd>{user.name || "-"}</dd>
          </div>
          <div>
            <dt>이메일</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>휴대폰</dt>
            <dd>{user.phone || "-"}</dd>
          </div>
          <div>
            <dt>직책</dt>
            <dd>{user.position || "-"}</dd>
          </div>
          <div>
            <dt>담당업무</dt>
            <dd>{user.duty || "-"}</dd>
          </div>
          <div>
            <dt>가입일</dt>
            <dd>{formatDate(user.createdAt)}</dd>
          </div>
          <div>
            <dt>수정일</dt>
            <dd>{formatDate(user.updatedAt)}</dd>
          </div>
          {!isPendingMember(user.status) && (
            <div>
              <dt>명함</dt>
              <dd>
                <MemberBusinessCardPreview user={user} />
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className="admin-member-block">
        <h3>소속 농협 정보</h3>
        <dl className="admin-detail-list">
          <div>
            <dt>농협명</dt>
            <dd>
              {user.cooperativeName ??
                user.manualCooperativeName ??
                "-"}
            </dd>
          </div>
          <div>
            <dt>농협 코드</dt>
            <dd>{user.cooperativeId || "-"}</dd>
          </div>
          <div>
            <dt>조직 코드</dt>
            <dd>{user.nh_org_id || user.cooperativeId || "-"}</dd>
          </div>
          <div>
            <dt>조직 회원 수</dt>
            <dd>{organization?.users?.length ?? 0}명</dd>
          </div>
          <div>
            <dt>조직 등록일</dt>
            <dd>{organization ? formatDate(organization.createdAt) : "-"}</dd>
          </div>
        </dl>
      </section>

      <section className="admin-member-block">
        <h3>포인트/지갑 정보</h3>
        <dl className="admin-detail-list">
          <div>
            <dt>지갑 잔액</dt>
            <dd>
              {organization
                ? formatPoints(organization.walletBalance ?? 0)
                : "-"}
            </dd>
          </div>
          <div>
            <dt>가입 지급 포인트</dt>
            <dd>{formatPoints(totalSignupPoints)}</dd>
          </div>
          <div>
            <dt>최근 거래</dt>
            <dd>
              {transactions[0]
                ? `${LEDGER_LABELS[transactions[0].type] ?? transactions[0].type} · ${formatDate(transactions[0].createdAt)}`
                : ledger[0]
                  ? `${LEDGER_LABELS[ledger[0].event] ?? ledger[0].event} · ${formatDate(ledger[0].createdAt)}`
                  : "내역 없음"}
            </dd>
          </div>
        </dl>
        <h4 className="admin-member-block__subhead">최근 포인트 내역</h4>
        <ul className="admin-mini-feed">
          {transactions.slice(0, 5).map((entry) => (
            <li key={entry.id}>
              <strong>{LEDGER_LABELS[entry.type] ?? entry.type}</strong>
              <span>
                {entry.amount >= 0 ? "+" : ""}
                {formatPoints(entry.amount)} · {formatDate(entry.createdAt)}
              </span>
            </li>
          ))}
          {transactions.length === 0 &&
            ledger.slice(0, 5).map((entry) => (
              <li key={entry.id}>
                <strong>{LEDGER_LABELS[entry.event] ?? entry.event}</strong>
                <span>
                  {entry.points >= 0 ? "+" : ""}
                  {formatPoints(entry.points)} · {formatDate(entry.createdAt)}
                </span>
              </li>
            ))}
          {transactions.length === 0 && ledger.length === 0 && (
            <li className="admin-empty">포인트 내역이 없습니다.</li>
          )}
        </ul>
      </section>

      <section className="admin-member-block">
        <h3>동의 및 마케팅 수신 상태</h3>
        <div className="admin-consent-grid">
          <span className={user.consents?.terms ? "is-on" : ""}>이용약관</span>
          <span className={user.consents?.privacy ? "is-on" : ""}>개인정보</span>
          <span className={user.consents?.marketing ? "is-on" : ""}>마케팅</span>
          <span className={user.consents?.email ? "is-on" : ""}>이메일</span>
          <span className={user.consents?.sms ? "is-on" : ""}>SMS</span>
          <span className={user.consents?.kakao ? "is-on" : ""}>카카오톡</span>
        </div>
        <p className="admin-cell-sub">
          수신 채널: {marketingChannels.join(" · ") || "수신 거부"}
        </p>
      </section>

      <section className="admin-member-block">
        <h3>관련 운영 이력</h3>
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
  const colSpan = showTarget ? 6 : 5;

  return (
    <div className={`admin-table-wrap${className ? ` ${className}` : ""}`}>
      <table className="admin-table">
        <thead>
          <tr>
            <th>발생 시각</th>
            {showTarget && <th>대상 농협</th>}
            <th>이벤트</th>
            <th>변화</th>
            <th>잔액</th>
            <th>사유</th>
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
                <strong>{LEDGER_LABELS[entry.eventKey] ?? entry.eventKey}</strong>
              </td>
              <td>
                <span
                  className={`admin-amount ${entry.points >= 0 ? "is-credit" : "is-debit"}`}
                >
                  {entry.points >= 0 ? "+" : ""}
                  {formatPoints(entry.points)}
                </span>
              </td>
              <td>{formatPoints(entry.balanceAfter)}</td>
              <td className="admin-cell-sub">{entry.reason ?? ""}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="admin-empty">
                거래 내역이 없습니다.
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
      aria-label="전체 포인트 거래 내역"
    >
      <button
        type="button"
        className="admin-modal__backdrop"
        aria-label="닫기"
        onClick={onClose}
      />
      <div className="admin-modal__panel admin-modal__panel--wide">
        <header className="admin-modal__head">
          <div>
            <p className="admin-modal__eyebrow">포인트 거래 로그</p>
            <h2>전체 거래 내역</h2>
            <p className="admin-cell-sub">
              전체 {rows.length.toLocaleString()}건 · 표시{" "}
              {filteredRows.length.toLocaleString()}건
            </p>
          </div>
          <button
            type="button"
            className="admin-btn admin-btn--ghost admin-btn--sm"
            onClick={onClose}
          >
            닫기
          </button>
        </header>
        <div className="admin-modal__body">
          <div className="admin-filter-row">
            <select
              className="admin-input"
              value={filterOrgId}
              onChange={(event) => setFilterOrgId(event.target.value)}
              aria-label="농협별 거래 필터"
            >
              <option value="">전체 농협</option>
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
  const pointRangeText = `${formatPointInput(ANSWER_POINT_MIN)}P 이상 ${formatPointInput(ANSWER_POINT_MAX)}P 이하`;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    if (!isValidAnswerPointCost(pointCostValue)) {
      event.preventDefault();
      setPointCostError(`답변 포인트는 ${pointRangeText}로 입력해 주세요.`);
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
      aria-label={readOnly ? "문의 및 답변 상세" : isEdit ? "답변 수정" : "답변 작성"}
    >
      <button type="button" className="admin-modal__backdrop" aria-label="닫기" onClick={onClose} />
      <div className="admin-modal__panel">
        <header className="admin-modal__head">
          <div>
            <span className="admin-cell-sub">{request.requestNumber} · {VISIBILITY_LABELS[request.visibility] ?? request.visibility}</span>
            <h2>{readOnly ? "문의 · 답변 상세" : request.subject}</h2>
            <p className="admin-cell-sub">
              {readOnly ? `${request.subject} · ` : ""}작성자 {request.userName || request.userEmail} · {request.cooperativeName ?? request.cooperativeDisplay ?? "-"}
            </p>
          </div>
          <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={onClose}>
            닫기
          </button>
        </header>
        <div className="admin-modal__body">
          <section className="admin-modal__quote">
            <h3>고객 문의</h3>
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
                  <dt>지원 분야</dt>
                  <dd>{request.internalCategory ?? request.internal_category ?? "-"}</dd>
                </div>
                <div>
                  <dt>담당자</dt>
                  <dd>{assignedManagers(request).join(", ") || "-"}</dd>
                </div>
                <div>
                  <dt>사용 포인트</dt>
                  <dd>{answer ? formatPoints(answer.pointCost ?? 0) : "-"}</dd>
                </div>
                <div>
                  <dt>답변일</dt>
                  <dd>{formatDate(getAnswerRespondedAt(answer ?? undefined, request) ?? undefined)}</dd>
                </div>
              </dl>
              <section className="admin-modal__quote admin-modal__quote--emphasis">
                <h3>답변 내용</h3>
                <p>{answer?.body?.trim() || "등록된 답변이 없습니다."}</p>
              </section>
            </>
          )}

          {!readOnly && (
            <>
          <div
            className={`admin-answer-type-banner${autoAssigned ? " is-auto" : ""}`}
          >
            <span className="admin-answer-type-banner__label">고객 문의 유형</span>
            <strong>{customerInquiryType}</strong>
            <p>
              {autoAssigned
                ? "자동 배정 문의입니다. 답변 등록 시 실제 지원 분야를 선택해 주세요."
                : "고객이 선택한 유형입니다. 필요 시 아래에서 지원 분야를 조정할 수 있습니다."}
            </p>
          </div>

          <form className="admin-form admin-form--grid" onSubmit={submit}>
            <label className="admin-form__full">
              <span>지원 분야 배정</span>
              <select
                className="admin-input"
                name="internalCategory"
                defaultValue={defaultSupportField || legacyField || ""}
                required
              >
                <option value="" disabled>
                  {autoAssigned ? "지원 분야를 선택해 주세요" : "지원 분야 선택"}
                </option>
                {legacyField && (
                  <option value={legacyField}>{legacyField} (기존 지정)</option>
                )}
                {INQUIRY_SUPPORT_FIELD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.label}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small className="admin-form__hint">
                실제 상담·견적 처리 분야를 지정합니다. 담당자 정보와 별도로 관리됩니다.
              </small>
            </label>
            <label className="admin-form__full">
              <span>담당자</span>
              <input
                className="admin-input"
                name="adminTags"
                placeholder="답변 담당자명을 입력하세요"
                defaultValue={assignedManagers(request).join(", ")}
                required
                aria-required="true"
              />
              <small className="admin-form__hint">
                이력 추적을 위해 필수입니다. 복수 담당자는 쉼표(,)로 구분해 입력해 주세요.
              </small>
            </label>
            <label>
              <span>답변 포인트 ({formatAnswerPointRangeLabel()}P)</span>
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
                {pointRangeText}로 입력해 주세요. 숫자 입력 시 천 단위마다 자동으로 콤마가 표시됩니다.
              </small>
            </label>
            <label className="admin-form__full">
              <span>답변 내용</span>
              <textarea
                className="admin-input admin-input--area"
                name="answerBody"
                rows={8}
                placeholder="고객에게 제공할 답변을 입력하세요."
                defaultValue={answer?.body ?? ""}
              />
            </label>
            <div className="admin-modal__actions">
              <button type="button" className="admin-btn admin-btn--ghost" onClick={onClose}>
                취소
              </button>
              <button
                type="submit"
                className={`admin-btn admin-btn--${isEdit ? "answer-edit" : "answer-write"}`}
              >
                {isEdit ? "답변 업데이트" : "답변 등록"}
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

function FaqEditorModal({
  mode,
  faq,
  loading,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  faq: FaqRecord | null;
  loading: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    question: string;
    answer: string;
    category: string;
    isPublic: boolean;
    displayStatus: "published" | "draft";
  }) => void;
}) {
  const [question, setQuestion] = useState(faq?.question ?? "");
  const [answer, setAnswer] = useState(faq?.answer ?? "");
  const [category, setCategory] = useState(
    faq?.category ?? FAQ_CATEGORY_OPTIONS[0]
  );
  const [isPublic, setIsPublic] = useState(faq?.isPublic ?? true);
  const [displayStatus, setDisplayStatus] = useState<"published" | "draft">(
    faq?.displayStatus ?? "published"
  );
  const [validation, setValidation] = useState("");

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!question.trim() || !answer.trim()) {
      setValidation("제목과 본문을 모두 입력해 주세요.");
      return;
    }
    setValidation("");
    onSubmit({
      question: question.trim(),
      answer: answer.trim(),
      category: category.trim() || "일반",
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
              {mode === "create" ? "FAQ 등록" : "FAQ 수정"}
            </span>
            <h2 className="admin-modal__title">자주 묻는 질문 콘텐츠 관리</h2>
            <p className="admin-modal__lede">
              홈페이지 FAQ 영역에 노출되는 내용을 작성합니다. 노출 상태를
              임시 저장으로 두면 고객 화면에는 표시되지 않습니다.
            </p>
          </div>
          <button
            type="button"
            className="admin-modal__close"
            onClick={onClose}
            aria-label="닫기"
          >
            ×
          </button>
        </header>
        <div className="admin-modal__body">
          <form className="admin-form admin-form--grid" onSubmit={handleSubmit}>
            <label className="admin-form__full">
              <span>제목</span>
              <input
                className="admin-input"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                maxLength={200}
                placeholder="예) 회원가입할 때 농협은 어떻게 선택하나요?"
              />
            </label>
            <label>
              <span>카테고리</span>
              <select
                className="admin-input"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                {FAQ_CATEGORY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>공개 여부</span>
              <select
                className="admin-input"
                value={isPublic ? "public" : "private"}
                onChange={(event) =>
                  setIsPublic(event.target.value === "public")
                }
              >
                <option value="public">공개</option>
                <option value="private">비공개</option>
              </select>
            </label>
            <label>
              <span>노출 상태</span>
              <select
                className="admin-input"
                value={displayStatus}
                onChange={(event) =>
                  setDisplayStatus(
                    event.target.value === "published" ? "published" : "draft"
                  )
                }
              >
                <option value="published">노출 중</option>
                <option value="draft">임시 저장</option>
              </select>
            </label>
            <label className="admin-form__full">
              <span>본문</span>
              <textarea
                className="admin-input admin-input--area"
                rows={8}
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                maxLength={5000}
                placeholder="고객에게 보여줄 답변 본문을 입력하세요."
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
                취소
              </button>
              <button
                type="submit"
                className="admin-btn admin-btn--primary"
                disabled={loading}
              >
                {loading
                  ? "저장 중..."
                  : mode === "create"
                    ? "FAQ 등록"
                    : "변경 저장"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
