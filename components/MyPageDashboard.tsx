"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { logoutPortalSession } from "@/lib/auth/login-client";
import { getFirebaseAuth } from "@/lib/firebase/client";
import {
  getRequestStatusTone,
  resolveRequestStatus,
  type ResolvedRequestStatus,
} from "@/lib/request-status";
import type {
  AnswerRatingRecord,
  AnswerRecord,
  AnswerViewRecord,
  ConsultRequestRecord,
  OrganizationRecord,
  PointLedgerRecord,
  UserRecord,
} from "@/lib/firebase/schema";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";
import { getCmsSection } from "@/lib/cms/runtime";

type State = "loading" | "ready" | "error";

type TabKey = "overview" | "inquiries" | "points" | "profile";

const TAB_KEYS: TabKey[] = ["overview", "inquiries", "points", "profile"];

function normalizeTab(value?: string | string[]) {
  const tabValue = Array.isArray(value) ? value[0] : value;
  return TAB_KEYS.includes(tabValue as TabKey)
    ? (tabValue as TabKey)
    : "overview";
}

type Overview = {
  user: UserRecord;
  organization: OrganizationRecord | null;
  requests: ConsultRequestRecord[];
  answers: AnswerRecord[];
  views: AnswerViewRecord[];
  ratings: AnswerRatingRecord[];
  ledger: PointLedgerRecord[];
  profileIncomplete: boolean;
};

const PREVIEW_USER_ID = "cms-preview-member";
const MY_PAGE_PREVIEW_OVERVIEW = {
  user: {
    uid: PREVIEW_USER_ID,
    name: "김농협",
    email: "member@nonghyup.com",
    phone: "010-1234-5678",
    cooperativeName: "샘플농협",
    cooperativeId: "preview-cooperative",
    position: "과장",
    duty: "회계",
    status: "active",
    role: "member",
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-21T09:00:00.000Z",
    consents: {
      terms: true,
      privacy: true,
      marketing: true,
      email: true,
      sms: false,
      kakao: false,
    },
  },
  organization: {
    id: "preview-cooperative",
    cooperativeName: "샘플농협",
    walletBalance: 120000,
    users: [PREVIEW_USER_ID],
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-21T09:00:00.000Z",
  },
  requests: [
    {
      id: "preview-request",
      uid: PREVIEW_USER_ID,
      requestNumber: "REQ-20260721-1001",
      subject: "회계 업무 처리 기준 문의",
      message: "관리자 미리보기용 문의 내용입니다.",
      visibility: "ORG_ONLY",
      status: "ANSWERED",
      createdAt: "2026-07-20T09:00:00.000Z",
    },
  ],
  answers: [
    {
      id: "preview-answer",
      requestId: "preview-request",
      body: "관리자 미리보기용 답변입니다.",
      pointCost: 30000,
      createdAt: "2026-07-21T09:00:00.000Z",
    },
  ],
  views: [],
  ratings: [],
  ledger: [
    {
      id: "preview-ledger",
      event: "first_org_signup",
      reason: "가입 보너스",
      points: 100000,
      balanceAfter: 100000,
      createdAt: "2026-07-01T09:00:00.000Z",
    },
  ],
  profileIncomplete: false,
} as unknown as Overview;

type EditableConsentKey = "marketing" | "email" | "sms" | "kakao";

