"use client";

import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { logoutPortalSession } from "@/lib/auth/login-client";
import { getFirebaseAuth } from "@/lib/firebase/client";
import type {
  ConsultRequestRecord,
  PartnerAnswerDraftRecord,
  PartnerAssignmentRecord,
  PartnerRecord,
  QuoteAssignmentRecord,
  QuoteRecord,
  QuoteRequestRecord,
} from "@/lib/firebase/schema";
import type { CmsPageContent } from "@/lib/cms/schemas";
import { getCmsSection } from "@/lib/cms/runtime";
import { ANSWER_POINT_MAX, ANSWER_POINT_MIN } from "@/lib/answer-points";
import { formatCurrencyInput, parseCurrencyInput } from "@/lib/currency-input";
import { CmsSupplementalSections } from "@/components/cms/CmsSupplementalSections";
import { PartnerNhAuditQuoteForm } from "@/components/PartnerNhAuditQuoteForm";
import { validatePartnerQuoteInput } from "@/lib/quotes/partner-quote-validation";
import {
  EMPTY_NH_AUDIT_PARTNER_FORM,
  sanitizeNhAuditPartnerFormDraft,
  validateNhAuditPartnerForm,
  valuesFromNhAuditSubmission,
  type NhAuditPartnerFormValues,
} from "@/lib/quotes/nh-audit-quote-form";
import {
  quoteSupplierProfileFrom,
  validateQuoteSupplierProfile,
  type QuoteSupplierProfile,
} from "@/lib/quotes/supplier-profile";
import { canPartnerMutateQuoteAssignment } from "@/lib/quotes/nh-audit-quote-server";
import { PortalSitemap } from "@/components/PortalSitemap";
import type { PortalSitemapModel } from "@/lib/sitemap/portal-sitemap";

type State = "loading" | "ready" | "denied" | "error";
type QuoteAction = "draft" | "preview" | "send";
type QuoteNotice = { tone: "success" | "error" | "warning"; text: string };
const EMPTY_PARTNER_SITEMAP: PortalSitemapModel = {
  role: "partner",
  groups: [],
  routeCount: 0,
};

const EMPTY_SUPPLIER_PROFILE: QuoteSupplierProfile = {
  name: "",
  businessRegistrationNumber: "",
  address: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
};

