"use client";

import type {
  NhAuditCooperativeType2025,
  NhAuditExpenseBillingMode,
  NhAuditProposerType,
} from "@/lib/audit-evaluation/nh-audit-v2-types";
import { formatCurrencyInput } from "@/lib/currency-input";
import {
  calculateNhAuditCostPreview,
  type NhAuditPartnerFormField,
  type NhAuditPartnerFormValues,
  type NhAuditYesNoChoice,
} from "@/lib/quotes/nh-audit-quote-form";

type Props = {
  idPrefix: string;
  accountingFirmName: string;
  targetCooperativeName?: string;
  fiscalYear?: number;
  values: NhAuditPartnerFormValues;
  errors: Partial<Record<NhAuditPartnerFormField, string>>;
  disabled?: boolean;
  heading?: string;
  description?: string;
  copy?: Record<string, string>;
  onChange: (values: NhAuditPartnerFormValues) => void;
  onClearError: (field: NhAuditPartnerFormField) => void;
};

const COOPERATIVE_TYPES: Array<{
  value: NhAuditCooperativeType2025;
  label: string;
}> = [
  { value: "LOCAL_AGRICULTURAL_COOPERATIVE", label: "지역농협" },
  { value: "LOCAL_LIVESTOCK_COOPERATIVE", label: "지역축협" },
  {
    value: "ITEM_AGRICULTURAL_OR_LIVESTOCK_COOPERATIVE",
    label: "품목농협·품목축협(원예농협 포함)",
  },
  { value: "GINSENG_COOPERATIVE", label: "인삼농협" },
];

