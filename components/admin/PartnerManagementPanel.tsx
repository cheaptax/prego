"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { AdminNhAuditQuotesPanel } from "@/components/admin/AdminNhAuditQuotesPanel";
import { PartnerQuoteProfileSection } from "@/components/admin/PartnerQuoteProfileSection";
import {
  canShowAdminAction,
  canShowAdminMenu,
} from "@/lib/admin/menu-permissions";
import {
  isDangerousPartnerStatusChange,
  partnerServerErrorCopyKey,
  validatePartnerAccountForm,
  validatePartnerForm,
  type PartnerAccountFormErrors,
  type PartnerAccountView,
  type PartnerDetailView,
  type PartnerFormErrors,
  type PartnerFormInput,
  type PartnerListView,
} from "@/lib/admin/partner-ui";
import { ANSWER_POINT_MAX, ANSWER_POINT_MIN } from "@/lib/answer-points";
import { labelAuditAction } from "@/lib/audit-log-display";
import { INQUIRY_SUPPORT_FIELD_OPTIONS } from "@/lib/inquiry-categories";
import {
  getPartnerProfessionLabel,
  PARTNER_PROFESSION_OPTIONS,
} from "@/lib/partner-professions";
import type { AdminOperationsCopy } from "@/lib/cms/admin-operations-content";
import type {
  AdminStatus,
  AuditLogRecord,
  AuthorizationContext,
  ConsultRequestRecord,
  PartnerApplicationRecord,
  PartnerAnswerDraftRecord,
  PartnerAssignmentRecord,
  PartnerProfession,
  PartnerRecord,
  QuoteAssignmentRecord,
  QuoteRecord,
  QuoteRequestRecord,
} from "@/lib/firebase/schema";
import type { AdminNhAuditQuoteView } from "@/lib/quotes/nh-audit-admin-view";

const PAGE_SIZES = [10, 20, 50] as const;

type AdminQuoteRecord = QuoteRecord & {
  evaluationCompatibility?: {
    status: "CURRENT" | "RESUBMISSION_REQUIRED";
    missingFields: string[];
  } | null;
};

type Confirmation =
  | { kind: "partner-status"; payload: PartnerFormInput }
  | { kind: "terminate" }
  | { kind: "unlink-account"; account: PartnerAccountView };

type AccountEditor = {
  mode: "create" | "edit";
  account: PartnerAccountView | null;
};

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatPoints(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function statusTone(status: PartnerRecord["status"]) {
  if (status === "active") return "green";
  if (status === "pending") return "amber";
  return "slate";
}

function accountStatus(account: PartnerAccountView): AdminStatus {
  if (account.accountStatus) return account.accountStatus;
  if (account.status === "active") return "active";
  if (account.status === "rejected") return "disabled";
  return "invited";
}

function useDialogFocus<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  locked = false,
) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open || locked) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    panel?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (!focusable.length) return;
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
  }, [locked, open]);
  return ref;
}

