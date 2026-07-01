"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebase/client";
import {
  getRequestStatusLabel,
  resolveRequestStatus,
} from "@/lib/request-status";
import type {
  AnswerRatingRecord,
  AnswerRecord,
  AnswerViewRecord,
  ConsultRequestRecord,
  OrganizationRecord,
  UserRecord,
} from "@/lib/firebase/schema";

type Props = { requestId: string };
type State = "loading" | "ready" | "not-found" | "error";
type Overview = {
  user: UserRecord;
  organization: OrganizationRecord | null;
  requests: ConsultRequestRecord[];
  answers: AnswerRecord[];
  views: AnswerViewRecord[];
  ratings: AnswerRatingRecord[];
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

function visibilityLabel(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "public") return "전체공개";
  if (normalized === "nonghyup" || normalized === "org_only") return "우리농협공개";
  return "미공개";
}

export function RequestDetailPage({ requestId }: Props) {
  const router = useRouter();
  const [state, setState] = useState<State>("loading");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [revealedAnswer, setRevealedAnswer] = useState<AnswerRecord | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState("");
  const [viewConfirmOpen, setViewConfirmOpen] = useState(false);
  const [ratingScore, setRatingScore] = useState<number | null>(null);
  const [ratingHelpful, setRatingHelpful] = useState<boolean | null>(null);
  const [ratingComment, setRatingComment] = useState("");
  const [ratingLoading, setRatingLoading] = useState(false);
  const [ratingMessage, setRatingMessage] = useState("");
  const [completeLoading, setCompleteLoading] = useState(false);
  const [completeMessage, setCompleteMessage] = useState("");
  const [completeConfirmOpen, setCompleteConfirmOpen] = useState(false);
  const [completionRatingOpen, setCompletionRatingOpen] = useState(false);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const unsubscribe = onAuthStateChanged(auth, async (user: User | null) => {
      if (!user) {
        router.push("/login");
        return;
      }

      try {
        const idToken = await user.getIdToken();
        const res = await fetch("/api/me/overview", {
          headers: { authorization: `Bearer ${idToken}` },
        });
        const data = (await res.json()) as ({ ok?: boolean; error?: string } & Partial<Overview>);
        if (!res.ok || !data.ok || !data.user) {
          throw new Error(data.error ?? "문의 상세를 불러오지 못했습니다.");
        }
        setOverview({
          user: data.user,
          organization: data.organization ?? null,
          requests: data.requests ?? [],
          answers: data.answers ?? [],
          views: data.views ?? [],
          ratings: data.ratings ?? [],
        });
        setState((data.requests ?? []).some((request) => request.id === requestId) ? "ready" : "not-found");
      } catch (err) {
        if (err instanceof Error && err.message === "approval_pending") {
          router.push("/pending-approval");
          return;
        }
        setError(err instanceof Error ? err.message : "문의 상세를 불러오지 못했습니다.");
        setState("error");
      }
    });
    return () => unsubscribe();
  }, [requestId, router]);

  const request = useMemo(
    () => overview?.requests.find((item) => item.id === requestId),
    [overview?.requests, requestId]
  );
  const answer = useMemo(
    () => overview?.answers.find((item) => item.requestId === requestId),
    [overview?.answers, requestId]
  );
  const alreadyViewed = useMemo(
    () => Boolean(overview?.views.some((item) => item.requestId === requestId)),
    [overview?.views, requestId]
  );
  const visibleAnswer = alreadyViewed ? answer : revealedAnswer;
  const currentRating = useMemo(
    () => overview?.ratings.find((item) => item.requestId === requestId),
    [overview?.ratings, requestId]
  );
  const hasRating = Boolean(currentRating);
  const isCompleted = ["completed", "COMPLETED"].includes(
    String(request?.status ?? "")
  );
  const effectiveRatingScore = ratingScore ?? currentRating?.score ?? 5;
  const effectiveRatingHelpful = ratingHelpful ?? currentRating?.helpful ?? true;
  const effectiveRatingComment = ratingComment || currentRating?.comment || "";
  const walletBalance = overview?.organization?.walletBalance ?? 0;
  const answerPointCost = answer?.pointCost ?? 0;
  const canPayAnswerView = alreadyViewed || walletBalance >= answerPointCost;
  const displayStatus = useMemo(() => {
    if (!request) return "SUBMITTED" as const;
    return resolveRequestStatus(request, {
      hasAnswer: Boolean(answer),
      hasAnswerView: alreadyViewed,
    });
  }, [request, answer, alreadyViewed]);

  const handleViewAnswer = useCallback(async () => {
    const user = getFirebaseAuth().currentUser;
    if (!user || !answer) return;
    setViewConfirmOpen(false);
    setViewLoading(true);
    setViewError("");
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/me/answers/${requestId}/view`, {
        method: "POST",
        headers: { authorization: `Bearer ${idToken}` },
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        answer?: AnswerRecord;
        walletBalance?: number;
      };
      if (!res.ok || !data.ok || !data.answer) {
        throw new Error(data.error ?? "답변을 열람하지 못했습니다.");
      }
      const viewedAnswer = data.answer;
      setRevealedAnswer(viewedAnswer);
      setOverview((current) =>
        current
          ? {
              ...current,
              organization: current.organization
                ? {
                    ...current.organization,
                    walletBalance:
                      data.walletBalance ?? current.organization.walletBalance,
                  }
                : current.organization,
              views: [
                ...current.views.filter((item) => item.requestId !== requestId),
                {
                  id: `${requestId}_${user.uid}`,
                  requestId,
                  answerId: viewedAnswer.id,
                  cooperativeId: current.user.cooperativeId ?? "",
                  nh_org_id: current.user.nh_org_id ?? current.user.cooperativeId,
                  uid: user.uid,
                  pointCost: viewedAnswer.pointCost,
                  charged: !alreadyViewed,
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : current
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "답변을 열람하지 못했습니다.";
      setViewError(
        message === "insufficient_points"
          ? "포인트가 부족하여 답변을 열람할 수 없습니다."
          : message
      );
    } finally {
      setViewLoading(false);
    }
  }, [alreadyViewed, answer, requestId]);

  const handleSaveRating = useCallback(async () => {
    const user = getFirebaseAuth().currentUser;
    if (!user || !visibleAnswer) return;
    setRatingLoading(true);
    setRatingMessage("");
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/me/answers/${requestId}/rating`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${idToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          score: effectiveRatingScore,
          helpful: effectiveRatingHelpful,
          comment: effectiveRatingComment,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "rating_failed");
      }

      const now = new Date().toISOString();
      const nextRating: AnswerRatingRecord = {
        id: `${requestId}_${user.uid}`,
        requestId,
        answerId: visibleAnswer.id,
        uid: user.uid,
        score: effectiveRatingScore,
        helpful: effectiveRatingHelpful,
        comment: effectiveRatingComment.trim() || undefined,
        createdAt: currentRating?.createdAt ?? now,
        updatedAt: now,
      };
      setOverview((current) =>
        current
          ? {
              ...current,
              ratings: [
                ...current.ratings.filter((item) => item.requestId !== requestId),
                nextRating,
              ],
            }
          : current
      );
      setRatingMessage("답변 평가를 저장했습니다. 이제 문의를 완료할 수 있습니다.");
      setCompletionRatingOpen(true);
    } catch (err) {
      setRatingMessage(
        err instanceof Error && err.message === "answer_not_viewed"
          ? "답변 열람 후 평가를 남길 수 있습니다."
          : "답변 평가를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."
      );
    } finally {
      setRatingLoading(false);
    }
  }, [
    currentRating,
    effectiveRatingComment,
    effectiveRatingHelpful,
    effectiveRatingScore,
    requestId,
    visibleAnswer,
  ]);

  const handleCompleteClick = useCallback(() => {
    if (isCompleted) return;
    if (!visibleAnswer) {
      setCompleteMessage("답변을 먼저 열람한 뒤 문의를 완료할 수 있습니다.");
      return;
    }
    if (!hasRating) {
      setCompletionRatingOpen(true);
      setCompleteMessage("문의 완료 전 답변 평가를 작성해 주세요.");
      return;
    }
    setCompleteConfirmOpen(true);
  }, [hasRating, isCompleted, visibleAnswer]);

  const handleCompleteRequest = useCallback(async () => {
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    setCompleteConfirmOpen(false);
    setCompleteLoading(true);
    setCompleteMessage("");
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/me/requests/${requestId}/complete`, {
        method: "POST",
        headers: { authorization: `Bearer ${idToken}` },
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        status?: ConsultRequestRecord["status"];
        updatedAt?: string;
      } | null;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "complete_failed");
      }

      setOverview((current) =>
        current
          ? {
              ...current,
              requests: current.requests.map((item) =>
                item.id === requestId
                  ? {
                      ...item,
                      status: data.status ?? "COMPLETED",
                      updatedAt: data.updatedAt ?? new Date().toISOString(),
                    }
                  : item
              ),
            }
          : current
      );
      setCompleteMessage("문의가 완료 처리되었습니다.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setCompleteMessage(
        message === "rating_required"
          ? "문의 완료 전 답변 평가를 먼저 작성해 주세요."
          : message === "answer_not_viewed"
            ? "답변을 먼저 열람한 뒤 문의를 완료할 수 있습니다."
            : "문의 완료 처리에 실패했습니다. 잠시 후 다시 시도해 주세요."
      );
    } finally {
      setCompleteLoading(false);
    }
  }, [requestId]);

  const backLink = (
    <div className="request-detail-toolbar">
      <Link className="request-detail-back" href="/mypage?tab=inquiries">
        ← 문의 내역으로 돌아가기
      </Link>
      <span className="request-detail-toolbar__hint">문의 내역으로 돌아갑니다.</span>
    </div>
  );

  if (state === "loading") {
    return (
      <section className="portal-layout portal-layout--detail portal-layout--single">
        <div className="portal-main">
          {backLink}
          <div className="portal-card">
            <h2>문의 내용을 불러오는 중입니다.</h2>
          </div>
        </div>
      </section>
    );
  }

  if (state === "error") {
    return (
      <section className="portal-layout portal-layout--detail portal-layout--single">
        <div className="portal-main">
          {backLink}
          <div className="portal-card">
            <h2>문의 상세를 불러오지 못했습니다.</h2>
            <p>{error}</p>
          </div>
        </div>
      </section>
    );
  }

  if (state === "not-found" || !request) {
    return (
      <section className="portal-layout portal-layout--detail portal-layout--single">
        <div className="portal-main">
          {backLink}
          <div className="portal-card">
            <h2>조회할 수 없는 문의입니다.</h2>
            <p>공개범위 또는 소속 농협 권한을 확인해 주세요.</p>
            <Link className="request-detail-back" href="/mypage?tab=inquiries">
              ← 문의 내역으로 돌아가기
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="portal-layout portal-layout--detail portal-layout--single">
      <div className="portal-main">
        <div className="request-detail-toolbar">
          <Link className="request-detail-back" href="/mypage?tab=inquiries">
            ← 문의 내역으로 돌아가기
          </Link>
          <span className="request-detail-toolbar__hint">문의 내역으로 돌아갑니다.</span>
        </div>

        <div className="wallet-hero wallet-hero--compact request-detail-hero">
          <div>
            <span className="kicker">Inquiry Detail</span>
            <h2>{request.subject}</h2>
            <p>{request.requestNumber}</p>
          </div>
          <dl className="request-detail-summary">
            <div>
              <dt>상태</dt>
              <dd>{getRequestStatusLabel(displayStatus)}</dd>
            </div>
            <div>
              <dt>공개범위</dt>
              <dd>{visibilityLabel(request.visibility)}</dd>
            </div>
            <div>
              <dt>농협 포인트</dt>
              <dd>{walletBalance.toLocaleString()}P</dd>
            </div>
          </dl>
        </div>

        <article className="portal-card">
          <span className="tag tag--gold">문의 내용</span>
          <h3>{request.subject}</h3>
          <p>{request.message}</p>
          <p>접수일: {formatDate(request.createdAt)}</p>
        </article>

        {(request.attachments?.length ?? 0) > 0 && (
          <article className="portal-card">
            <span className="tag tag--gold">첨부 사진</span>
            <h3>등록한 사진 {request.attachments?.length ?? 0}장</h3>
            <ul className="attachment-grid">
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
          </article>
        )}

        <article className="portal-card">
          <span className="tag tag--gold">답변 내용</span>
          <h3>{answer ? "답변이 등록되었습니다." : "운영자가 답변을 준비 중입니다."}</h3>
          {answer && visibleAnswer ? (
            <div className="answer-body">
              <p>
                {visibleAnswer.body?.trim() ||
                  "등록된 답변 본문이 없습니다. 운영자에게 문의해 주세요."}
              </p>
            </div>
          ) : answer ? (
            <div className="answer-view-panel">
              <p className="answer-view-notice">
                답변을 열람하면 {answer.pointCost.toLocaleString()}P가 차감됩니다.
                이미 열람한 답변은 추가 차감되지 않습니다.
              </p>
              <button
                type="button"
                className="cta cta--solid cta--block answer-view-panel__cta"
                onClick={() => setViewConfirmOpen(true)}
                disabled={viewLoading}
              >
                {viewLoading ? "답변을 여는 중..." : "답변 열람하기"}
              </button>
              {viewError && <p className="answer-view-panel__error">{viewError}</p>}
            </div>
          ) : (
            <p>답변이 완료되면 이 화면에서 바로 확인할 수 있습니다.</p>
          )}
        </article>

        {visibleAnswer && (
          <article className="portal-card request-actions-card">
            <span className="tag tag--gold">후속 액션</span>
            <h3>답변 확인 후 다음 단계를 선택해 주세요.</h3>
            <p>
              답변으로 해결되지 않은 내용은 후속 문의나 상담 요청으로 이어가고,
              해결된 문의는 평가를 남긴 뒤 완료할 수 있습니다.
            </p>

            <div className="request-action-grid">
              <Link
                className="request-action"
                href={`/consult?parentRequestId=${encodeURIComponent(request.id)}&subject=${encodeURIComponent(`[추가 문의] ${request.subject}`)}`}
              >
                <strong>추가 문의 작성</strong>
                <span>답변과 연결된 후속 문의를 남깁니다.</span>
              </Link>
              <Link
                className="request-action"
                href={`/consult?parentRequestId=${encodeURIComponent(request.id)}&subject=${encodeURIComponent(`[추가상담·견적진행] ${request.subject}`)}`}
              >
                <strong>추가상담·견적진행 요청</strong>
                <span>전문가 연결이나 견적이 필요한 경우 요청합니다.</span>
              </Link>
              {isCompleted ? (
                <span className="request-action request-action--done">
                  <strong>문의 완료됨</strong>
                  <span>평가 작성 후 상담이 종료되었습니다.</span>
                </span>
              ) : (
                <button
                  type="button"
                  className="request-action"
                  onClick={handleCompleteClick}
                  disabled={completeLoading}
                >
                  <strong>문의 완료하기</strong>
                  <span>
                    문제가 해결되었다면 답변 평가를 작성하고 문의를 종료합니다.
                  </span>
                </button>
              )}
            </div>

            {(completionRatingOpen || hasRating) && !isCompleted && (
              <div className="answer-rating-box" id="answer-rating-section">
                <div>
                  <h4>답변 평가 {hasRating ? "(작성 완료)" : "(필수)"}</h4>
                  <p>
                    문의 완료 전 답변 평가를 작성해 주세요. 평가는 운영자가 답변 품질과
                    후속 지원 필요 여부를 확인하는 데 사용됩니다.
                  </p>
                </div>
                <div className="answer-rating-box__score" aria-label="답변 점수">
                  {[1, 2, 3, 4, 5].map((score) => (
                    <button
                      key={score}
                      type="button"
                      className={effectiveRatingScore >= score ? "is-active" : undefined}
                      onClick={() => setRatingScore(score)}
                      aria-label={`${score}점`}
                    >
                      ★
                    </button>
                  ))}
                </div>
                <div className="answer-rating-box__helpful">
                  <label>
                    <input
                      type="radio"
                      name="answer-helpful"
                      checked={effectiveRatingHelpful}
                      onChange={() => setRatingHelpful(true)}
                    />
                    도움이 되었어요
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="answer-helpful"
                      checked={!effectiveRatingHelpful}
                      onChange={() => setRatingHelpful(false)}
                    />
                    보완이 필요해요
                  </label>
                </div>
                <textarea
                  value={effectiveRatingComment}
                  onChange={(event) => setRatingComment(event.target.value)}
                  placeholder="답변에 대한 의견이나 추가로 필요한 도움을 적어주세요."
                  rows={4}
                />
                <div className="answer-rating-box__actions">
                  <button
                    type="button"
                    className="cta cta--solid"
                    onClick={() => void handleSaveRating()}
                    disabled={ratingLoading}
                  >
                    {ratingLoading
                      ? "평가 저장 중..."
                      : hasRating
                        ? "평가 수정하기"
                        : "답변 평가 저장"}
                  </button>
                  <button
                    type="button"
                    className="cta cta--ghost"
                    onClick={handleCompleteClick}
                    disabled={completeLoading || !hasRating}
                  >
                    {completeLoading ? "완료 처리 중..." : "문의 완료 처리"}
                  </button>
                </div>
                {ratingMessage && <p className="request-action-message">{ratingMessage}</p>}
                {completeMessage && <p className="request-action-message">{completeMessage}</p>}
              </div>
            )}
          </article>
        )}
      </div>

      {completeConfirmOpen && (
        <div className="answer-confirm-modal" role="dialog" aria-modal="true">
          <div className="answer-confirm-modal__panel">
            <span className="tag tag--gold">문의 완료</span>
            <h3>상담을 종료하시겠습니까?</h3>
            <p>
              완료 처리 후에는 이 문의의 상담이 종료됩니다. 추가 지원이 필요하면
              완료 전에 추가 문의나 후속 상담 요청을 먼저 진행해 주세요.
            </p>
            <div className="answer-confirm-modal__actions">
              <button
                type="button"
                className="cta cta--ghost"
                onClick={() => setCompleteConfirmOpen(false)}
                disabled={completeLoading}
              >
                계속 진행
              </button>
              <button
                type="button"
                className="cta cta--solid"
                onClick={() => void handleCompleteRequest()}
                disabled={completeLoading}
              >
                {completeLoading ? "완료 처리 중..." : "상담 종료하기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {answer && viewConfirmOpen && (
        <div
          className="answer-confirm-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="answer-view-dialog-title"
        >
          <div className="answer-confirm-modal__panel answer-confirm-modal__panel--view">
            <h3 id="answer-view-dialog-title">답변을 열람하시겠습니까?</h3>
            <p className="answer-confirm-modal__lede">
              답변을 열람하면 {answer.pointCost.toLocaleString()}P가 차감됩니다.
              <br />
              이미 열람한 답변은 추가 차감되지 않습니다.
            </p>
            <dl className="answer-confirm-modal__meta">
              <div>
                <dt>차감 예정 포인트</dt>
                <dd>{answer.pointCost.toLocaleString()}P</dd>
              </div>
              <div>
                <dt>현재 보유 포인트</dt>
                <dd>{walletBalance.toLocaleString()}P</dd>
              </div>
            </dl>
            {!canPayAnswerView && (
              <p className="answer-confirm-modal__error">
                보유 포인트가 부족하여 답변을 열람할 수 없습니다.
              </p>
            )}
            <div className="answer-confirm-modal__actions">
              <button
                type="button"
                className="cta cta--ghost"
                onClick={() => setViewConfirmOpen(false)}
                disabled={viewLoading}
              >
                취소
              </button>
              <button
                type="button"
                className="cta cta--solid"
                onClick={() => void handleViewAnswer()}
                disabled={viewLoading || !canPayAnswerView}
              >
                {viewLoading ? "열람 처리 중..." : "답변 열람하기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
