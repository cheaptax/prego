"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { getFirebaseAuth } from "@/lib/firebase/client";
import {
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
import type { CmsPageContent } from "@/lib/cms/schemas";
import { getCmsSection } from "@/lib/cms/runtime";

type Props = {
  requestId: string;
  content: CmsPageContent;
  previewMode?: boolean;
};
type State = "loading" | "ready" | "not-found" | "error";
type Overview = {
  user: UserRecord;
  organization: OrganizationRecord | null;
  requests: ConsultRequestRecord[];
  answers: AnswerRecord[];
  views: AnswerViewRecord[];
  ratings: AnswerRatingRecord[];
};

const FOLLOWUP_SUBJECT_PREFIX = "[추가 문의]";
const ESTIMATE_SUBJECT_PREFIX = "[추가상담·견적진행]";

function formatDate(value: string | undefined, missingValue: string) {
  if (!value) return missingValue;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function preventPreviewLinkNavigation(event: ReactMouseEvent<HTMLElement>) {
  if ((event.target as HTMLElement).closest("a")) {
    event.preventDefault();
  }
}

function visibilityLabel(
  value: string,
  copy: ReturnType<typeof getCmsSection>,
) {
  const normalized = value.toLowerCase();
  if (normalized === "public") return copy.text.visibilityPublic;
  if (normalized === "nonghyup" || normalized === "org_only") {
    return copy.text.visibilityOrganization;
  }
  return copy.text.visibilityPrivate;
}

const REQUEST_DETAIL_PREVIEW = {
  user: {
    uid: "cms-preview-member",
    cooperativeName: "샘플농협",
  },
  organization: {
    cooperativeName: "샘플농협",
    walletBalance: 120000,
  },
  requests: [
    {
      id: "preview-request",
      uid: "cms-preview-member",
      requestNumber: "REQ-20260721-1001",
      subject: "회계 업무 처리 기준 문의",
      message: "관리자 미리보기용 문의 내용입니다.",
      visibility: "ORG_ONLY",
      status: "ANSWERED",
      attachments: [],
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
  views: [
    {
      requestId: "preview-request",
      uid: "cms-preview-member",
      createdAt: "2026-07-21T09:00:00.000Z",
    },
  ],
  ratings: [],
} as unknown as Overview;

export function RequestDetailPage({
  requestId,
  content,
  previewMode = false,
}: Props) {
  const router = useRouter();
  const summaryCopy = getCmsSection(
    content,
    "member.requestDetail",
    "summary",
  );
  const requestCopy = getCmsSection(
    content,
    "member.requestDetail",
    "requestBody",
  );
  const attachmentsCopy = getCmsSection(
    content,
    "member.requestDetail",
    "attachments",
  );
  const answerCopy = getCmsSection(content, "member.requestDetail", "answer");
  const followupCopy = getCmsSection(
    content,
    "member.requestDetail",
    "followupActions",
  );
  const ratingCopy = getCmsSection(content, "member.requestDetail", "rating");
  const dialogsCopy = getCmsSection(content, "member.requestDetail", "dialogs");
  const messages = content.messages;
  const [state, setState] = useState<State>(previewMode ? "ready" : "loading");
  const [overview, setOverview] = useState<Overview | null>(
    previewMode ? REQUEST_DETAIL_PREVIEW : null,
  );
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
    if (previewMode) return;
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
          throw new Error(data.error ?? messages.loadFailed);
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
        setError(messages.loadFailed);
        setState("error");
      }
    });
    return () => unsubscribe();
  }, [messages.loadFailed, previewMode, requestId, router]);

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
  const statusLabels = {
    SUBMITTED: summaryCopy.text.statusSubmitted,
    ANSWERED: summaryCopy.text.statusAnswered,
    ANSWER_PUBLISHED: summaryCopy.text.statusPublished,
    FOLLOWUP: summaryCopy.text.statusFollowup,
    COMPLETED: summaryCopy.text.statusCompleted,
  } as const;

  async function handleViewAnswer() {
    if (previewMode) return;
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
        throw new Error(data.error ?? messages.viewFailed);
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
      const message =
        err instanceof Error ? err.message : messages.viewFailed;
      setViewError(
        message === "insufficient_points"
          ? messages.insufficientPoints
          : messages.viewFailed,
      );
    } finally {
      setViewLoading(false);
    }
  }

  async function handleSaveRating() {
    if (previewMode) return;
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
      setRatingMessage(messages.ratingSaved);
      setCompletionRatingOpen(true);
    } catch (err) {
      setRatingMessage(
        err instanceof Error && err.message === "answer_not_viewed"
          ? messages.ratingRequiresView
          : messages.ratingFailed,
      );
    } finally {
      setRatingLoading(false);
    }
  }

  function handleCompleteClick() {
    if (isCompleted) return;
    if (!visibleAnswer) {
      setCompleteMessage(messages.completeRequiresView);
      return;
    }
    if (!hasRating) {
      setCompletionRatingOpen(true);
      setCompleteMessage(messages.completeRequiresRating);
      return;
    }
    setCompleteConfirmOpen(true);
  }

  async function handleCompleteRequest() {
    if (previewMode) return;
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
      setCompleteMessage(messages.completeSuccess);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setCompleteMessage(
        message === "rating_required"
          ? messages.completeRequiresRating
          : message === "answer_not_viewed"
            ? messages.completeRequiresView
            : messages.completeFailed,
      );
    } finally {
      setCompleteLoading(false);
    }
  }

  const backLink = (
    <div className="request-detail-toolbar">
      <Link className="request-detail-back" href="/mypage?tab=inquiries">
        {summaryCopy.text.backLabel}
      </Link>
      <span className="request-detail-toolbar__hint">
        {summaryCopy.text.backHint}
      </span>
    </div>
  );

  if (state === "loading") {
    return (
      <section className="portal-layout portal-layout--detail portal-layout--single">
        <div className="portal-main">
          {backLink}
          <div className="portal-card">
            <h2>{messages.loading}</h2>
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
            <h2>{messages.loadFailed}</h2>
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
            <h2>{messages.notFound}</h2>
            <p>{messages.notFoundDescription}</p>
            <Link className="request-detail-back" href="/mypage?tab=inquiries">
              {summaryCopy.text.backLabel}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="portal-layout portal-layout--detail portal-layout--single"
      onClickCapture={previewMode ? preventPreviewLinkNavigation : undefined}
    >
      <div className="portal-main">
        <div className="request-detail-toolbar">
          <Link className="request-detail-back" href="/mypage?tab=inquiries">
            {summaryCopy.text.backLabel}
          </Link>
          <span className="request-detail-toolbar__hint">
            {summaryCopy.text.backHint}
          </span>
        </div>

        <div className="wallet-hero wallet-hero--compact request-detail-hero">
          <div>
            <span className="kicker">{summaryCopy.eyebrow}</span>
            <h2>{request.subject}</h2>
            <p>{request.requestNumber}</p>
          </div>
          <dl className="request-detail-summary">
            <div>
              <dt>{summaryCopy.text.statusLabel}</dt>
              <dd>{statusLabels[displayStatus]}</dd>
            </div>
            <div>
              <dt>{summaryCopy.text.visibilityLabel}</dt>
              <dd>{visibilityLabel(request.visibility, summaryCopy)}</dd>
            </div>
            <div>
              <dt>{summaryCopy.text.pointsLabel}</dt>
              <dd>
                {walletBalance.toLocaleString()}
                {summaryCopy.text.pointUnit}
              </dd>
            </div>
          </dl>
        </div>

        <article className="portal-card">
          <span className="tag tag--gold">{requestCopy.eyebrow}</span>
          <h3>{request.subject}</h3>
          <p>{request.message}</p>
          <p>
            {requestCopy.text.receivedPrefix}{" "}
            {formatDate(request.createdAt, summaryCopy.text.missingValue)}
          </p>
        </article>

        {(request.attachments?.length ?? 0) > 0 && (
          <article className="portal-card">
            <span className="tag tag--gold">{attachmentsCopy.eyebrow}</span>
            <h3>
              {attachmentsCopy.title} {request.attachments?.length ?? 0}
              {attachmentsCopy.text.countSuffix}
            </h3>
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
          <span className="tag tag--gold">{answerCopy.eyebrow}</span>
          <h3>{answer ? answerCopy.title : answerCopy.description}</h3>
          {answer && visibleAnswer ? (
            <div className="answer-body">
              <p>
                {visibleAnswer.body?.trim() ||
                  answerCopy.text.emptyBody}
              </p>
            </div>
          ) : answer ? (
            <div className="answer-view-panel">
              <p className="answer-view-notice">
                {answerCopy.text.pointPrefix}{" "}
                {answer.pointCost.toLocaleString()}
                {answerCopy.text.pointSuffix}{" "}
                {answerCopy.text.noDuplicateCharge}
              </p>
              <button
                type="button"
                className="cta cta--solid cta--block answer-view-panel__cta"
                onClick={() => setViewConfirmOpen(true)}
                disabled={viewLoading}
              >
                {viewLoading
                  ? answerCopy.text.loadingLabel
                  : answerCopy.text.openLabel}
              </button>
              {viewError && <p className="answer-view-panel__error">{viewError}</p>}
            </div>
          ) : (
            <p>{answerCopy.text.pendingDescription}</p>
          )}
        </article>

        {visibleAnswer && (
          <article className="portal-card request-actions-card">
            <span className="tag tag--gold">{followupCopy.eyebrow}</span>
            <h3>{followupCopy.title}</h3>
            <p>{followupCopy.description}</p>

            <div className="request-action-grid">
              <Link
                className="request-action"
                href={`/consult?parentRequestId=${encodeURIComponent(request.id)}&subject=${encodeURIComponent(`${FOLLOWUP_SUBJECT_PREFIX} ${request.subject}`)}`}
              >
                <strong>{followupCopy.text.followupTitle}</strong>
                <span>{followupCopy.text.followupDescription}</span>
              </Link>
              <Link
                className="request-action"
                href={`/consult?parentRequestId=${encodeURIComponent(request.id)}&subject=${encodeURIComponent(`${ESTIMATE_SUBJECT_PREFIX} ${request.subject}`)}`}
              >
                <strong>{followupCopy.text.estimateTitle}</strong>
                <span>{followupCopy.text.estimateDescription}</span>
              </Link>
              {isCompleted ? (
                <span className="request-action request-action--done">
                  <strong>{followupCopy.text.completedTitle}</strong>
                  <span>{followupCopy.text.completedDescription}</span>
                </span>
              ) : (
                <button
                  type="button"
                  className="request-action"
                  onClick={handleCompleteClick}
                  disabled={previewMode || completeLoading}
                >
                  <strong>{followupCopy.text.completeTitle}</strong>
                  <span>{followupCopy.text.completeDescription}</span>
                </button>
              )}
            </div>

            {(completionRatingOpen || hasRating) && !isCompleted && (
              <div className="answer-rating-box" id="answer-rating-section">
                <div>
                  <h4>
                    {ratingCopy.title}{" "}
                    {hasRating
                      ? ratingCopy.text.completedBadge
                      : ratingCopy.text.requiredBadge}
                  </h4>
                  <p>{ratingCopy.description}</p>
                </div>
                <div
                  className="answer-rating-box__score"
                  aria-label={ratingCopy.text.scoreAriaLabel}
                >
                  {[1, 2, 3, 4, 5].map((score) => (
                    <button
                      key={score}
                      type="button"
                      className={effectiveRatingScore >= score ? "is-active" : undefined}
                      onClick={() => setRatingScore(score)}
                      aria-label={`${score}${ratingCopy.text.scoreSuffix}`}
                      disabled={previewMode}
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
                      disabled={previewMode}
                    />
                    {ratingCopy.text.helpfulLabel}
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="answer-helpful"
                      checked={!effectiveRatingHelpful}
                      onChange={() => setRatingHelpful(false)}
                      disabled={previewMode}
                    />
                    {ratingCopy.text.needsWorkLabel}
                  </label>
                </div>
                <textarea
                  value={effectiveRatingComment}
                  onChange={(event) => setRatingComment(event.target.value)}
                  placeholder={ratingCopy.text.commentPlaceholder}
                  rows={4}
                  disabled={previewMode}
                />
                <div className="answer-rating-box__actions">
                  <button
                    type="button"
                    className="cta cta--solid"
                    onClick={() => void handleSaveRating()}
                    disabled={previewMode || ratingLoading}
                  >
                    {ratingLoading
                      ? ratingCopy.text.savingLabel
                      : hasRating
                        ? ratingCopy.text.updateLabel
                        : ratingCopy.text.saveLabel}
                  </button>
                  <button
                    type="button"
                    className="cta cta--ghost"
                    onClick={handleCompleteClick}
                    disabled={previewMode || completeLoading || !hasRating}
                  >
                    {completeLoading
                      ? ratingCopy.text.completingLabel
                      : ratingCopy.text.completeLabel}
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
        <div
          className="answer-confirm-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="complete-request-dialog-title"
        >
          <div className="answer-confirm-modal__panel">
            <span className="tag tag--gold">
              {dialogsCopy.text.completeEyebrow}
            </span>
            <h3 id="complete-request-dialog-title">
              {dialogsCopy.text.completeTitle}
            </h3>
            <p>{dialogsCopy.text.completeDescription}</p>
            <div className="answer-confirm-modal__actions">
              <button
                type="button"
                className="cta cta--ghost"
                onClick={() => setCompleteConfirmOpen(false)}
                disabled={completeLoading}
              >
                {dialogsCopy.text.continueLabel}
              </button>
              <button
                type="button"
                className="cta cta--solid"
                onClick={() => void handleCompleteRequest()}
                disabled={completeLoading}
              >
                {completeLoading
                  ? dialogsCopy.text.completingLabel
                  : dialogsCopy.text.endLabel}
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
            <h3 id="answer-view-dialog-title">
              {dialogsCopy.text.viewTitle}
            </h3>
            <p className="answer-confirm-modal__lede">
              {dialogsCopy.text.pointPrefix} {answer.pointCost.toLocaleString()}
              {dialogsCopy.text.pointSuffix}
              <br />
              {dialogsCopy.text.noDuplicateCharge}
            </p>
            <dl className="answer-confirm-modal__meta">
              <div>
                <dt>{dialogsCopy.text.costLabel}</dt>
                <dd>
                  {answer.pointCost.toLocaleString()}
                  {summaryCopy.text.pointUnit}
                </dd>
              </div>
              <div>
                <dt>{dialogsCopy.text.balanceLabel}</dt>
                <dd>
                  {walletBalance.toLocaleString()}
                  {summaryCopy.text.pointUnit}
                </dd>
              </div>
            </dl>
            {!canPayAnswerView && (
              <p className="answer-confirm-modal__error">
                {dialogsCopy.text.insufficient}
              </p>
            )}
            <div className="answer-confirm-modal__actions">
              <button
                type="button"
                className="cta cta--ghost"
                onClick={() => setViewConfirmOpen(false)}
                disabled={viewLoading}
              >
                {dialogsCopy.text.cancelLabel}
              </button>
              <button
                type="button"
                className="cta cta--solid"
                onClick={() => void handleViewAnswer()}
                disabled={viewLoading || !canPayAnswerView}
              >
                {viewLoading
                  ? dialogsCopy.text.processingLabel
                  : dialogsCopy.text.viewLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
