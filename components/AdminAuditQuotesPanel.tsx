"use client";

import { useEffect, useMemo, useState } from "react";
import type { AuditQuoteDetail, AuditQuoteListItem } from "@/lib/audit-quote/admin";
import {
  AUDIT_QUOTE_STATUSES,
  allowedNextStatuses,
} from "@/lib/audit-quote/status";
import { getFirebaseAuth } from "@/lib/firebase/client";
import {
  ADMIN_AUDIT_QUOTE_FILTERS,
  createAdminOperationsCopy,
  formatAdminOperationsMessage,
} from "@/lib/cms/admin-operations-content";
import type { CmsPageContent } from "@/lib/cms/schemas";

type Props = {
  onMessage: (message: { tone: "success" | "error"; text: string }) => void;
  content: CmsPageContent;
  previewMode?: boolean;
};

class AdminRequestError extends Error {
  constructor(readonly code: string) {
    super("Admin request failed");
  }
}

async function adminFetch(path: string, init?: RequestInit) {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new AdminRequestError("auth_required");
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
    throw new AdminRequestError(String(data?.error ?? "request_failed"));
  }
  return data;
}

const previewQuote: AuditQuoteDetail = {
  requestId: "preview-audit-quote",
  publicReference: "AQ-2026-0720",
  emailMasked: "au***@example.com",
  contactName: "최감사",
  status: "received",
  quoteCount: 2,
  campaign: "FY27",
  channel: "web",
  assignedTo: "박운영",
  createdAt: "2026-07-20T08:30:00.000Z",
  updatedAt: "2026-07-20T09:00:00.000Z",
  marketingConsent: true,
  email: "audit@example.com",
  phone: "010-5555-1234",
  privacyPolicyVersion: "2026-07",
  pagePath: "/events/audit-quote",
};