function formatDate(value: string | undefined, missingValue: string) {
  if (!value) return missingValue;
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
  messages: CmsPageContent["messages"],
  missingValue: string,
) {
  if (!value) return missingValue;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (!reference) {
    return new Intl.DateTimeFormat("ko-KR", {
      month: "short",
      day: "numeric",
    }).format(date);
  }
  const diff = reference - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return messages.relativeNow;
  if (minutes < 60) {
    return messages.relativeMinutes.replace("{count}", String(minutes));
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return messages.relativeHours.replace("{count}", String(hours));
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return messages.relativeDays.replace("{count}", String(days));
  }
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function preventPreviewLinkNavigation(event: ReactMouseEvent<HTMLElement>) {
  if ((event.target as HTMLElement).closest("a")) {
    event.preventDefault();
  }
}

function StatusPill({
  value,
  section,
}: {
  value: ResolvedRequestStatus;
  section: CmsSection;
}) {
  const labels: Record<ResolvedRequestStatus, string> = {
    SUBMITTED: section.text.statusSubmitted,
    ANSWERED: section.text.statusAnswered,
    ANSWER_PUBLISHED: section.text.statusPublished,
    FOLLOWUP: section.text.statusFollowup,
    COMPLETED: section.text.statusCompleted,
  };
  return (
    <span className={`admin-pill admin-pill--${getRequestStatusTone(value)}`}>
      <span className="admin-pill__dot" aria-hidden="true" />
      {labels[value]}
    </span>
  );
}

function VisibilityChip({
  value,
  section,
}: {
  value?: string;
  section: CmsSection;
}) {
  const labels: Record<string, string> = {
    PUBLIC: section.text.visibilityPublic,
    public: section.text.visibilityPublic,
    ORG_ONLY: section.text.visibilityOrganization,
    nonghyup: section.text.visibilityOrganization,
    PRIVATE: section.text.visibilityPrivate,
    private: section.text.visibilityPrivate,
  };
  const label = labels[value ?? ""] ?? section.text.unknownValue;
  return <span className="admin-chip">{label}</span>;
}

export function MyPageDashboard({
  content,
  initialTab,
  membershipConverted = false,
  previewMode = false,
}: {
  content: CmsPageContent;
  initialTab?: string | string[];
  membershipConverted?: boolean;
  previewMode?: boolean;
}) {
  const router = useRouter();
  const navigationCopy = getCmsSection(
    content,
    "member.mypage",
    "navigation",
  );
  const overviewCopy = getCmsSection(content, "member.mypage", "overview");
  const inquiriesCopy = getCmsSection(content, "member.mypage", "inquiries");
  const pointsCopy = getCmsSection(content, "member.mypage", "points");
  const profileCopy = getCmsSection(content, "member.mypage", "profile");
  const messages = content.messages;
  const tabs = navigationCopy.items.flatMap((item) =>
    TAB_KEYS.includes(item.id as TabKey) && item.visible && !item.deleted
      ? [
          {
            key: item.id as TabKey,
            label: item.title,
            description: item.description ?? "",
          },
        ]
      : [],
  );
  const ledgerLabels: Record<string, string> = {
    first_org_signup: overviewCopy.text.ledgerFirstSignup,
    user_signup: overviewCopy.text.ledgerUserSignup,
    answer_view: overviewCopy.text.ledgerAnswerView,
    manual_adjustment: overviewCopy.text.ledgerManual,
    admin_adjustment_credit: overviewCopy.text.ledgerAdminCredit,
    admin_adjustment_debit: overviewCopy.text.ledgerAdminDebit,
  };
  const [state, setState] = useState<State>(previewMode ? "ready" : "loading");
  const [currentUser, setCurrentUser] = useState<User | null>(
    previewMode ? ({ uid: PREVIEW_USER_ID } as User) : null,
  );
  const [overview, setOverview] = useState<Overview | null>(
    previewMode ? MY_PAGE_PREVIEW_OVERVIEW : null,
  );
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>(() => normalizeTab(initialTab));
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    previewMode ? new Date("2026-07-21T09:00:00.000Z") : null,
  );
  const [savingConsentKey, setSavingConsentKey] = useState<EditableConsentKey | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    tone: "info" | "success" | "error";
    text: string;
  } | null>(() =>
    membershipConverted
      ? {
          tone: "success",
          text: messages.temporaryConversionSuccess,
        }
      : null,
  );

  const fetchOverview = useCallback(async () => {
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new Error(messages.loginRequired);
    const idToken = await user.getIdToken();
    const res = await fetch("/api/me/overview", {
      headers: { authorization: `Bearer ${idToken}` },
    });
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      profileIncomplete?: boolean;
    } & Partial<Overview>;
    if (!res.ok || !data.ok || !data.user) {
      throw new Error(data.error ?? messages.loadFailed);
    }
    setOverview({
      user: data.user,
      organization: data.organization ?? null,
      requests: data.requests ?? [],
      answers: data.answers ?? [],
      views: data.views ?? [],
      ratings: data.ratings ?? [],
      ledger: data.ledger ?? [],
      profileIncomplete: Boolean(data.profileIncomplete),
    });
    setLastUpdated(new Date());
  }, [messages.loadFailed, messages.loginRequired]);

  const refreshOverview = useCallback(async () => {
    if (previewMode) return;
    setRefreshing(true);
    try {
      await fetchOverview();
      setActionMessage({ tone: "info", text: messages.refreshed });
    } catch (err) {
      setActionMessage({
        tone: "error",
        text:
          err instanceof Error ? err.message : messages.refreshFailed,
      });
    } finally {
      setRefreshing(false);
    }
  }, [
    fetchOverview,
    messages.refreshed,
    messages.refreshFailed,
    previewMode,
  ]);

  useEffect(() => {
    if (previewMode) return;
    const auth = getFirebaseAuth();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }
      setCurrentUser(user);
      try {
        const tokenResult = await user.getIdTokenResult(true);
        if (tokenResult.claims.admin === true) {
          router.replace("/admin");
          return;
        }
        if (tokenResult.claims.partner === true) {
          router.replace("/partner");
          return;
        }
        await fetchOverview();
        setState("ready");
      } catch (err) {
        if (err instanceof Error && err.message === "approval_pending") {
          router.push("/pending-approval");
          return;
        }
        setState("error");
        setError(
          err instanceof Error && err.message !== "approval_pending"
            ? messages.loadFailed
            : messages.genericError,
        );
      }
    });
    return () => unsubscribe();
  }, [
    router,
    fetchOverview,
    messages.genericError,
    messages.loadFailed,
    previewMode,
  ]);

  const referenceTime = lastUpdated?.getTime() ?? 0;

  const myRequests = useMemo(() => {
    if (!overview || !currentUser) return [] as ConsultRequestRecord[];
    return overview.requests.filter(
      (request) => request.uid === currentUser.uid
    );
  }, [overview, currentUser]);

  const answerByRequestId = useMemo(
    () =>
      new Map(
        (overview?.answers ?? []).map((answer) => [answer.requestId, answer])
      ),
    [overview?.answers]
  );

  const viewedRequestIds = useMemo(
    () => new Set((overview?.views ?? []).map((view) => view.requestId)),
    [overview?.views]
  );

  const viewedCount = useMemo(
    () =>
      myRequests.filter((request) => viewedRequestIds.has(request.id)).length,
    [myRequests, viewedRequestIds]
  );

  const waitingAnswerCount = useMemo(
    () =>
      myRequests.filter(
        (request) =>
          answerByRequestId.has(request.id) && !viewedRequestIds.has(request.id)
      ).length,
    [myRequests, answerByRequestId, viewedRequestIds]
  );

  const walletBalance = overview?.organization?.walletBalance ?? 0;
  const earnedPoints = useMemo(
    () =>
      (overview?.ledger ?? [])
        .filter((entry) => entry.points > 0)
        .reduce((total, entry) => total + entry.points, 0),
    [overview?.ledger]
  );
  const usedPoints = useMemo(
    () =>
      (overview?.ledger ?? [])
        .filter((entry) => entry.points < 0)
        .reduce((total, entry) => total + Math.abs(entry.points), 0),
    [overview?.ledger]
  );

  const sortedLedger = useMemo(
    () => overview?.ledger ?? [],
    [overview?.ledger]
  );

  const handleLogout = async () => {
    if (previewMode) return;
    try {
      await logoutPortalSession();
      router.push("/login");
    } catch {
      setActionMessage({
        tone: "error",
        text: messages.logoutFailed,
      });
    }
  };

  const updateConsent = async (key: EditableConsentKey, value: boolean) => {
    if (previewMode) return;
    const user = getFirebaseAuth().currentUser;
    if (!user) {
      setActionMessage({
        tone: "error",
        text: messages.consentLoginRequired,
      });
      return;
    }

    setSavingConsentKey(key);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/me/consents", {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${idToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ consents: { [key]: value } }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        consents?: UserRecord["consents"];
        updatedAt?: string;
      } | null;
      const nextConsents = data?.consents;

      if (!res.ok || !data?.ok || !nextConsents) {
        throw new Error(data?.error ?? "consent_update_failed");
      }

      setOverview((current) =>
        current
          ? {
              ...current,
              user: {
                ...current.user,
                consents: nextConsents,
                updatedAt: data.updatedAt ?? current.user.updatedAt,
              },
            }
          : current
      );
      setActionMessage({ tone: "success", text: messages.consentSaved });
      setLastUpdated(new Date());
    } catch {
      setActionMessage({
        tone: "error",
        text: messages.consentSaveFailed,
      });
    } finally {
      setSavingConsentKey(null);
    }
  };

  if (state === "loading") {
    return (
      <div className="admin-state">
        <div className="admin-state__card">
          <div className="admin-state__spinner" aria-hidden="true" />
          <h2>{messages.loading}</h2>
          <p>{messages.loadingDescription}</p>
        </div>
      </div>
    );
  }

  if (state === "error" || !overview) {
    return (
      <div className="admin-state">
        <div className="admin-state__card admin-state__card--error">
          <h2>{messages.loadFailed}</h2>
          <p>{error || messages.retryDescription}</p>
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            onClick={() => void refreshOverview()}
          >
            {messages.retryLabel}
          </button>
          <button type="button" className="admin-btn" onClick={handleLogout}>
            {messages.otherLoginLabel}
          </button>
        </div>
      </div>
    );
  }

  const activeTab = tabs.find((item) => item.key === tab);
  const topbarTitle =
    tab === "inquiries" ? overviewCopy.text.inquiriesTopbarTitle : activeTab?.label;
  const topbarDescription =
    tab === "inquiries"
      ? overviewCopy.text.inquiriesTopbarDescription
      : activeTab?.description;

  return (
    <div
      className="admin-shell"
      onClickCapture={previewMode ? preventPreviewLinkNavigation : undefined}
    >
      <aside
        className="admin-sidebar"
        aria-label={navigationCopy.text.navigationAriaLabel}
      >
        <div className="admin-brand">
          <div className="admin-brand__mark" aria-hidden="true">
            {navigationCopy.text.brandMark}
          </div>
          <div className="admin-brand__meta">
            <strong>{navigationCopy.text.serviceName}</strong>
            <span>{navigationCopy.text.brandSubtitle}</span>
          </div>
        </div>

        <nav className="admin-nav">
          {tabs.map((item) => (
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
              {(overview.user.name ??
                overview.user.email ??
                navigationCopy.text.avatarFallback)
                .slice(0, 1)
                .toUpperCase()}
            </div>
            <div className="admin-user__meta">
              <strong>
                {overview.user.name?.trim() ||
                  overview.user.email ||
                  navigationCopy.text.fallbackMemberName}
              </strong>
              <span>
                {overview.user.cooperativeName ??
                  (overview.profileIncomplete
                    ? navigationCopy.text.profileIncomplete
                    : navigationCopy.text.organizationPending)}
              </span>
            </div>
          </div>
          <button
            className="admin-btn admin-btn--ghost admin-btn--block"
            type="button"
            onClick={() => {
              if (!previewMode) router.push("/");
            }}
            disabled={previewMode}
          >
            {navigationCopy.text.homeLabel}
          </button>
          <button
            className="admin-btn admin-btn--ghost admin-btn--block"
            type="button"
            onClick={handleLogout}
            disabled={previewMode}
          >
            {navigationCopy.text.logoutLabel}
          </button>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div>
            <p className="admin-topbar__crumb">
              {navigationCopy.text.breadcrumbPrefix} / {activeTab?.label}
            </p>
            <h1 className="admin-topbar__title">{topbarTitle}</h1>
            <p className="admin-topbar__hint">{topbarDescription}</p>
          </div>
          <div className="admin-topbar__actions">
            <span className="admin-topbar__updated">
              {navigationCopy.text.lastSyncPrefix}{" "}
              {lastUpdated
                ? formatRelative(
                    lastUpdated.toISOString(),
                    referenceTime,
                    messages,
                    navigationCopy.text.missingValue,
                  )
                : navigationCopy.text.missingValue}
            </span>
            <button
              type="button"
              className="admin-btn"
              onClick={() => void refreshOverview()}
              disabled={previewMode || refreshing}
            >
              {refreshing
                ? navigationCopy.text.refreshingLabel
                : navigationCopy.text.refreshLabel}
            </button>
            <Link className="admin-btn admin-btn--primary" href="/consult">
              {navigationCopy.text.newInquiryLabel}
            </Link>
            <Link className="admin-btn" href="/mypage/quotes">
              견적함
            </Link>
          </div>
        </header>

        {overview.profileIncomplete && (
          <div className="admin-toast admin-toast--info" role="status">
            {navigationCopy.text.incompleteNotice}
            <Link
              href="/signup"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              style={{ marginLeft: "auto" }}
            >
              {navigationCopy.text.continueSignupLabel}
            </Link>
          </div>
        )}

        {actionMessage && (
          <div
            className={`admin-toast admin-toast--${actionMessage.tone}`}
            role="status"
          >
            {actionMessage.text}
            <button
              type="button"
              className="admin-toast__close"
              aria-label={navigationCopy.text.closeLabel}
              onClick={() => setActionMessage(null)}
            >
              ×
            </button>
          </div>
        )}

        {tab === "overview" && (
          <div className="admin-grid admin-grid--overview">
            <div className="admin-kpi-grid">
              <article className="admin-kpi admin-kpi--blue">
                <header>
                  <span>{overviewCopy.text.balanceLabel}</span>
                </header>
                <p className="admin-kpi__value">
                  {walletBalance.toLocaleString()}
                  <span className="admin-kpi__suffix">
                    {navigationCopy.text.pointUnit}
                  </span>
                </p>
                <p className="admin-kpi__helper">
                  {overview.organization?.cooperativeName ??
                    overview.user.cooperativeName ??
                    overviewCopy.text.organizationFallback}{" "}
                  {overviewCopy.text.walletSuffix}
                </p>
              </article>
              <article className="admin-kpi admin-kpi--amber">
                <header>
                  <span>{overviewCopy.text.inquiryCountLabel}</span>
                </header>
                <p className="admin-kpi__value">
                  {myRequests.length.toLocaleString()}
                  <span className="admin-kpi__suffix">
                    {overviewCopy.text.countSuffix}
                  </span>
                </p>
                <p className="admin-kpi__helper">
                  {overviewCopy.text.inquiryCountHelp}
                </p>
              </article>
              <article className="admin-kpi admin-kpi--green">
                <header>
                  <span>{overviewCopy.text.unreadAnswersLabel}</span>
                </header>
                <p className="admin-kpi__value">
                  {waitingAnswerCount.toLocaleString()}
                  <span className="admin-kpi__suffix">
                    {overviewCopy.text.countSuffix}
                  </span>
                </p>
                <p className="admin-kpi__helper">
                  {overviewCopy.text.unreadAnswersHelp}
                </p>
              </article>
              <article className="admin-kpi admin-kpi--violet">
                <header>
                  <span>{overviewCopy.text.viewedAnswersLabel}</span>
                </header>
                <p className="admin-kpi__value">
                  {viewedCount.toLocaleString()}
                  <span className="admin-kpi__suffix">
                    {overviewCopy.text.countSuffix}
                  </span>
                </p>
                <p className="admin-kpi__helper">
                  {overviewCopy.text.viewedAnswersHelp}
                </p>
              </article>
            </div>

            <div className="admin-card admin-card--span-2">
              <header className="admin-card__head">
                <div>
                  <h2>{overviewCopy.text.recentInquiriesTitle}</h2>
                  <p>{overviewCopy.text.recentInquiriesDescription}</p>
                </div>
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  onClick={() => setTab("inquiries")}
                >
                  {overviewCopy.text.viewAllLabel}
                </button>
              </header>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>{overviewCopy.text.requestNumberHeading}</th>
                      <th>{overviewCopy.text.subjectHeading}</th>
                      <th>{overviewCopy.text.visibilityHeading}</th>
                      <th>{overviewCopy.text.statusHeading}</th>
                      <th>{overviewCopy.text.createdHeading}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myRequests.slice(0, 5).map((request) => {
                      const resolvedStatus = resolveRequestStatus(request, {
                        hasAnswer: answerByRequestId.has(request.id),
                        hasAnswerView: viewedRequestIds.has(request.id),
                      });
                      return (
                      <tr key={request.id}>
                        <td>
                          <Link href={`/mypage/requests/${request.id}`}>
                            {request.requestNumber}
                          </Link>
                        </td>
                        <td>
                          <Link href={`/mypage/requests/${request.id}`}>
                            {request.subject}
                          </Link>
                        </td>
                        <td>
                          <VisibilityChip
                            value={request.visibility}
                            section={overviewCopy}
                          />
                        </td>
                        <td>
                          <StatusPill
                            value={resolvedStatus}
                            section={overviewCopy}
                          />
                        </td>
                        <td>
                          {formatRelative(
                            request.createdAt,
                            referenceTime,
                            messages,
                            navigationCopy.text.missingValue,
                          )}
                        </td>
                      </tr>
                    );
                    })}
                    {myRequests.length === 0 && (
                      <tr>
                        <td colSpan={5} className="admin-table__empty">
                          {content.messages.emptyInquiries}{" "}
                          <Link href="/consult">
                            {overviewCopy.text.emptyInquiriesLink}
                          </Link>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="admin-card">
              <header className="admin-card__head">
                <div>
                  <h2>{overviewCopy.text.recentPointsTitle}</h2>
                  <p>{overviewCopy.text.recentPointsDescription}</p>
                </div>
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  onClick={() => setTab("points")}
                >
                  {overviewCopy.text.viewAllLabel}
                </button>
              </header>
              <ul className="admin-feed">
                {sortedLedger.slice(0, 5).map((entry) => (
                  <li key={entry.id} className="admin-feed__item">
                    <div>
                      <strong>
                        {ledgerLabels[entry.event] ??
                          entry.reason ??
                          overviewCopy.text.ledgerFallback}
                      </strong>
                      <span>
                        {formatDate(
                          entry.createdAt,
                          navigationCopy.text.missingValue,
                        )}
                      </span>
                    </div>
                    <em
                      className={
                        entry.points > 0
                          ? "admin-feed__delta is-plus"
                          : "admin-feed__delta is-minus"
                      }
                    >
                      {entry.points > 0 ? "+" : ""}
                      {entry.points.toLocaleString()}
                      {navigationCopy.text.pointUnit}
                    </em>
                  </li>
                ))}
                {sortedLedger.length === 0 && (
                  <li className="admin-feed__empty">
                    {content.messages.emptyPoints}
                  </li>
                )}
              </ul>
            </div>
          </div>
        )}

        {tab === "inquiries" && (
          <div className="admin-grid">
            <div className="admin-card admin-card--span-2">
              <header className="admin-card__head">
                <div>
                  <h2>{inquiriesCopy.title}</h2>
                  <p>{inquiriesCopy.description}</p>
                </div>
                <Link
                  className="admin-btn admin-btn--primary admin-btn--sm"
                  href="/consult"
                >
                  {inquiriesCopy.text.newInquiryLabel}
                </Link>
              </header>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>{inquiriesCopy.text.requestNumberHeading}</th>
                      <th>{inquiriesCopy.text.subjectHeading}</th>
                      <th>{inquiriesCopy.text.visibilityHeading}</th>
                      <th>{inquiriesCopy.text.statusHeading}</th>
                      <th>{inquiriesCopy.text.answerHeading}</th>
                      <th>{inquiriesCopy.text.createdHeading}</th>
                      <th aria-label={inquiriesCopy.text.actionsHeading} />
                    </tr>
                  </thead>
                  <tbody>
                    {myRequests.map((request) => {
                      const answer = answerByRequestId.get(request.id);
                      const viewed = viewedRequestIds.has(request.id);
                      const resolvedStatus = resolveRequestStatus(request, {
                        hasAnswer: Boolean(answer),
                        hasAnswerView: viewed,
                      });
                      return (
                        <tr key={request.id}>
                          <td>
                            <Link href={`/mypage/requests/${request.id}`}>
                              {request.requestNumber}
                            </Link>
                          </td>
                          <td>
                            <Link href={`/mypage/requests/${request.id}`}>
                              {request.subject}
                            </Link>
                          </td>
                          <td>
                            <VisibilityChip
                              value={request.visibility}
                              section={overviewCopy}
                            />
                          </td>
                          <td>
                            <StatusPill
                              value={resolvedStatus}
                              section={overviewCopy}
                            />
                          </td>
                          <td>
                            {answer ? (
                              <span className="admin-chip">
                                {viewed
                                  ? inquiriesCopy.text.viewedAnswerLabel
                                  : inquiriesCopy.text.viewAnswerLabel}{" "}
                                ·{" "}
                                {answer.pointCost.toLocaleString()}
                                {navigationCopy.text.pointUnit}
                              </span>
                            ) : (
                              <span className="admin-chip admin-chip--muted">
                                {inquiriesCopy.text.answerPendingLabel}
                              </span>
                            )}
                          </td>
                          <td>
                            {formatRelative(
                              request.createdAt,
                              referenceTime,
                              messages,
                              navigationCopy.text.missingValue,
                            )}
                          </td>
                          <td className="admin-table__actions">
                            <Link
                              className="admin-btn admin-btn--detail"
                              href={`/mypage/requests/${request.id}`}
                            >
                              {inquiriesCopy.text.detailLabel}
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                    {myRequests.length === 0 && (
                      <tr>
                        <td colSpan={7} className="admin-table__empty">
                          {content.messages.emptyInquiries}{" "}
                          <Link href="/consult">
                            {inquiriesCopy.text.emptyLinkLabel}
                          </Link>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === "points" && (
          <div className="admin-grid">
            <div className="admin-kpi-grid">
              <article className="admin-kpi admin-kpi--blue">
                <header>
                  <span>{pointsCopy.text.balanceLabel}</span>
                </header>
                <p className="admin-kpi__value">
                  {walletBalance.toLocaleString()}
                  <span className="admin-kpi__suffix">
                    {navigationCopy.text.pointUnit}
                  </span>
                </p>
                <p className="admin-kpi__helper">
                  {overview.organization?.cooperativeName ??
                    overview.user.cooperativeName ??
                    overviewCopy.text.organizationFallback}{" "}
                  {pointsCopy.text.walletSuffix}
                </p>
              </article>
              <article className="admin-kpi admin-kpi--amber">
                <header>
                  <span>{pointsCopy.text.earnedLabel}</span>
                </header>
                <p className="admin-kpi__value">
                  {earnedPoints.toLocaleString()}
                  <span className="admin-kpi__suffix">
                    {navigationCopy.text.pointUnit}
                  </span>
                </p>
                <p className="admin-kpi__helper">{pointsCopy.text.earnedHelp}</p>
              </article>
              <article className="admin-kpi admin-kpi--green">
                <header>
                  <span>{pointsCopy.text.usedLabel}</span>
                </header>
                <p className="admin-kpi__value">
                  {usedPoints.toLocaleString()}
                  <span className="admin-kpi__suffix">
                    {navigationCopy.text.pointUnit}
                  </span>
                </p>
                <p className="admin-kpi__helper">{pointsCopy.text.usedHelp}</p>
              </article>
              <article className="admin-kpi admin-kpi--violet">
                <header>
                  <span>{pointsCopy.text.countLabel}</span>
                </header>
                <p className="admin-kpi__value">
                  {sortedLedger.length.toLocaleString()}
                  <span className="admin-kpi__suffix">
                    {overviewCopy.text.countSuffix}
                  </span>
                </p>
                <p className="admin-kpi__helper">{pointsCopy.text.countHelp}</p>
              </article>
            </div>

            <div className="admin-card admin-card--span-2">
              <header className="admin-card__head">
                <div>
                  <h2>{pointsCopy.text.guideTitle}</h2>
                  <p>{pointsCopy.text.guideDescription}</p>
                </div>
              </header>
              <ul className="admin-info-list">
                {pointsCopy.items
                  .filter((item) => item.visible && !item.deleted)
                  .map((item) => (
                    <li key={item.id}>{item.title}</li>
                  ))}
              </ul>
            </div>

            <div className="admin-card admin-card--span-2">
              <header className="admin-card__head">
                <div>
                  <h2>{pointsCopy.text.historyTitle}</h2>
                  <p>{pointsCopy.text.historyDescription}</p>
                </div>
              </header>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>{pointsCopy.text.dateHeading}</th>
                      <th>{pointsCopy.text.eventHeading}</th>
                      <th>{pointsCopy.text.descriptionHeading}</th>
                      <th style={{ textAlign: "right" }}>
                        {pointsCopy.text.changeHeading}
                      </th>
                      <th style={{ textAlign: "right" }}>
                        {pointsCopy.text.balanceHeading}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLedger.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          {formatDate(
                            entry.createdAt,
                            navigationCopy.text.missingValue,
                          )}
                        </td>
                        <td>
                          <span className="admin-chip">
                            {ledgerLabels[entry.event] ??
                              overviewCopy.text.ledgerFallback}
                          </span>
                        </td>
                        <td>
                          {entry.reason ?? navigationCopy.text.missingValue}
                        </td>
                        <td
                          style={{ textAlign: "right" }}
                          className={
                            entry.points > 0
                              ? "is-plus"
                              : entry.points < 0
                                ? "is-minus"
                                : ""
                          }
                        >
                          {entry.points > 0 ? "+" : ""}
                          {entry.points.toLocaleString()}
                          {navigationCopy.text.pointUnit}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {(entry.balanceAfter ?? 0).toLocaleString()}
                          {navigationCopy.text.pointUnit}
                        </td>
                      </tr>
                    ))}
                    {sortedLedger.length === 0 && (
                      <tr>
                        <td colSpan={5} className="admin-table__empty">
                          {content.messages.emptyPoints}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === "profile" && (
          <div className="admin-grid">
            <div className="admin-card">
              <header className="admin-card__head">
                <div>
                  <h2>{profileCopy.title}</h2>
                  <p>{profileCopy.description}</p>
                </div>
              </header>
              <dl className="admin-define">
                <div>
                  <dt>{profileCopy.text.nameLabel}</dt>
                  <dd>
                    {overview.user.name?.trim() ||
                      navigationCopy.text.missingValue}
                  </dd>
                </div>
                <div>
                  <dt>{profileCopy.text.emailLabel}</dt>
                  <dd>
                    {overview.user.email || navigationCopy.text.missingValue}
                  </dd>
                </div>
                <div>
                  <dt>{profileCopy.text.phoneLabel}</dt>
                  <dd>
                    {overview.user.phone?.trim() ||
                      navigationCopy.text.missingValue}
                  </dd>
                </div>
                <div>
                  <dt>{profileCopy.text.organizationLabel}</dt>
                  <dd>
                    {overview.user.cooperativeName ??
                      overview.user.manualCooperativeName ??
                      (overview.profileIncomplete
                        ? profileCopy.text.organizationMissing
                        : profileCopy.text.organizationPending)}
                  </dd>
                </div>
                <div>
                  <dt>{profileCopy.text.positionLabel}</dt>
                  <dd>
                    {overview.user.position?.trim() ||
                      navigationCopy.text.missingValue}
                  </dd>
                </div>
                <div>
                  <dt>{profileCopy.text.dutyLabel}</dt>
                  <dd>
                    {overview.user.duty?.trim() ||
                      navigationCopy.text.missingValue}
                  </dd>
                </div>
                <div>
                  <dt>{profileCopy.text.joinedLabel}</dt>
                  <dd>
                    {formatDate(
                      overview.user.createdAt,
                      navigationCopy.text.missingValue,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{profileCopy.text.businessCardLabel}</dt>
                  <dd>
                    {overview.user.businessCardUrl ? (
                      <a href={overview.user.businessCardUrl} target="_blank" rel="noreferrer">
                        {profileCopy.text.businessCardView}
                      </a>
                    ) : (
                      profileCopy.text.businessCardEmpty
                    )}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="admin-card">
              <header className="admin-card__head">
                <div>
                  <h2>{profileCopy.text.walletTitle}</h2>
                  <p>{profileCopy.text.walletDescription}</p>
                </div>
              </header>
              <dl className="admin-define">
                <div>
                  <dt>{profileCopy.text.walletOrganizationLabel}</dt>
                  <dd>
                    {overview.organization?.cooperativeName ??
                      overview.user.cooperativeName ??
                      navigationCopy.text.missingValue}
                  </dd>
                </div>
                <div>
                  <dt>{profileCopy.text.walletBalanceLabel}</dt>
                  <dd>
                    {walletBalance.toLocaleString()}
                    {navigationCopy.text.pointUnit}
                  </dd>
                </div>
                <div>
                  <dt>{profileCopy.text.walletEarnedLabel}</dt>
                  <dd>
                    {earnedPoints.toLocaleString()}
                    {navigationCopy.text.pointUnit}
                  </dd>
                </div>
                <div>
                  <dt>{profileCopy.text.walletUsedLabel}</dt>
                  <dd>
                    {usedPoints.toLocaleString()}
                    {navigationCopy.text.pointUnit}
                  </dd>
                </div>
                <div>
                  <dt>{profileCopy.text.walletMemberCountLabel}</dt>
                  <dd>
                    {overview.organization?.users?.length ?? 0}
                    {profileCopy.text.memberSuffix}
                  </dd>
                </div>
                <div>
                  <dt>{profileCopy.text.walletCreatedLabel}</dt>
                  <dd>
                    {formatDate(
                      overview.organization?.createdAt,
                      navigationCopy.text.missingValue,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{profileCopy.text.walletUpdatedLabel}</dt>
                  <dd>
                    {formatDate(
                      overview.organization?.updatedAt,
                      navigationCopy.text.missingValue,
                    )}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="admin-card admin-card--span-2">
              <header className="admin-card__head">
                <div>
                  <h2>{profileCopy.text.consentsTitle}</h2>
                  <p>{profileCopy.text.consentsDescription}</p>
                </div>
              </header>
              <div className="admin-consent-list">
                <div className="admin-consent-group">
                  <h3 className="admin-consent-group__title">
                    {profileCopy.text.requiredConsentsTitle}
                  </h3>
                  {[
                    {
                      label: profileCopy.text.termsLabel,
                      value: overview.user.consents?.terms,
                    },
                    {
                      label: profileCopy.text.privacyLabel,
                      value: overview.user.consents?.privacy,
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className={`admin-consent-row admin-consent-row--locked${
                        item.value ? " is-on" : ""
                      }`}
                    >
                      <span aria-hidden="true" className="admin-consent-row__icon">
                        {item.value ? "✓" : "·"}
                      </span>
                      <strong>{item.label}</strong>
                      <em>
                        {item.value
                          ? profileCopy.text.agreedLabel
                          : profileCopy.text.disagreedLabel}
                      </em>
                    </div>
                  ))}
                </div>

                <div className="admin-consent-group">
                  <h3 className="admin-consent-group__title">
                    {profileCopy.text.optionalConsentsTitle}
                  </h3>
                  <p className="admin-consent-group__hint">
                    {profileCopy.text.optionalConsentsDescription}
                  </p>
                  {(
                    [
                      ["marketing", profileCopy.text.marketingLabel],
                      ["email", profileCopy.text.consentEmailLabel],
                      ["sms", profileCopy.text.smsLabel],
                      ["kakao", profileCopy.text.kakaoLabel],
                    ] as const
                  ).map(([key, label]) => {
                    const checked = Boolean(overview.user.consents?.[key]);
                    const saving = savingConsentKey === key;
                    return (
                      <label
                        key={key}
                        className={`admin-consent-row admin-consent-row--editable${
                          checked ? " is-on" : ""
                        }`}
                      >
                        <span aria-hidden="true" className="admin-consent-row__icon">
                          {checked ? "✓" : "·"}
                        </span>
                        <strong>{label}</strong>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={previewMode || saving}
                          aria-label={`${label} ${
                            checked
                              ? profileCopy.text.agreedLabel
                              : profileCopy.text.disagreedLabel
                          }`}
                          onChange={(event) =>
                            void updateConsent(key, event.target.checked)
                          }
                        />
                        <span aria-hidden="true" className="admin-consent-row__toggle" />
                        <em>
                          {saving
                            ? profileCopy.text.savingLabel
                            : checked
                              ? profileCopy.text.agreedLabel
                              : profileCopy.text.disagreedLabel}
                        </em>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            {overview.profileIncomplete && (
              <div className="admin-card admin-card--span-2">
                <header className="admin-card__head">
                  <div>
                    <h2>{profileCopy.text.incompleteTitle}</h2>
                    <p>{profileCopy.text.incompleteDescription}</p>
                  </div>
                  <Link className="admin-btn admin-btn--primary" href="/signup">
                    {profileCopy.text.continueSignupLabel}
                  </Link>
                </header>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
