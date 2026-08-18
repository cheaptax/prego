import { normalizeWonAmount } from "@/lib/audit-evaluation/money";
import type {
  NhAuditCooperativeType2025,
  NhAuditExpenseBillingMode,
  NhAuditPartnerSubmissionInputV2,
  NhAuditProposerType,
} from "@/lib/audit-evaluation/nh-audit-v2-types";
import {
  NH_AUDIT_COOPERATIVE_TYPES_2025,
  NH_AUDIT_EXPENSE_BILLING_MODES,
  NH_AUDIT_PROPOSER_TYPES,
} from "@/lib/audit-evaluation/nh-audit-v2-types";
import { formatCurrencyInput } from "@/lib/currency-input";

export type NhAuditYesNoChoice = "" | "YES" | "NO";

export type NhAuditPartnerFormValues = {
  engagementPartnerName: string;
  proposerType: "" | NhAuditProposerType;
  auditFeeWon: string;
  expenseBillingMode: "" | NhAuditExpenseBillingMode;
  expectedExpenseWon: string;
  localNonghyupAuditCount2025: string;
  certifiedPublicAccountantCount: string;
  accountingFirmRevenueWon: string;
  auditedNonghyupTypes2025: NhAuditCooperativeType2025[];
  noAuditedNonghyupTypes2025: boolean;
  nonghyupTaxAgencyPerformed2025: NhAuditYesNoChoice;
  nonghyupSubsidySettlementPerformed2025: NhAuditYesNoChoice;
  factsConfirmed: boolean;
};

export type NhAuditPartnerFormField =
  | "engagementPartnerName"
  | "proposerType"
  | "auditFeeWon"
  | "expenseBillingMode"
  | "expectedExpenseWon"
  | "localNonghyupAuditCount2025"
  | "certifiedPublicAccountantCount"
  | "accountingFirmRevenueWon"
  | "auditedNonghyupTypes2025"
  | "nonghyupTaxAgencyPerformed2025"
  | "nonghyupSubsidySettlementPerformed2025"
  | "factsConfirmed";

export type NhAuditPartnerFormValidation = {
  valid: boolean;
  fieldErrors: Partial<Record<NhAuditPartnerFormField, string>>;
  missingLabels: string[];
  submissionInput: NhAuditPartnerSubmissionInputV2 | null;
};

export const EMPTY_NH_AUDIT_PARTNER_FORM: NhAuditPartnerFormValues = {
  engagementPartnerName: "",
  proposerType: "",
  auditFeeWon: "",
  expenseBillingMode: "",
  expectedExpenseWon: "",
  localNonghyupAuditCount2025: "",
  certifiedPublicAccountantCount: "",
  accountingFirmRevenueWon: "",
  auditedNonghyupTypes2025: [],
  noAuditedNonghyupTypes2025: false,
  nonghyupTaxAgencyPerformed2025: "",
  nonghyupSubsidySettlementPerformed2025: "",
  factsConfirmed: false,
};

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const INTEGER_PATTERN = /^(0|[1-9]\d*)$/u;

