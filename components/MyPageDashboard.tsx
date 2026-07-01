"use client";

import { FirebaseError } from "firebase/app";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebase/client";
import {
  getRequestStatusLabel,
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

type State = "loading" | "ready" | "error";

type TabKey = "overview" | "inquiries" | "points" | "profile";

const TABS: { key: TabKey; label: string; description: string }[] = [
  { key: "overview", label: "Overview", description: "내 활동과 보유 포인트 요약" },
  {
    key: "inquiries",
    label: "Inquiries",
    description: "내가 등록한 문의와 답변",
  },
  { key: "points", label: "Points", description: "농협 지갑 포인트 사용 내역" },
  { key: "profile", label: "Profile", description: "내 소속과 계정 정보" },
];

function normalizeTab(value?: string | string[]) {
  const tabValue = Array.isArray(value) ? value[0] : value;
  return TABS.some((item) => item.key === tabValue) ? (tabValue as TabKey) : "overview";
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

type EditableConsentKey = "marketing" | "email" | "sms" | "kakao";

const VISIBILITY_LABELS: Record<string, string> = {
  PUBLIC: "전체 공개",
  public: "전체 공개",
  ORG_ONLY: "농협 공개",
  nonghyup: "농협 공개",
  PRIVATE: "비공개",
  private: "비공개",
};

const LEDGER_LABELS: Record<string, string> = {
  first_org_signup: "농협 최초 가입 보너스",
  user_signup: "회원 가입 적립",
  answer_view: "답변 열람 사용",
  manual_adjustment: "수동 조정",
  admin_adjustment_credit: "운영자 적립",
  admin_adjustment_debit: "운영자 차감",
};

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
    return new Intl.DateTimeFormat("ko-KR", {
      month: "short",
      day: "numeric",
    }).format(date);
  }
  const diff = reference - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function StatusPill({ value }: { value: ResolvedRequestStatus }) {
  return (
    <span className={`admin-pill admin-pill--${getRequestStatusTone(value)}`}>
      <span className="admin-pill__dot" aria-hidden="true" />
      {getRequestStatusLabel(value)}
    </span>
  );
}

function VisibilityChip({ value }: { value?: string }) {
  const label = VISIBILITY_LABELS[value ?? ""] ?? value ?? "-";
  return <span className="admin-chip">{label}</span>;
}

export function MyPageDashboard({ initialTab }: { initialTab?: string | string[] } = {}) {
  const router = useRouter();
  const [state, setState] = useState<State>("loading");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>(() => normalizeTab(initialTab));
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [savingConsentKey, setSavingConsentKey] = useState<EditableConsentKey | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    tone: "info" | "success" | "error";
    text: string;
  } | null>(null);

  const fetchOverview = useCallback(async () => {
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new Error("로그인이 필요합니다.");
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
      throw new Error(data.error ?? "마이페이지 데이터를 불러오지 못했습니다.");
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
  }, []);

  const refreshOverview = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchOverview();
      setActionMessage({ tone: "info", text: "데이터를 새로 불러왔습니다." });
    } catch (err) {
      setActionMessage({
        tone: "error",
        text:
          err instanceof Error ? err.message : "새로고침에 실패했습니다.",
      });
    } finally {
      setRefreshing(false);
    }
  }, [fetchOverview]);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }
      setCurrentUser(user);
      try {
        await fetchOverview();
        setState("ready");
      } catch (err) {
        if (err instanceof Error && err.message === "approval_pending") {
          router.push("/pending-approval");
          return;
        }
        setState("error");
        setError(
          err instanceof FirebaseError
            ? `${err.code}: ${err.message}`
            : err instanceof Error
              ? err.message
              : "마이페이지 데이터를 불러오지 못했습니다."
        );
      }
    });
    return () => unsubscribe();
  }, [router, fetchOverview]);

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
    try {
      await signOut(getFirebaseAuth());
      router.push("/login");
    } catch (err) {
      setActionMessage({
        tone: "error",
        text: err instanceof Error ? err.message : "로그아웃에 실패했습니다.",
      });
    }
  };

  const updateConsent = async (key: EditableConsentKey, value: boolean) => {
    const user = getFirebaseAuth().currentUser;
    if (!user) {
      setActionMessage({ tone: "error", text: "로그인 후 동의 항목을 변경할 수 있습니다." });
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
      setActionMessage({ tone: "success", text: "수신 동의 항목을 저장했습니다." });
      setLastUpdated(new Date());
    } catch (err) {
      setActionMessage({
        tone: "error",
        text:
          err instanceof Error
            ? "동의 항목을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."
            : "동의 항목을 저장하지 못했습니다.",
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
          <h2>마이페이지를 준비하고 있습니다</h2>
          <p>로그인 정보와 농협 지갑을 확인하고 있습니다.</p>
        </div>
      </div>
    );
  }

  if (state === "error" || !overview) {
    return (
      <div className="admin-state">
        <div className="admin-state__card admin-state__card--error">
          <h2>마이페이지를 불러오지 못했습니다</h2>
          <p>{error || "잠시 후 다시 시도해 주세요."}</p>
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            onClick={() => void refreshOverview()}
          >
            다시 시도
          </button>
          <button type="button" className="admin-btn" onClick={handleLogout}>
            다른 계정으로 로그인
          </button>
        </div>
      </div>
    );
  }

  const activeTab = TABS.find((item) => item.key === tab);
  const topbarTitle = tab === "inquiries" ? "문의 내역" : activeTab?.label;
  const topbarDescription =
    tab === "inquiries"
      ? "등록한 문의와 답변 내역을 상세하게 확인할 수 있습니다."
      : activeTab?.description;

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar" aria-label="마이페이지 내비게이션">
        <div className="admin-brand">
          <div className="admin-brand__mark" aria-hidden="true">
            N
          </div>
          <div className="admin-brand__meta">
            <strong>농협지원센터</strong>
            <span>My Page</span>
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
              {(overview.user.name ?? overview.user.email ?? "M")
                .slice(0, 1)
                .toUpperCase()}
            </div>
            <div className="admin-user__meta">
              <strong>
                {overview.user.name?.trim() ||
                  overview.user.email ||
                  "회원"}
              </strong>
              <span>
                {overview.user.cooperativeName ??
                  (overview.profileIncomplete
                    ? "프로필 미완료"
                    : "소속 확인 중")}
              </span>
            </div>
          </div>
          <button
            className="admin-btn admin-btn--ghost admin-btn--block"
            type="button"
            onClick={() => router.push("/")}
          >
            홈으로
          </button>
          <button
            className="admin-btn admin-btn--ghost admin-btn--block"
            type="button"
            onClick={handleLogout}
          >
            로그아웃
          </button>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div>
            <p className="admin-topbar__crumb">My page / {activeTab?.label}</p>
            <h1 className="admin-topbar__title">{topbarTitle}</h1>
            <p className="admin-topbar__hint">{topbarDescription}</p>
          </div>
          <div className="admin-topbar__actions">
            <span className="admin-topbar__updated">
              마지막 동기화{" "}
              {lastUpdated
                ? formatRelative(lastUpdated.toISOString(), referenceTime)
                : "-"}
            </span>
            <button
              type="button"
              className="admin-btn"
              onClick={() => void refreshOverview()}
              disabled={refreshing}
            >
              {refreshing ? "새로고침 중..." : "새로고침"}
            </button>
            <Link className="admin-btn admin-btn--primary" href="/consult">
              + 새 문의 등록
            </Link>
          </div>
        </header>

        {overview.profileIncomplete && (
          <div className="admin-toast admin-toast--info" role="status">
            소속 농협 정보를 등록하지 않았어요. 회원가입을 마무리하면
            농협 통합 지갑과 답변 열람을 사용할 수 있어요.
            <Link
              href="/signup"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              style={{ marginLeft: "auto" }}
            >
              회원가입 이어가기
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
              aria-label="닫기"
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
                  <span>보유 포인트</span>
                </header>
                <p className="admin-kpi__value">
                  {walletBalance.toLocaleString()}
                  <span className="admin-kpi__suffix">P</span>
                </p>
                <p className="admin-kpi__helper">
                  {overview.organization?.cooperativeName ??
                    overview.user.cooperativeName ??
                    "소속 농협"}{" "}
                  통합 지갑
                </p>
              </article>
              <article className="admin-kpi admin-kpi--amber">
                <header>
                  <span>등록 문의</span>
                </header>
                <p className="admin-kpi__value">
                  {myRequests.length.toLocaleString()}
                  <span className="admin-kpi__suffix">건</span>
                </p>
                <p className="admin-kpi__helper">내가 등록한 전체 문의</p>
              </article>
              <article className="admin-kpi admin-kpi--green">
                <header>
                  <span>미열람 답변</span>
                </header>
                <p className="admin-kpi__value">
                  {waitingAnswerCount.toLocaleString()}
                  <span className="admin-kpi__suffix">건</span>
                </p>
                <p className="admin-kpi__helper">아직 확인하지 않은 답변</p>
              </article>
              <article className="admin-kpi admin-kpi--violet">
                <header>
                  <span>확인한 답변</span>
                </header>
                <p className="admin-kpi__value">
                  {viewedCount.toLocaleString()}
                  <span className="admin-kpi__suffix">건</span>
                </p>
                <p className="admin-kpi__helper">열람을 완료한 답변</p>
              </article>
            </div>

            <div className="admin-card admin-card--span-2">
              <header className="admin-card__head">
                <div>
                  <h2>최근 내 문의</h2>
                  <p>최근 등록한 문의 5건입니다.</p>
                </div>
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  onClick={() => setTab("inquiries")}
                >
                  전체 보기
                </button>
              </header>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>문의번호</th>
                      <th>제목</th>
                      <th>공개범위</th>
                      <th>상태</th>
                      <th>등록일</th>
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
                          <VisibilityChip value={request.visibility} />
                        </td>
                        <td>
                          <StatusPill value={resolvedStatus} />
                        </td>
                        <td>
                          {formatRelative(request.createdAt, referenceTime)}
                        </td>
                      </tr>
                    );
                    })}
                    {myRequests.length === 0 && (
                      <tr>
                        <td colSpan={5} className="admin-table__empty">
                          등록한 문의가 아직 없습니다.{" "}
                          <Link href="/consult">새 문의를 작성해 보세요.</Link>
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
                  <h2>최근 포인트 이력</h2>
                  <p>최근 적립과 사용 내역 5건입니다.</p>
                </div>
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  onClick={() => setTab("points")}
                >
                  전체 보기
                </button>
              </header>
              <ul className="admin-feed">
                {sortedLedger.slice(0, 5).map((entry) => (
                  <li key={entry.id} className="admin-feed__item">
                    <div>
                      <strong>
                        {LEDGER_LABELS[entry.event] ??
                          entry.reason ??
                          "포인트 변동"}
                      </strong>
                      <span>{formatDate(entry.createdAt)}</span>
                    </div>
                    <em
                      className={
                        entry.points > 0
                          ? "admin-feed__delta is-plus"
                          : "admin-feed__delta is-minus"
                      }
                    >
                      {entry.points > 0 ? "+" : ""}
                      {entry.points.toLocaleString()}P
                    </em>
                  </li>
                ))}
                {sortedLedger.length === 0 && (
                  <li className="admin-feed__empty">
                    포인트 변동 내역이 아직 없습니다.
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
                  <h2>문의 내역</h2>
                  <p>등록한 문의와 답변 내역을 상세하게 확인할 수 있습니다.</p>
                </div>
                <Link
                  className="admin-btn admin-btn--primary admin-btn--sm"
                  href="/consult"
                >
                  + 새 문의 등록
                </Link>
              </header>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>문의번호</th>
                      <th>제목</th>
                      <th>공개범위</th>
                      <th>상태</th>
                      <th>답변</th>
                      <th>등록일</th>
                      <th></th>
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
                            <VisibilityChip value={request.visibility} />
                          </td>
                          <td>
                            <StatusPill value={resolvedStatus} />
                          </td>
                          <td>
                            {answer ? (
                              <span className="admin-chip">
                                {viewed ? "확인 완료" : "답변 확인"} ·{" "}
                                {answer.pointCost.toLocaleString()}P
                              </span>
                            ) : (
                              <span className="admin-chip admin-chip--muted">
                                답변 대기
                              </span>
                            )}
                          </td>
                          <td>
                            {formatRelative(request.createdAt, referenceTime)}
                          </td>
                          <td className="admin-table__actions">
                            <Link
                              className="admin-btn admin-btn--detail"
                              href={`/mypage/requests/${request.id}`}
                            >
                              상세 보기
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                    {myRequests.length === 0 && (
                      <tr>
                        <td colSpan={7} className="admin-table__empty">
                          등록한 문의가 아직 없습니다.{" "}
                          <Link href="/consult">새 문의를 작성해 보세요.</Link>
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
                  <span>현재 잔액</span>
                </header>
                <p className="admin-kpi__value">
                  {walletBalance.toLocaleString()}
                  <span className="admin-kpi__suffix">P</span>
                </p>
                <p className="admin-kpi__helper">
                  {overview.organization?.cooperativeName ??
                    overview.user.cooperativeName ??
                    "소속 농협"}{" "}
                  통합 지갑
                </p>
              </article>
              <article className="admin-kpi admin-kpi--amber">
                <header>
                  <span>총 적립 포인트</span>
                </header>
                <p className="admin-kpi__value">
                  {earnedPoints.toLocaleString()}
                  <span className="admin-kpi__suffix">P</span>
                </p>
                <p className="admin-kpi__helper">가입 보너스와 운영자 적립 포함</p>
              </article>
              <article className="admin-kpi admin-kpi--green">
                <header>
                  <span>총 사용 포인트</span>
                </header>
                <p className="admin-kpi__value">
                  {usedPoints.toLocaleString()}
                  <span className="admin-kpi__suffix">P</span>
                </p>
                <p className="admin-kpi__helper">답변 열람과 운영자 차감 포함</p>
              </article>
              <article className="admin-kpi admin-kpi--violet">
                <header>
                  <span>포인트 이력</span>
                </header>
                <p className="admin-kpi__value">
                  {sortedLedger.length.toLocaleString()}
                  <span className="admin-kpi__suffix">건</span>
                </p>
                <p className="admin-kpi__helper">전체 포인트 내역 기준</p>
              </article>
            </div>

            <div className="admin-card admin-card--span-2">
              <header className="admin-card__head">
                <div>
                  <h2>포인트 안내</h2>
                  <p>농협 통합 지갑 포인트는 상담 답변을 열람할 때 사용됩니다.</p>
                </div>
              </header>
              <ul className="admin-info-list">
                <li>최초 승인 시 농협 지갑에 가입 보너스가 적립됩니다.</li>
                <li>답변을 처음 열람할 때만 포인트가 차감되고, 다시 보기는 중복 차감되지 않습니다.</li>
                <li>포인트가 부족하면 운영자에게 충전 또는 조정을 요청해 주세요.</li>
              </ul>
            </div>

            <div className="admin-card admin-card--span-2">
              <header className="admin-card__head">
                <div>
                  <h2>포인트 사용 내역</h2>
                  <p>적립과 사용 내역을 시간 순으로 보여드려요.</p>
                </div>
              </header>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>일시</th>
                      <th>이벤트</th>
                      <th>설명</th>
                      <th style={{ textAlign: "right" }}>변동</th>
                      <th style={{ textAlign: "right" }}>잔액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLedger.map((entry) => (
                      <tr key={entry.id}>
                        <td>{formatDate(entry.createdAt)}</td>
                        <td>
                          <span className="admin-chip">
                            {LEDGER_LABELS[entry.event] ?? entry.event}
                          </span>
                        </td>
                        <td>{entry.reason ?? "-"}</td>
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
                          {entry.points.toLocaleString()}P
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {(entry.balanceAfter ?? 0).toLocaleString()}P
                        </td>
                      </tr>
                    ))}
                    {sortedLedger.length === 0 && (
                      <tr>
                        <td colSpan={5} className="admin-table__empty">
                          포인트 변동 내역이 아직 없습니다.
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
                  <h2>내 정보</h2>
                  <p>회원가입 정보와 소속 농협을 확인할 수 있어요.</p>
                </div>
              </header>
              <dl className="admin-define">
                <div>
                  <dt>이름</dt>
                  <dd>{overview.user.name?.trim() || "-"}</dd>
                </div>
                <div>
                  <dt>이메일</dt>
                  <dd>{overview.user.email || "-"}</dd>
                </div>
                <div>
                  <dt>연락처</dt>
                  <dd>{overview.user.phone?.trim() || "-"}</dd>
                </div>
                <div>
                  <dt>소속 농협</dt>
                  <dd>
                    {overview.user.cooperativeName ??
                      overview.user.manualCooperativeName ??
                      (overview.profileIncomplete
                        ? "등록되지 않음"
                        : "확인 중")}
                  </dd>
                </div>
                <div>
                  <dt>직책</dt>
                  <dd>{overview.user.position?.trim() || "-"}</dd>
                </div>
                <div>
                  <dt>담당 업무</dt>
                  <dd>{overview.user.duty?.trim() || "-"}</dd>
                </div>
                <div>
                  <dt>가입일</dt>
                  <dd>{formatDate(overview.user.createdAt)}</dd>
                </div>
                <div>
                  <dt>명함 첨부</dt>
                  <dd>
                    {overview.user.businessCardUrl ? (
                      <a href={overview.user.businessCardUrl} target="_blank" rel="noreferrer">
                        첨부 파일 보기
                      </a>
                    ) : (
                      "첨부 없음"
                    )}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="admin-card">
              <header className="admin-card__head">
                <div>
                  <h2>소속 농협 지갑</h2>
                  <p>회원가입으로 연결된 농협 통합 지갑 정보입니다.</p>
                </div>
              </header>
              <dl className="admin-define">
                <div>
                  <dt>농협명</dt>
                  <dd>
                    {overview.organization?.cooperativeName ??
                      overview.user.cooperativeName ??
                      "-"}
                  </dd>
                </div>
                <div>
                  <dt>지갑 잔액</dt>
                  <dd>{walletBalance.toLocaleString()}P</dd>
                </div>
                <div>
                  <dt>누적 적립</dt>
                  <dd>{earnedPoints.toLocaleString()}P</dd>
                </div>
                <div>
                  <dt>누적 사용</dt>
                  <dd>{usedPoints.toLocaleString()}P</dd>
                </div>
                <div>
                  <dt>조직 회원 수</dt>
                  <dd>{overview.organization?.users?.length ?? 0}명</dd>
                </div>
                <div>
                  <dt>조직 생성일</dt>
                  <dd>{formatDate(overview.organization?.createdAt)}</dd>
                </div>
                <div>
                  <dt>최근 업데이트</dt>
                  <dd>{formatDate(overview.organization?.updatedAt)}</dd>
                </div>
              </dl>
            </div>

            <div className="admin-card admin-card--span-2">
              <header className="admin-card__head">
                <div>
                  <h2>계정 동의 항목</h2>
                  <p>회원가입 시 동의한 항목을 확인하고, 선택 수신 항목은 토글로 변경할 수 있습니다.</p>
                </div>
              </header>
              <div className="admin-consent-list">
                <div className="admin-consent-group">
                  <h3 className="admin-consent-group__title">필수 동의</h3>
                  {[
                    { label: "이용약관", value: overview.user.consents?.terms },
                    {
                      label: "개인정보 수집·이용",
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
                      <em>{item.value ? "동의" : "미동의"}</em>
                    </div>
                  ))}
                </div>

                <div className="admin-consent-group">
                  <h3 className="admin-consent-group__title">선택 수신 동의</h3>
                  <p className="admin-consent-group__hint">
                    마케팅·이메일·SMS·카카오 알림 수신 여부를 직접 변경할 수
                    있습니다.
                  </p>
                  {(
                    [
                      ["marketing", "마케팅 정보 수신"],
                      ["email", "이메일 수신"],
                      ["sms", "SMS 수신"],
                      ["kakao", "카카오 알림 수신"],
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
                          disabled={saving}
                          aria-label={`${label} ${checked ? "동의" : "미동의"}`}
                          onChange={(event) =>
                            void updateConsent(key, event.target.checked)
                          }
                        />
                        <span aria-hidden="true" className="admin-consent-row__toggle" />
                        <em>{saving ? "저장 중" : checked ? "동의" : "미동의"}</em>
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
                    <h2>회원가입 마무리</h2>
                    <p>
                      소속 농협 정보를 입력하면 통합 지갑과 답변 열람 기능을
                      이용할 수 있어요.
                    </p>
                  </div>
                  <Link className="admin-btn admin-btn--primary" href="/signup">
                    회원가입 이어가기
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
