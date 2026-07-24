"use client";

import type {
  PartnerEvaluationAnswers,
  PartnerEvaluationField,
  PartnerEvaluationForm,
} from "@/lib/audit-evaluation/partner-quote-form";
import type {
  NormalizedAuditQuoteField,
  QuoteEvidenceValue,
} from "@/lib/audit-evaluation/types";
import { formatCurrencyInput } from "@/lib/currency-input";

type Props = {
  form: PartnerEvaluationForm;
  answers: PartnerEvaluationAnswers;
  errors?: Record<string, string>;
  heading?: string;
  description?: string;
  fallbackWarning?: string;
  onChange: (
    field: NormalizedAuditQuoteField,
    value: QuoteEvidenceValue | undefined,
  ) => void;
};

const SECTION_ORDER: PartnerEvaluationField["section"][] = [
  "법인 정보",
  "감사 경험",
  "투입인력",
  "수행계획",
  "제안 충실성",
];

export function PartnerAuditEvaluationFields({
  form,
  answers,
  errors = {},
  heading,
  description,
  fallbackWarning,
  onChange,
}: Props) {
  return (
    <section className="admin-card">
      <header className="admin-card__head">
        <div>
          <p className="admin-eyebrow">적용 평가기준</p>
          <h3>{heading || form.configName}</h3>
          {heading ? <strong>{form.configName}</strong> : null}
          <p className="admin-form__hint">
            {description ||
              `관리자에서 게시한 평가기준 v${form.configVersion}의 필수 입력항목이 자동 반영됩니다.`}
          </p>
          {form.source === "fallback" ? (
            <p className="admin-form__error">
              {fallbackWarning ||
                "게시된 운영 평가기준이 없어 기본 기준을 표시하고 있습니다."}
            </p>
          ) : null}
        </div>
      </header>

      <div className="admin-detail-list">
        {form.criteria.map((criterion) => (
          <div key={criterion.id}>
            <dt>
              {criterion.name} ({criterion.weightPercent}%)
            </dt>
            <dd>{criterion.description}</dd>
          </div>
        ))}
      </div>

      {SECTION_ORDER.map((section) => {
        const fields = form.fields.filter((field) => field.section === section);
        if (fields.length === 0) return null;
        return (
          <fieldset key={section} className="admin-form__group">
            <legend>{section}</legend>
            {fields.map((field) => (
              <EvaluationFieldEditor
                key={field.id}
                field={field}
                value={answers[field.id]}
                error={errors[field.id]}
                onChange={(value) => onChange(field.id, value)}
              />
            ))}
          </fieldset>
        );
      })}
    </section>
  );
}

