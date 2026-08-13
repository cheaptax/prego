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
import { getPartnerProfessionLabel } from "@/lib/partner-professions";
import { MIN_AUDIT_QUOTE_ASSIGNMENTS } from "@/lib/quotes/audit-quote-assignment";
import type { QuoteAssignmentRecord } from "@/lib/firebase/schema";
import { PartnerNhAuditQuoteForm } from "@/components/PartnerNhAuditQuoteForm";
import {
  EMPTY_NH_AUDIT_PARTNER_FORM,
  validateNhAuditPartnerForm,
  type NhAuditPartnerFormField,
  type NhAuditPartnerFormValues,
} from "@/lib/quotes/nh-audit-quote-form";
import { extractNhAuditEvaluationDefaults } from "@/lib/quotes/nh-audit-evaluation-defaults";

type AssignablePartner = {
  id: string;
  displayName: string;
  name: string;
  profession: string;
  contactEmail: string;
};

type Props = {
  onMessage: (message: { tone: "success" | "error"; text: string }) => void;
  content: CmsPageContent;
  previewMode?: boolean;
};

type ProxySendSkipped = {
  partnerId: string;
  partnerName: string;
  missing?: string[];
  missingLabels: string[];
  missingDetails?: string[];
  fixHints?: string[];
};