export function PartnerNhAuditQuoteForm({
  idPrefix,
  accountingFirmName,
  targetCooperativeName,
  fiscalYear,
  values,
  errors,
  disabled = false,
  heading,
  description,
  copy = {},
  onChange,
  onClearError,
}: Props) {
  const costPreview = calculateNhAuditCostPreview(values);
  const fieldId = (field: NhAuditPartnerFormField) =>
    `${idPrefix}-${field}`;
  const errorId = (field: NhAuditPartnerFormField) =>
    `${fieldId(field)}-error`;
  const describedBy = (field: NhAuditPartnerFormField, helpId?: string) =>
    [helpId, errors[field] ? errorId(field) : ""].filter(Boolean).join(" ") ||
    undefined;
  const update = <Key extends keyof NhAuditPartnerFormValues>(
    key: Key,
    value: NhAuditPartnerFormValues[Key],
    errorField: NhAuditPartnerFormField = key as NhAuditPartnerFormField,
  ) => {
    onChange({ ...values, [key]: value });
    onClearError(errorField);
  };

  return (
    <section className="admin-card nh-audit-partner-form">
      <header className="admin-card__head">
        <div>
          <p className="admin-eyebrow">
            {copy.eyebrow || "회계감사 견적 제출"}
          </p>
          <h3>{heading || "회계감사 견적 정보"}</h3>
          <p className="admin-form__hint">
            {description ||
              "정해진 항목을 입력하면 서버가 평가기준에 따라 검증하고 점수를 계산합니다."}
          </p>
        </div>
      </header>

      <fieldset className="admin-form__group">
        <legend>{copy.basicLegend || "기본정보"}</legend>
        <dl className="admin-detail-list nh-audit-readonly-info">
          <div>
            <dt>{copy.accountingFirmLabel || "회계법인명"}</dt>
            <dd>{accountingFirmName || "계정정보 확인 필요"}</dd>
          </div>
          <div>
            <dt>{copy.targetCooperativeLabel || "대상 농협"}</dt>
            <dd>{targetCooperativeName || "견적요청 정보 미등록"}</dd>
          </div>
          <div>
            <dt>{copy.fiscalYearLabel || "사업연도"}</dt>
            <dd>{fiscalYear ? `${fiscalYear}년` : "견적요청 정보 미등록"}</dd>
          </div>
          <div>
            <dt>{copy.submittedAtLabel || "제출일시"}</dt>
            <dd>{copy.submittedAtHelp || "최종 제출 시 서버가 자동 기록"}</dd>
          </div>
        </dl>
        {!targetCooperativeName || !fiscalYear ? (
          <p className="nh-audit-warning" role="alert">
            {copy.requestContextMissing ||
              "대상 농협 또는 사업연도가 견적요청에 등록되지 않았습니다. 운영자에게 요청정보 보완을 요청해 주세요."}
          </p>
        ) : null}

        <label
          id={`quote-field-engagementPartnerName`}
          className="admin-form__field"
          htmlFor={fieldId("engagementPartnerName")}
        >
          <span>{copy.engagementPartnerLabel || "담당회계사 이름 *"}</span>
          <input
            id={fieldId("engagementPartnerName")}
            className="admin-input"
            type="text"
            autoComplete="name"
            maxLength={200}
            value={values.engagementPartnerName}
            disabled={disabled}
            aria-invalid={Boolean(errors.engagementPartnerName)}
            aria-describedby={describedBy("engagementPartnerName")}
            onChange={(event) =>
              update("engagementPartnerName", event.target.value)}
          />
          <FieldError
            id={errorId("engagementPartnerName")}
            message={errors.engagementPartnerName}
          />
        </label>

        <ChoiceFieldset
          id={fieldId("proposerType")}
          quoteFieldId="quote-field-proposerType"
          legend={copy.proposerTypeLabel || "제안 주체 유형 *"}
          value={values.proposerType}
          choices={[
            { value: "ACCOUNTING_FIRM", label: "회계법인" },
            { value: "AUDIT_GROUP", label: "감사반" },
          ]}
          disabled={disabled}
          error={errors.proposerType}
          errorId={errorId("proposerType")}
          onChange={(value) =>
            update("proposerType", value as NhAuditProposerType)}
        />
        {values.proposerType === "AUDIT_GROUP" ? (
          <p className="nh-audit-warning nh-audit-warning--critical" role="alert">
            {copy.auditGroupWarning ||
              "감사반은 현재 평가기준상 부적격으로 처리되며 종합순위에 포함되지 않습니다."}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="admin-form__group">
        <legend>{copy.costLegend || "비용정보"}</legend>
        <label
          id="quote-field-auditFeeWon"
          className="admin-form__field"
          htmlFor={fieldId("auditFeeWon")}
        >
          <span>{copy.auditFeeLabel || "감사보수(VAT 제외, 원) *"}</span>
          <input
            id={fieldId("auditFeeWon")}
            className="admin-input"
            type="text"
            inputMode="numeric"
            value={values.auditFeeWon}
            disabled={disabled}
            aria-invalid={Boolean(errors.auditFeeWon)}
            aria-describedby={describedBy(
              "auditFeeWon",
              `${fieldId("auditFeeWon")}-help`,
            )}
            onChange={(event) =>
              update("auditFeeWon", formatCurrencyInput(event.target.value, 15))}
          />
          <small id={`${fieldId("auditFeeWon")}-help`}>
            {copy.auditFeeHelp || "부가가치세를 제외한 감사보수를 원 단위로 입력합니다."}
          </small>
          <FieldError
            id={errorId("auditFeeWon")}
            message={errors.auditFeeWon}
          />
        </label>

        <ChoiceFieldset
          id={fieldId("expenseBillingMode")}
          quoteFieldId="quote-field-expenseBillingMode"
          legend={copy.expenseModeLabel || "제경비 청구방식 *"}
          value={values.expenseBillingMode}
          choices={[
            {
              value: "INCLUDED_IN_AUDIT_FEE",
              label: "감사보수에 전액 포함",
            },
            { value: "SEPARATELY_BILLED", label: "별도 청구" },
          ]}
          disabled={disabled}
          error={errors.expenseBillingMode}
          errorId={errorId("expenseBillingMode")}
          onChange={(value) => {
            const expenseBillingMode = value as NhAuditExpenseBillingMode;
            onChange({
              ...values,
              expenseBillingMode,
              expectedExpenseWon:
                expenseBillingMode === "INCLUDED_IN_AUDIT_FEE"
                  ? "0"
                  : values.expectedExpenseWon === "0"
                    ? ""
                    : values.expectedExpenseWon,
            });
            onClearError("expenseBillingMode");
            onClearError("expectedExpenseWon");
          }}
        />

        <label
          id="quote-field-expectedExpenseWon"
          className="admin-form__field"
          htmlFor={fieldId("expectedExpenseWon")}
        >
          <span>{copy.expectedExpenseLabel || "예상 제경비(원) *"}</span>
          <input
            id={fieldId("expectedExpenseWon")}
            className="admin-input"
            type="text"
            inputMode="numeric"
            value={
              values.expenseBillingMode === "INCLUDED_IN_AUDIT_FEE"
                ? "0"
                : values.expectedExpenseWon
            }
            disabled={
              disabled ||
              values.expenseBillingMode !== "SEPARATELY_BILLED"
            }
            aria-invalid={Boolean(errors.expectedExpenseWon)}
            aria-describedby={describedBy(
              "expectedExpenseWon",
              `${fieldId("expectedExpenseWon")}-help`,
            )}
            onChange={(event) =>
              update(
                "expectedExpenseWon",
                formatCurrencyInput(event.target.value, 15),
              )}
          />
          <small id={`${fieldId("expectedExpenseWon")}-help`}>
            {values.expenseBillingMode === "INCLUDED_IN_AUDIT_FEE"
              ? copy.expenseIncludedHelp ||
                "감사보수 포함을 선택하면 예상 제경비는 0원으로 처리됩니다."
              : copy.expenseSeparateHelp ||
                "별도 청구할 예상 제경비를 원 단위로 입력합니다."}
          </small>
          <FieldError
            id={errorId("expectedExpenseWon")}
            message={errors.expectedExpenseWon}
          />
        </label>

        <div className="nh-audit-cost-preview" aria-live="polite">
          <span>{copy.totalPreviewLabel || "예상 총부담액"}</span>
          <strong>
            {costPreview === null
              ? "입력 후 계산"
              : `${costPreview.toLocaleString("ko-KR")}원`}
          </strong>
          <small>
            {copy.totalPreviewHelp ||
              "VAT 10%와 별도 제경비를 반영한 참고값이며 서버 확정 결과가 최종값입니다."}
          </small>
        </div>
      </fieldset>

      <fieldset className="admin-form__group">
        <legend>{copy.evaluationLegend || "평가정보"}</legend>
        <IntegerField
          id={fieldId("localNonghyupAuditCount2025")}
          quoteFieldId="quote-field-localNonghyupAuditCount2025"
          label={
            copy.localAuditCountLabel ||
            "2025년 지역농협 회계감사 수행 건수 *"
          }
          unit="건"
          value={values.localNonghyupAuditCount2025}
          disabled={disabled}
          error={errors.localNonghyupAuditCount2025}
          errorId={errorId("localNonghyupAuditCount2025")}
          onChange={(value) =>
            update("localNonghyupAuditCount2025", value)}
        />
        <IntegerField
          id={fieldId("certifiedPublicAccountantCount")}
          quoteFieldId="quote-field-certifiedPublicAccountantCount"
          label={copy.cpaCountLabel || "소속 공인회계사 수 *"}
          unit="명"
          value={values.certifiedPublicAccountantCount}
          disabled={disabled}
          error={errors.certifiedPublicAccountantCount}
          errorId={errorId("certifiedPublicAccountantCount")}
          onChange={(value) =>
            update("certifiedPublicAccountantCount", value)}
        />
        <label
          id="quote-field-accountingFirmRevenueWon"
          className="admin-form__field"
          htmlFor={fieldId("accountingFirmRevenueWon")}
        >
          <span>
            {copy.revenueLabel ||
              "회계법인 최근 확정 사업연도 매출액(원) *"}
          </span>
          <input
            id={fieldId("accountingFirmRevenueWon")}
            className="admin-input"
            type="text"
            inputMode="numeric"
            value={values.accountingFirmRevenueWon}
            disabled={disabled}
            aria-invalid={Boolean(errors.accountingFirmRevenueWon)}
            aria-describedby={describedBy("accountingFirmRevenueWon")}
            onChange={(event) =>
              update(
                "accountingFirmRevenueWon",
                formatCurrencyInput(event.target.value, 15),
              )}
          />
          <FieldError
            id={errorId("accountingFirmRevenueWon")}
            message={errors.accountingFirmRevenueWon}
          />
        </label>

        <fieldset
          id="quote-field-auditedNonghyupTypes2025"
          className="admin-form__group nh-audit-choice-group"
          aria-invalid={Boolean(errors.auditedNonghyupTypes2025)}
          aria-describedby={
            errors.auditedNonghyupTypes2025
              ? errorId("auditedNonghyupTypes2025")
              : undefined
          }
        >
          <legend>
            {copy.cooperativeTypesLabel || "2025년 수행 농협 유형 *"}
          </legend>
          <div className="nh-audit-options">
            {COOPERATIVE_TYPES.map((option) => (
              <label key={option.value} className="nh-audit-option">
                <input
                  type="checkbox"
                  value={option.value}
                  checked={values.auditedNonghyupTypes2025.includes(
                    option.value,
                  )}
                  disabled={disabled}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...values.auditedNonghyupTypes2025, option.value]
                      : values.auditedNonghyupTypes2025.filter(
                          (value) => value !== option.value,
                        );
                    onChange({
                      ...values,
                      auditedNonghyupTypes2025: next,
                      noAuditedNonghyupTypes2025: false,
                    });
                    onClearError("auditedNonghyupTypes2025");
                  }}
                />
                <span>{option.label}</span>
              </label>
            ))}
            <label className="nh-audit-option">
              <input
                type="checkbox"
                checked={values.noAuditedNonghyupTypes2025}
                disabled={disabled}
                onChange={(event) => {
                  onChange({
                    ...values,
                    auditedNonghyupTypes2025: event.target.checked
                      ? []
                      : values.auditedNonghyupTypes2025,
                    noAuditedNonghyupTypes2025: event.target.checked,
                  });
                  onClearError("auditedNonghyupTypes2025");
                }}
              />
              <span>{copy.noCooperativeTypesLabel || "해당 없음(0종)"}</span>
            </label>
          </div>
          <FieldError
            id={errorId("auditedNonghyupTypes2025")}
            message={errors.auditedNonghyupTypes2025}
          />
        </fieldset>

        <YesNoFieldset
          id={fieldId("nonghyupTaxAgencyPerformed2025")}
          quoteFieldId="quote-field-nonghyupTaxAgencyPerformed2025"
          legend={
            copy.taxAgencyLabel || "2025년 농협 세무대리 수행 여부 *"
          }
          value={values.nonghyupTaxAgencyPerformed2025}
          disabled={disabled}
          error={errors.nonghyupTaxAgencyPerformed2025}
          errorId={errorId("nonghyupTaxAgencyPerformed2025")}
          onChange={(value) =>
            update("nonghyupTaxAgencyPerformed2025", value)}
        />
        <YesNoFieldset
          id={fieldId("nonghyupSubsidySettlementPerformed2025")}
          quoteFieldId="quote-field-nonghyupSubsidySettlementPerformed2025"
          legend={
            copy.subsidySettlementLabel ||
            "2025년 농협 보조금 정산 수행 여부 *"
          }
          value={values.nonghyupSubsidySettlementPerformed2025}
          disabled={disabled}
          error={errors.nonghyupSubsidySettlementPerformed2025}
          errorId={errorId("nonghyupSubsidySettlementPerformed2025")}
          onChange={(value) =>
            update("nonghyupSubsidySettlementPerformed2025", value)}
        />

        <div
          id="quote-field-factsConfirmed"
          className="admin-form__field"
        >
          <label className="nh-audit-option">
            <input
              id={fieldId("factsConfirmed")}
              type="checkbox"
              checked={values.factsConfirmed}
              disabled={disabled}
              aria-invalid={Boolean(errors.factsConfirmed)}
              aria-describedby={
                errors.factsConfirmed ? errorId("factsConfirmed") : undefined
              }
              onChange={(event) =>
                update("factsConfirmed", event.target.checked)}
            />
            <span>
              {copy.factsConfirmationLabel ||
                "입력한 내용이 사실이며 서버 검증 결과가 최종 결과임을 확인합니다. *"}
            </span>
          </label>
          <FieldError
            id={errorId("factsConfirmed")}
            message={errors.factsConfirmed}
          />
        </div>
      </fieldset>

      <p className="admin-form__hint">
        {copy.serverFinalNotice ||
          "가격점수와 종합점수는 비교 대상 적격 견적이 모두 모인 후 서버에서 계산합니다. 화면의 예상 금액은 참고용입니다."}
      </p>
    </section>
  );
}