export function AdminAuditQuotesPanel({
  onMessage,
  content,
  previewMode = false,
}: Props) {
  const copy = useMemo(() => createAdminOperationsCopy(content), [content]);
  const section = copy.section("auditQuotes");
  const statusLabel = (status: string) => {
    const option = ADMIN_AUDIT_QUOTE_FILTERS.find(
      (candidate) => candidate.value === status,
    );
    return option ? section.item(`status.${option.id}`) : status;
  };
  const [loading, setLoading] = useState(!previewMode);
  const [items, setItems] = useState<AuditQuoteListItem[]>(
    previewMode ? [previewQuote] : [],
  );
  const [receivedCount, setReceivedCount] = useState(previewMode ? 1 : 0);
  const [statusFilter, setStatusFilter] = useState("received");
  const [selectedId, setSelectedId] = useState<string | null>(
    previewMode ? previewQuote.requestId : null,
  );
  const [detail, setDetail] = useState<AuditQuoteDetail | null>(
    previewMode ? previewQuote : null,
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftStatus, setDraftStatus] = useState("");
  const [draftAssignee, setDraftAssignee] = useState("");
  const [draftQuoteCount, setDraftQuoteCount] = useState("0");
  const [listVersion, setListVersion] = useState(0);

  useEffect(() => {
    if (previewMode) return;
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
            error instanceof AdminRequestError &&
            error.code === "auth_required"
              ? copy.message("authRequired")
              : copy.message("auditQuoteListFailed"),
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [statusFilter, listVersion, onMessage, previewMode, copy]);

  async function loadDetail(requestId: string) {
    if (previewMode) {
      setSelectedId(requestId);
      setDetail(previewQuote);
      return;
    }
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
          error instanceof AdminRequestError && error.code === "auth_required"
            ? copy.message("authRequired")
            : copy.message("auditQuoteDetailFailed"),
      });
    } finally {
      setDetailLoading(false);
    }
  }

  const nextStatuses = detail
    ? Array.from(new Set([detail.status, ...allowedNextStatuses(detail.status)]))
    : [];

  async function saveDetail() {
    if (!detail || previewMode) return;
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
      onMessage({ tone: "success", text: copy.message("auditQuoteSaved") });
      setLoading(true);
      setListVersion((value) => value + 1);
    } catch (error) {
      const code = error instanceof AdminRequestError ? error.code : "";
      onMessage({
        tone: "error",
        text:
          code === "auth_required"
            ? copy.message("authRequired")
            : code === "conflict"
            ? copy.message("auditQuoteConflict")
            : code === "invalid_transition"
              ? copy.message("auditQuoteInvalidTransition")
              : copy.message("auditQuoteSaveFailed"),
      });
      if (selectedId) await loadDetail(selectedId);
    } finally {
      setSaving(false);
    }
  }

  async function retryNotify() {
    if (!detail || previewMode) return;
    setSaving(true);
    try {
      const data = await adminFetch(
        `/api/admin/audit-quotes/${detail.requestId}/notify-retry`,
        { method: "POST" }
      );
      onMessage({
        tone: "success",
        text: formatAdminOperationsMessage(
          copy.message("auditQuoteNotifySuccess"),
          {
            status: String(data.notifyStatus),
            attempts: String(data.attempts),
          },
        ),
      });
    } catch (error) {
      onMessage({
        tone: "error",
        text:
          error instanceof AdminRequestError && error.code === "auth_required"
            ? copy.message("authRequired")
            : copy.message("auditQuoteNotifyFailed"),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-grid">
      <div className="admin-card admin-card--span-2">
        <div className="admin-card__head">
          <div>
            <h2>{section.title}</h2>
            <p>
              {section.text("receivedPrefix")} {statusLabel("received")}{" "}
              {receivedCount}
              {section.text("receivedSuffix")}
            </p>
          </div>
          <div className="admin-topbar__actions">
            <label className="admin-field">
              <span>{section.text("statusFilter")}</span>
              <select
                value={statusFilter}
                onChange={(event) => {
                  setLoading(true);
                  setStatusFilter(event.target.value);
                }}
              >
                <option value="all">{section.item("status.all")}</option>
                {AUDIT_QUOTE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
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
              {loading
                ? section.text("refreshing")
                : section.text("refresh")}
            </button>
          </div>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{section.text("referenceColumn")}</th>
                <th>{section.text("contactColumn")}</th>
                <th>{section.text("emailColumn")}</th>
                <th>{section.text("statusColumn")}</th>
                <th>{section.text("quoteCountColumn")}</th>
                <th>{section.text("assigneeColumn")}</th>
                <th>{section.text("receivedAtColumn")}</th>
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
                  <td>{statusLabel(item.status)}</td>
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
                  <td colSpan={7}>{section.text("empty")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card__head">
          <div>
            <h2>{section.text("detailTitle")}</h2>
            <p>{section.text("detailDescription")}</p>
          </div>
        </div>

        {!selectedId && (
          <p className="admin-empty">{section.text("selectDetail")}</p>
        )}
        {selectedId && detailLoading && (
          <p>{section.text("detailLoading")}</p>
        )}
        {detail && !detailLoading && (
          <div className="admin-form">
            <dl className="admin-define">
              <div>
                <dt>{section.text("referenceColumn")}</dt>
                <dd>{detail.publicReference}</dd>
              </div>
              <div>
                <dt>{section.text("contactName")}</dt>
                <dd>{detail.contactName || "-"}</dd>
              </div>
              <div>
                <dt>{section.text("phone")}</dt>
                <dd>{detail.phone || "-"}</dd>
              </div>
              <div>
                <dt>{section.text("originalEmail")}</dt>
                <dd>
                  <code>{detail.email}</code>
                </dd>
              </div>
              <div>
                <dt>{section.text("campaign")}</dt>
                <dd>{detail.campaign}</dd>
              </div>
              <div>
                <dt>{section.text("marketingConsent")}</dt>
                <dd>
                  {detail.marketingConsent
                    ? section.text("agreed")
                    : section.text("notAgreed")}
                </dd>
              </div>
            </dl>

            <label className="admin-field">
              <span>{section.text("status")}</span>
              <select
                value={draftStatus}
                onChange={(event) => setDraftStatus(event.target.value)}
              >
                {nextStatuses.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field">
              <span>{section.text("assignee")}</span>
              <input
                value={draftAssignee}
                onChange={(event) => setDraftAssignee(event.target.value)}
                placeholder={section.text("assigneePlaceholder")}
              />
            </label>

            <label className="admin-field">
              <span>{section.text("quoteCount")}</span>
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
                {saving ? section.text("saving") : section.text("save")}
              </button>
              <button
                type="button"
                className="admin-btn"
                disabled={saving}
                onClick={() => void retryNotify()}
              >
                {section.text("retryNotification")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