export function PartnerDashboard({
  content,
  sitemap = EMPTY_PARTNER_SITEMAP,
}: {
  content: CmsPageContent;
  sitemap?: PortalSitemapModel;
}) {
  const router = useRouter();
  const sitemapCopy = getCmsSection(content, "partner.portal", "sitemap");
  const quoteDocumentCopy = getCmsSection(
    content,
    "partner.portal",
    "quoteDocument",
  );
  const [state, setState] = useState<State>("loading");
  const [partner, setPartner] = useState<PartnerRecord | null>(null);
  const [assignments, setAssignments] = useState<PartnerAssignmentRecord[]>([]);
  const [requests, setRequests] = useState<ConsultRequestRecord[]>([]);
  const [drafts, setDrafts] = useState<PartnerAnswerDraftRecord[]>([]);
  const [quoteAssignments, setQuoteAssignments] = useState<QuoteAssignmentRecord[]>([]);
  const [quoteRequests, setQuoteRequests] = useState<QuoteRequestRecord[]>([]);
  const [quotes, setQuotes] = useState<QuoteRecord[]>([]);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [selectedQuoteAssignmentId, setSelectedQuoteAssignmentId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [pointCost, setPointCost] = useState(String(ANSWER_POINT_MIN));
  const [quoteItemName, setQuoteItemName] = useState("전문 서비스");
  const [quoteQuantity, setQuoteQuantity] = useState("1");
  const [quoteUnitPrice, setQuoteUnitPrice] = useState("");
  const [quoteVatIncluded, setQuoteVatIncluded] = useState(true);
  const [quoteServicePeriod, setQuoteServicePeriod] = useState("");
  const [quoteValidUntil, setQuoteValidUntil] = useState("");
  const [quoteTerms, setQuoteTerms] = useState("");
  const [quoteNotes, setQuoteNotes] = useState("");
  const [quoteSupplierProfile, setQuoteSupplierProfile] =
    useState<QuoteSupplierProfile>(EMPTY_SUPPLIER_PROFILE);
  const [nhAuditFormValues, setNhAuditFormValues] =
    useState<NhAuditPartnerFormValues>({
      ...EMPTY_NH_AUDIT_PARTNER_FORM,
    });
  const [message, setMessage] = useState("");
  const [quoteNotice, setQuoteNotice] = useState<QuoteNotice | null>(null);
  const [quoteFieldErrors, setQuoteFieldErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [quoteAction, setQuoteAction] = useState<QuoteAction | null>(null);
  const [quotePreviewUrl, setQuotePreviewUrl] = useState<string | null>(null);
  const [quotePreviewEmailReady, setQuotePreviewEmailReady] = useState<
    boolean | null
  >(null);

  const deniedSection = content.sections.find((section) => section.id === "accessNotice");
  const quoteEvaluationSection = content.sections.find(
    (section) => section.id === "quoteEvaluation",
  );

  const loadAssignments = useCallback(async () => {
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new Error("missing_user");
    const token = await user.getIdToken();
    const res = await fetch("/api/partner/assignments", {
      headers: { authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as {
      ok?: boolean;
      assignments?: PartnerAssignmentRecord[];
      requests?: ConsultRequestRecord[];
      drafts?: PartnerAnswerDraftRecord[];
    };
    if (!res.ok || !data.ok) throw new Error("assignment_load_failed");
    const nextAssignments = data.assignments ?? [];
    const nextDrafts = data.drafts ?? [];
    setAssignments(nextAssignments);
    setRequests(data.requests ?? []);
    setDrafts(nextDrafts);
    if (!selectedAssignmentId && nextAssignments[0]) {
      const firstDraft = nextDrafts.find(
        (draft) => draft.assignmentId === nextAssignments[0].id,
      );
      setSelectedAssignmentId(nextAssignments[0].id);
      setBody(firstDraft?.body ?? "");
      setPointCost(
        String(firstDraft?.pointCost ?? partner?.pointMin ?? ANSWER_POINT_MIN),
      );
    }
  }, [partner?.pointMin, selectedAssignmentId]);

  const loadQuotes = useCallback(async (partnerOverride?: PartnerRecord) => {
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new Error("missing_user");
    const token = await user.getIdToken();
    const res = await fetch("/api/partner/quotes", {
      headers: { authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as {
      ok?: boolean;
      assignments?: QuoteAssignmentRecord[];
      quoteRequests?: QuoteRequestRecord[];
      quotes?: QuoteRecord[];
    };
    if (!res.ok || !data.ok) throw new Error("quote_load_failed");
    const nextAssignments = data.assignments ?? [];
    const nextQuotes = data.quotes ?? [];
    setQuoteAssignments(nextAssignments);
    setQuoteRequests(data.quoteRequests ?? []);
    setQuotes(nextQuotes);
    if (!selectedQuoteAssignmentId && nextAssignments[0]) {
      const draft = nextQuotes.find(
        (quote) => quote.id === `${nextAssignments[0].id}_draft`,
      );
      const request = (data.quoteRequests ?? []).find(
        (item) => item.id === nextAssignments[0].quoteRequestId,
      );
      setSelectedQuoteAssignmentId(nextAssignments[0].id);
      setQuoteItemName(
        draft?.lineItems[0]?.name ??
          (request?.sourceType === "audit_quote"
            ? "회계감사 용역"
            : "전문 서비스"),
      );
      setQuoteQuantity(String(draft?.lineItems[0]?.quantity ?? 1));
      setQuoteUnitPrice(
        formatCurrencyInput(draft?.lineItems[0]?.unitPrice ?? ""),
      );
      setQuoteVatIncluded(draft?.vatIncluded ?? true);
      setQuoteServicePeriod(draft?.servicePeriod ?? "");
      setQuoteValidUntil(draft?.validUntil ?? "");
      setQuoteTerms(draft?.terms ?? "");
      setQuoteNotes(draft?.notes ?? "");
      const supplierPartner = partnerOverride;
      if (supplierPartner) {
        setQuoteSupplierProfile(
          quoteSupplierProfileFrom(supplierPartner, draft),
        );
      }
      setNhAuditFormValues(
        draft?.nhAuditDraft
          ? sanitizeNhAuditPartnerFormDraft(draft.nhAuditDraft)
          : valuesFromNhAuditSubmission(draft?.nhAuditV2?.submission),
      );
    }
  }, [selectedQuoteAssignmentId]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (!user) {
        setState("denied");
        return;
      }
      void Promise.resolve()
        .then(async () => {
          const tokenResult = await user.getIdTokenResult(true);
          if (tokenResult.claims.partner !== true) {
            setState("denied");
            return;
          }
          const token = await user.getIdToken(true);
          const sessionRes = await fetch("/api/partner/session", {
            headers: { authorization: `Bearer ${token}` },
          });
          const session = (await sessionRes.json().catch(() => null)) as {
            ok?: boolean;
            partner?: PartnerRecord;
            error?: string;
          } | null;
          if (!sessionRes.ok || !session?.ok || !session.partner) {
            if (
              session?.error === "inactive_account" ||
              session?.error === "permission_denied" ||
              session?.error === "profile_not_found"
            ) {
              setState("denied");
              return;
            }
            setState("error");
            return;
          }
          setPartner(session.partner);
          setQuoteSupplierProfile(quoteSupplierProfileFrom(session.partner));
          const results = await Promise.allSettled([
            loadAssignments(),
            loadQuotes(session.partner),
          ]);
          const failed = results.some((result) => result.status === "rejected");
          if (failed) {
            setMessage(
              "일부 배정·견적 목록을 불러오지 못했습니다. 포털은 이용할 수 있습니다.",
            );
          }
          setState("ready");
        })
        .catch(() => setState("error"));
    });
    return () => unsubscribe();
  }, [loadAssignments, loadQuotes]);

  const requestById = useMemo(
    () => new Map(requests.map((request) => [request.id, request])),
    [requests],
  );
  const draftByAssignmentId = useMemo(
    () => new Map(drafts.map((draft) => [draft.assignmentId, draft])),
    [drafts],
  );
  const selectedAssignment =
    assignments.find((assignment) => assignment.id === selectedAssignmentId) ??
    assignments[0] ??
    null;
  const quoteRequestById = useMemo(
    () => new Map(quoteRequests.map((request) => [request.id, request])),
    [quoteRequests],
  );
  const selectedQuoteAssignment =
    quoteAssignments.find(
      (assignment) => assignment.id === selectedQuoteAssignmentId,
    ) ??
    quoteAssignments[0] ??
    null;
  const selectedQuoteRequest = selectedQuoteAssignment
    ? quoteRequestById.get(selectedQuoteAssignment.quoteRequestId)
    : null;
  const canMutateSelectedQuote = Boolean(
    partner &&
      selectedQuoteAssignment &&
      selectedQuoteRequest &&
      canPartnerMutateQuoteAssignment({
        authenticatedPartnerId: partner.id,
        assignment: selectedQuoteAssignment,
        quoteRequest: selectedQuoteRequest,
      }),
  );
  const selectedFinalizedQuote = selectedQuoteAssignment
    ? quotes
        .filter(
          (quote) =>
            quote.quoteAssignmentId === selectedQuoteAssignment.id &&
            ["finalized", "delivered"].includes(quote.status),
        )
        .sort((left, right) => Number(right.version) - Number(left.version))[0]
    : null;

  const submitDraft = async (event: FormEvent<HTMLFormElement>, submit: boolean) => {
    event.preventDefault();
    if (!selectedAssignment) return;
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    const token = await user.getIdToken();
    const res = await fetch(
      `/api/partner/assignments/${selectedAssignment.id}/draft`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          body,
          pointCost: Number(pointCost),
          submit,
        }),
      },
    );
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean }
      | null;
    if (!res.ok || !data?.ok) {
      setMessage("답변 초안을 저장하지 못했습니다.");
      return;
    }
    setMessage(submit ? "답변 초안을 제출했습니다." : "답변 초안을 저장했습니다.");
    await loadAssignments();
  };

  const uploadLogo = async (file: File | null) => {
    if (!file) return;
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    const token = await user.getIdToken();
    const formData = new FormData();
    formData.set("logo", file);
    const res = await fetch("/api/partner/profile/logo", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) {
      setQuoteNotice({
        tone: "error",
        text: content.messages.quoteLogoUploadFailed,
      });
      return;
    }
    setQuoteNotice({
      tone: "success",
      text: content.messages.quoteLogoUploadSuccess,
    });
  };

  const uploadSeal = async (file: File | null) => {
    if (!file) return;
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    const token = await user.getIdToken();
    const formData = new FormData();
    formData.set("seal", file);
    const res = await fetch("/api/partner/profile/seal", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      sealPath?: string;
    } | null;
    if (!res.ok || !data?.ok || !data.sealPath) {
      setQuoteNotice({
        tone: "error",
        text: content.messages.quoteSealUploadFailed,
      });
      return;
    }
    setPartner((current) =>
      current ? { ...current, sealPath: data.sealPath } : current,
    );
    clearQuoteFieldError("supplierSeal");
    setQuoteNotice({
      tone: "success",
      text: content.messages.quoteSealUploadSuccess,
    });
  };

  const validateCurrentQuote = () => {
    if (selectedQuoteRequest?.sourceType === "audit_quote") {
      const auditValidation = validateNhAuditPartnerForm(nhAuditFormValues);
      const supplierValidation = validateQuoteSupplierProfile(
        quoteSupplierProfile,
        { requireSeal: true, sealPath: partner?.sealPath },
      );
      const supplierFieldErrors = Object.fromEntries(
        Object.entries(supplierValidation.fieldErrors).map(([field, message]) => [
          `supplier${field[0].toUpperCase()}${field.slice(1)}`,
          message,
        ]),
      );
      return {
        ...auditValidation,
        valid: auditValidation.valid && supplierValidation.valid,
        fieldErrors: {
          ...auditValidation.fieldErrors,
          ...supplierFieldErrors,
        },
        missingLabels: [
          ...auditValidation.missingLabels,
          ...Object.values(supplierValidation.fieldErrors),
        ],
      };
    }
    return validatePartnerQuoteInput({
      itemName: quoteItemName,
      quantity: quoteQuantity,
      unitPrice: quoteUnitPrice,
      servicePeriod: quoteServicePeriod,
      validUntil: quoteValidUntil,
    });
  };

  const clearQuoteFieldError = (fieldId: string) => {
    setQuoteFieldErrors((current) => {
      if (!current[fieldId]) return current;
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
  };

  const updateSupplierProfile = (
    field: keyof QuoteSupplierProfile,
    value: string,
  ) => {
    setQuoteSupplierProfile((current) => ({ ...current, [field]: value }));
    clearQuoteFieldError(
      `supplier${field[0].toUpperCase()}${field.slice(1)}`,
    );
  };

  const focusQuoteField = (fieldId: string) => {
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`quote-field-${fieldId}`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target
        ?.querySelector<HTMLElement>("input, select, textarea, button")
        ?.focus();
    });
  };

  const quotePayload = (
    validation: ReturnType<typeof validateCurrentQuote>,
    action: QuoteAction,
  ) => {
    if (selectedQuoteRequest?.sourceType === "audit_quote") {
      if (action === "draft") {
        return {
          nhAuditDraft: nhAuditFormValues,
          supplierProfile: quoteSupplierProfile,
        };
      }
      return {
        nhAuditSubmission:
          "submissionInput" in validation
            ? validation.submissionInput
            : null,
        supplierProfile: quoteSupplierProfile,
      };
    }
    return {
      lineItems: [
        {
          name: quoteItemName,
          quantity: Number(quoteQuantity),
          unitPrice: parseCurrencyInput(quoteUnitPrice),
        },
      ],
      vatIncluded: quoteVatIncluded,
      servicePeriod: quoteServicePeriod,
      validUntil: quoteValidUntil,
      terms: quoteTerms,
      notes: quoteNotes,
      supplierProfile: quoteSupplierProfile,
    };
  };

  const requestQuote = async (action: QuoteAction) => {
    if (!selectedQuoteAssignment) {
      setQuoteNotice({
        tone: "error",
        text: "먼저 견적 요청을 선택해 주세요.",
      });
      return;
    }
    if (!canMutateSelectedQuote && action !== "preview") {
      setQuoteNotice({
        tone: "error",
        text:
          content.messages.quoteAlreadyFinalized ??
          "이미 최종확정된 견적입니다. 같은 제휴사의 다른 계정에서도 다시 저장·발송할 수 없습니다.",
      });
      return;
    }
    if (
      action !== "draft" &&
      selectedQuoteRequest?.sourceType === "audit_quote" &&
      (!selectedQuoteRequest.cooperativeName ||
        !selectedQuoteRequest.fiscalYear)
    ) {
      setQuoteNotice({
        tone: "error",
        text: "대상 농협 또는 사업연도 정보가 없습니다. 운영자에게 견적요청 정보 보완을 요청해 주세요.",
      });
      return;
    }
    const validation = validateCurrentQuote();
    setQuoteFieldErrors(validation.fieldErrors);
    if (action !== "draft" && canMutateSelectedQuote && !validation.valid) {
      setQuoteNotice({
        tone: "error",
        text: `${content.messages.quoteRequiredSummary ?? "표시된 필수 입력정보를 확인해 주세요."} (${validation.missingLabels.join(", ")})`,
      });
      focusQuoteField(Object.keys(validation.fieldErrors)[0]);
      return;
    }
    const user = getFirebaseAuth().currentUser;
    if (!user) {
      setQuoteNotice({
        tone: "error",
        text: "로그인 세션이 만료되었습니다. 다시 로그인해 주세요.",
      });
      return;
    }

    setQuoteAction(action);
    setQuoteNotice(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/partner/quotes/${selectedQuoteAssignment.id}`,
        {
          method:
            action === "draft" ? "PUT" : action === "preview" ? "PATCH" : "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(quotePayload(validation, action)),
        },
      );

      if (action === "preview" && res.ok) {
        const pdfBlob = await res.blob();
        setQuotePreviewEmailReady(
          res.headers.get("x-quote-email-ready") === "true",
        );
        setQuotePreviewUrl(URL.createObjectURL(pdfBlob));
        if (res.headers.get("x-quote-already-finalized") === "true") {
          setQuoteNotice({
            tone: "success",
            text:
              content.messages.quoteAlreadyFinalizedPreview ??
              "이미 최종확정된 견적서입니다. 저장된 PDF를 표시합니다.",
          });
        }
        return;
      }

      const data = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            missingQuoteFields?: string[];
            missingRequiredFields?: string[];
            missingRequiredProposalItemIds?: string[];
            nhAuditValidationIssues?: Array<{
              path: string;
              message: string;
            }>;
            supplierProfileErrors?: Record<string, string>;
            delivery?: {
              status?: "sent" | "failed";
              error?: "email_not_configured" | "email_send_failed";
            };
          }
        | null;
      if (!res.ok || !data?.ok) {
        const nextErrors: Record<string, string | undefined> = {
          ...validation.fieldErrors,
        };
        for (const fieldId of data?.missingQuoteFields ?? []) {
          nextErrors[fieldId] =
            nextErrors[fieldId] ??
            "이 항목은 최종확정 전에 반드시 입력해야 합니다.";
        }
        for (const fieldId of data?.missingRequiredFields ?? []) {
          nextErrors[fieldId] = "이 항목을 입력해 주세요.";
        }
        for (const issue of data?.nhAuditValidationIssues ?? []) {
          const fieldId = issue.path.split(".")[0];
          if (fieldId) nextErrors[fieldId] = issue.message;
        }
        for (const [field, error] of Object.entries(
          data?.supplierProfileErrors ?? {},
        )) {
          nextErrors[
            `supplier${field[0].toUpperCase()}${field.slice(1)}`
          ] = error;
        }
        if ((data?.missingRequiredProposalItemIds?.length ?? 0) > 0) {
          nextErrors.requiredProposalItems =
            "필수 제안항목의 포함 여부를 모두 선택해 주세요.";
        }
        setQuoteFieldErrors(nextErrors);

        let errorMessage =
          content.messages.quoteSaveFailed ??
          "견적서를 저장하지 못했습니다.";
        if (
          data?.error === "assignment_already_finalized" ||
          data?.error === "duplicate_quote_submission"
        ) {
          errorMessage =
            content.messages.quoteAlreadyFinalized ??
            "이미 최종확정된 견적입니다. 같은 제휴사의 다른 계정에서도 다시 저장·발송할 수 없습니다.";
        } else if (data?.error === "quote_request_closed") {
          errorMessage =
            content.messages.quoteRequestClosed ??
            "이 견적 요청은 마감되어 더 이상 저장·발송할 수 없습니다.";
        } else if (data?.error === "nh_audit_request_context_missing") {
          errorMessage =
            "대상 농협 또는 사업연도 정보가 없습니다. 운영자에게 견적요청 정보 보완을 요청해 주세요.";
        } else if (data?.error === "nh_audit_submission_invalid") {
          errorMessage =
            content.messages.quoteRequiredSummary ??
            "표시된 필수 입력정보를 확인해 주세요.";
        } else if (data?.error === "supplier_profile_invalid") {
          errorMessage =
            content.messages.quoteSupplierProfileInvalid;
        } else if (data?.error === "evaluation_config_changed") {
          errorMessage =
            content.messages.evaluationCriteriaChanged ??
            "평가기준이 변경되었습니다. 목록을 새로 불러온 뒤 다시 입력해 주세요.";
          await loadQuotes();
        } else if (
          data?.error === "evaluation_required_fields_missing" ||
          data?.error === "quote_required_fields_missing"
        ) {
          errorMessage =
            content.messages.quoteRequiredSummary ??
            "표시된 필수 입력정보를 확인해 주세요.";
        } else if (data?.error === "invalid_line_items") {
          errorMessage = content.messages.quoteLineItemsInvalid;
        } else if (data?.error === "evaluation_payload_invalid") {
          errorMessage =
            content.messages.evaluationInvalid ??
            "평가정보 형식을 확인해 주세요. 총 투입시간은 1시간 이상이어야 하며 책임회계사 시간은 총 투입시간을 초과할 수 없습니다.";
        } else if (
          data?.error === "audit_evaluation_registration_failed"
        ) {
          errorMessage =
            content.messages.evaluationRegistrationFailed ??
            "감사평가용 견적 등록에 실패했습니다. 운영자에게 평가 설정과 전자서명 환경을 확인해 달라고 요청해 주세요.";
        } else if (data?.error === "email_not_configured") {
          errorMessage =
            content.messages.quoteDeliveryNotConfigured ??
            "메일 발송 설정이 완료되지 않아 견적을 최종확정할 수 없습니다. 운영자에게 메일 발송 설정을 요청해 주세요.";
        }
        setQuotePreviewUrl(null);
        setQuoteNotice({ tone: "error", text: errorMessage });
        const firstError = Object.keys(nextErrors)[0];
        if (firstError) focusQuoteField(firstError);
        return;
      }

      if (action === "send") {
        setQuotePreviewUrl(null);
        if (data.delivery?.status === "sent") {
          setQuoteNotice({
            tone: "success",
            text:
              content.messages.quoteFinalized ??
              "견적서를 확정하고 고객에게 이메일로 발송했습니다.",
          });
        } else {
          setQuoteNotice({
            tone: "warning",
            text:
              data.delivery?.error === "email_not_configured"
                ? content.messages.quoteDeliveryNotConfigured ??
                  "견적서를 확정해 고객 견적함에 등록했습니다. 이메일은 발송 설정이 완료되면 자동으로 다시 전송합니다."
                : content.messages.quoteDeliveryFailed ??
                  "견적서를 확정해 고객 견적함에 등록했습니다. 이메일 발송은 자동 재시도 대상에 등록했습니다.",
          });
        }
      } else {
        setQuoteNotice({
          tone: validation.valid ? "success" : "warning",
          text: validation.valid
            ? content.messages.quoteDraftSaved ??
              "견적서 초안을 저장했습니다."
            : `${content.messages.quoteDraftIncomplete ?? "초안은 저장했습니다. 최종확정 전에 표시된 필수 입력정보를 보완해 주세요."} (${validation.missingLabels.join(", ")})`,
        });
      }
      await loadQuotes();
    } catch {
      setQuoteNotice({
        tone: "error",
        text:
          content.messages.quoteNetworkFailed ??
          "네트워크 오류로 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setQuoteAction(null);
    }
  };

  useEffect(
    () => () => {
      if (quotePreviewUrl) URL.revokeObjectURL(quotePreviewUrl);
    },
    [quotePreviewUrl],
  );

  if (state === "loading") {
    return <main className="admin-state"><p>제휴사 권한을 확인하고 있습니다.</p></main>;
  }

  if (state === "denied") {
    return (
      <main className="admin-state">
        <section className="admin-state__card">
          <h1>{deniedSection?.title ?? "협력 전문가 전용 화면입니다"}</h1>
          <p>{deniedSection?.description ?? "협력 전문가 권한이 필요합니다."}</p>
          <button
            type="button"
            className="admin-btn"
            onClick={() =>
              void logoutPortalSession().then(() =>
                router.replace("/partner/login"),
              )
            }
          >
            로그아웃
          </button>
        </section>
      </main>
    );
  }

  if (state === "error") {
    return <main className="admin-state"><p>제휴사 포털을 불러오지 못했습니다.</p></main>;
  }

  const selectedRequest = selectedAssignment
    ? requestById.get(selectedAssignment.requestId)
    : null;
  const selectedDraft = selectedAssignment
    ? draftByAssignmentId.get(selectedAssignment.id)
    : null;
  const minPoint = partner?.pointMin ?? ANSWER_POINT_MIN;
  const maxPoint = partner?.pointMax ?? ANSWER_POINT_MAX;

  return (
    <main className="admin-app">
      <div className="admin-shell">
        <aside className="admin-sidebar">
          <div className="admin-brand">
            <span className="admin-brand__mark">P</span>
            <div>
              <strong>{partner?.displayName}</strong>
              <span>제휴사 포털</span>
            </div>
          </div>
          {message ? <p className="admin-form__hint">{message}</p> : null}
          <nav className="admin-nav" aria-label={sitemapCopy.title}>
            <a className="admin-nav__item" href="#partner-sitemap">
              <span className="admin-nav__label">
                {sitemapCopy.text.menuLabel}
              </span>
              <span className="admin-nav__desc">
                {sitemapCopy.text.menuDescription}
              </span>
            </a>
          </nav>
          <nav className="admin-nav" aria-label="배정 문의">
            {assignments.map((assignment) => {
              const request = requestById.get(assignment.requestId);
              return (
                <button
                  key={assignment.id}
                  type="button"
                  className={`admin-nav__item${selectedAssignment?.id === assignment.id ? " is-active" : ""}`}
                  onClick={() => {
                    const draft = draftByAssignmentId.get(assignment.id);
                    setSelectedAssignmentId(assignment.id);
                    setBody(draft?.body ?? "");
                    setPointCost(
                      String(
                        draft?.pointCost ??
                          partner?.pointMin ??
                          ANSWER_POINT_MIN,
                      ),
                    );
                  }}
                >
                  <span className="admin-nav__label">{request?.subject ?? assignment.requestId}</span>
                  <span className="admin-nav__desc">{assignment.status}</span>
                </button>
              );
            })}
          </nav>
          <nav className="admin-nav" aria-label="배정 견적">
            <span className="admin-nav__section">견적 업무</span>
            {quoteAssignments.map((assignment) => {
              const quoteRequest = quoteRequestById.get(assignment.quoteRequestId);
              return (
                <button
                  key={assignment.id}
                  type="button"
                  className={`admin-nav__item${selectedQuoteAssignment?.id === assignment.id ? " is-active" : ""}`}
                  onClick={() => {
                    const draft = quotes.find(
                      (quote) => quote.id === `${assignment.id}_draft`,
                    );
                    setQuotePreviewUrl(null);
                    setQuotePreviewEmailReady(null);
                    setQuoteNotice(null);
                    setQuoteFieldErrors({});
                    setSelectedQuoteAssignmentId(assignment.id);
                    setQuoteItemName(draft?.lineItems[0]?.name ?? "전문 서비스");
                    setQuoteQuantity(String(draft?.lineItems[0]?.quantity ?? 1));
                    setQuoteUnitPrice(
                      formatCurrencyInput(
                        draft?.lineItems[0]?.unitPrice ?? "",
                      ),
                    );
                    setQuoteVatIncluded(draft?.vatIncluded ?? true);
                    setQuoteServicePeriod(draft?.servicePeriod ?? "");
                    setQuoteValidUntil(draft?.validUntil ?? "");
                    setQuoteTerms(draft?.terms ?? "");
                    setQuoteNotes(draft?.notes ?? "");
                    if (partner) {
                      setQuoteSupplierProfile(
                        quoteSupplierProfileFrom(partner, draft),
                      );
                    }
                    setNhAuditFormValues(
                      draft?.nhAuditDraft
                        ? sanitizeNhAuditPartnerFormDraft(
                            draft.nhAuditDraft,
                          )
                        : valuesFromNhAuditSubmission(
                            draft?.nhAuditV2?.submission,
                          ),
                    );
                  }}
                >
                  <span className="admin-nav__label">
                    {quoteRequest?.subject ?? assignment.quoteRequestId}
                  </span>
                  <span className="admin-nav__desc">
                    {quoteAssignmentStatusLabel(assignment.status)}
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>
        <section className="admin-main">
          <header className="admin-topbar">
            <div>
              <p className="admin-eyebrow">협력 전문가 답변 업무</p>
              <h1>{selectedRequest?.subject ?? "배정된 문의가 없습니다."}</h1>
            </div>
          </header>
          {selectedAssignment && selectedRequest ? (
            <div className="admin-grid">
              <article className="admin-card">
                <h2>문의 내용</h2>
                <p>{selectedRequest.message}</p>
                <dl className="admin-detail-list">
                  <div>
                    <dt>문의번호</dt>
                    <dd>{selectedRequest.requestNumber}</dd>
                  </div>
                  <div>
                    <dt>농협</dt>
                    <dd>{selectedRequest.cooperativeDisplay ?? selectedRequest.cooperativeName ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>초안 상태</dt>
                    <dd>{selectedDraft?.status ?? selectedAssignment.status}</dd>
                  </div>
                </dl>
              </article>
              <form className="admin-card admin-card--span-2" onSubmit={(event) => void submitDraft(event, false)}>
                <h2>답변 초안</h2>
                <label className="admin-form__field">
                  <span>답변 포인트</span>
                  <input
                    className="admin-input"
                    inputMode="numeric"
                    value={pointCost}
                    min={minPoint}
                    max={maxPoint}
                    onChange={(event) => setPointCost(event.target.value)}
                  />
                  <small>{minPoint.toLocaleString()}P ~ {maxPoint.toLocaleString()}P</small>
                </label>
                <label className="admin-form__field">
                  <span>답변 내용</span>
                  <textarea
                    className="admin-input"
                    rows={12}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                  />
                </label>
                {message && <p className="admin-form__hint">{message}</p>}
                <div className="admin-modal__actions">
                  <button type="submit" className="admin-btn">임시 저장</button>
                  <button
                    type="button"
                    className="admin-btn admin-btn--primary"
                    onClick={(event) => void submitDraft(event as unknown as FormEvent<HTMLFormElement>, true)}
                  >
                    관리자 검수 요청
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <p className="admin-empty">현재 배정된 문의가 없습니다.</p>
          )}
          <section className="admin-card admin-card--span-2">
            <header className="admin-card__head">
              <div>
                <p className="admin-eyebrow">
                  {selectedQuoteRequest?.sourceType === "audit_quote"
                    ? "회계감사 견적 평가"
                    : "자동 견적서"}
                </p>
                <h2>{selectedQuoteRequest?.subject ?? "배정된 견적 요청이 없습니다."}</h2>
                {selectedQuoteRequest?.sourceType === "audit_quote" ? (
                  <p className="admin-form__hint">
                    평가항목과 금액을 입력한 뒤 최종확정하면 고객 이메일로 견적서가
                    자동 발송됩니다.
                  </p>
                ) : null}
              </div>
            </header>
            {selectedQuoteAssignment && selectedQuoteRequest ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void requestQuote("draft");
                }}
              >
                <dl className="admin-detail-list">
                  <div>
                    <dt>접수번호</dt>
                    <dd>{selectedQuoteRequest.sourceReference ?? selectedQuoteRequest.id}</dd>
                  </div>
                  <div>
                    <dt>고객</dt>
                    <dd>{selectedQuoteRequest.customerName ?? selectedQuoteRequest.customerEmail}</dd>
                  </div>
                  <div>
                    <dt>이메일</dt>
                    <dd>{selectedQuoteRequest.customerEmail}</dd>
                  </div>
                  <div>
                    <dt>연락처</dt>
                    <dd>{selectedQuoteRequest.customerPhone ?? "-"}</dd>
                  </div>
                </dl>
                <fieldset className="admin-form__group">
                  <legend>{quoteDocumentCopy.text.supplierFormLegend}</legend>
                  <p className="admin-form__hint">
                    {quoteDocumentCopy.text.supplierFormHelp}
                  </p>
                  <div className="admin-partner-form-grid">
                    <label
                      id="quote-field-supplierName"
                      className="admin-form__field"
                    >
                      <span>{quoteDocumentCopy.text.supplierNameInputLabel}</span>
                      <input
                        className="admin-input"
                        value={quoteSupplierProfile.name}
                        disabled={quoteAction !== null}
                        aria-invalid={Boolean(quoteFieldErrors.supplierName)}
                        onChange={(event) =>
                          updateSupplierProfile("name", event.target.value)}
                      />
                      {quoteFieldErrors.supplierName ? (
                        <small className="admin-form__error">
                          {quoteFieldErrors.supplierName}
                        </small>
                      ) : null}
                    </label>
                    <label
                      id="quote-field-supplierBusinessRegistrationNumber"
                      className="admin-form__field"
                    >
                      <span>
                        {quoteDocumentCopy.text.supplierBusinessNumberInputLabel}
                      </span>
                      <input
                        className="admin-input"
                        inputMode="numeric"
                        placeholder="000-00-00000"
                        value={
                          quoteSupplierProfile.businessRegistrationNumber
                        }
                        disabled={quoteAction !== null}
                        aria-invalid={Boolean(
                          quoteFieldErrors.supplierBusinessRegistrationNumber,
                        )}
                        onChange={(event) =>
                          updateSupplierProfile(
                            "businessRegistrationNumber",
                            event.target.value,
                          )}
                      />
                      {quoteFieldErrors.supplierBusinessRegistrationNumber ? (
                        <small className="admin-form__error">
                          {
                            quoteFieldErrors.supplierBusinessRegistrationNumber
                          }
                        </small>
                      ) : null}
                    </label>
                    <label
                      id="quote-field-supplierAddress"
                      className="admin-form__field"
                    >
                      <span>
                        {quoteDocumentCopy.text.supplierAddressInputLabel}
                      </span>
                      <input
                        className="admin-input"
                        value={quoteSupplierProfile.address}
                        disabled={quoteAction !== null}
                        aria-invalid={Boolean(
                          quoteFieldErrors.supplierAddress,
                        )}
                        onChange={(event) =>
                          updateSupplierProfile("address", event.target.value)}
                      />
                      {quoteFieldErrors.supplierAddress ? (
                        <small className="admin-form__error">
                          {quoteFieldErrors.supplierAddress}
                        </small>
                      ) : null}
                    </label>
                    <label
                      id="quote-field-supplierContactName"
                      className="admin-form__field"
                    >
                      <span>
                        {quoteDocumentCopy.text.supplierContactNameInputLabel}
                      </span>
                      <input
                        className="admin-input"
                        value={quoteSupplierProfile.contactName}
                        disabled={quoteAction !== null}
                        aria-invalid={Boolean(
                          quoteFieldErrors.supplierContactName,
                        )}
                        onChange={(event) =>
                          updateSupplierProfile(
                            "contactName",
                            event.target.value,
                          )}
                      />
                      {quoteFieldErrors.supplierContactName ? (
                        <small className="admin-form__error">
                          {quoteFieldErrors.supplierContactName}
                        </small>
                      ) : null}
                    </label>
                    <label
                      id="quote-field-supplierContactPhone"
                      className="admin-form__field"
                    >
                      <span>
                        {quoteDocumentCopy.text.supplierContactPhoneInputLabel}
                      </span>
                      <input
                        className="admin-input"
                        type="tel"
                        value={quoteSupplierProfile.contactPhone}
                        disabled={quoteAction !== null}
                        aria-invalid={Boolean(
                          quoteFieldErrors.supplierContactPhone,
                        )}
                        onChange={(event) =>
                          updateSupplierProfile(
                            "contactPhone",
                            event.target.value,
                          )}
                      />
                      {quoteFieldErrors.supplierContactPhone ? (
                        <small className="admin-form__error">
                          {quoteFieldErrors.supplierContactPhone}
                        </small>
                      ) : null}
                    </label>
                    <label
                      id="quote-field-supplierContactEmail"
                      className="admin-form__field"
                    >
                      <span>
                        {quoteDocumentCopy.text.supplierContactEmailInputLabel}
                      </span>
                      <input
                        className="admin-input"
                        type="email"
                        value={quoteSupplierProfile.contactEmail}
                        disabled={quoteAction !== null}
                        aria-invalid={Boolean(
                          quoteFieldErrors.supplierContactEmail,
                        )}
                        onChange={(event) =>
                          updateSupplierProfile(
                            "contactEmail",
                            event.target.value,
                          )}
                      />
                      {quoteFieldErrors.supplierContactEmail ? (
                        <small className="admin-form__error">
                          {quoteFieldErrors.supplierContactEmail}
                        </small>
                      ) : null}
                    </label>
                  </div>
                  <div className="admin-partner-form-grid">
                    <label className="admin-form__field">
                      <span>{quoteDocumentCopy.text.logoUploadLabel}</span>
                      <input
                        className="admin-input"
                        type="file"
                        accept="image/png,image/jpeg"
                        disabled={quoteAction !== null}
                        onChange={(event) =>
                          void uploadLogo(event.target.files?.[0] ?? null)}
                      />
                    </label>
                    <label
                      id="quote-field-supplierSeal"
                      className="admin-form__field"
                    >
                      <span>{quoteDocumentCopy.text.sealUploadLabel}</span>
                      <input
                        className="admin-input"
                        type="file"
                        accept="image/png,image/jpeg"
                        disabled={quoteAction !== null}
                        aria-invalid={Boolean(
                          quoteFieldErrors.supplierSeal,
                        )}
                        onChange={(event) =>
                          void uploadSeal(event.target.files?.[0] ?? null)}
                      />
                      <small>
                        {partner?.sealPath
                          ? quoteDocumentCopy.text.sealRegisteredHelp
                          : quoteDocumentCopy.text.sealRequiredHelp}
                      </small>
                      {quoteFieldErrors.supplierSeal ? (
                        <small className="admin-form__error">
                          {quoteFieldErrors.supplierSeal}
                        </small>
                      ) : null}
                    </label>
                  </div>
                </fieldset>
                {selectedQuoteRequest.sourceType !== "audit_quote" ? (
                  <div className="admin-partner-form-grid">
                  <label
                    id="quote-field-quoteItemName"
                    className="admin-form__field"
                  >
                    <span>{quoteDocumentCopy.text.quoteItemInputLabel}</span>
                    <input
                      className="admin-input"
                      value={quoteItemName}
                      aria-invalid={Boolean(quoteFieldErrors.quoteItemName)}
                      disabled={quoteAction !== null}
                      onChange={(event) => {
                        setQuoteItemName(event.target.value);
                        clearQuoteFieldError("quoteItemName");
                      }}
                    />
                    {quoteFieldErrors.quoteItemName ? (
                      <small className="admin-form__error">
                        {quoteFieldErrors.quoteItemName}
                      </small>
                    ) : null}
                  </label>
                  <label
                    id="quote-field-quoteQuantity"
                    className="admin-form__field"
                  >
                    <span>{quoteDocumentCopy.text.quantityInputLabel}</span>
                    <input
                      className="admin-input"
                      inputMode="decimal"
                      value={quoteQuantity}
                      aria-invalid={Boolean(quoteFieldErrors.quoteQuantity)}
                      disabled={quoteAction !== null}
                      onChange={(event) => {
                        setQuoteQuantity(event.target.value);
                        clearQuoteFieldError("quoteQuantity");
                      }}
                    />
                    {quoteFieldErrors.quoteQuantity ? (
                      <small className="admin-form__error">
                        {quoteFieldErrors.quoteQuantity}
                      </small>
                    ) : null}
                  </label>
                  <label
                    id="quote-field-quoteUnitPrice"
                    className="admin-form__field"
                  >
                    <span>{quoteDocumentCopy.text.unitPriceInputLabel}</span>
                    <input
                      className="admin-input"
                      inputMode="numeric"
                      value={quoteUnitPrice}
                      aria-invalid={Boolean(quoteFieldErrors.quoteUnitPrice)}
                      disabled={quoteAction !== null}
                      onChange={(event) => {
                        setQuoteUnitPrice(
                          formatCurrencyInput(event.target.value, 10),
                        );
                        clearQuoteFieldError("quoteUnitPrice");
                      }}
                    />
                    {quoteFieldErrors.quoteUnitPrice ? (
                      <small className="admin-form__error">
                        {quoteFieldErrors.quoteUnitPrice}
                      </small>
                    ) : null}
                  </label>
                  <label className="admin-form__field">
                    <span>{quoteDocumentCopy.text.vatIncludedInputLabel}</span>
                    <select
                      className="admin-input"
                      value={quoteVatIncluded ? "excluded" : "none"}
                      disabled={quoteAction !== null}
                      onChange={(event) =>
                        setQuoteVatIncluded(event.target.value === "excluded")}
                    >
                      <option value="excluded">
                        {quoteDocumentCopy.text.vatExcludedOption}
                      </option>
                      <option value="none">
                        {quoteDocumentCopy.text.vatNoneOption}
                      </option>
                    </select>
                  </label>
                  <label
                    id="quote-field-quoteServicePeriod"
                    className="admin-form__field"
                  >
                    <span>
                      {quoteDocumentCopy.text.servicePeriodInputLabel}
                    </span>
                    <input
                      className="admin-input"
                      value={quoteServicePeriod}
                      aria-invalid={Boolean(
                        quoteFieldErrors.quoteServicePeriod,
                      )}
                      disabled={quoteAction !== null}
                      onChange={(event) => {
                        setQuoteServicePeriod(event.target.value);
                        clearQuoteFieldError("quoteServicePeriod");
                      }}
                      placeholder={
                        quoteDocumentCopy.text.servicePeriodPlaceholder
                      }
                    />
                    {quoteFieldErrors.quoteServicePeriod ? (
                      <small className="admin-form__error">
                        {quoteFieldErrors.quoteServicePeriod}
                      </small>
                    ) : null}
                  </label>
                  <label
                    id="quote-field-quoteValidUntil"
                    className="admin-form__field"
                  >
                    <span>{quoteDocumentCopy.text.validUntilInputLabel}</span>
                    <input
                      className="admin-input"
                      value={quoteValidUntil}
                      aria-invalid={Boolean(quoteFieldErrors.quoteValidUntil)}
                      disabled={quoteAction !== null}
                      onChange={(event) => {
                        setQuoteValidUntil(event.target.value);
                        clearQuoteFieldError("quoteValidUntil");
                      }}
                      placeholder={quoteDocumentCopy.text.validUntilPlaceholder}
                    />
                    {quoteFieldErrors.quoteValidUntil ? (
                      <small className="admin-form__error">
                        {quoteFieldErrors.quoteValidUntil}
                      </small>
                    ) : null}
                  </label>
                  </div>
                ) : (
                  <PartnerNhAuditQuoteForm
                    idPrefix={`nh-audit-${selectedQuoteAssignment.id}`}
                    accountingFirmName={partner?.name ?? ""}
                    targetCooperativeName={
                      selectedQuoteRequest.cooperativeName
                    }
                    fiscalYear={selectedQuoteRequest.fiscalYear}
                    values={nhAuditFormValues}
                    errors={quoteFieldErrors}
                    disabled={quoteAction !== null || !canMutateSelectedQuote}
                    heading={quoteEvaluationSection?.title}
                    description={quoteEvaluationSection?.description}
                    copy={quoteEvaluationSection?.text}
                    onChange={setNhAuditFormValues}
                    onClearError={clearQuoteFieldError}
                  />
                )}
                {selectedQuoteRequest.sourceType !== "audit_quote" ? (
                  <>
                    <label className="admin-form__field">
                  <span>{quoteDocumentCopy.text.termsInputLabel}</span>
                  <textarea
                    className="admin-input"
                    rows={4}
                    value={quoteTerms}
                    disabled={quoteAction !== null}
                    onChange={(event) => setQuoteTerms(event.target.value)}
                  />
                    </label>
                    <label className="admin-form__field">
                  <span>{quoteDocumentCopy.text.notesInputLabel}</span>
                  <textarea
                    className="admin-input"
                    rows={4}
                    value={quoteNotes}
                    disabled={quoteAction !== null}
                    onChange={(event) => setQuoteNotes(event.target.value)}
                  />
                    </label>
                  </>
                ) : null}
                {quoteNotice ? (
                  <p
                    className={
                      quoteNotice.tone === "success"
                        ? "admin-form__hint"
                        : "admin-form__error"
                    }
                    role={quoteNotice.tone === "success" ? "status" : "alert"}
                  >
                    {quoteNotice.text}
                  </p>
                ) : null}
                {!canMutateSelectedQuote && selectedQuoteAssignment ? (
                  <p className="admin-form__hint" role="status">
                    {selectedFinalizedQuote
                      ? (content.messages.quoteAlreadyFinalizedHint ??
                        "이미 최종확정된 견적입니다. 미리보기로 저장된 PDF를 확인할 수 있으며, 같은 제휴사 계정으로는 다시 발송할 수 없습니다.")
                      : (content.messages.quoteMutationLocked ??
                        "이 견적 요청은 현재 저장·발송할 수 없는 상태입니다.")}
                  </p>
                ) : null}
                <div className="admin-modal__actions">
                  <button
                    type="submit"
                    className="admin-btn"
                    disabled={quoteAction !== null || !canMutateSelectedQuote}
                  >
                    {quoteAction === "draft"
                      ? content.messages.quoteDraftSaving
                      : content.messages.quoteDraftSaveButton}
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn--primary"
                    disabled={quoteAction !== null}
                    onClick={() => void requestQuote("preview")}
                  >
                    {quoteAction === "preview"
                      ? content.messages.quotePreviewLoading ??
                        "미리보기 생성 중..."
                      : !canMutateSelectedQuote
                        ? (content.messages.quoteViewFinalizedButton ??
                          "확정 견적서 미리보기")
                        : content.messages.quotePreviewButton ??
                          "견적서 미리보기 및 전송 확인"}
                  </button>
                </div>
              </form>
            ) : (
              <p className="admin-empty">
                {content.messages.quoteAssignmentsEmpty}
              </p>
            )}
          </section>
          <div id="partner-sitemap">
            <PortalSitemap
              sitemap={sitemap}
              copy={{
                title: sitemapCopy.title,
                description: sitemapCopy.description ?? "",
                publicGroupTitle: sitemapCopy.text.publicGroupTitle ?? "",
                roleGroupTitle: sitemapCopy.text.roleGroupTitle ?? "",
                countPrefix: sitemapCopy.text.countPrefix ?? "",
                countSuffix: sitemapCopy.text.countSuffix ?? "",
                automaticUpdateLabel:
                  sitemapCopy.text.automaticUpdateLabel ?? "",
                openLabel: sitemapCopy.text.openLabel ?? "",
              }}
            />
          </div>
        </section>
      </div>
      {quotePreviewUrl && selectedQuoteRequest ? (
        <div
          className="admin-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quote-preview-title"
        >
          <button
            type="button"
            className="admin-modal__backdrop"
            aria-label="견적서 미리보기 닫기"
            disabled={quoteAction === "send"}
            onClick={() => setQuotePreviewUrl(null)}
          />
          <section className="admin-modal__panel admin-modal__panel--quote-preview">
            <header className="admin-modal__head">
              <div>
                <p className="admin-modal__eyebrow">
                  {content.messages.quotePreviewEyebrow ??
                    "고객 발송 전 확인"}
                </p>
                <h2 id="quote-preview-title">
                  {content.messages.quotePreviewTitle ?? "견적서 미리보기"}
                </h2>
                <p className="admin-modal__lede">
                  {content.messages.quotePreviewRecipient ?? "수신자"}:{" "}
                  {selectedQuoteRequest.customerEmail}
                </p>
              </div>
              <button
                type="button"
                className="admin-modal__close"
                aria-label="견적서 미리보기 닫기"
                disabled={quoteAction === "send"}
                onClick={() => setQuotePreviewUrl(null)}
              >
                ×
              </button>
            </header>
            <div className="admin-modal__body">
              <iframe
                className="partner-quote-preview"
                src={quotePreviewUrl}
                title="고객에게 발송할 견적서 PDF 미리보기"
              />
              <p className="admin-form__hint">
                {content.messages.quotePreviewHelp ??
                  "표시된 PDF와 고객 이메일을 확인해 주세요. 확정하면 고객 견적함에 즉시 등록되며, 메일 설정이 완료된 경우 PDF도 첨부 발송됩니다."}
              </p>
              {quotePreviewEmailReady === false ? (
                <p className="admin-form__hint" role="status">
                  {content.messages.quoteDeliveryPendingHelp ??
                    "메일 발송 설정 전에도 견적 확정과 고객 견적함 등록은 가능합니다. 이메일은 설정 완료 후 자동 재시도합니다."}
                </p>
              ) : null}
              <div className="admin-modal__actions">
                <button
                  type="button"
                  className="admin-btn"
                  disabled={quoteAction === "send"}
                  onClick={() => setQuotePreviewUrl(null)}
                >
                  {content.messages.quotePreviewEdit ?? "입력 내용 수정"}
                </button>
                <button
                  type="button"
                  className="admin-btn admin-btn--primary"
                  disabled={quoteAction === "send" || !canMutateSelectedQuote}
                  onClick={() => void requestQuote("send")}
                >
                  {quoteAction === "send"
                    ? content.messages.quoteSending ??
                      "최종확정 및 발송 중..."
                    : !canMutateSelectedQuote
                      ? (content.messages.quoteAlreadyFinalizedSendDisabled ??
                        "이미 최종확정됨")
                      : content.messages.quoteSendConfirm ??
                        "확인 완료 · 최종확정 및 고객 발송"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      <CmsSupplementalSections pageKey="partner.portal" content={content} />
    </main>
  );
}

function quoteAssignmentStatusLabel(
  status: QuoteAssignmentRecord["status"],
): string {
  return {
    assigned: "배정됨",
    drafting: "작성 중",
    submitted: "제출됨",
    finalized: "최종확정",
    revoked: "배정 취소",
  }[status];
}
