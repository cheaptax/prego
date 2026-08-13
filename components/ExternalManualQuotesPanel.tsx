"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { PartnerNhAuditQuoteForm } from "@/components/PartnerNhAuditQuoteForm";
import { formStateFromExternalManualQuote } from "@/lib/quotes/external-manual-quote-form";
import {
  EMPTY_NH_AUDIT_PARTNER_FORM,
  type NhAuditPartnerFormField,
  type NhAuditPartnerFormValues,
} from "@/lib/quotes/nh-audit-quote-form";
import type { ExternalManualQuoteRecord } from "@/lib/quotes/quote-automation-types";
import type { QuoteSupplierProfile } from "@/lib/quotes/supplier-profile";

const EMPTY_SUPPLIER: QuoteSupplierProfile = {
  name: "",
  businessRegistrationNumber: "",
  address: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
};

const EXTERNAL_AUDIT_COPY: Record<string, string> = {
  eyebrow: "회계감사 견적 평가정보",
  engagementPartnerLabel: "담당회계사 이름",
  proposerTypeLabel: "제안 주체 유형",
  auditFeeLabel: "감사보수(VAT 제외, 원)",
  expenseModeLabel: "제경비 청구방식",
  expectedExpenseLabel: "예상 제경비(원)",
  localAuditCountLabel: "2025년 지역농협 회계감사 수행 건수",
  cpaCountLabel: "소속 공인회계사 수",
  revenueLabel: "회계법인 최근 확정 사업연도 매출액(원)",
  cooperativeTypesLabel: "2025년 수행 농협 유형",
  taxAgencyLabel: "2025년 농협 세무대리 수행 여부",
  subsidySettlementLabel: "2025년 농협 보조금 정산 수행 여부",
  evaluationDefaultsHelp:
    "알고 있는 항목만 입력하세요. 입력하지 않은 정보는 평가 시 0점으로 처리됩니다.",
};

