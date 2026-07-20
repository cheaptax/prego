"use client";

import { useEffect, useState } from "react";
import type { AuditQuoteDetail, AuditQuoteListItem } from "@/lib/audit-quote/admin";
import {
  AUDIT_QUOTE_STATUSES,
  AUDIT_QUOTE_STATUS_LABELS,
  allowedNextStatuses,
} from "@/lib/audit-quote/status";
import { getFirebaseAuth } from "@/lib/firebase/client";

type Props = {
  onMessage: (message: { tone: "success" | "error"; text: string }) => void;
};

async function adminFetch(path: string, init?: RequestInit) {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  const idToken = await user.getIdToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${idToken}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !data?.ok) {
    throw new Error(String(data?.error ?? "request_failed"));
  }
  return data;
}

export function AdminAuditQuotesPanel({ onMessage }: Props) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AuditQuoteListItem[]>([]);
  const [receivedCount, setReceivedCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState("received");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AuditQuoteDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftStatus, setDraftStatus] = useState("");
  const [draftAssignee, setDraftAssignee] = useState("");
  const [draftQuoteCount, setDraftQuoteCount] = useState("0");
  const [listVersion, setListVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const query =
          statusFilter && statusFilter !== "all"
            ? `?status=${encodeURIComponent(statusFilter)}`
            : "";
        const data = await adminFetch(`/api/admin/audit-quotes${query}`);
        if (cancelled) return;
        setItems((data.items as AuditQuoteListItem[]) ?? []);
        setReceivedCount(Number(data.receivedCount ?? 0));
      } catch (error) {
        if (cancelled) return;
        onMessage({
          tone: "error",
          text:
            error instanceof Error
              ? error.message
              : "견적 접수 목록을 불러오지 못했습니다.",
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [statusFilter, listVersion, onMessage]);

  async function loadDetail(requestId: string) {
    setSelectedId(requestId);
    setDetailLoading(true);
    try {
      const data = await adminFetch(`/api/admin/audit-quotes/${requestId}`);
      const item = data.item as AuditQuoteDetail;
      setDetail(item);
      setDraftStatus(item.status);
      setDraftAssignee(item.assignedTo ?? "");
      setDraftQuoteCount(String(item.quoteCount));
    } catch (error) {
      onMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "상세 정보를 불러오지 못했습니다.",
      });
    } finally {
      setDetailLoading(false);
    }
  }

  const nextStatuses = detail
    ? Array.from(new Set([detail.status, ...allowedNextStatuses(detail.status)]))
    : [];

  async function saveDetail() {
    if (!detail) return;
    setSaving(true);
    try {
      const quoteCount = Number(draftQuoteCount);
      const data = await adminFetch(`/api/admin/audit-quotes/${detail.requestId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: draftStatus,
          assignedTo: draftAssignee.trim() || null,
          quoteCount,
          expectedUpdatedAt: detail.updatedAt || undefined,
        }),
      });
      const item = data.item as AuditQuoteDetail;
      setDetail(item);
      setDraftStatus(item.status);
      setDraftAssignee(item.assignedTo ?? "");
      setDraftQuoteCount(String(item.quoteCount));
      onMessage({ tone: "success", text: "접수 정보를 저장했습니다." });
      setLoading(true);
      setListVersion((value) => value + 1);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      onMessage({
        tone: "error",
        text:
          code === "conflict"
            ? "다른 담당자가 먼저 수정했습니다. 다시 불러온 뒤 저장해 주세요."
            : code === "invalid_transition"
              ? "허용되지 않은 상태 변경입니다."
              : "저장에 실패했습니다.",
      });
      if (selectedId) await loadDetail(selectedId);
    } finally {
      setSaving(false);
    }
  }

  async function retryNotify() {
    if (!detail) return;
    setSaving(true);
    try {
      const data = await adminFetch(
        `/api/admin/audit-quotes/${detail.requestId}/notify-retry`,
        { method: "POST" }
      );
      onMessage({
        tone: "success",
        text: `알림 상태: ${String(data.notifyStatus)} (시도 ${String(data.attempts)})`,
      });
    } catch {
      onMessage({ tone: "error", text: "알림 재시도에 실패했습니다." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-grid">
      <div className="admin-card admin-card--span-2">
        <div className="admin-card__head">
          <div>
            <h2>회계감사 견적 접수</h2>
            <p>
              미처리 received {receivedCount}건 · 목록은 이메일 마스킹, 상세에서만
              원문 확인
            </p>
          </div>
          <div className="admin-topbar__actions">
            <label className="admin-field">
              <span>상태 필터</span>
              <select
                value={statusFilter}
                onChange={(event) => {
                  setLoading(true);
                  setStatusFilter(event.target.value);
                }}
              >
                <option value="all">전체</option>
                {AUDIT_QUOTE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {AUDIT_QUOTE_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="admin-btn"
              onClick={() => {
                setLoading(true);
                setListVersion((value) => value + 1);
              }}
              disabled={loading}
            >
              {loading ? "불러오는 중..." : "새로고침"}
            </button>
          </div>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>접수번호</th>
                <th>담당자</th>
                <th>이메일</th>
                <th>상태</th>
                <th>견적수</th>
                <th>담당</th>
                <th>접수시각</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.requestId}
                  className={
                    selectedId === item.requestId
                      ? "admin-row-clickable is-selected"
                      : "admin-row-clickable"
                  }
                >
                  <td>
                    <button
                      type="button"
                      className="admin-link"
                      onClick={() => void loadDetail(item.requestId)}
                    >
                      {item.publicReference}
                    </button>
                  </td>
                  <td>{item.contactName || "-"}</td>
                  <td>{item.emailMasked}</td>
                  <td>{AUDIT_QUOTE_STATUS_LABELS[item.status]}</td>
                  <td>{item.quoteCount}</td>
                  <td>{item.assignedTo || "-"}</td>
                  <td>
                    {item.createdAt
                      ? new Date(item.createdAt).toLocaleString("ko-KR")
                      : "-"}
                  </td>
                </tr>
              ))}
              {items.length === 0 && !loading && (
                <tr>
                  <td colSpan={7}>조건에 맞는 접수가 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card__head">
          <div>
            <h2>상세</h2>
            <p>권한 있는 운영자만 원문 이메일을 확인합니다.</p>
          </div>
        </div>

        {!selectedId && <p className="admin-empty">목록에서 접수를 선택하세요.</p>}
        {selectedId && detailLoading && <p>상세를 불러오는 중...</p>}
        {detail && !detailLoading && (
          <div className="admin-form">
            <dl className="admin-define">
              <div>
                <dt>접수번호</dt>
                <dd>{detail.publicReference}</dd>
              </div>
              <div>
                <dt>담당자 이름</dt>
                <dd>{detail.contactName || "-"}</dd>
              </div>
              <div>
                <dt>휴대폰 번호</dt>
                <dd>{detail.phone || "-"}</dd>
              </div>
              <div>
                <dt>원문 이메일</dt>
                <dd>
                  <code>{detail.email}</code>
                </dd>
              </div>
              <div>
                <dt>캠페인</dt>
                <dd>{detail.campaign}</dd>
              </div>
              <div>
                <dt>마케팅 동의</dt>
                <dd>{detail.marketingConsent ? "동의" : "미동의"}</dd>
              </div>
            </dl>

            <label className="admin-field">
              <span>상태</span>
              <select
                value={draftStatus}
                onChange={(event) => setDraftStatus(event.target.value)}
              >
                {nextStatuses.map((status) => (
                  <option key={status} value={status}>
                    {AUDIT_QUOTE_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field">
              <span>담당자</span>
              <input
                value={draftAssignee}
                onChange={(event) => setDraftAssignee(event.target.value)}
                placeholder="담당자 이메일 또는 이름"
              />
            </label>

            <label className="admin-field">
              <span>견적 수 (quoteCount)</span>
              <input
                type="number"
                min={0}
                max={50}
                value={draftQuoteCount}
                onChange={(event) => setDraftQuoteCount(event.target.value)}
              />
            </label>

            <div className="admin-topbar__actions">
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                disabled={saving}
                onClick={() => void saveDetail()}
              >
                {saving ? "저장 중..." : "저장"}
              </button>
              <button
                type="button"
                className="admin-btn"
                disabled={saving}
                onClick={() => void retryNotify()}
              >
                알림 재시도
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