function IntegerField({
  id,
  quoteFieldId,
  label,
  unit,
  value,
  disabled,
  error,
  errorId,
  onChange,
}: {
  id: string;
  quoteFieldId: string;
  label: string;
  unit: string;
  value: string;
  disabled: boolean;
  error?: string;
  errorId: string;
  onChange: (value: string) => void;
}) {
  return (
    <label id={quoteFieldId} className="admin-form__field" htmlFor={id}>
      <span>{label}</span>
      <div className="nh-audit-number-with-unit">
        <input
          id={id}
          className="admin-input"
          type="text"
          inputMode="numeric"
          value={value}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) =>
            onChange(event.target.value.replace(/\D/gu, "").slice(0, 15))}
        />
        <span aria-hidden="true">{unit}</span>
      </div>
      <FieldError id={errorId} message={error} />
    </label>
  );
}

function YesNoFieldset({
  id,
  quoteFieldId,
  legend,
  value,
  disabled,
  error,
  errorId,
  onChange,
}: {
  id: string;
  quoteFieldId: string;
  legend: string;
  value: NhAuditYesNoChoice;
  disabled: boolean;
  error?: string;
  errorId: string;
  onChange: (value: Exclude<NhAuditYesNoChoice, "">) => void;
}) {
  return (
    <ChoiceFieldset
      id={id}
      quoteFieldId={quoteFieldId}
      legend={legend}
      value={value}
      choices={[
        { value: "YES", label: "유" },
        { value: "NO", label: "무" },
      ]}
      disabled={disabled}
      error={error}
      errorId={errorId}
      onChange={(next) =>
        onChange(next as Exclude<NhAuditYesNoChoice, "">)}
    />
  );
}

function ChoiceFieldset({
  id,
  quoteFieldId,
  legend,
  value,
  choices,
  disabled,
  error,
  errorId,
  onChange,
}: {
  id: string;
  quoteFieldId: string;
  legend: string;
  value: string;
  choices: Array<{ value: string; label: string }>;
  disabled: boolean;
  error?: string;
  errorId: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset
      id={quoteFieldId}
      className="admin-form__group nh-audit-choice-group"
      aria-invalid={Boolean(error)}
      aria-describedby={error ? errorId : undefined}
    >
      <legend>{legend}</legend>
      <div className="nh-audit-options">
        {choices.map((choice) => (
          <label key={choice.value} className="nh-audit-option">
            <input
              type="radio"
              name={id}
              value={choice.value}
              checked={value === choice.value}
              disabled={disabled}
              onChange={() => onChange(choice.value)}
            />
            <span>{choice.label}</span>
          </label>
        ))}
      </div>
      <FieldError id={errorId} message={error} />
    </fieldset>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <small id={id} className="admin-form__error" role="alert">
      {message}
    </small>
  ) : null;
}