export function PartnerManagementPanel({
  copy,
  adminContext,
  auditLogs,
  previewMode,
  previewPartners,
  assignments,
  drafts,
  requests,
  workflowLoading,
  revisionNote,
  refreshVersion,
  onRevisionNoteChange,
  onAssignPartner,
  onDraftAction,
}: {
  copy: AdminOperationsCopy;
  adminContext: AuthorizationContext | null;
  auditLogs: AuditLogRecord[];
  previewMode: boolean;
  previewPartners: PartnerRecord[];
  assignments: PartnerAssignmentRecord[];
  drafts: PartnerAnswerDraftRecord[];
  requests: ConsultRequestRecord[];
  workflowLoading: boolean;
  revisionNote: string;
  refreshVersion?: string;
  onRevisionNoteChange: (value: string) => void;
  onAssignPartner: (requestId: string, partnerId: string) => void;
  onDraftAction: (
    draft: PartnerAnswerDraftRecord,
    action: "approve" | "request_revision",
  ) => void;
}) {
  const partnersCopy = useMemo(() => copy.section("partners"), [copy]);
  const inquiryCopy = useMemo(() => copy.section("inquiries"), [copy]);
  const membersCopy = useMemo(() => copy.section("members"), [copy]);
  const canRead = canShowAdminMenu(adminContext, "partners");
  const canReadQuotes = canShowAdminMenu(adminContext, "inquiries");
  const canCreate = canShowAdminAction(adminContext, "partners:create");
  const canUpdate = canShowAdminAction(adminContext, "partners:update");
  const canChangeStatus = canShowAdminAction(
    adminContext,
    "partners:changeStatus",
  );
  const canManageScope = canShowAdminAction(
    adminContext,
    "partners:manageScope",
  );
  const canManageMembers = canShowAdminAction(
    adminContext,
    "partners:manageMembers",
  );
  const canManageInquiries = canShowAdminAction(
    adminContext,
    "inquiries:write",
  );
  const [partners, setPartners] = useState<PartnerListView[]>([]);
  const [partnerOptions, setPartnerOptions] = useState<PartnerListView[]>([]);
  const [applications, setApplications] = useState<PartnerApplicationRecord[]>(
    [],
  );
  const [quoteRequests, setQuoteRequests] = useState<QuoteRequestRecord[]>([]);
  const [quoteAssignments, setQuoteAssignments] = useState<
    QuoteAssignmentRecord[]
  >([]);
  const [quotes, setQuotes] = useState<AdminQuoteRecord[]>([]);
  const [auditQuoteViews, setAuditQuoteViews] = useState<
    AdminNhAuditQuoteView[]
  >([]);
  const [professionFilter, setProfessionFilter] = useState("");
  const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [detail, setDetail] = useState<PartnerDetailView | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editor, setEditor] = useState<"create" | "edit" | null>(null);
  const [accountEditor, setAccountEditor] = useState<AccountEditor | null>(
    null,
  );
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const selectedPartner =
    detail?.partner ??
    partners.find((partner) => partner.id === selectedPartnerId) ??
    null;

  const loadList = useCallback(async () => {
    if (!canRead) return;
    if (previewMode) {
      const items = previewPartners.map((partner) => ({
        ...partner,
        memberCount: 0,
      }));
      setPartners(items);
      setTotal(items.length);
      setTotalPages(1);
      if (!selectedPartnerId && items[0]) setSelectedPartnerId(items[0].id);
      return;
    }
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    setListLoading(true);
    setListError("");
    try {
      const token = await user.getIdToken();
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (search.trim()) params.set("search", search.trim());
      if (professionFilter) params.set("profession", professionFilter);
      if (statusFilter) params.set("status", statusFilter);
      const response = await fetch(`/api/admin/partners?${params.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        partners?: PartnerListView[];
        pagination?: {
          page: number;
          total: number;
          totalPages: number;
        };
      } | null;
      if (!response.ok || !data?.ok) throw new Error("partner_list_failed");
      const items = data.partners ?? [];
      setPartners(items);
      setTotal(data.pagination?.total ?? 0);
      setTotalPages(data.pagination?.totalPages ?? 1);
      if (data.pagination?.page && data.pagination.page !== page) {
        setPage(data.pagination.page);
      }
      if (!selectedPartnerId && items[0]) setSelectedPartnerId(items[0].id);
    } catch {
      setPartners([]);
      setListError(partnersCopy.text("listLoadFailed"));
    } finally {
      setListLoading(false);
    }
  }, [
    canRead,
    page,
    pageSize,
    partnersCopy,
    previewMode,
    previewPartners,
    professionFilter,
    search,
    selectedPartnerId,
    statusFilter,
  ]);

  const loadDetail = useCallback(
    async (partnerId: string) => {
      if (!partnerId || !canRead) return;
      if (previewMode) {
        const partner = previewPartners.find((item) => item.id === partnerId);
        if (!partner) return;
        setDetail({
          partner,
          accounts: [],
          summary: {
            memberCount: 0,
            assignmentCount: assignments.filter(
              (item) => item.partnerId === partnerId,
            ).length,
            activeAssignmentCount: assignments.filter(
              (item) =>
                item.partnerId === partnerId && item.status !== "revoked",
            ).length,
            draftCount: drafts.filter((item) => item.partnerId === partnerId)
              .length,
            answerCount: 0,
          },
        });
        return;
      }
      const user = getFirebaseAuth().currentUser;
      if (!user) return;
      setDetailLoading(true);
      setDetailError("");
      try {
        const token = await user.getIdToken();
        const response = await fetch(`/api/admin/partners/${partnerId}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        const data = (await response.json().catch(() => null)) as
          | ({ ok?: boolean; error?: string } & Partial<PartnerDetailView>)
          | null;
        if (
          !response.ok ||
          !data?.ok ||
          !data.partner ||
          !data.accounts ||
          !data.summary
        ) {
          throw new Error("partner_detail_failed");
        }
        setDetail({
          partner: data.partner,
          accounts: data.accounts,
          summary: data.summary,
        });
      } catch {
        setDetail(null);
        setDetailError(partnersCopy.text("detailLoadFailed"));
      } finally {
        setDetailLoading(false);
      }
    },
    [assignments, canRead, drafts, partnersCopy, previewMode, previewPartners],
  );

  const loadPartnerOptions = useCallback(async () => {
    if (!canManageMembers) return;
    if (previewMode) {
      setPartnerOptions(
        previewPartners.map((partner) => ({ ...partner, memberCount: 0 })),
      );
      return;
    }
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const fetchPage = async (requestedPage: number) => {
        const response = await fetch(
          `/api/admin/partners?page=${requestedPage}&pageSize=50`,
          { headers: { authorization: `Bearer ${token}` } },
        );
        const data = (await response.json().catch(() => null)) as {
          ok?: boolean;
          partners?: PartnerListView[];
          pagination?: { totalPages?: number };
        } | null;
        if (!response.ok || !data?.ok)
          throw new Error("partner_options_failed");
        return data;
      };
      const first = await fetchPage(1);
      const totalOptionPages = first.pagination?.totalPages ?? 1;
      const remaining =
        totalOptionPages > 1
          ? await Promise.all(
              Array.from({ length: totalOptionPages - 1 }, (_, index) =>
                fetchPage(index + 2),
              ),
            )
          : [];
      setPartnerOptions([
        ...(first.partners ?? []),
        ...remaining.flatMap((result) => result.partners ?? []),
      ]);
    } catch {
      setPartnerOptions([]);
    }
  }, [canManageMembers, previewMode, previewPartners]);

  const loadApplications = useCallback(async () => {
    if (!canRead || previewMode) return;
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        "/api/admin/partner-applications?status=pending",
        { headers: { authorization: `Bearer ${token}` } },
      );
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        applications?: PartnerApplicationRecord[];
      } | null;
      if (!response.ok || !data?.ok) throw new Error("applications_failed");
      setApplications(data.applications ?? []);
    } catch {
      setApplications([]);
    }
  }, [canRead, previewMode]);

  const loadQuotes = useCallback(async () => {
    if (!canRead || !canReadQuotes || previewMode) return;
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/admin/quotes", {
        headers: { authorization: `Bearer ${token}` },
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        quoteRequests?: QuoteRequestRecord[];
        assignments?: QuoteAssignmentRecord[];
        quotes?: AdminQuoteRecord[];
        auditQuoteViews?: AdminNhAuditQuoteView[];
      } | null;
      if (!response.ok || !data?.ok) throw new Error("quotes_failed");
      setQuoteRequests(data.quoteRequests ?? []);
      setQuoteAssignments(data.assignments ?? []);
      setQuotes(data.quotes ?? []);
      setAuditQuoteViews(data.auditQuoteViews ?? []);
    } catch {
      setQuoteRequests([]);
      setQuoteAssignments([]);
      setQuotes([]);
      setAuditQuoteViews([]);
    }
  }, [canRead, canReadQuotes, previewMode]);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => {
        void loadList();
      },
      search ? 250 : 0,
    );
    return () => window.clearTimeout(timeout);
  }, [loadList, refreshKey, refreshVersion, search]);

  useEffect(() => {
    if (!selectedPartnerId) return;
    const timeout = window.setTimeout(() => {
      void loadDetail(selectedPartnerId);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadDetail, refreshKey, refreshVersion, selectedPartnerId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadPartnerOptions();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadPartnerOptions, refreshKey, refreshVersion]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadApplications();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadApplications, refreshKey, refreshVersion]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadQuotes();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadQuotes, refreshKey, refreshVersion]);

  const refresh = useCallback(() => {
    setRefreshKey((current) => current + 1);
  }, []);

  const savePartner = async (payload: PartnerFormInput, confirmed = false) => {
    if (previewMode) return;
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    const current = editor === "edit" ? detail?.partner : null;
    if (
      current &&
      !confirmed &&
      isDangerousPartnerStatusChange(current.status, payload.status)
    ) {
      setConfirmation({ kind: "partner-status", payload });
      return;
    }
    setSaving(true);
    setActionError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        current ? `/api/admin/partners/${current.id}` : "/api/admin/partners",
        {
          method: current ? "PATCH" : "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        partner?: PartnerRecord;
        accountCreated?: boolean;
        accessEnabled?: boolean;
      } | null;
      if (!response.ok || !data?.ok || !data.partner) {
        throw new Error(data?.error ?? "partner_save_failed");
      }
      setEditor(null);
      setConfirmation(null);
      setSelectedPartnerId(data.partner.id);
      setActionMessage(
        data.accountCreated
          ? partnersCopy.text(
              data.accessEnabled
                ? "partnerAndAccountSaved"
                : "partnerAndInactiveAccountSaved",
            )
          : partnersCopy.text("partnerSaved"),
      );
      refresh();
    } catch (caught) {
      const code =
        caught instanceof TypeError
          ? "partner_request_failed"
          : caught instanceof Error
            ? caught.message
            : undefined;
      setActionError(partnersCopy.text(partnerServerErrorCopyKey(code)));
    } finally {
      setSaving(false);
    }
  };

  const terminatePartner = async () => {
    if (!selectedPartner || previewMode) return;
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    setSaving(true);
    setActionError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/admin/partners/${selectedPartner.id}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
        },
      );
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error ?? "partner_terminate_failed");
      }
      setConfirmation(null);
      setActionMessage(partnersCopy.text("partnerTerminated"));
      refresh();
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : undefined;
      setActionError(partnersCopy.text(partnerServerErrorCopyKey(code)));
    } finally {
      setSaving(false);
    }
  };

  const saveAccount = async (payload: {
    name: string;
    email: string;
    password?: string;
    phone: string;
    position: string;
    duty: string;
    accountStatus: AdminStatus;
    targetPartnerId?: string;
  }) => {
    if (!selectedPartner || !accountEditor || previewMode) return;
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    setSaving(true);
    setActionError("");
    try {
      const token = await user.getIdToken();
      const account = accountEditor.account;
      const response = await fetch(
        account
          ? `/api/admin/partners/${selectedPartner.id}/accounts/${account.uid}`
          : `/api/admin/partners/${selectedPartner.id}/accounts`,
        {
          method: account ? "PATCH" : "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error ?? "partner_account_save_failed");
      }
      setAccountEditor(null);
      setActionMessage(partnersCopy.text("accountSaved"));
      refresh();
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setActionError(
        code === "partner_account_email_exists"
          ? partnersCopy.text("accountDuplicateEmail")
          : partnersCopy.text("accountSaveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const unlinkAccount = async () => {
    if (
      confirmation?.kind !== "unlink-account" ||
      !selectedPartner ||
      previewMode
    ) {
      return;
    }
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    setSaving(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/admin/partners/${selectedPartner.id}/accounts/${confirmation.account.uid}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
        },
      );
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
      } | null;
      if (!response.ok || !data?.ok) {
        throw new Error("partner_account_unlink_failed");
      }
      setConfirmation(null);
      setActionMessage(partnersCopy.text("accountUnlinked"));
      refresh();
    } catch {
      setActionError(partnersCopy.text("accountUnlinkFailed"));
    } finally {
      setSaving(false);
    }
  };

  const reviewApplication = async (
    applicationId: string,
    action: "approve" | "reject",
  ) => {
    if (previewMode) return;
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    const reviewNote =
      action === "reject"
        ? (window.prompt("반려 사유를 입력해 주세요.")?.trim() ?? "")
        : "";
    const application = applications.find(
      (item) => item.id === applicationId,
    );
    const businessRegistrationNumber =
      action === "approve"
        ? application?.businessRegistrationNumber?.trim() ||
          window
            .prompt(
              "승인할 제휴사의 사업자등록번호를 입력해 주세요.",
              "000-00-00000",
            )
            ?.trim() ||
          ""
        : "";
    const businessAddress =
      action === "approve"
        ? application?.businessAddress?.trim() ||
          window
            .prompt("승인할 제휴사의 사업장 주소를 입력해 주세요.")
            ?.trim() ||
          ""
        : "";
    if (
      action === "approve" &&
      (!/^\d{3}-?\d{2}-?\d{5}$/.test(businessRegistrationNumber) ||
        !businessAddress)
    ) {
      setActionError(
        "승인하려면 올바른 사업자등록번호와 사업장 주소가 필요합니다.",
      );
      return;
    }
    setSaving(true);
    setActionError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/admin/partner-applications/${applicationId}`,
        {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action,
            reviewNote,
            businessRegistrationNumber,
            businessAddress,
          }),
        },
      );
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        partner?: PartnerRecord;
      } | null;
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error ?? "partner_application_review_failed");
      }
      setActionMessage(
        action === "approve"
          ? "제휴 신청을 승인하고 초대 메일을 발송했습니다."
          : "제휴 신청을 반려했습니다.",
      );
      if (data.partner?.id) setSelectedPartnerId(data.partner.id);
      refresh();
    } catch (caught) {
      setActionError(
        caught instanceof Error
          ? caught.message
          : "partner_application_review_failed",
      );
    } finally {
      setSaving(false);
    }
  };

  const assignQuote = async (quoteRequestId: string, partnerId: string) => {
    if (previewMode) return;
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    setSaving(true);
    setActionError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/admin/quotes/${quoteRequestId}/assignments`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ partnerId }),
        },
      );
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error ?? "quote_assignment_failed");
      }
      setActionMessage("견적 요청을 제휴사에 배정했습니다.");
      refresh();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "quote_assignment_failed",
      );
    } finally {
      setSaving(false);
    }
  };

  const selectedAssignments = useMemo(
    () =>
      assignments.filter(
        (assignment) => assignment.partnerId === selectedPartnerId,
      ),
    [assignments, selectedPartnerId],
  );
  const selectedDrafts = useMemo(
    () => drafts.filter((draft) => draft.partnerId === selectedPartnerId),
    [drafts, selectedPartnerId],
  );
  const requestById = useMemo(
    () => new Map(requests.map((request) => [request.id, request])),
    [requests],
  );
  const assignedRequestIds = useMemo(
    () =>
      new Set(
        requests
          .filter((request) => request.assignedPartnerId)
          .map((request) => request.id),
      ),
    [requests],
  );
  const assignableRequests = useMemo(
    () =>
      requests
        .filter((request) => !assignedRequestIds.has(request.id))
        .filter((request) => {
          if (!selectedPartner) return true;
          const requestCategory = (
            request.internalCategory ??
            request.internal_category ??
            ""
          ).trim();
          return (
            !requestCategory || selectedPartner.fields.includes(requestCategory)
          );
        })
        .slice(0, 12),
    [assignedRequestIds, requests, selectedPartner],
  );
  const relatedAuditLogs = useMemo(
    () =>
      auditLogs
        .filter((entry) => entry.targetId === selectedPartnerId)
        .slice(0, 8),
    [auditLogs, selectedPartnerId],
  );
  const quoteAssignmentsByRequestId = useMemo(() => {
    const map = new Map<string, QuoteAssignmentRecord[]>();
    for (const assignment of quoteAssignments) {
      if (assignment.status === "revoked") continue;
      const current = map.get(assignment.quoteRequestId) ?? [];
      current.push(assignment);
      map.set(assignment.quoteRequestId, current);
    }
    return map;
  }, [quoteAssignments]);
  const selectedPartnerQuoteRequests = useMemo(
    () =>
      quoteRequests
        .filter((request) => {
          if (!selectedPartner) return false;
          const assigned = quoteAssignmentsByRequestId.get(request.id) ?? [];
          if (assigned.some((item) => item.partnerId === selectedPartner.id)) {
            return false;
          }
          return (
            !request.supportField ||
            selectedPartner.fields.includes(request.supportField) ||
            (request.sourceType === "audit_quote" &&
              ["ACCOUNTANT", "TAX_ACCOUNTANT", "OTHER"].includes(
                selectedPartner.profession ?? "OTHER",
              ))
          );
        })
        .slice(0, 10),
    [quoteAssignmentsByRequestId, quoteRequests, selectedPartner],
  );

  if (!canRead) {
    return (
      <div className="admin-card admin-inline-state admin-inline-state--error">
        {partnersCopy.text("accessDenied")}
      </div>
    );
  }

  return (
    <>
      <div className="admin-grid admin-grid--partner-management">
        {canReadQuotes ? (
          <AdminNhAuditQuotesPanel
            copy={copy}
            quotes={auditQuoteViews}
          />
        ) : null}
        <section className="admin-card admin-card--span-2">
          <header className="admin-card__head">
            <div>
              <h2>견적 운영 현황</h2>
              <p>일반 상담·감사견적에서 생성된 공통 견적요청입니다.</p>
            </div>
            <a
              className="admin-btn"
              href="/admin/operations/quote-screens"
            >
              법인별 견적서 템플릿
            </a>
          </header>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>요청</th>
                  <th>원본</th>
                  <th>상태</th>
                  <th>배정</th>
                  <th>제출 견적</th>
                  <th>{membersCopy.text("actionsColumn")}</th>
                </tr>
              </thead>
              <tbody>
                {quoteRequests.slice(0, 12).map((request) => {
                  const requestAssignments =
                    quoteAssignmentsByRequestId.get(request.id) ?? [];
                  const requestQuotes = quotes.filter(
                    (quote) => quote.quoteRequestId === request.id,
                  );
                  const resubmissionRequired = requestQuotes.filter(
                    (quote) =>
                      quote.evaluationCompatibility?.status ===
                      "RESUBMISSION_REQUIRED",
                  );
                  const canAssignSelected =
                    Boolean(selectedPartner) &&
                    selectedPartnerQuoteRequests.some(
                      (item) => item.id === request.id,
                    );
                  return (
                    <tr key={request.id}>
                      <td>
                        <strong>{request.subject}</strong>
                        <span className="admin-cell-sub">
                          {request.sourceReference ?? request.id}
                        </span>
                      </td>
                      <td>{request.sourceType}</td>
                      <td>{request.status}</td>
                      <td>
                        {requestAssignments.length > 0
                          ? `${requestAssignments
                              .map((item) => item.partnerName)
                              .join(", ")} (${requestAssignments.length}/${
                              request.expectedQuoteCount ??
                              Math.max(requestAssignments.length, 2)
                            })`
                          : "-"}
                      </td>
                      <td>
                        {requestQuotes.length.toLocaleString()}
                        {resubmissionRequired.length > 0 ? (
                          <span className="admin-cell-sub">
                            {partnersCopy.text("resubmissionRequiredLabel")}{" "}
                            {resubmissionRequired.length}건:{" "}
                            {[
                              ...new Set(
                                resubmissionRequired.flatMap(
                                  (quote) =>
                                    quote.evaluationCompatibility
                                      ?.missingFields ?? [],
                                ),
                              ),
                            ].join(", ")}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {canAssignSelected && selectedPartner ? (
                          <button
                            type="button"
                            className="admin-link"
                            disabled={saving}
                            onClick={() =>
                              void assignQuote(request.id, selectedPartner.id)
                            }
                          >
                            선택 제휴사에 추가 배정
                          </button>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  );
                })}
                {quoteRequests.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="admin-empty">
                      생성된 견적 요청이 없습니다.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
        <section className="admin-card admin-card--span-2">
          <header className="admin-card__head">
            <div>
              <h2>제휴 신청함</h2>
              <p>제휴 신청하기 페이지로 접수된 승인 대기 건입니다.</p>
            </div>
          </header>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>업체명</th>
                  <th>직역</th>
                  <th>업무범위</th>
                  <th>담당자</th>
                  <th>사업자 정보</th>
                  <th>{membersCopy.text("emailLabel")}</th>
                  <th>{membersCopy.text("actionsColumn")}</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((application) => (
                  <tr key={application.id}>
                    <td>
                      <strong>{application.displayName}</strong>
                      <span className="admin-cell-sub">
                        {application.organizationName}
                      </span>
                    </td>
                    <td>{getPartnerProfessionLabel(application.profession)}</td>
                    <td>{application.fields.join(", ")}</td>
                    <td>{application.managerName}</td>
                    <td>
                      <strong>
                        {application.businessRegistrationNumber || "미등록"}
                      </strong>
                      <span className="admin-cell-sub">
                        {application.businessAddress || "주소 미등록"}
                      </span>
                    </td>
                    <td className="admin-cell-ellipsis">
                      {application.contactEmail}
                    </td>
                    <td>
                      <div className="admin-row-actions">
                        <button
                          type="button"
                          className="admin-link"
                          disabled={saving || !canCreate}
                          onClick={() =>
                            void reviewApplication(application.id, "approve")
                          }
                        >
                          승인
                        </button>
                        <button
                          type="button"
                          className="admin-link"
                          disabled={saving || !canCreate}
                          onClick={() =>
                            void reviewApplication(application.id, "reject")
                          }
                        >
                          반려
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {applications.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="admin-empty">
                      승인 대기 중인 제휴 신청이 없습니다.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
        <section className="admin-card admin-card--span-2">
          <header className="admin-card__head">
            <div>
              <h2>{partnersCopy.text("listTitle")}</h2>
              <p>
                {total.toLocaleString()}
                {partnersCopy.text("listCountSuffix")}
              </p>
            </div>
            <div className="admin-card__tools">
              <button
                type="button"
                className="admin-btn"
                onClick={refresh}
                disabled={listLoading}
              >
                {listLoading
                  ? copy.section("navigation").text("refreshing")
                  : copy.section("navigation").text("refresh")}
              </button>
              {canCreate ? (
                <button
                  type="button"
                  className="admin-btn admin-btn--primary"
                  onClick={() => {
                    setActionError("");
                    setEditor("create");
                  }}
                >
                  {partnersCopy.text("addPartner")}
                </button>
              ) : null}
            </div>
          </header>
          <div className="admin-partner-filters">
            <label>
              <span>{partnersCopy.text("searchLabel")}</span>
              <input
                className="admin-input"
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder={partnersCopy.text("searchPlaceholder")}
              />
            </label>
            <label>
              <span>{partnersCopy.text("professionLabel")}</span>
              <select
                className="admin-input"
                value={professionFilter}
                onChange={(event) => {
                  setProfessionFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">{partnersCopy.text("filterAll")}</option>
                {PARTNER_PROFESSION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{partnersCopy.text("statusFilterLabel")}</span>
              <select
                className="admin-input"
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">{partnersCopy.text("filterAll")}</option>
                {(["pending", "active", "paused", "terminated"] as const).map(
                  (status) => (
                    <option key={status} value={status}>
                      {partnersCopy.text(status)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              <span>{partnersCopy.text("pageSizeLabel")}</span>
              <select
                className="admin-input"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                    {partnersCopy.text("pageSizeSuffix")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {listError ? (
            <div
              className="admin-inline-state admin-inline-state--error"
              role="alert"
            >
              <span>{listError}</span>
              <button type="button" className="admin-btn" onClick={refresh}>
                {copy.message("retry")}
              </button>
            </div>
          ) : null}
          <div className="admin-table-wrap admin-table-wrap--partners">
            <table className="admin-table admin-table--partners">
              <thead>
                <tr>
                  <th>{partnersCopy.text("displayNameLabel")}</th>
                  <th>{partnersCopy.text("professionLabel")}</th>
                  <th>{partnersCopy.text("identifierLabel")}</th>
                  <th>{partnersCopy.text("managerLabel")}</th>
                  <th>{partnersCopy.text("emailLabel")}</th>
                  <th>{partnersCopy.text("phoneLabel")}</th>
                  <th>{partnersCopy.text("statusLabel")}</th>
                  <th>{partnersCopy.text("memberCountLabel")}</th>
                  <th>{membersCopy.text("updatedColumn")}</th>
                  <th>{partnersCopy.text("manageLabel")}</th>
                </tr>
              </thead>
              <tbody>
                {listLoading ? (
                  <tr>
                    <td colSpan={10} className="admin-empty">
                      {partnersCopy.text("listLoading")}
                    </td>
                  </tr>
                ) : null}
                {!listLoading
                  ? partners.map((partner) => (
                      <tr
                        key={partner.id}
                        className={`admin-row-clickable${
                          selectedPartnerId === partner.id ? " is-selected" : ""
                        }`}
                        tabIndex={0}
                        onClick={() => setSelectedPartnerId(partner.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedPartnerId(partner.id);
                          }
                        }}
                      >
                        <td>
                          <strong title={partner.displayName}>
                            {partner.displayName}
                          </strong>
                          <span className="admin-cell-sub">{partner.name}</span>
                        </td>
                        <td>{getPartnerProfessionLabel(partner.profession)}</td>
                        <td className="admin-cell-mono">{partner.id}</td>
                        <td>{partner.managerName}</td>
                        <td
                          className="admin-cell-ellipsis"
                          title={partner.contactEmail}
                        >
                          {partner.contactEmail}
                        </td>
                        <td>{partner.contactPhone || "-"}</td>
                        <td>
                          <span
                            className={`admin-pill admin-pill--${statusTone(partner.status)}`}
                          >
                            <span
                              className="admin-pill__dot"
                              aria-hidden="true"
                            />
                            {partnersCopy.text(partner.status)}
                          </span>
                        </td>
                        <td>{partner.memberCount.toLocaleString()}</td>
                        <td>
                          {formatDate(partner.updatedAt || partner.createdAt)}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="admin-btn admin-btn--sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedPartnerId(partner.id);
                            }}
                          >
                            {partnersCopy.text("viewDetail")}
                          </button>
                        </td>
                      </tr>
                    ))
                  : null}
                {!listLoading && partners.length === 0 && !listError ? (
                  <tr>
                    <td colSpan={10} className="admin-empty">
                      {partnersCopy.text("noPartners")}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <nav
            className="admin-pagination"
            aria-label={partnersCopy.text("paginationAriaLabel")}
          >
            <button
              type="button"
              className="admin-btn admin-btn--sm"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1 || listLoading}
            >
              {partnersCopy.text("previousPage")}
            </button>
            <span>
              {page.toLocaleString()} / {totalPages.toLocaleString()}
            </span>
            <button
              type="button"
              className="admin-btn admin-btn--sm"
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
              disabled={page >= totalPages || listLoading}
            >
              {partnersCopy.text("nextPage")}
            </button>
          </nav>
        </section>

        <section className="admin-card admin-card--partner-detail">
          <header className="admin-card__head">
            <div>
              <h2>
                {selectedPartner?.displayName ??
                  partnersCopy.text("detailTitle")}
              </h2>
              <p>{selectedPartner?.id ?? partnersCopy.text("selectPartner")}</p>
            </div>
            {selectedPartner ? (
              <div className="admin-card__tools">
                {(canUpdate || canManageScope || canChangeStatus) &&
                selectedPartner.status !== "terminated" ? (
                  <button
                    type="button"
                    className="admin-btn"
                    onClick={() => {
                      setActionError("");
                      setEditor("edit");
                    }}
                  >
                    {partnersCopy.text("editPartner")}
                  </button>
                ) : null}
                {canChangeStatus && selectedPartner.status !== "terminated" ? (
                  <button
                    type="button"
                    className="admin-btn admin-btn--danger"
                    onClick={() => setConfirmation({ kind: "terminate" })}
                  >
                    {partnersCopy.text("terminatePartner")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </header>
          {detailLoading ? (
            <p className="admin-empty">{partnersCopy.text("detailLoading")}</p>
          ) : null}
          {detailError ? (
            <div
              className="admin-inline-state admin-inline-state--error"
              role="alert"
            >
              <span>{detailError}</span>
              <button
                type="button"
                className="admin-btn"
                onClick={() =>
                  selectedPartnerId && void loadDetail(selectedPartnerId)
                }
              >
                {copy.message("retry")}
              </button>
            </div>
          ) : null}
          {actionMessage ? (
            <div
              className="admin-inline-state admin-inline-state--success"
              role="status"
            >
              {actionMessage}
            </div>
          ) : null}
          {actionError ? (
            <div
              className="admin-inline-state admin-inline-state--error"
              role="alert"
            >
              {actionError}
            </div>
          ) : null}
          {selectedPartner && !detailLoading ? (
            <div className="admin-partner-detail-sections">
              <section>
                <h3>{partnersCopy.text("basicInfoTitle")}</h3>
                <dl className="admin-detail-list">
                  <div>
                    <dt>{partnersCopy.text("nameLabel")}</dt>
                    <dd>{selectedPartner.name}</dd>
                  </div>
                  <div>
                    <dt>{partnersCopy.text("displayNameLabel")}</dt>
                    <dd>{selectedPartner.displayName}</dd>
                  </div>
                  <div>
                    <dt>{partnersCopy.text("identifierLabel")}</dt>
                    <dd className="admin-cell-mono">{selectedPartner.id}</dd>
                  </div>
                  <div>
                    <dt>{partnersCopy.text("professionLabel")}</dt>
                    <dd>
                      {getPartnerProfessionLabel(selectedPartner.profession)}
                    </dd>
                  </div>
                  <div>
                    <dt>{partnersCopy.text("createdAtLabel")}</dt>
                    <dd>{formatDate(selectedPartner.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>{partnersCopy.text("updatedAtLabel")}</dt>
                    <dd>{formatDate(selectedPartner.updatedAt)}</dd>
                  </div>
                </dl>
              </section>
              <section>
                <h3>{partnersCopy.text("managerInfoTitle")}</h3>
                <dl className="admin-detail-list">
                  <div>
                    <dt>{partnersCopy.text("managerLabel")}</dt>
                    <dd>{selectedPartner.managerName}</dd>
                  </div>
                  <div>
                    <dt>{partnersCopy.text("emailLabel")}</dt>
                    <dd className="admin-cell-ellipsis">
                      {selectedPartner.contactEmail}
                    </dd>
                  </div>
                  <div>
                    <dt>{partnersCopy.text("phoneLabel")}</dt>
                    <dd>{selectedPartner.contactPhone || "-"}</dd>
                  </div>
                </dl>
              </section>
              <PartnerQuoteProfileSection
                copy={copy}
                partner={selectedPartner}
                canUpdate={canUpdate}
                previewMode={previewMode}
                onMessage={(message) => {
                  if (message.tone === "success") {
                    setActionMessage(message.text);
                    setActionError("");
                  } else {
                    setActionError(message.text);
                    setActionMessage("");
                  }
                }}
                onPartnerUpdated={(nextPartner) => {
                  setDetail((current) =>
                    current
                      ? { ...current, partner: { ...current.partner, ...nextPartner } }
                      : current,
                  );
                }}
              />
              <section>
                <h3>{partnersCopy.text("scopeInfoTitle")}</h3>
                <div className="admin-chip-list">
                  {selectedPartner.fields.map((field) => (
                    <span key={field} className="admin-chip">
                      {field}
                    </span>
                  ))}
                </div>
              </section>
              <section>
                <h3>{partnersCopy.text("statusInfoTitle")}</h3>
                <p>
                  <span
                    className={`admin-pill admin-pill--${statusTone(selectedPartner.status)}`}
                  >
                    <span className="admin-pill__dot" aria-hidden="true" />
                    {partnersCopy.text(selectedPartner.status)}
                  </span>
                </p>
                {selectedPartner.status !== "active" ? (
                  <p className="admin-form__hint">
                    {partnersCopy.text("inactiveAccessDescription")}
                  </p>
                ) : null}
              </section>
              <section>
                <h3>{partnersCopy.text("memoInfoTitle")}</h3>
                <p className="admin-detail-copy">
                  {selectedPartner.memo || partnersCopy.text("emptyMemo")}
                </p>
              </section>
            </div>
          ) : null}
        </section>

        {detail ? (
          <>
            <section className="admin-card admin-card--span-2">
              <header className="admin-card__head">
                <div>
                  <h2>{partnersCopy.text("memberSectionTitle")}</h2>
                  <p>{partnersCopy.text("memberSectionDescription")}</p>
                </div>
                {canManageMembers && detail.partner.status !== "terminated" ? (
                  <button
                    type="button"
                    className="admin-btn admin-btn--primary"
                    onClick={() =>
                      setAccountEditor({ mode: "create", account: null })
                    }
                  >
                    {partnersCopy.text("addAccount")}
                  </button>
                ) : null}
              </header>
              <div className="admin-table-wrap">
                <table className="admin-table admin-table--partner-accounts">
                  <thead>
                    <tr>
                      <th>{membersCopy.text("nameLabel")}</th>
                      <th>{membersCopy.text("emailLabel")}</th>
                      <th>{partnersCopy.text("accountRoleLabel")}</th>
                      <th>{partnersCopy.text("statusLabel")}</th>
                      <th>{partnersCopy.text("phoneLabel")}</th>
                      <th>{membersCopy.text("updatedColumn")}</th>
                      <th>{partnersCopy.text("manageLabel")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.accounts.map((account) => (
                      <tr key={account.uid}>
                        <td>
                          <strong>{account.name}</strong>
                          <span className="admin-cell-sub">
                            {account.position || account.duty}
                          </span>
                        </td>
                        <td
                          className="admin-cell-ellipsis"
                          title={account.email}
                        >
                          {account.email}
                        </td>
                        <td>{partnersCopy.text("partnerAccountRole")}</td>
                        <td>
                          {partnersCopy.text(
                            `accountStatus.${accountStatus(account)}`,
                          )}
                        </td>
                        <td>{account.phone || "-"}</td>
                        <td>{formatDate(account.updatedAt)}</td>
                        <td>
                          {canManageMembers &&
                          detail.partner.status !== "terminated" ? (
                            <div className="admin-row-actions">
                              <button
                                type="button"
                                className="admin-link"
                                onClick={() =>
                                  setAccountEditor({
                                    mode: "edit",
                                    account,
                                  })
                                }
                              >
                                {partnersCopy.text("viewAccountDetail")}
                              </button>
                              <button
                                type="button"
                                className="admin-link"
                                onClick={() =>
                                  setConfirmation({
                                    kind: "unlink-account",
                                    account,
                                  })
                                }
                              >
                                {partnersCopy.text("unlinkAccount")}
                              </button>
                            </div>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    ))}
                    {detail.accounts.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="admin-empty">
                          {partnersCopy.text("noAccounts")}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="admin-card admin-card--span-2">
              <header className="admin-card__head">
                <div>
                  <h2>{partnersCopy.text("relatedSummaryTitle")}</h2>
                  <p>{partnersCopy.text("relatedSummaryDescription")}</p>
                </div>
              </header>
              <dl className="admin-partner-summary">
                <div>
                  <dt>{partnersCopy.text("memberCountLabel")}</dt>
                  <dd>{detail.summary.memberCount.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>{partnersCopy.text("assignmentCountLabel")}</dt>
                  <dd>{detail.summary.assignmentCount.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>{partnersCopy.text("activeAssignmentCountLabel")}</dt>
                  <dd>
                    {detail.summary.activeAssignmentCount.toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt>{partnersCopy.text("draftCountLabel")}</dt>
                  <dd>{detail.summary.draftCount.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>{partnersCopy.text("answerCountLabel")}</dt>
                  <dd>{detail.summary.answerCount.toLocaleString()}</dd>
                </div>
              </dl>
            </section>

            <section className="admin-card">
              <header className="admin-card__head">
                <div>
                  <h2>{partnersCopy.text("historyTitle")}</h2>
                  <p>{partnersCopy.text("historyDescription")}</p>
                </div>
              </header>
              <ul className="admin-mini-feed">
                {relatedAuditLogs.map((entry) => {
                  return (
                    <li key={entry.id}>
                      <strong>{labelAuditAction(entry.action)}</strong>
                      <time>{formatDate(entry.createdAt)}</time>
                    </li>
                  );
                })}
                {relatedAuditLogs.length === 0 ? (
                  <li className="admin-empty">
                    {partnersCopy.text("noHistory")}
                  </li>
                ) : null}
              </ul>
            </section>
          </>
        ) : null}

        {selectedPartner ? (
          <section className="admin-card admin-card--span-2">
            <header className="admin-card__head">
              <div>
                <h2>{partnersCopy.text("assignmentTitle")}</h2>
                <p>{selectedPartner.displayName}</p>
              </div>
            </header>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{inquiryCopy.text("requestColumn")}</th>
                    <th>{inquiryCopy.text("statusColumn")}</th>
                    <th>{partnersCopy.text("statusLabel")}</th>
                    <th>{membersCopy.text("updatedColumn")}</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedAssignments.map((assignment) => {
                    const request = requestById.get(assignment.requestId);
                    return (
                      <tr key={assignment.id}>
                        <td>
                          <strong>
                            {request?.subject ?? assignment.requestId}
                          </strong>
                          <span className="admin-cell-sub">
                            {request?.requestNumber}
                          </span>
                        </td>
                        <td>{request?.status ?? "-"}</td>
                        <td>{assignment.status}</td>
                        <td>{formatDate(assignment.updatedAt)}</td>
                      </tr>
                    );
                  })}
                  {selectedAssignments.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="admin-empty">
                        {partnersCopy.text("noAssignments")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {canManageInquiries &&
            selectedPartner.status === "active" &&
            assignableRequests.length > 0 ? (
              <div className="admin-assignment-list">
                {assignableRequests.map((request) => (
                  <button
                    key={request.id}
                    type="button"
                    className="admin-btn"
                    disabled={workflowLoading}
                    onClick={() =>
                      onAssignPartner(request.id, selectedPartner.id)
                    }
                  >
                    {request.requestNumber} · {request.subject}
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {selectedPartner ? (
          <section className="admin-card admin-card--span-2">
            <header className="admin-card__head">
              <div>
                <h2>{partnersCopy.text("draftTitle")}</h2>
                <p>{selectedPartner.displayName}</p>
              </div>
            </header>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{inquiryCopy.text("requestColumn")}</th>
                    <th>{partnersCopy.text("pointMaxLabel")}</th>
                    <th>{partnersCopy.text("statusLabel")}</th>
                    <th>{membersCopy.text("actionsColumn")}</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedDrafts.map((draft) => {
                    const request = requestById.get(draft.requestId);
                    return (
                      <tr key={draft.id}>
                        <td>
                          <strong>{request?.subject ?? draft.requestId}</strong>
                          <span className="admin-cell-sub">
                            {draft.body.slice(0, 80)}
                          </span>
                        </td>
                        <td>{formatPoints(draft.pointCost)}</td>
                        <td>{draft.status}</td>
                        <td>
                          <div className="admin-row-actions">
                            <button
                              type="button"
                              className="admin-link"
                              disabled={
                                workflowLoading || draft.status !== "submitted"
                              }
                              onClick={() => onDraftAction(draft, "approve")}
                            >
                              {partnersCopy.text("approveDraft")}
                            </button>
                            <button
                              type="button"
                              className="admin-link"
                              disabled={
                                workflowLoading ||
                                draft.status !== "submitted" ||
                                !revisionNote.trim()
                              }
                              onClick={() =>
                                onDraftAction(draft, "request_revision")
                              }
                            >
                              {partnersCopy.text("requestRevision")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {selectedDrafts.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="admin-empty">
                        {partnersCopy.text("noDrafts")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <label className="admin-form__field">
              <span>{partnersCopy.text("requestRevision")}</span>
              <input
                className="admin-input"
                value={revisionNote}
                onChange={(event) => onRevisionNoteChange(event.target.value)}
                placeholder={partnersCopy.text("revisionNotePlaceholder")}
              />
            </label>
          </section>
        ) : null}
      </div>

      {editor ? (
        <PartnerEditorModal
          copy={copy}
          mode={editor}
          partner={editor === "edit" ? selectedPartner : null}
          loading={saving}
          suspended={confirmation?.kind === "partner-status"}
          canUpdate={canUpdate}
          canChangeStatus={canChangeStatus}
          canManageScope={canManageScope}
          canManageMembers={canManageMembers}
          serverError={actionError}
          onClose={() => {
            if (!saving) setEditor(null);
          }}
          onSubmit={savePartner}
        />
      ) : null}
      {accountEditor && selectedPartner ? (
        <PartnerAccountEditorModal
          copy={copy}
          editor={accountEditor}
          currentPartner={selectedPartner}
          partners={partnerOptions}
          loading={saving}
          serverError={actionError}
          onClose={() => {
            if (!saving) setAccountEditor(null);
          }}
          onSubmit={saveAccount}
        />
      ) : null}
      {confirmation ? (
        <PartnerConfirmationModal
          copy={copy}
          confirmation={confirmation}
          partner={selectedPartner}
          loading={saving}
          onClose={() => {
            if (!saving) setConfirmation(null);
          }}
          onConfirm={() => {
            if (confirmation.kind === "partner-status") {
              void savePartner(confirmation.payload, true);
            } else if (confirmation.kind === "terminate") {
              void terminatePartner();
            } else {
              void unlinkAccount();
            }
          }}
        />
      ) : null}
    </>
  );
}

function PartnerEditorModal({
  copy,
  mode,
  partner,
  loading,
  suspended,
  canUpdate,
  canChangeStatus,
  canManageScope,
  canManageMembers,
  serverError,
  onClose,
  onSubmit,
}: {
  copy: AdminOperationsCopy;
  mode: "create" | "edit";
  partner: PartnerRecord | null;
  loading: boolean;
  suspended: boolean;
  canUpdate: boolean;
  canChangeStatus: boolean;
  canManageScope: boolean;
  canManageMembers: boolean;
  serverError: string;
  onClose: () => void;
  onSubmit: (payload: PartnerFormInput) => void;
}) {
  const partnersCopy = copy.section("partners");
  const dialogs = copy.section("dialogs");
  const [name, setName] = useState(partner?.name ?? "");
  const [displayName, setDisplayName] = useState(partner?.displayName ?? "");
  const [profession, setProfession] = useState<PartnerProfession>(
    partner?.profession ?? "OTHER",
  );
  const [fields, setFields] = useState<string[]>(partner?.fields ?? []);
  const [managerName, setManagerName] = useState(partner?.managerName ?? "");
  const [contactEmail, setContactEmail] = useState(partner?.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(partner?.contactPhone ?? "");
  const [businessRegistrationNumber, setBusinessRegistrationNumber] =
    useState(partner?.businessRegistrationNumber ?? "");
  const [businessAddress, setBusinessAddress] = useState(
    partner?.businessAddress ?? "",
  );
  const [status, setStatus] = useState<PartnerRecord["status"]>(
    partner?.status ?? "active",
  );
  const [createLoginAccount, setCreateLoginAccount] = useState(
    mode === "create" && canManageMembers,
  );
  const [loginPassword, setLoginPassword] = useState("");
  const [pointMin, setPointMin] = useState(
    String(partner?.pointMin ?? ANSWER_POINT_MIN),
  );
  const [pointMax, setPointMax] = useState(
    String(partner?.pointMax ?? ANSWER_POINT_MAX),
  );
  const [memo, setMemo] = useState(partner?.memo ?? "");
  const [errors, setErrors] = useState<PartnerFormErrors>({});
  const panelRef = useDialogFocus<HTMLFormElement>(
    true,
    onClose,
    loading || suspended,
  );
  const isCreate = mode === "create";
  const canEditBase = isCreate || canUpdate;
  const statusChanged = Boolean(partner && status !== partner.status);
  const scopeChanged = Boolean(
    partner && fields.join(",") !== partner.fields.join(","),
  );
  const canSubmit =
    isCreate ||
    canUpdate ||
    (canChangeStatus && statusChanged) ||
    (canManageScope && scopeChanged);
  const statusOptions =
    partner?.status === "active"
      ? ["active", "paused"]
      : partner?.status === "paused"
        ? ["paused", "active"]
        : partner?.status === "terminated"
          ? ["terminated"]
          : ["pending", "active"];

  const errorText = (field: keyof PartnerFormErrors) => {
    if (field === "contactEmail") {
      return partnersCopy.text("emailValidationError");
    }
    if (field === "contactPhone") {
      return partnersCopy.text("phoneValidationError");
    }
    if (field === "businessRegistrationNumber") {
      return errors.businessRegistrationNumber === "invalid"
        ? partnersCopy.text("businessRegistrationNumberInvalid")
        : partnersCopy.text("businessRegistrationNumberRequired");
    }
    if (field === "businessAddress") {
      return partnersCopy.text("businessAddressRequired");
    }
    if (field === "pointRange") {
      return partnersCopy.text("pointRangeValidationError");
    }
    if (field === "loginPassword") {
      return partnersCopy.text("accountPasswordValidationError");
    }
    return partnersCopy.text("requiredFieldError");
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload: PartnerFormInput = {
      name: name.trim(),
      displayName: displayName.trim() || name.trim(),
      partnerType: getPartnerProfessionLabel(profession),
      profession,
      fields,
      managerName: managerName.trim(),
      contactEmail: contactEmail.trim().toLowerCase(),
      contactPhone: contactPhone.trim(),
      businessRegistrationNumber: businessRegistrationNumber.trim(),
      businessAddress: businessAddress.trim(),
      status,
      pointMin: Number(pointMin),
      pointMax: Number(pointMax),
      memo: memo.trim(),
      createLoginAccount: isCreate ? createLoginAccount : undefined,
      loginPassword: isCreate && createLoginAccount ? loginPassword : undefined,
    };
    const nextErrors = validatePartnerForm(payload);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    onSubmit(payload);
  };

  return (
    <div
      className={`admin-modal${suspended ? " is-suspended" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-hidden={suspended || undefined}
      aria-labelledby="partner-editor-title"
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
        className="admin-modal__panel admin-modal__panel--partner"
        onSubmit={submit}
      >
        <header className="admin-modal__head">
          <div>
            <p className="admin-modal__eyebrow">{partnersCopy.title}</p>
            <h2 id="partner-editor-title">
              {isCreate
                ? partnersCopy.text("addPartner")
                : partnersCopy.text("editPartner")}
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
          <p className="admin-form__hint">
            {partnersCopy.text("requiredOptionalDescription")}
          </p>
          <div className="admin-partner-form-grid">
            <label className="admin-modal__field">
              {partnersCopy.text("nameLabel")}
              <input
                className="admin-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={loading || !canEditBase}
                aria-invalid={Boolean(errors.name)}
                data-autofocus
              />
              {errors.name ? (
                <small className="admin-field-error">{errorText("name")}</small>
              ) : null}
            </label>
            <label className="admin-modal__field">
              {partnersCopy.text("displayNameLabel")}
              <input
                className="admin-input"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                disabled={loading || !canEditBase}
              />
            </label>
            <label className="admin-modal__field">
              {partnersCopy.text("identifierLabel")}
              <input
                className="admin-input"
                value={partner?.id ?? partnersCopy.text("identifierAutoValue")}
                disabled
              />
              <small className="admin-form__hint">
                {partnersCopy.text("identifierHelp")}
              </small>
            </label>
            <label className="admin-modal__field">
              {partnersCopy.text("professionLabel")}
              <select
                className="admin-input"
                value={profession}
                onChange={(event) =>
                  setProfession(event.target.value as PartnerProfession)
                }
                disabled={loading || !canEditBase}
                aria-invalid={Boolean(errors.profession)}
              >
                {PARTNER_PROFESSION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {errors.profession ? (
                <small className="admin-field-error">
                  {errorText("profession")}
                </small>
              ) : null}
            </label>
            <label className="admin-modal__field">
              {partnersCopy.text("managerLabel")}
              <input
                className="admin-input"
                value={managerName}
                onChange={(event) => setManagerName(event.target.value)}
                disabled={loading || !canEditBase}
                aria-invalid={Boolean(errors.managerName)}
              />
              {errors.managerName ? (
                <small className="admin-field-error">
                  {errorText("managerName")}
                </small>
              ) : null}
            </label>
            <label className="admin-modal__field">
              {partnersCopy.text("emailLabel")}
              <input
                className="admin-input"
                type="email"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                disabled={loading || !canEditBase}
                aria-invalid={Boolean(errors.contactEmail)}
              />
              {errors.contactEmail ? (
                <small className="admin-field-error">
                  {errorText("contactEmail")}
                </small>
              ) : null}
            </label>
            <label className="admin-modal__field">
              {partnersCopy.text("phoneLabel")}
              <input
                className="admin-input"
                type="tel"
                value={contactPhone}
                onChange={(event) => setContactPhone(event.target.value)}
                disabled={loading || !canEditBase}
                aria-invalid={Boolean(errors.contactPhone)}
              />
              {errors.contactPhone ? (
                <small className="admin-field-error">
                  {errorText("contactPhone")}
                </small>
              ) : null}
            </label>
            <label className="admin-modal__field">
              {partnersCopy.text("businessRegistrationNumberLabel")}
              <input
                className="admin-input"
                value={businessRegistrationNumber}
                onChange={(event) =>
                  setBusinessRegistrationNumber(event.target.value)
                }
                disabled={loading || !canEditBase}
                inputMode="numeric"
                placeholder={partnersCopy.text(
                  "businessRegistrationNumberPlaceholder",
                )}
                aria-invalid={Boolean(errors.businessRegistrationNumber)}
              />
              {errors.businessRegistrationNumber ? (
                <small className="admin-field-error">
                  {errorText("businessRegistrationNumber")}
                </small>
              ) : null}
            </label>
            <label className="admin-modal__field">
              {partnersCopy.text("businessAddressLabel")}
              <input
                className="admin-input"
                value={businessAddress}
                onChange={(event) => setBusinessAddress(event.target.value)}
                disabled={loading || !canEditBase}
                aria-invalid={Boolean(errors.businessAddress)}
              />
              {errors.businessAddress ? (
                <small className="admin-field-error">
                  {errorText("businessAddress")}
                </small>
              ) : null}
            </label>
            <label className="admin-modal__field">
              {partnersCopy.text("statusLabel")}
              <select
                className="admin-input"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as PartnerRecord["status"])
                }
                disabled={loading || (!isCreate && !canChangeStatus)}
              >
                {statusOptions.map((option) => (
                  <option key={option} value={option}>
                    {partnersCopy.text(option)}
                  </option>
                ))}
              </select>
            </label>
            {isCreate && canManageMembers ? (
              <>
                <label className="admin-check-row">
                  <input
                    type="checkbox"
                    checked={createLoginAccount}
                    onChange={(event) =>
                      setCreateLoginAccount(event.target.checked)
                    }
                    disabled={loading}
                  />
                  <span>{partnersCopy.text("createLoginAccountLabel")}</span>
                </label>
                {createLoginAccount ? (
                  <label className="admin-modal__field">
                    {partnersCopy.text("initialLoginPasswordLabel")}
                    <input
                      className="admin-input"
                      type="password"
                      autoComplete="new-password"
                      value={loginPassword}
                      onChange={(event) => setLoginPassword(event.target.value)}
                      aria-invalid={Boolean(errors.loginPassword)}
                      disabled={loading}
                      placeholder={partnersCopy.text(
                        "initialPasswordPlaceholder",
                      )}
                    />
                    <small className="admin-form__hint">
                      {partnersCopy.text("loginEmailHelp")}
                    </small>
                    {status !== "active" ? (
                      <small className="admin-field-error">
                        {partnersCopy.text("inactiveLoginAccountHelp")}
                      </small>
                    ) : null}
                    {errors.loginPassword ? (
                      <small className="admin-field-error">
                        {errorText("loginPassword")}
                      </small>
                    ) : null}
                  </label>
                ) : null}
              </>
            ) : null}
            <label className="admin-modal__field">
              {partnersCopy.text("pointMinLabel")}
              <input
                className="admin-input"
                inputMode="numeric"
                value={pointMin}
                onChange={(event) => setPointMin(event.target.value)}
                disabled={loading || !canEditBase}
                aria-invalid={Boolean(errors.pointRange)}
              />
            </label>
            <label className="admin-modal__field">
              {partnersCopy.text("pointMaxLabel")}
              <input
                className="admin-input"
                inputMode="numeric"
                value={pointMax}
                onChange={(event) => setPointMax(event.target.value)}
                disabled={loading || !canEditBase}
                aria-invalid={Boolean(errors.pointRange)}
              />
              {errors.pointRange ? (
                <small className="admin-field-error">
                  {errorText("pointRange")}
                </small>
              ) : null}
            </label>
          </div>
          <fieldset className="admin-modal__field">
            <legend>{partnersCopy.text("fieldsLabel")}</legend>
            <div className="admin-checkbox-grid">
              {INQUIRY_SUPPORT_FIELD_OPTIONS.map((option) => (
                <label key={option.value} className="admin-check-row">
                  <input
                    type="checkbox"
                    checked={fields.includes(option.label)}
                    onChange={() =>
                      setFields((current) =>
                        current.includes(option.label)
                          ? current.filter((field) => field !== option.label)
                          : [...current, option.label],
                      )
                    }
                    disabled={loading || (!isCreate && !canManageScope)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            {errors.fields ? (
              <small className="admin-field-error">{errorText("fields")}</small>
            ) : null}
          </fieldset>
          <label className="admin-modal__field">
            {partnersCopy.text("memoLabel")}
            <textarea
              className="admin-input admin-input--area"
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              disabled={loading || !canEditBase}
              rows={4}
            />
          </label>
          {serverError ? (
            <p className="admin-form__error" role="alert">
              {serverError}
            </p>
          ) : null}
          <div className="admin-modal__actions">
            <button
              type="button"
              className="admin-btn"
              onClick={onClose}
              disabled={loading || suspended}
            >
              {dialogs.text("cancel")}
            </button>
            <button
              type="submit"
              className="admin-btn admin-btn--primary"
              disabled={loading || suspended || !canSubmit}
            >
              {loading
                ? dialogs.text("saving")
                : partnersCopy.text("savePartner")}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function PartnerAccountEditorModal({
  copy,
  editor,
  currentPartner,
  partners,
  loading,
  serverError,
  onClose,
  onSubmit,
}: {
  copy: AdminOperationsCopy;
  editor: AccountEditor;
  currentPartner: PartnerRecord;
  partners: PartnerListView[];
  loading: boolean;
  serverError: string;
  onClose: () => void;
  onSubmit: (payload: {
    name: string;
    email: string;
    password?: string;
    phone: string;
    position: string;
    duty: string;
    accountStatus: AdminStatus;
    targetPartnerId?: string;
  }) => void;
}) {
  const partnersCopy = copy.section("partners");
  const dialogs = copy.section("dialogs");
  const account = editor.account;
  const [name, setName] = useState(account?.name ?? currentPartner.managerName);
  const [email, setEmail] = useState(
    account?.email ?? currentPartner.contactEmail,
  );
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState(
    account?.phone ?? currentPartner.contactPhone,
  );
  const [position, setPosition] = useState(
    account?.position ?? "제휴사 담당자",
  );
  const [duty, setDuty] = useState(account?.duty ?? currentPartner.displayName);
  const [status, setStatus] = useState<AdminStatus>(
    account
      ? accountStatus(account)
      : currentPartner.status === "active"
        ? "active"
        : "invited",
  );
  const [targetPartnerId, setTargetPartnerId] = useState(currentPartner.id);
  const [errors, setErrors] = useState<PartnerAccountFormErrors>({});
  const panelRef = useDialogFocus<HTMLFormElement>(true, onClose, loading);
  const isCreate = editor.mode === "create";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validatePartnerAccountForm({
      mode: editor.mode,
      name,
      email,
      password,
      phone,
      accountStatus: status,
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    onSubmit({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: isCreate ? password : undefined,
      phone: phone.trim(),
      position: position.trim(),
      duty: duty.trim(),
      accountStatus: status,
      targetPartnerId: isCreate ? undefined : targetPartnerId,
    });
  };

  const fieldError = (field: keyof PartnerAccountFormErrors) =>
    field === "email"
      ? partnersCopy.text("emailValidationError")
      : field === "phone"
        ? partnersCopy.text("phoneValidationError")
        : field === "password"
          ? partnersCopy.text("accountPasswordValidationError")
          : partnersCopy.text("requiredFieldError");

  return (
    <div
      className="admin-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="partner-account-editor-title"
    >
      <button
        type="button"
        className="admin-modal__backdrop"
        aria-label={dialogs.text("close")}
        onClick={onClose}
        disabled={loading}
      />
      <form
        ref={panelRef}
        className="admin-modal__panel admin-modal__panel--sm"
        onSubmit={submit}
      >
        <header className="admin-modal__head">
          <div>
            <p className="admin-modal__eyebrow">{currentPartner.displayName}</p>
            <h2 id="partner-account-editor-title">
              {isCreate
                ? partnersCopy.text("addAccount")
                : partnersCopy.text("editAccount")}
            </h2>
          </div>
          <button
            type="button"
            className="admin-modal__close"
            aria-label={dialogs.text("close")}
            onClick={onClose}
            disabled={loading}
          >
            ×
          </button>
        </header>
        <div className="admin-modal__body">
          <label className="admin-modal__field">
            {copy.section("members").text("nameLabel")}
            <input
              className="admin-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={Boolean(errors.name)}
              disabled={loading}
              data-autofocus
            />
            {errors.name ? (
              <small className="admin-field-error">{fieldError("name")}</small>
            ) : null}
          </label>
          <label className="admin-modal__field">
            {copy.section("members").text("emailLabel")}
            <input
              className="admin-input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={Boolean(errors.email)}
              disabled={loading || !isCreate}
            />
            {errors.email ? (
              <small className="admin-field-error">{fieldError("email")}</small>
            ) : null}
          </label>
          {isCreate ? (
            <label className="admin-modal__field">
              {partnersCopy.text("temporaryPasswordLabel")}
              <input
                className="admin-input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={Boolean(errors.password)}
                disabled={loading}
              />
              {errors.password ? (
                <small className="admin-field-error">
                  {fieldError("password")}
                </small>
              ) : null}
            </label>
          ) : null}
          <label className="admin-modal__field">
            {partnersCopy.text("phoneLabel")}
            <input
              className="admin-input"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              aria-invalid={Boolean(errors.phone)}
              disabled={loading}
            />
            {errors.phone ? (
              <small className="admin-field-error">{fieldError("phone")}</small>
            ) : null}
          </label>
          <label className="admin-modal__field">
            {copy.section("members").text("positionLabel")}
            <input
              className="admin-input"
              value={position}
              onChange={(event) => setPosition(event.target.value)}
              disabled={loading}
            />
          </label>
          <label className="admin-modal__field">
            {copy.section("members").text("dutyLabel")}
            <input
              className="admin-input"
              value={duty}
              onChange={(event) => setDuty(event.target.value)}
              disabled={loading}
            />
          </label>
          <label className="admin-modal__field">
            {partnersCopy.text("statusLabel")}
            <select
              className="admin-input"
              value={status}
              onChange={(event) => setStatus(event.target.value as AdminStatus)}
              disabled={loading}
            >
              {(["invited", "active", "suspended", "disabled"] as const).map(
                (value) => (
                  <option key={value} value={value}>
                    {partnersCopy.text(`accountStatus.${value}`)}
                  </option>
                ),
              )}
            </select>
          </label>
          {!isCreate ? (
            <label className="admin-modal__field">
              {partnersCopy.text("linkedPartnerLabel")}
              <select
                className="admin-input"
                value={targetPartnerId}
                onChange={(event) => setTargetPartnerId(event.target.value)}
                disabled={loading}
              >
                {partners
                  .filter((partner) => partner.status !== "terminated")
                  .map((partner) => (
                    <option key={partner.id} value={partner.id}>
                      {partner.displayName}
                    </option>
                  ))}
              </select>
              <small className="admin-form__hint">
                {partnersCopy.text("moveAccountHelp")}
              </small>
            </label>
          ) : null}
          {serverError ? (
            <p className="admin-form__error" role="alert">
              {serverError}
            </p>
          ) : null}
          <div className="admin-modal__actions">
            <button
              type="button"
              className="admin-btn"
              onClick={onClose}
              disabled={loading}
            >
              {dialogs.text("cancel")}
            </button>
            <button
              type="submit"
              className="admin-btn admin-btn--primary"
              disabled={loading}
            >
              {loading ? dialogs.text("saving") : dialogs.text("save")}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function PartnerConfirmationModal({
  copy,
  confirmation,
  partner,
  loading,
  onClose,
  onConfirm,
}: {
  copy: AdminOperationsCopy;
  confirmation: Confirmation;
  partner: PartnerRecord | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const partnersCopy = copy.section("partners");
  const dialogs = copy.section("dialogs");
  const panelRef = useDialogFocus<HTMLDivElement>(true, onClose, loading);
  const title =
    confirmation.kind === "unlink-account"
      ? partnersCopy.text("unlinkConfirmTitle")
      : confirmation.kind === "terminate"
        ? partnersCopy.text("terminateConfirmTitle")
        : partnersCopy.text("statusConfirmTitle");
  const target =
    confirmation.kind === "unlink-account"
      ? confirmation.account.name
      : (partner?.displayName ?? "");
  const warning =
    confirmation.kind === "unlink-account"
      ? partnersCopy.text("unlinkConfirmDescription")
      : confirmation.kind === "terminate"
        ? partnersCopy.text("terminateConfirmDescription")
        : partnersCopy.text("statusConfirmDescription");
  const confirmLabel =
    confirmation.kind === "unlink-account"
      ? partnersCopy.text("unlinkAccount")
      : confirmation.kind === "terminate"
        ? partnersCopy.text("terminatePartner")
        : dialogs.text("saveChanges");
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
      <div ref={panelRef} className="admin-modal__panel admin-modal__panel--sm">
        <header className="admin-modal__head">
          <div>
            <p className="admin-modal__eyebrow">{target}</p>
            <h2>{title}</h2>
          </div>
        </header>
        <div className="admin-modal__body">
          <p className="admin-modal__warning" role="alert">
            {warning}
          </p>
          <div className="admin-modal__actions">
            <button
              type="button"
              className="admin-btn"
              onClick={onClose}
              disabled={loading}
              data-autofocus
            >
              {dialogs.text("cancel")}
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--danger"
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