export function ExternalManualQuotesPanel({
  caseId,
  targetCooperativeName,
  fiscalYear,
  onChanged,
}: {
  caseId: string;
  targetCooperativeName?: string;
  fiscalYear?: number;
  onChanged?: () => void | Promise<void>;
}) {
  const [quotes, setQuotes] = useState<ExternalManualQuoteRecord[]>([]);
  const [supplier, setSupplier] = useState<QuoteSupplierProfile>(EMPTY_SUPPLIER);
  const [auditValues, setAuditValues] = useState<NhAuditPartnerFormValues>(
    EMPTY_NH_AUDIT_PARTNER_FORM,
  );
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<NhAuditPartnerFormField | "supplierName" | "auditFeeWon", string>>
  >({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [initialExpandDone, setInitialExpandDone] = useState(false);
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(
      `/api/audit-evaluations/${encodeURIComponent(caseId)}/external-quotes`,
      { credentials: "include" },
    );
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      quotes?: ExternalManualQuoteRecord[];
    } | null;
    if (response.ok && data?.ok) {
      const nextQuotes = data.quotes ?? [];
      setQuotes(nextQuotes);
      setInitialExpandDone((done) => {
        if (!done && nextQuotes.length > 0) {
          setExpanded(true);
        }
        return true;
      });
    } else {
      setInitialExpandDone(true);
    }
  }, [caseId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function resetForm() {
    setEditingQuoteId(null);
    setSupplier(EMPTY_SUPPLIER);
    setAuditValues(EMPTY_NH_AUDIT_PARTNER_FORM);
    setFieldErrors({});
  }

  function startEdit(quote: ExternalManualQuoteRecord) {
    if (!quote.id) {
      setMessage("이 견적을 수정할 수 없습니다. 삭제 후 다시 추가해 주세요.");
      return;
    }
    const next = formStateFromExternalManualQuote(quote);
    setEditingQuoteId(quote.id);
    setSupplier(next.supplier);
    setAuditValues(next.auditValues);
    setFieldErrors({});
    setMessage(
      `${quote.accountingFirmName || quote.supplierName} 견적을 수정합니다. 추가 정보를 입력한 뒤 저장해 주세요.`,
    );
    setExpanded(true);
    window.requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const nextErrors: typeof fieldErrors = {};
    const firmName = supplier.name.trim();
    if (!firmName) {
      nextErrors.supplierName = "회계법인명을 입력해 주세요.";
    }
    const auditFeeDigits = auditValues.auditFeeWon.replace(/\D/gu, "");
    if (!auditFeeDigits || BigInt(auditFeeDigits) <= 0n) {
      nextErrors.auditFeeWon =
        "비교를 위해 감사보수는 0보다 큰 금액으로 입력해 주세요.";
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setBusy(false);
      return;
    }

    try {
      const yesNoToBoolean = (value: NhAuditPartnerFormValues[
        | "nonghyupTaxAgencyPerformed2025"
        | "nonghyupSubsidySettlementPerformed2025"
      ]) => value === "YES";

      const response = await fetch(
        `/api/audit-evaluations/${encodeURIComponent(caseId)}/external-quotes`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            quoteId: editingQuoteId || undefined,
            supplierName: firmName,
            supplierBusinessRegistrationNumber:
              supplier.businessRegistrationNumber,
            supplierAddress: supplier.address,
            supplierContactName: supplier.contactName,
            supplierContactEmail: supplier.contactEmail,
            supplierContactPhone: supplier.contactPhone,
            accountingFirmName: firmName,
            engagementPartnerName: auditValues.engagementPartnerName,
            proposerType: auditValues.proposerType || "ACCOUNTING_FIRM",
            auditFeeWon: auditFeeDigits,
            expenseBillingMode:
              auditValues.expenseBillingMode || "INCLUDED_IN_AUDIT_FEE",
            expectedExpenseWon:
              auditValues.expenseBillingMode === "SEPARATELY_BILLED"
                ? auditValues.expectedExpenseWon.replace(/\D/gu, "") || "0"
                : "0",
            localNonghyupAuditCount2025:
              Number(auditValues.localNonghyupAuditCount2025 || 0) || 0,
            certifiedPublicAccountantCount:
              Number(auditValues.certifiedPublicAccountantCount || 0) || 0,
            accountingFirmRevenueWon:
              auditValues.accountingFirmRevenueWon.replace(/\D/gu, "") || "0",
            auditedNonghyupTypes2025: auditValues.noAuditedNonghyupTypes2025
              ? []
              : auditValues.auditedNonghyupTypes2025,
            noAuditedNonghyupTypes2025: auditValues.noAuditedNonghyupTypes2025,
            nonghyupTaxAgencyPerformed2025: yesNoToBoolean(
              auditValues.nonghyupTaxAgencyPerformed2025,
            ),
            nonghyupSubsidySettlementPerformed2025: yesNoToBoolean(
              auditValues.nonghyupSubsidySettlementPerformed2025,
            ),
          }),
        },
      );
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !data?.ok) {
        setMessage(
          editingQuoteId
            ? "비제휴 견적을 수정하지 못했습니다."
            : "비제휴 견적을 저장하지 못했습니다.",
        );
        return;
      }
      const wasEditing = Boolean(editingQuoteId);
      resetForm();
      setMessage(
        wasEditing
          ? "비제휴 견적을 수정했습니다."
          : "비제휴 견적을 비교 대상에 추가했습니다.",
      );
      await refresh();
      await onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function remove(quote: ExternalManualQuoteRecord) {
    const quoteId = quote.id?.trim() ?? "";
    if (!quoteId) {
      setMessage("이 견적을 삭제할 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.");
      return;
    }
    const firmName = quote.accountingFirmName || quote.supplierName;
    if (
      typeof window !== "undefined" &&
      !window.confirm(`${firmName} 견적을 삭제할까요?`)
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/audit-evaluations/${encodeURIComponent(caseId)}/external-quotes?quoteId=${encodeURIComponent(quoteId)}`,
        { method: "DELETE", credentials: "include" },
      );
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
      } | null;
      if (!response.ok || !data?.ok) {
        setMessage("비제휴 견적을 삭제하지 못했습니다.");
        return;
      }
      if (editingQuoteId === quoteId) resetForm();
      setMessage("비제휴 견적을 삭제했습니다.");
      await refresh();
      await onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="external-manual-quotes"
      aria-labelledby="external-quotes-title"
    >
      <div className="external-manual-quotes__toggle-row">
        <div>
          <h3 id="external-quotes-title">비제휴사 견적 비교 (선택)</h3>
          <p>
            제휴사 외의 견적이 있으신 경우 추가를 선택하여 비교하실수
            있습니다.
          </p>
        </div>
        <label className="external-manual-quotes__switch">
          <span className="visually-hidden">비제휴 견적 추가 옵션</span>
          <input
            type="checkbox"
            role="switch"
            checked={expanded}
            aria-checked={expanded}
            aria-controls="external-quotes-panel"
            onChange={(event) => {
              setExpanded(event.target.checked);
              if (!event.target.checked) setMessage(null);
            }}
          />
          <span aria-hidden="true">{expanded ? "닫기" : "선택"}</span>
        </label>
      </div>

      {!expanded && quotes.length > 0 ? (
        <p className="external-manual-quotes__hint" role="status">
          저장된 비제휴 견적 {quotes.length}건이 있습니다. 옵션을 켜면
          확인·수정·추가할 수 있습니다.
        </p>
      ) : null}

      {expanded ? (
        <div id="external-quotes-panel" className="external-manual-quotes__panel">
          <p className="admin-form__hint">
            제휴사 견적과 동일한 항목을 입력할 수 있습니다. 알고 있는 부분만
            선택적으로 입력하면 되고, 입력하지 않은 정보는 평가 시 0점으로
            처리됩니다. 비교를 위해 회계법인명과 감사보수는 필요합니다.
          </p>
          {quotes.length > 0 ? (
            <ul className="external-manual-quotes__list">
              {quotes.map((quote) => {
                const firmName =
                  quote.accountingFirmName || quote.supplierName;
                const isEditing = editingQuoteId === quote.id;
                return (
                  <li
                    key={quote.id}
                    className={isEditing ? "is-editing" : undefined}
                  >
                    <div className="external-manual-quotes__list-main">
                      <strong>{firmName}</strong>
                      <span>
                        감사보수{" "}
                        {Number(quote.auditFeeWon).toLocaleString("ko-KR")}원
                      </span>
                    </div>
                    <div className="external-manual-quotes__actions">
                      <button
                        type="button"
                        className="cta cta--ghost"
                        disabled={busy}
                        onClick={() => startEdit(quote)}
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        className="cta cta--ghost"
                        disabled={busy}
                        onClick={() => void remove(quote)}
                      >
                        삭제
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <form
            ref={formRef}
            className="external-manual-quotes__form"
            onSubmit={(event) => void submit(event)}
          >
            <section className="admin-card">
              <header className="admin-card__head">
                <div>
                  <p className="admin-eyebrow">
                    {editingQuoteId ? "비제휴 견적 수정" : "견적서 공급자"}
                  </p>
                  <h3>
                    {editingQuoteId
                      ? "선택한 비제휴 견적 수정"
                      : "견적서 공급자 정보"}
                  </h3>
                  <p className="admin-form__hint">
                    {editingQuoteId
                      ? "금액과 평가정보를 고치거나, 처음 입력하지 않은 항목을 추가로 적을 수 있습니다."
                      : "알고 있는 공급자 정보만 입력하면 됩니다."}
                  </p>
                </div>
              </header>
              <fieldset className="admin-form__group">
                <legend>견적서 공급자 정보</legend>
                <div className="admin-partner-form-grid">
                  <label className="admin-form__field">
                    <span>회계법인명</span>
                    <input
                      className="admin-input"
                      value={supplier.name}
                      disabled={busy}
                      aria-invalid={Boolean(fieldErrors.supplierName)}
                      onChange={(event) => {
                        setSupplier((current) => ({
                          ...current,
                          name: event.target.value,
                        }));
                        setFieldErrors((current) => ({
                          ...current,
                          supplierName: undefined,
                        }));
                      }}
                    />
                    {fieldErrors.supplierName ? (
                      <small className="admin-form__error" role="alert">
                        {fieldErrors.supplierName}
                      </small>
                    ) : null}
                  </label>
                  <label className="admin-form__field">
                    <span>사업자등록번호</span>
                    <input
                      className="admin-input"
                      inputMode="numeric"
                      placeholder="000-00-00000"
                      value={supplier.businessRegistrationNumber}
                      disabled={busy}
                      onChange={(event) =>
                        setSupplier((current) => ({
                          ...current,
                          businessRegistrationNumber: event.target.value,
                        }))}
                    />
                  </label>
                  <label className="admin-form__field">
                    <span>사업장 주소</span>
                    <input
                      className="admin-input"
                      value={supplier.address}
                      disabled={busy}
                      onChange={(event) =>
                        setSupplier((current) => ({
                          ...current,
                          address: event.target.value,
                        }))}
                    />
                  </label>
                  <label className="admin-form__field">
                    <span>견적 담당자</span>
                    <input
                      className="admin-input"
                      value={supplier.contactName}
                      disabled={busy}
                      onChange={(event) =>
                        setSupplier((current) => ({
                          ...current,
                          contactName: event.target.value,
                        }))}
                    />
                  </label>
                  <label className="admin-form__field">
                    <span>견적 담당자 연락처</span>
                    <input
                      className="admin-input"
                      type="tel"
                      value={supplier.contactPhone}
                      disabled={busy}
                      onChange={(event) =>
                        setSupplier((current) => ({
                          ...current,
                          contactPhone: event.target.value,
                        }))}
                    />
                  </label>
                  <label className="admin-form__field">
                    <span>견적 담당자 이메일</span>
                    <input
                      className="admin-input"
                      type="email"
                      value={supplier.contactEmail}
                      disabled={busy}
                      onChange={(event) =>
                        setSupplier((current) => ({
                          ...current,
                          contactEmail: event.target.value,
                        }))}
                    />
                  </label>
                </div>
              </fieldset>
            </section>

            <PartnerNhAuditQuoteForm
              idPrefix={`external-${caseId}`}
              variant="external"
              accountingFirmName={supplier.name}
              targetCooperativeName={targetCooperativeName}
              fiscalYear={fiscalYear}
              values={auditValues}
              errors={{
                ...fieldErrors,
                auditFeeWon: fieldErrors.auditFeeWon,
              }}
              disabled={busy}
              copy={EXTERNAL_AUDIT_COPY}
              showFactsConfirmation={false}
              onChange={setAuditValues}
              onClearError={(field) =>
                setFieldErrors((current) => ({
                  ...current,
                  [field]: undefined,
                }))}
            />

            <div className="external-manual-quotes__form-actions">
              <button type="submit" className="cta cta--solid" disabled={busy}>
                {busy
                  ? "저장 중..."
                  : editingQuoteId
                    ? "수정 내용 저장"
                    : "비제휴 견적 추가"}
              </button>
              {editingQuoteId ? (
                <button
                  type="button"
                  className="cta cta--ghost"
                  disabled={busy}
                  onClick={() => {
                    resetForm();
                    setMessage(null);
                  }}
                >
                  수정 취소
                </button>
              ) : null}
            </div>
          </form>
          {message ? <p role="status">{message}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