function EvaluationFieldEditor({
  field,
  value,
  error,
  onChange,
}: {
  field: PartnerEvaluationField;
  value: QuoteEvidenceValue | undefined;
  error?: string;
  onChange: (value: QuoteEvidenceValue | undefined) => void;
}) {
  const label = (
    <span>
      {field.label}
      {field.required ? " *" : ""}
    </span>
  );

  if (field.control === "money" || field.control === "integer") {
    const display =
      field.control === "money"
        ? formatCurrencyInput(typeof value === "string" ? value : String(value ?? ""))
        : String(value ?? "");
    return (
      <label
        id={`quote-field-${field.id}`}
        className="admin-form__field"
      >
        {label}
        <input
          className="admin-input"
          inputMode="numeric"
          aria-invalid={Boolean(error)}
          value={display}
          onChange={(event) =>
            onChange(
              field.control === "money"
                ? formatCurrencyInput(event.target.value)
                : event.target.value.replace(/[^\d]/g, ""),
            )}
        />
        <small>{field.help}</small>
        {error ? <small className="admin-form__error">{error}</small> : null}
      </label>
    );
  }

  if (
    field.control === "tag-list" ||
    field.control === "text-list"
  ) {
    return (
      <label
        id={`quote-field-${field.id}`}
        className="admin-form__field"
      >
        {label}
        <textarea
          className="admin-input"
          rows={4}
          aria-invalid={Boolean(error)}
          value={listText(value)}
          placeholder="항목별로 줄을 바꾸어 입력해 주세요."
          onChange={(event) => onChange(event.target.value)}
        />
        <small>{field.help}</small>
        {error ? <small className="admin-form__error">{error}</small> : null}
      </label>
    );
  }

  if (field.control === "experience") {
    const record = recordValue(value);
    const hasExperience =
      typeof record.hasExperience === "boolean"
        ? record.hasExperience
        : undefined;
    return (
      <div
        id={`quote-field-${field.id}`}
        className="admin-form__field"
      >
        {label}
        <select
          className="admin-input"
          aria-invalid={Boolean(error)}
          value={
            hasExperience === undefined ? "" : hasExperience ? "yes" : "no"
          }
          onChange={(event) => {
            const selected = event.target.value;
            if (!selected) {
              onChange(undefined);
              return;
            }
            onChange({
              hasExperience: selected === "yes",
              descriptions: record.descriptions ?? "",
            });
          }}
        >
          <option value="">경험 유무를 선택해 주세요.</option>
          <option value="yes">경험 있음</option>
          <option value="no">경험 없음</option>
        </select>
        <textarea
          className="admin-input"
          rows={3}
          value={listText(record.descriptions)}
          disabled={hasExperience !== true}
          placeholder="대표 수행사례를 줄 단위로 입력해 주세요."
          onChange={(event) =>
            onChange({
              hasExperience: hasExperience === true,
              descriptions: event.target.value,
            })}
        />
        <small>{field.help}</small>
        {error ? <small className="admin-form__error">{error}</small> : null}
      </div>
    );
  }

  if (field.control === "person") {
    const record = recordValue(value);
    return (
      <div
        id={`quote-field-${field.id}`}
        className="admin-form__field"
      >
        {label}
        <div className="admin-partner-form-grid">
          <input
            className="admin-input"
            aria-label={`${field.label} 성명`}
            aria-invalid={Boolean(error)}
            placeholder="성명"
            value={textValue(record.name)}
            onChange={(event) =>
              onChange({ ...record, name: event.target.value })}
          />
          <input
            className="admin-input"
            aria-label={`${field.label} 직급`}
            placeholder="직급"
            value={textValue(record.title)}
            onChange={(event) =>
              onChange({ ...record, title: event.target.value })}
          />
          <input
            className="admin-input"
            aria-label={`${field.label} 경력연수`}
            inputMode="numeric"
            placeholder="경력연수"
            value={textValue(record.yearsOfExperience)}
            onChange={(event) =>
              onChange({
                ...record,
                yearsOfExperience: event.target.value.replace(/[^\d]/g, ""),
              })}
          />
        </div>
        <small>{field.help}</small>
        {error ? <small className="admin-form__error">{error}</small> : null}
      </div>
    );
  }

  if (field.control === "team-list") {
    const rows = arrayRecords(value);
    return (
      <div
        id={`quote-field-${field.id}`}
        className="admin-form__field"
      >
        {label}
        {rows.map((row, index) => (
          <div key={`team-${index}`} className="admin-partner-form-grid">
            <input
              className="admin-input"
              aria-label={`투입인력 ${index + 1} 성명`}
              placeholder="성명"
              value={textValue(row.name)}
              onChange={(event) =>
                onChange(replaceRow(rows, index, { ...row, name: event.target.value }))}
            />
            <input
              className="admin-input"
              aria-label={`투입인력 ${index + 1} 역할`}
              placeholder="역할"
              value={textValue(row.role)}
              onChange={(event) =>
                onChange(replaceRow(rows, index, { ...row, role: event.target.value }))}
            />
            <input
              className="admin-input"
              aria-label={`투입인력 ${index + 1} 예정시간`}
              inputMode="numeric"
              placeholder="예정시간"
              value={textValue(row.plannedHours)}
              onChange={(event) =>
                onChange(
                  replaceRow(rows, index, {
                    ...row,
                    plannedHours: event.target.value.replace(/[^\d]/g, ""),
                  }),
                )}
            />
            <button
              type="button"
              className="admin-btn"
              onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
            >
              삭제
            </button>
          </div>
        ))}
        <button
          type="button"
          className="admin-btn"
          onClick={() =>
            onChange([...rows, { name: "", role: "", plannedHours: "" }])}
        >
          투입인력 추가
        </button>
        <small>{field.help}</small>
        {error ? <small className="admin-form__error">{error}</small> : null}
      </div>
    );
  }

  if (field.control === "schedule-list") {
    const rows = arrayRecords(value);
    return (
      <div
        id={`quote-field-${field.id}`}
        className="admin-form__field"
      >
        {label}
        {rows.map((row, index) => (
          <div key={`schedule-${index}`} className="admin-partner-form-grid">
            <input
              className="admin-input"
              aria-label={`감사일정 ${index + 1} 단계명`}
              placeholder="단계명"
              value={textValue(row.label)}
              onChange={(event) =>
                onChange(replaceRow(rows, index, { ...row, label: event.target.value }))}
            />
            <input
              className="admin-input"
              aria-label={`감사일정 ${index + 1} 시작일`}
              type="date"
              value={textValue(row.startsOn)}
              onChange={(event) =>
                onChange(replaceRow(rows, index, { ...row, startsOn: event.target.value }))}
            />
            <input
              className="admin-input"
              aria-label={`감사일정 ${index + 1} 종료일`}
              type="date"
              value={textValue(row.endsOn)}
              onChange={(event) =>
                onChange(replaceRow(rows, index, { ...row, endsOn: event.target.value }))}
            />
            <button
              type="button"
              className="admin-btn"
              onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
            >
              삭제
            </button>
          </div>
        ))}
        <button
          type="button"
          className="admin-btn"
          onClick={() =>
            onChange([...rows, { label: "", startsOn: "", endsOn: "" }])}
        >
          일정 단계 추가
        </button>
        <small>{field.help}</small>
        {error ? <small className="admin-form__error">{error}</small> : null}
      </div>
    );
  }

  const proposal = recordValue(value);
  return (
    <div
      id={`quote-field-${field.id}`}
      className="admin-form__field"
    >
      {label}
      {(field.checklistItems ?? []).map((item) => {
        const itemValue = recordValue(proposal[item.id]);
        const present =
          typeof itemValue.present === "boolean"
            ? itemValue.present
            : undefined;
        return (
          <fieldset key={item.id} className="admin-form__group">
            <legend>
              {item.label}
              {item.required ? " *" : ""}
            </legend>
            <select
              className="admin-input"
              aria-invalid={Boolean(error)}
              value={present === undefined ? "" : present ? "yes" : "no"}
              onChange={(event) => {
                const selected = event.target.value;
                const next = { ...proposal };
                if (!selected) {
                  delete next[item.id];
                } else {
                  next[item.id] = {
                    present: selected === "yes",
                    value: itemValue.value ?? "",
                  };
                }
                onChange(next);
              }}
            >
              <option value="">포함 여부를 선택해 주세요.</option>
              <option value="yes">제안에 포함</option>
              <option value="no">제안에 미포함</option>
            </select>
            <textarea
              className="admin-input"
              rows={3}
              disabled={present === undefined}
              value={textValue(itemValue.value)}
              placeholder="구체적인 수행방법 또는 근거를 입력해 주세요."
              onChange={(event) =>
                onChange({
                  ...proposal,
                  [item.id]: {
                    present: present === true,
                    value: event.target.value,
                  },
                })}
            />
          </fieldset>
        );
      })}
      <small>{field.help}</small>
      {error ? <small className="admin-form__error">{error}</small> : null}
    </div>
  );
}

function recordValue(value: unknown): Record<string, QuoteEvidenceValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, QuoteEvidenceValue>)
    : {};
}

function arrayRecords(value: unknown): Record<string, QuoteEvidenceValue>[] {
  return Array.isArray(value) ? value.map(recordValue) : [];
}

function listText(value: unknown): string {
  return Array.isArray(value)
    ? value.map((item) => String(item)).join("\n")
    : textValue(value);
}

function textValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function replaceRow(
  rows: Record<string, QuoteEvidenceValue>[],
  index: number,
  next: Record<string, QuoteEvidenceValue>,
) {
  return rows.map((row, rowIndex) => (rowIndex === index ? next : row));
}
