import type {
  PartnerEvaluationAnswers,
  PartnerEvaluationField,
  PartnerEvaluationForm,
} from "@/lib/audit-evaluation/partner-quote-form";
import { parseCurrencyInput } from "@/lib/currency-input";

export type PartnerQuoteValidationInput = {
  itemName: string;
  quantity: string;
  unitPrice: string;
  servicePeriod: string;
  validUntil: string;
  evaluationForm?: PartnerEvaluationForm | null;
  evaluationAnswers?: PartnerEvaluationAnswers;
};

export type PartnerQuoteValidationResult = {
  valid: boolean;
  fieldErrors: Record<string, string>;
  missingLabels: string[];
};

export function validatePartnerQuoteInput(
  input: PartnerQuoteValidationInput,
): PartnerQuoteValidationResult {
  const fieldErrors: Record<string, string> = {};
  const missingLabels: string[] = [];
  const add = (id: string, label: string, message: string) => {
    if (fieldErrors[id]) return;
    fieldErrors[id] = message;
    missingLabels.push(label);
  };

  if (!input.itemName.trim()) {
    add("quoteItemName", "견적 항목", "견적 항목을 입력해 주세요.");
  }
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 9_999) {
    add(
      "quoteQuantity",
      "수량",
      "수량은 0보다 크고 9,999 이하인 숫자로 입력해 주세요.",
    );
  }
  const unitPrice = parseCurrencyInput(input.unitPrice);
  if (
    !input.unitPrice.trim() ||
    !Number.isSafeInteger(unitPrice) ||
    unitPrice <= 0 ||
    unitPrice > 1_000_000_000
  ) {
    add(
      "quoteUnitPrice",
      "단가",
      "단가는 1원 이상 10억원 이하로 입력해 주세요.",
    );
  }
  if (!input.servicePeriod.trim()) {
    add("quoteServicePeriod", "수행기간", "수행기간을 입력해 주세요.");
  }
  if (!input.validUntil.trim()) {
    add("quoteValidUntil", "유효기간", "견적 유효기간을 입력해 주세요.");
  }

  const answers = input.evaluationAnswers ?? {};
  for (const field of input.evaluationForm?.fields ?? []) {
    if (!field.required) continue;
    const error = requiredEvaluationError(field, answers[field.id]);
    if (error) add(field.id, field.label, error);
  }

  const totalHours = numericAnswer(answers.totalPlannedHours);
  const partnerHours = numericAnswer(answers.partnerHours);
  if (totalHours !== null && totalHours <= 0) {
    add(
      "totalPlannedHours",
      "총 예정 투입시간",
      "총 예정 투입시간은 1시간 이상이어야 합니다.",
    );
  }
  if (
    totalHours !== null &&
    partnerHours !== null &&
    partnerHours > totalHours
  ) {
    add(
      "partnerHours",
      "책임회계사 예정 투입시간",
      "책임회계사 투입시간은 총 예정 투입시간을 초과할 수 없습니다.",
    );
  }

  return {
    valid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
    missingLabels,
  };
}

function requiredEvaluationError(
  field: PartnerEvaluationField,
  value: unknown,
): string | null {
  if (field.control === "money" || field.control === "integer") {
    return numericAnswer(value) === null
      ? `${field.label}을(를) 숫자로 입력해 주세요.`
      : null;
  }
  if (field.control === "tag-list" || field.control === "text-list") {
    return listAnswer(value).length === 0
      ? `${field.label}을(를) 한 항목 이상 입력해 주세요.`
      : null;
  }
  if (field.control === "experience") {
    return isRecord(value) && typeof value.hasExperience === "boolean"
      ? null
      : `${field.label}의 경험 유무를 선택해 주세요.`;
  }
  if (field.control === "person") {
    const person = isRecord(value) ? value : {};
    return textAnswer(person.name) &&
      textAnswer(person.title) &&
      numericAnswer(person.yearsOfExperience) !== null
      ? null
      : `${field.label}의 성명, 직급, 경력연수를 모두 입력해 주세요.`;
  }
  if (field.control === "team-list") {
    const rows = arrayRecords(value);
    return rows.length > 0 &&
      rows.every(
        (row) =>
          textAnswer(row.name) &&
          textAnswer(row.role) &&
          numericAnswer(row.plannedHours) !== null,
      )
      ? null
      : `${field.label}을(를) 한 명 이상 추가하고 성명, 역할, 예정시간을 모두 입력해 주세요.`;
  }
  if (field.control === "schedule-list") {
    const rows = arrayRecords(value);
    return rows.length > 0 &&
      rows.every(
        (row) =>
          textAnswer(row.label) &&
          dateAnswer(row.startsOn) &&
          dateAnswer(row.endsOn),
      )
      ? null
      : `${field.label}을(를) 한 단계 이상 추가하고 단계명과 기간을 모두 입력해 주세요.`;
  }

  const proposal = isRecord(value) ? value : {};
  const missingItem = (field.checklistItems ?? [])
    .filter((item) => item.required)
    .find((item) => {
      const candidate = proposal[item.id];
      return !isRecord(candidate) || typeof candidate.present !== "boolean";
    });
  return missingItem
    ? `${missingItem.label}의 포함 여부를 선택해 주세요.`
    : null;
}

function numericAnswer(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function textAnswer(value: unknown): boolean {
  return String(value ?? "").trim().length > 0;
}

function listAnswer(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }
  return String(value ?? "")
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(isRecord)
    : [];
}

function dateAnswer(value: unknown): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