export function validateNhAuditPartnerForm(
  values: NhAuditPartnerFormValues,
): NhAuditPartnerFormValidation {
  const fieldErrors: Partial<Record<NhAuditPartnerFormField, string>> = {};
  const missingLabels: string[] = [];
  const add = (
    field: NhAuditPartnerFormField,
    label: string,
    message: string,
  ) => {
    if (fieldErrors[field]) return;
    fieldErrors[field] = message;
    missingLabels.push(label);
  };

  const engagementPartnerName = values.engagementPartnerName.trim();
  if (!engagementPartnerName) {
    add(
      "engagementPartnerName",
      "담당회계사 이름",
      "담당회계사 이름을 입력해 주세요.",
    );
  }
  if (!values.proposerType) {
    add(
      "proposerType",
      "제안 주체 유형",
      "제안 주체 유형을 선택해 주세요.",
    );
  }

  const auditFeeWon = parseFormInteger(values.auditFeeWon);
  if (auditFeeWon === null || auditFeeWon <= 0n) {
    add(
      "auditFeeWon",
      "감사보수",
      "감사보수는 0보다 큰 원 단위 정수로 입력해 주세요.",
    );
  }
  if (!values.expenseBillingMode) {
    add(
      "expenseBillingMode",
      "제경비 청구방식",
      "제경비 청구방식을 선택해 주세요.",
    );
  }

  const expectedExpenseWon =
    values.expenseBillingMode === "INCLUDED_IN_AUDIT_FEE"
      ? 0n
      : parseFormInteger(values.expectedExpenseWon);
  if (
    values.expenseBillingMode === "SEPARATELY_BILLED" &&
    expectedExpenseWon === null
  ) {
    add(
      "expectedExpenseWon",
      "예상 제경비",
      "별도 청구할 예상 제경비를 0 이상의 원 단위 정수로 입력해 주세요.",
    );
  }

  const localNonghyupAuditCount2025 = requiredNonNegativeInteger(
    values.localNonghyupAuditCount2025,
    "localNonghyupAuditCount2025",
    "2025년 지역농협 회계감사 수행 건수",
    fieldErrors,
    missingLabels,
  );
  const certifiedPublicAccountantCount = requiredNonNegativeInteger(
    values.certifiedPublicAccountantCount,
    "certifiedPublicAccountantCount",
    "공인회계사 인원 수",
    fieldErrors,
    missingLabels,
  );
  const accountingFirmRevenueWon = parseFormInteger(
    values.accountingFirmRevenueWon,
  );
  if (accountingFirmRevenueWon === null) {
    add(
      "accountingFirmRevenueWon",
      "회계법인 매출액",
      "회계법인 매출액을 0 이상의 원 단위 정수로 입력해 주세요.",
    );
  }

  if (
    values.auditedNonghyupTypes2025.length === 0 &&
    !values.noAuditedNonghyupTypes2025
  ) {
    add(
      "auditedNonghyupTypes2025",
      "2025년 수행 농협 유형",
      "수행한 농협 유형을 선택하거나 ‘해당 없음(0종)’을 선택해 주세요.",
    );
  }
  if (!values.nonghyupTaxAgencyPerformed2025) {
    add(
      "nonghyupTaxAgencyPerformed2025",
      "2025년 농협 세무대리 수행 여부",
      "농협 세무대리 수행 여부를 선택해 주세요.",
    );
  }
  if (!values.nonghyupSubsidySettlementPerformed2025) {
    add(
      "nonghyupSubsidySettlementPerformed2025",
      "2025년 농협 보조금 정산 수행 여부",
      "농협 보조금 정산 수행 여부를 선택해 주세요.",
    );
  }
  if (!values.factsConfirmed) {
    add(
      "factsConfirmed",
      "입력 내용 사실확인 동의",
      "입력 내용이 사실임을 확인하고 동의해 주세요.",
    );
  }

  const valid = Object.keys(fieldErrors).length === 0;
  return {
    valid,
    fieldErrors,
    missingLabels,
    submissionInput:
      valid &&
      values.proposerType &&
      values.expenseBillingMode &&
      auditFeeWon !== null &&
      expectedExpenseWon !== null &&
      localNonghyupAuditCount2025 !== null &&
      certifiedPublicAccountantCount !== null &&
      accountingFirmRevenueWon !== null &&
      values.nonghyupTaxAgencyPerformed2025 &&
      values.nonghyupSubsidySettlementPerformed2025 &&
      values.factsConfirmed
        ? {
            engagementPartnerName,
            proposerType: values.proposerType,
            auditFeeWon: normalizeWonAmount(auditFeeWon),
            expenseBillingMode: values.expenseBillingMode,
            expectedExpenseWon: normalizeWonAmount(expectedExpenseWon),
            localNonghyupAuditCount2025,
            certifiedPublicAccountantCount,
            accountingFirmRevenueWon: normalizeWonAmount(
              accountingFirmRevenueWon,
            ),
            auditedNonghyupTypes2025: [
              ...new Set(values.auditedNonghyupTypes2025),
            ],
            nonghyupTaxAgencyPerformed2025:
              values.nonghyupTaxAgencyPerformed2025 === "YES",
            nonghyupSubsidySettlementPerformed2025:
              values.nonghyupSubsidySettlementPerformed2025 === "YES",
            factsConfirmed: true,
          }
        : null,
  };
}

export function calculateNhAuditCostPreview(
  values: NhAuditPartnerFormValues,
): bigint | null {
  const auditFee = parseFormInteger(values.auditFeeWon);
  if (auditFee === null || auditFee <= 0n) return null;
  const expectedExpense =
    values.expenseBillingMode === "INCLUDED_IN_AUDIT_FEE"
      ? 0n
      : values.expenseBillingMode === "SEPARATELY_BILLED"
        ? parseFormInteger(values.expectedExpenseWon)
        : null;
  if (expectedExpense === null) return null;
  const supply = auditFee + expectedExpense;
  const vat = (supply * 1_000n + 5_000n) / 10_000n;
  return supply + vat;
}