type ProxySendResult = {
  requestId: string;
  error?: string;
  assigned?: string[];
  sent?: string[];
  sentVersions?: number[];
  skipped?: ProxySendSkipped[];
  errors?: Array<{
    partnerId: string;
    partnerName?: string;
    error: string;
    errorLabel?: string;
  }>;
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
  targetCooperativeName: "프리고농협",
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
  const [assignablePartners, setAssignablePartners] = useState<
    AssignablePartner[]
  >([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [assignments, setAssignments] = useState<QuoteAssignmentRecord[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [checkedRequestIds, setCheckedRequestIds] = useState<string[]>([]);
  const [proxySending, setProxySending] = useState(false);
  const [proxyPreview, setProxyPreview] = useState<ProxySendResult[] | null>(
    null,
  );
  const [complementPartnerId, setComplementPartnerId] = useState<string | null>(
    null,
  );
  const [complementValues, setComplementValues] =
    useState<NhAuditPartnerFormValues>(EMPTY_NH_AUDIT_PARTNER_FORM);
  const [complementErrors, setComplementErrors] = useState<
    Partial<Record<NhAuditPartnerFormField, string>>
  >({});
  const [complementSaving, setComplementSaving] = useState(false);
  const [automationPresets, setAutomationPresets] = useState<
    Array<{
      assignmentId: string;
      partnerId: string;
      partnerName: string;
      plannedAuditFeeWon: string;
      expenseBillingMode: "INCLUDED_IN_AUDIT_FEE" | "SEPARATELY_BILLED";
      expectedExpenseWon: string;
      safePriceMinWon: string;
      safePriceMaxWon: string;
      isPlannedWinner: boolean;
    }>
  >([]);
  const [automationNotes, setAutomationNotes] = useState("");
  const [automationSaving, setAutomationSaving] = useState(false);

  useEffect(() => {
    if (previewMode) return;
    let cancelled = false;

    (async () => {
      try {
        const query =
          statusFilter && statusFilter !== "all"
            ? `?status=${encodeURIComponent(statusFilter)}`
            : "";
        const [listData, partnerData] = await Promise.all([
          adminFetch(`/api/admin/audit-quotes${query}`),
          adminFetch("/api/admin/audit-quotes/partners"),
        ]);
        if (cancelled) return;
        setItems((listData.items as AuditQuoteListItem[]) ?? []);
        setReceivedCount(Number(listData.receivedCount ?? 0));
        setAssignablePartners(
          (partnerData.partners as AssignablePartner[]) ?? [],
        );
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

  useEffect(() => {
    setCheckedRequestIds((current) =>
      current.filter((id) => items.some((item) => item.requestId === id)),
    );
  }, [items]);

  async function loadDetail(requestId: string) {
    if (previewMode) {
      setSelectedId(requestId);
      setDetail(previewQuote);
      setAssignments([]);
      return;
    }
    setSelectedId(requestId);
    setDetailLoading(true);
    try {
      const [data, assignData, automationData] = await Promise.all([
        adminFetch(`/api/admin/audit-quotes/${requestId}`),
        adminFetch(`/api/admin/audit-quotes/${requestId}/assign`),
        adminFetch(`/api/admin/audit-quotes/${requestId}/automation`).catch(
          () => ({ ok: false }),
        ),
      ]);
      const item = data.item as AuditQuoteDetail;
      setDetail(item);
      setDraftStatus(item.status);
      setDraftAssignee(item.assignedTo ?? "");
      setDraftQuoteCount(String(item.quoteCount));
      const nextAssignments =
        (assignData.assignments as QuoteAssignmentRecord[]) ?? [];
      setAssignments(nextAssignments);
      setSelectedPartnerId("");
      const presets =
        ((automationData as { presets?: typeof automationPresets }).presets ??
          []) as typeof automationPresets;
      setAutomationNotes(
        String((automationData as { plan?: { notes?: string } }).plan?.notes ?? ""),
      );
      setAutomationPresets(
        nextAssignments.map((assignment) => {
          const existing = presets.find(
            (preset) => preset.partnerId === assignment.partnerId,
          );
          return (
            existing ?? {
              assignmentId: assignment.id,
              partnerId: assignment.partnerId,
              partnerName: assignment.partnerName,
              plannedAuditFeeWon: "10000000",
              expenseBillingMode: "INCLUDED_IN_AUDIT_FEE" as const,
              expectedExpenseWon: "0",
              safePriceMinWon: "9000000",
              safePriceMaxWon: "12000000",
              isPlannedWinner: false,
            }
          );
        }),
      );
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

  const assignedPartnerIds = useMemo(
    () => new Set(assignments.map((assignment) => assignment.partnerId)),
    [assignments],
  );
  const availablePartners = useMemo(
    () =>
      assignablePartners.filter(
        (partner) => !assignedPartnerIds.has(partner.id),
      ),
    [assignablePartners, assignedPartnerIds],
  );
  const targetQuoteCount = Math.max(
    Number(draftQuoteCount) || 0,
    assignments.length,
    MIN_AUDIT_QUOTE_ASSIGNMENTS,
  );

  async function saveAutomation() {
    if (!detail || previewMode) return;
    setAutomationSaving(true);
    try {
      const plannedWinner =
        automationPresets.find((item) => item.isPlannedWinner)?.partnerId ??
        null;
      await adminFetch(
        `/api/admin/audit-quotes/${detail.requestId}/automation`,
        {
          method: "PUT",
          body: JSON.stringify({
            plannedWinnerPartnerId: plannedWinner,
            notes: automationNotes,
            partnerPresets: automationPresets.map((item) => ({
              ...item,
              expectedExpenseWon: item.expectedExpenseWon || "0",
            })),
          }),
        },
      );
      onMessage({
        tone: "success",
        text: "견적 자동화 내정을 저장했습니다.",
      });
    } catch {
      onMessage({
        tone: "error",
        text: "견적 자동화 내정을 저장하지 못했습니다.",
      });
    } finally {
      setAutomationSaving(false);
    }
  }

  async function assignPartner() {
    if (!detail || previewMode || !selectedPartnerId) return;
    setAssigning(true);
    try {
      const data = await adminFetch(
        `/api/admin/audit-quotes/${detail.requestId}/assign`,
        {
          method: "POST",
          body: JSON.stringify({ partnerId: selectedPartnerId }),
        },
      );
      const item = data.item as AuditQuoteDetail;
      setDetail(item);
      setDraftStatus(item.status);
      setDraftAssignee(item.assignedTo ?? "");
      setDraftQuoteCount(String(item.quoteCount));
      setAssignments((data.assignments as QuoteAssignmentRecord[]) ?? []);
      setSelectedPartnerId("");
      onMessage({
        tone: "success",
        text: section.text("partnerAssignSuccess"),
      });
      setListVersion((value) => value + 1);
    } catch (error) {
      const code = error instanceof AdminRequestError ? error.code : "";
      onMessage({
        tone: "error",
        text:
          code === "partner_inactive"
            ? section.text("partnerInactiveError")
            : code === "partner_scope_mismatch"
              ? section.text("partnerScopeError")
              : code === "partner_already_assigned"
                ? section.text("partnerAlreadyAssignedError")
                : code === "missing_partner"
                  ? section.text("partnerRequiredError")
                  : section.text("partnerAssignFailed"),
      });
    } finally {
      setAssigning(false);
    }
  }

  async function revokeAssignment(partnerId: string) {
    if (!detail || previewMode) return;
    setAssigning(true);
    try {
      await adminFetch(
        `/api/admin/audit-quotes/${detail.requestId}/assign?partnerId=${encodeURIComponent(partnerId)}`,
        { method: "DELETE" },
      );
      const assignData = await adminFetch(
        `/api/admin/audit-quotes/${detail.requestId}/assign`,
      );
      setAssignments(
        (assignData.assignments as QuoteAssignmentRecord[]) ?? [],
      );
      onMessage({
        tone: "success",
        text: section.text("partnerUnassignSuccess"),
      });
      setListVersion((value) => value + 1);
    } catch {
      onMessage({
        tone: "error",
        text: section.text("partnerUnassignFailed"),
      });
    } finally {
      setAssigning(false);
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

  async function runProxySend(dryRun: boolean) {
    const requestIds =
      checkedRequestIds.length > 0
        ? checkedRequestIds
        : detail?.requestId
          ? [detail.requestId]
          : [];
    if (previewMode || requestIds.length === 0) return;
    setProxySending(true);
    try {
      const data = await adminFetch("/api/admin/audit-quotes/proxy-send", {
        method: "POST",
        body: JSON.stringify({ requestIds, dryRun }),
      });
      const results = (data.results as ProxySendResult[]) ?? [];
      setProxyPreview(results);
      const sentCount = results.reduce(
        (sum, item) => sum + (item.sent?.length ?? 0),
        0,
      );
      const skippedCount = results.reduce(
        (sum, item) => sum + (item.skipped?.length ?? 0),
        0,
      );
      const errorCount = results.reduce(
        (sum, item) => sum + (item.errors?.length ?? 0) + (item.error ? 1 : 0),
        0,
      );
      onMessage({
        tone:
          errorCount > 0 || (!dryRun && sentCount === 0)
            ? "error"
            : "success",
        text: dryRun
          ? `대행 발송 사전검사 완료: 발송 가능 ${sentCount}건 · 보완필요 ${skippedCount}건 · 오류 ${errorCount}건`
          : `대행 발송 완료: 메일 발송 ${sentCount}건 · 보완필요 ${skippedCount}건 · 오류 ${errorCount}건`,
      });
      if (!dryRun) {
        setListVersion((value) => value + 1);
        if (detail?.requestId) await loadDetail(detail.requestId);
      }
    } catch (error) {
      onMessage({
        tone: "error",
        text:
          error instanceof AdminRequestError && error.code === "auth_required"
            ? copy.message("authRequired")
            : "마스터 기준 대행 발송에 실패했습니다.",
      });
    } finally {
      setProxySending(false);
    }
  }

  function skippedPartners() {
    return (proxyPreview ?? []).flatMap((result) =>
      (result.skipped ?? []).map((item) => ({
        ...item,
        requestId: result.requestId,
      })),
    );
  }

  async function saveEvaluationDefaults(partner: ProxySendSkipped) {
    const validation = validateNhAuditPartnerForm({
      ...complementValues,
      auditFeeWon: "1",
      expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
      expectedExpenseWon: "0",
      factsConfirmed: true,
    });
    const defaults = extractNhAuditEvaluationDefaults(complementValues);
    if (!validation.valid || !defaults) {
      setComplementErrors(validation.fieldErrors);
      onMessage({
        tone: "error",
        text: `평가 기본값을 모두 입력해 주세요. 부족한 항목: ${
          validation.missingLabels.filter(
            (label) =>
              !["감사보수", "제경비 청구방식", "예상 제경비", "입력 내용 사실확인 동의"].includes(
                label,
              ),
          ).join(", ") || "평가 항목"
        }`,
      });
      return;
    }
    setComplementSaving(true);
    try {
      await adminFetch(
        `/api/admin/partners/${encodeURIComponent(partner.partnerId)}/nh-audit-defaults`,
        {
          method: "PUT",
          body: JSON.stringify({ nhAuditEvaluationDefaults: defaults }),
        },
      );
      onMessage({
        tone: "success",
        text: `${partner.partnerName} 평가 기본값을 저장했습니다. 사전검사를 다시 실행합니다.`,
      });
      setComplementPartnerId(null);
      await runProxySend(true);
    } catch {
      onMessage({
        tone: "error",
        text: `${partner.partnerName} 평가 기본값을 저장하지 못했습니다.`,
      });
    } finally {
      setComplementSaving(false);
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

        <div className="admin-actions">
          <button
            type="button"
            className="admin-btn"
            disabled={
              proxySending ||
              previewMode ||
              (checkedRequestIds.length === 0 && !detail?.requestId)
            }
            onClick={() => void runProxySend(true)}
          >
            {proxySending ? "검사 중..." : "대행 발송 사전검사"}
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            disabled={
              proxySending ||
              previewMode ||
              (checkedRequestIds.length === 0 && !detail?.requestId)
            }
            onClick={() => void runProxySend(false)}
          >
            {proxySending ? "발송 중..." : "마스터 기준 대행 발송"}
          </button>
          <span className="admin-form__hint">
            선택 {checkedRequestIds.length || (detail ? 1 : 0)}건 · 이미
            발송한 제휴사는 다음 버전(v2, v3…)으로 다시 보냅니다.
          </span>
        </div>

        {proxyPreview ? (
          <div className="admin-note">
            {proxyPreview.map((result) => (
              <p key={result.requestId}>
                {result.requestId}: 메일 발송 {result.sent?.length ?? 0}
                {result.sentVersions && result.sentVersions.length > 0
                  ? ` (${result.sentVersions
                      .map((version) => `v${version}`)
                      .join(", ")})`
                  : ""}{" "}
                · 보완필요 {result.skipped?.length ?? 0} · 오류{" "}
                {result.errors?.length ?? 0}
                {result.error ? ` · ${result.error}` : ""}
              </p>
            ))}
            {skippedPartners().length > 0 ? (
              <div className="admin-table-wrap" style={{ marginTop: 12 }}>
                <p className="admin-form__hint">
                  아래 제휴사는 이번 대행 발송에서 빠집니다. 부족한 항목을
                  저장한 뒤 사전검사를 다시 실행하세요.
                </p>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>제휴사</th>
                      <th>부족한 항목</th>
                      <th>보완 방법</th>
                      <th>보완</th>
                    </tr>
                  </thead>
                  <tbody>
                    {skippedPartners().map((item) => {
                      const needsDefaults = (item.missing ?? []).includes(
                        "evaluation_defaults_missing",
                      );
                      const open = complementPartnerId === item.partnerId;
                      return (
                        <tr key={`${item.requestId}-${item.partnerId}`}>
                          <td>{item.partnerName}</td>
                          <td>
                            {item.missingLabels.join(", ")}
                            {item.missingDetails &&
                            item.missingDetails.length > 0
                              ? ` (${item.missingDetails.join(", ")})`
                              : ""}
                          </td>
                          <td>
                            {(item.fixHints ?? [])
                              .filter(Boolean)
                              .join(" ")}
                          </td>
                          <td>
                            {needsDefaults ? (
                              <button
                                type="button"
                                className="admin-link"
                                onClick={() => {
                                  setComplementPartnerId(
                                    open ? null : item.partnerId,
                                  );
                                  setComplementValues(
                                    EMPTY_NH_AUDIT_PARTNER_FORM,
                                  );
                                  setComplementErrors({});
                                }}
                              >
                                {open ? "닫기" : "평가 기본값 입력"}
                              </button>
                            ) : (
                              "제휴사 관리에서 보완"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {skippedPartners().map((item) =>
                  complementPartnerId === item.partnerId ? (
                    <div key={`form-${item.partnerId}`} style={{ marginTop: 12 }}>
                      <PartnerNhAuditQuoteForm
                        idPrefix={`proxy-defaults-${item.partnerId}`}
                        accountingFirmName={item.partnerName}
                        values={complementValues}
                        errors={complementErrors}
                        disabled={complementSaving}
                        heading={`${item.partnerName} 평가 기본값`}
                        description="담당회계사와 2025년 수행실적 등 제휴사 공통 평가항목만 저장합니다. 감사보수는 견적 가격 마스터 예정가를 사용합니다."
                        showCostFields={false}
                        showFactsConfirmation={false}
                        showRequestContext={false}
                        onChange={setComplementValues}
                        onClearError={(field) =>
                          setComplementErrors((current) => {
                            const next = { ...current };
                            delete next[field];
                            return next;
                          })
                        }
                      />
                      <div className="admin-topbar__actions">
                        <button
                          type="button"
                          className="admin-btn admin-btn--primary"
                          disabled={complementSaving}
                          onClick={() => void saveEvaluationDefaults(item)}
                        >
                          {complementSaving
                            ? "저장 중..."
                            : "평가 기본값 저장 후 재검사"}
                        </button>
                      </div>
                    </div>
                  ) : null,
                )}
              </div>
            ) : null}
            {proxyPreview.some(
              (result) => (result.errors?.length ?? 0) > 0 || result.error,
            ) ? (
              <div className="admin-table-wrap" style={{ marginTop: 12 }}>
                <p className="admin-form__hint">
                  아래 오류 때문에 고객 메일이 나가지 않았습니다. 메일 설정
                  오류면 Resend API 키와 발신 주소를 확인한 뒤 다시 발송하세요.
                </p>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>제휴사</th>
                      <th>오류</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proxyPreview.flatMap((result) => [
                      result.error ? (
                        <tr key={`${result.requestId}-request-error`}>
                          <td>요청 전체</td>
                          <td>{result.error}</td>
                        </tr>
                      ) : null,
                      ...(result.errors ?? []).map((item) => (
                        <tr key={`${result.requestId}-${item.partnerId}`}>
                          <td>{item.partnerName || item.partnerId}</td>
                          <td>{item.errorLabel || item.error}</td>
                        </tr>
                      )),
                    ])}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={
                      items.length > 0 &&
                      checkedRequestIds.length === items.length
                    }
                    onChange={(event) =>
                      setCheckedRequestIds(
                        event.target.checked
                          ? items.map((item) => item.requestId)
                          : [],
                      )
                    }
                    aria-label="전체 선택"
                  />
                </th>
                <th>농협명</th>
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
                    <input
                      type="checkbox"
                      checked={checkedRequestIds.includes(item.requestId)}
                      onChange={(event) =>
                        setCheckedRequestIds((current) =>
                          event.target.checked
                            ? [...new Set([...current, item.requestId])]
                            : current.filter((id) => id !== item.requestId),
                        )
                      }
                      aria-label={`${item.publicReference} 선택`}
                    />
                  </td>
                  <td>{item.targetCooperativeName || "-"}</td>
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
                  <td colSpan={9}>{section.text("empty")}</td>
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
              <span>{section.text("partnerAssignLabel")}</span>
              <select
                value={selectedPartnerId}
                onChange={(event) => setSelectedPartnerId(event.target.value)}
              >
                <option value="">{section.text("partnerAssignPlaceholder")}</option>
                {availablePartners.map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {partner.displayName} ·{" "}
                    {getPartnerProfessionLabel(partner.profession)}
                  </option>
                ))}
              </select>
              <small className="admin-form__hint">
                {section.text("partnerAssignHelp")}
              </small>
              <small className="admin-form__hint">
                {section.text("partnerAssignProgressPrefix")} {assignments.length}
                {" / "}
                {targetQuoteCount}
                {assignments.length < MIN_AUDIT_QUOTE_ASSIGNMENTS
                  ? ` (${section.text("partnerAssignMinimumHint")})`
                  : ""}
              </small>
            </label>

            <div className="admin-topbar__actions">
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                disabled={
                  assigning ||
                  !selectedPartnerId ||
                  previewMode ||
                  availablePartners.length === 0
                }
                onClick={() => void assignPartner()}
              >
                {assigning
                  ? section.text("partnerAssigning")
                  : section.text("partnerAssignAction")}
              </button>
            </div>

            {assignments.length > 0 ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>{section.text("assignedPartnerColumn")}</th>
                      <th>{section.text("assignmentStatusColumn")}</th>
                      <th>{section.text("assignmentActionColumn")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((assignment) => (
                      <tr key={assignment.id}>
                        <td>{assignment.partnerName}</td>
                        <td>{assignment.status}</td>
                        <td>
                          <button
                            type="button"
                            className="admin-link"
                            disabled={assigning || previewMode}
                            onClick={() =>
                              void revokeAssignment(assignment.partnerId)}
                          >
                            {section.text("partnerUnassignAction")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="admin-form__hint">
                {section.text("noPartnerAssigned")}
              </p>
            )}

            {assignments.length > 0 ? (
              <div className="admin-card" style={{ marginTop: 16 }}>
                <h3>견적 자동화 · 안전가격 내정</h3>
                <p className="admin-form__hint">
                  제휴사 승인·배정 후 농협별 예정 견적가와 안전가격 범위를
                  내정하면, 제휴사 견적 입력 기본값과 평가보고서 안전가격
                  조정에 연동됩니다.
                </p>
                {automationNotes.includes("농협 견적 마스터") ? (
                  <p className="admin-form__hint" role="status">
                    농협 견적 마스터에서 자동 시드된 내정입니다. 이 요청에서
                    수정하면 요청별 값이 우선 적용됩니다.
                  </p>
                ) : null}
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>제휴사</th>
                        <th>예정 감사보수</th>
                        <th>안전 최소</th>
                        <th>안전 최대</th>
                        <th>선정예정</th>
                      </tr>
                    </thead>
                    <tbody>
                      {automationPresets.map((preset, index) => (
                        <tr key={preset.partnerId}>
                          <td>{preset.partnerName}</td>
                          <td>
                            <input
                              className="admin-input"
                              value={preset.plannedAuditFeeWon}
                              onChange={(event) =>
                                setAutomationPresets((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? {
                                          ...item,
                                          plannedAuditFeeWon:
                                            event.target.value.replace(
                                              /\D/g,
                                              "",
                                            ),
                                        }
                                      : item,
                                  ),
                                )}
                            />
                          </td>
                          <td>
                            <input
                              className="admin-input"
                              value={preset.safePriceMinWon}
                              onChange={(event) =>
                                setAutomationPresets((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? {
                                          ...item,
                                          safePriceMinWon:
                                            event.target.value.replace(
                                              /\D/g,
                                              "",
                                            ),
                                        }
                                      : item,
                                  ),
                                )}
                            />
                          </td>
                          <td>
                            <input
                              className="admin-input"
                              value={preset.safePriceMaxWon}
                              onChange={(event) =>
                                setAutomationPresets((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? {
                                          ...item,
                                          safePriceMaxWon:
                                            event.target.value.replace(
                                              /\D/g,
                                              "",
                                            ),
                                        }
                                      : item,
                                  ),
                                )}
                            />
                          </td>
                          <td>
                            <input
                              type="radio"
                              name="planned-winner"
                              checked={preset.isPlannedWinner}
                              onChange={() =>
                                setAutomationPresets((current) =>
                                  current.map((item, itemIndex) => ({
                                    ...item,
                                    isPlannedWinner: itemIndex === index,
                                  })),
                                )}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <label className="admin-field">
                  <span>운영 메모</span>
                  <textarea
                    value={automationNotes}
                    onChange={(event) => setAutomationNotes(event.target.value)}
                    rows={2}
                  />
                </label>
                <button
                  type="button"
                  className="admin-btn admin-btn--primary"
                  disabled={automationSaving || previewMode}
                  onClick={() => void saveAutomation()}
                >
                  {automationSaving ? "저장 중..." : "자동화 내정 저장"}
                </button>
              </div>
            ) : null}

            <label className="admin-field">
              <span>{section.text("assignee")}</span>
              <input
                value={draftAssignee}
                onChange={(event) => setDraftAssignee(event.target.value)}
                placeholder={section.text("assigneePlaceholder")}
              />
              <small className="admin-form__hint">
                {section.text("internalAssigneeHelp")}
              </small>
            </label>

            <label className="admin-field">
              <span>{section.text("quoteCount")}</span>
              <input
                type="number"
                min={MIN_AUDIT_QUOTE_ASSIGNMENTS}
                max={50}
                value={draftQuoteCount}
                onChange={(event) => setDraftQuoteCount(event.target.value)}
              />
              <small className="admin-form__hint">
                {section.text("quoteCountHelp")}
              </small>
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