export function valuesFromNhAuditSubmission(
  submission?: NhAuditPartnerSubmissionInputV2 | null,
): NhAuditPartnerFormValues {
  if (!submission) return { ...EMPTY_NH_AUDIT_PARTNER_FORM };
  return {
    engagementPartnerName: submission.engagementPartnerName,
    proposerType: submission.proposerType,
    auditFeeWon: submission.auditFeeWon,
    expenseBillingMode: submission.expenseBillingMode,
    expectedExpenseWon: submission.expectedExpenseWon,
    localNonghyupAuditCount2025: String(
      submission.localNonghyupAuditCount2025,
    ),
    certifiedPublicAccountantCount: String(
      submission.certifiedPublicAccountantCount,
    ),
    accountingFirmRevenueWon: submission.accountingFirmRevenueWon,
    auditedNonghyupTypes2025: [...submission.auditedNonghyupTypes2025],
    noAuditedNonghyupTypes2025:
      submission.auditedNonghyupTypes2025.length === 0,
    nonghyupTaxAgencyPerformed2025:
      submission.nonghyupTaxAgencyPerformed2025 ? "YES" : "NO",
    nonghyupSubsidySettlementPerformed2025:
      submission.nonghyupSubsidySettlementPerformed2025 ? "YES" : "NO",
    factsConfirmed: submission.factsConfirmed,
  };
}

export function sanitizeNhAuditPartnerFormDraft(
  value: unknown,
): NhAuditPartnerFormValues {
  const draft = isRecord(value) ? value : {};
  const proposerType = NH_AUDIT_PROPOSER_TYPES.includes(
    draft.proposerType as NhAuditProposerType,
  )
    ? (draft.proposerType as NhAuditProposerType)
    : "";
  const expenseBillingMode = NH_AUDIT_EXPENSE_BILLING_MODES.includes(
    draft.expenseBillingMode as NhAuditExpenseBillingMode,
  )
    ? (draft.expenseBillingMode as NhAuditExpenseBillingMode)
    : "";
  const auditedNonghyupTypes2025 = Array.isArray(
    draft.auditedNonghyupTypes2025,
  )
    ? [
        ...new Set(
          draft.auditedNonghyupTypes2025.filter(
            (candidate): candidate is NhAuditCooperativeType2025 =>
              NH_AUDIT_COOPERATIVE_TYPES_2025.includes(
                candidate as NhAuditCooperativeType2025,
              ),
          ),
        ),
      ]
    : [];
  return {
    engagementPartnerName: String(draft.engagementPartnerName ?? "").slice(
      0,
      200,
    ),
    proposerType,
    auditFeeWon: sanitizeCurrencyDraft(draft.auditFeeWon),
    expenseBillingMode,
    expectedExpenseWon:
      expenseBillingMode === "INCLUDED_IN_AUDIT_FEE"
        ? "0"
        : sanitizeCurrencyDraft(draft.expectedExpenseWon),
    localNonghyupAuditCount2025: digitsOnly(
      draft.localNonghyupAuditCount2025,
    ),
    certifiedPublicAccountantCount: digitsOnly(
      draft.certifiedPublicAccountantCount,
    ),
    accountingFirmRevenueWon: sanitizeCurrencyDraft(
      draft.accountingFirmRevenueWon,
    ),
    auditedNonghyupTypes2025,
    noAuditedNonghyupTypes2025:
      draft.noAuditedNonghyupTypes2025 === true &&
      auditedNonghyupTypes2025.length === 0,
    nonghyupTaxAgencyPerformed2025: yesNoChoice(
      draft.nonghyupTaxAgencyPerformed2025,
    ),
    nonghyupSubsidySettlementPerformed2025: yesNoChoice(
      draft.nonghyupSubsidySettlementPerformed2025,
    ),
    factsConfirmed: draft.factsConfirmed === true,
  };
}

function parseFormInteger(value: string): bigint | null {
  const normalized = value.replaceAll(",", "").trim();
  if (!INTEGER_PATTERN.test(normalized)) return null;
  const parsed = BigInt(normalized);
  return parsed <= MAX_SAFE_INTEGER_BIGINT ? parsed : null;
}

function requiredNonNegativeInteger(
  value: string,
  field: Extract<
    NhAuditPartnerFormField,
    "localNonghyupAuditCount2025" | "certifiedPublicAccountantCount"
  >,
  label: string,
  fieldErrors: Partial<Record<NhAuditPartnerFormField, string>>,
  missingLabels: string[],
): number | null {
  const parsed = parseFormInteger(value);
  if (parsed === null) {
    fieldErrors[field] =
      `${label}을(를) 0 이상의 정수로 입력해 주세요.`;
    missingLabels.push(label);
    return null;
  }
  return Number(parsed);
}

function digitsOnly(value: unknown) {
  const candidate = String(value ?? "").trim();
  return /^\d*$/u.test(candidate) ? candidate.slice(0, 15) : "";
}

function sanitizeCurrencyDraft(value: unknown) {
  const candidate = String(value ?? "").trim();
  return /^[\d,]*$/u.test(candidate)
    ? formatCurrencyInput(candidate, 15)
    : "";
}

function yesNoChoice(value: unknown): NhAuditYesNoChoice {
  return value === "YES" || value === "NO" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
