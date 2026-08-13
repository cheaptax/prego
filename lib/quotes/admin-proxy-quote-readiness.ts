import type { PartnerRecord } from "@/lib/firebase/schema";
import type { CooperativeQuotePartnerPrice } from "@/lib/quotes/cooperative-quote-price-master-types";
import {
  applyNhAuditEvaluationDefaults,
} from "@/lib/quotes/nh-audit-evaluation-defaults";
import {
  validateNhAuditPartnerForm,
  type NhAuditPartnerFormValues,
} from "@/lib/quotes/nh-audit-quote-form";
import { validateQuoteSupplierProfile } from "@/lib/quotes/supplier-profile";

export type AdminProxyQuoteMissingCode =
  | "proxy_consent_missing"
  | "seal_missing"
  | "supplier_profile_invalid"
  | "evaluation_defaults_missing"
  | "master_price_missing";

export type AdminProxyQuoteReady = {
  ready: true;
  supplierProfile: ReturnType<typeof validateQuoteSupplierProfile>["profile"];
  nhAuditSubmission: NonNullable<
    ReturnType<typeof validateNhAuditPartnerForm>["submissionInput"]
  >;
};

export type AdminProxyQuoteNotReady = {
  ready: false;
  missing: AdminProxyQuoteMissingCode[];
  supplierProfileErrors?: Record<string, string>;
  nhAuditMissingLabels?: string[];
};

export function buildAdminProxyNhAuditForm(input: {
  partner: PartnerRecord;
  price: CooperativeQuotePartnerPrice;
}): NhAuditPartnerFormValues {
  const defaults = applyNhAuditEvaluationDefaults(
    input.partner.nhAuditEvaluationDefaults,
  );
  return {
    ...defaults,
    auditFeeWon: input.price.plannedAuditFeeWon,
    expenseBillingMode: input.price.expenseBillingMode,
    expectedExpenseWon: input.price.expectedExpenseWon,
    factsConfirmed: true,
  };
}

export function checkAdminProxyQuoteReadiness(input: {
  partner: PartnerRecord;
  price: CooperativeQuotePartnerPrice | null;
}): AdminProxyQuoteReady | AdminProxyQuoteNotReady {
  const missing: AdminProxyQuoteMissingCode[] = [];
  // Legacy/test partners predate this consent field. Explicit false blocks.
  if (input.partner.opsProxyQuoteSendConsent === false) {
    missing.push("proxy_consent_missing");
  }
  if (!input.partner.sealPath) {
    missing.push("seal_missing");
  }
  if (!input.price) {
    missing.push("master_price_missing");
  }
  const supplierValidation = validateQuoteSupplierProfile(
    {
      name: input.partner.name || input.partner.displayName,
      businessRegistrationNumber: input.partner.businessRegistrationNumber,
      address: input.partner.businessAddress,
      contactName: input.partner.managerName,
      contactEmail: input.partner.contactEmail,
      contactPhone: input.partner.contactPhone,
    },
    { requireSeal: true, sealPath: input.partner.sealPath },
  );
  if (!supplierValidation.valid) {
    missing.push("supplier_profile_invalid");
  }

  let nhAuditSubmission: AdminProxyQuoteReady["nhAuditSubmission"] | null = null;
  let nhAuditMissingLabels: string[] = [];
  if (input.price) {
    const form = buildAdminProxyNhAuditForm({
      partner: input.partner,
      price: input.price,
    });
    const validation = validateNhAuditPartnerForm(form);
    if (validation.valid && validation.submissionInput) {
      nhAuditSubmission = validation.submissionInput;
    } else {
      missing.push("evaluation_defaults_missing");
      nhAuditMissingLabels = validation.missingLabels;
    }
  }

  if (missing.length > 0 || !nhAuditSubmission) {
    return {
      ready: false,
      missing: [...new Set(missing)],
      supplierProfileErrors: supplierValidation.fieldErrors,
      nhAuditMissingLabels,
    };
  }
  return {
    ready: true,
    supplierProfile: supplierValidation.profile,
    nhAuditSubmission,
  };
}

const PROFILE_GAP_CODES = [
  "proxy_consent_missing",
  "seal_missing",
  "supplier_profile_invalid",
  "evaluation_defaults_missing",
] as const satisfies readonly AdminProxyQuoteMissingCode[];

/** Partner-only gaps for 제휴사 관리. Master prices are managed elsewhere. */
export function partnerQuoteProfileGaps(partner: PartnerRecord) {
  const result = checkAdminProxyQuoteReadiness({ partner, price: null });
  const missing: AdminProxyQuoteMissingCode[] = result.ready
    ? []
    : result.missing.filter((code) =>
        PROFILE_GAP_CODES.includes(
          code as (typeof PROFILE_GAP_CODES)[number],
        ),
      );
  const defaultsForm = applyNhAuditEvaluationDefaults(
    partner.nhAuditEvaluationDefaults,
  );
  const defaultsValidation = validateNhAuditPartnerForm({
    ...defaultsForm,
    auditFeeWon: "1",
    expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
    expectedExpenseWon: "0",
    factsConfirmed: true,
  });
  if (
    !defaultsValidation.valid &&
    !missing.includes("evaluation_defaults_missing")
  ) {
    missing.push("evaluation_defaults_missing");
  }
  return {
    ready: missing.length === 0,
    missing,
    missingLabels: missing.map(adminProxyMissingLabel),
    logoMissing: !partner.logoPath,
  };
}

export function adminProxyMissingLabel(code: AdminProxyQuoteMissingCode) {
  const labels: Record<AdminProxyQuoteMissingCode, string> = {
    proxy_consent_missing: "대행 발송 동의",
    seal_missing: "직인",
    supplier_profile_invalid: "제휴사 공급자 정보",
    evaluation_defaults_missing: "평가 기본값",
    master_price_missing: "견적 가격 마스터",
  };
  return labels[code] ?? code;
}

export function adminProxySendErrorLabel(code: string) {
  const labels: Record<string, string> = {
    partner_not_found: "제휴사를 찾을 수 없습니다",
    assignment_already_finalized: "이미 확정된 견적입니다",
    assignment_revoked: "배정이 해제된 제휴사입니다",
    quote_request_closed: "견적 요청이 마감되었습니다",
    permission_denied: "현재 배정 상태에서는 발송할 수 없습니다",
    nh_audit_request_context_missing: "견적요청에 농협명 또는 사업연도가 없습니다",
    nh_audit_submission_invalid: "평가 기본값 형식이 올바르지 않습니다",
    supplier_profile_invalid: "제휴사 공급자 정보가 올바르지 않습니다",
    email_not_configured:
      "메일 발송 설정(Resend API 키·발신 주소)이 없어 고객 메일을 보내지 못했습니다",
    email_send_failed: "고객 메일 발송에 실패했습니다",
    quote_pdf_missing: "저장된 견적서 PDF를 찾지 못했습니다",
    quote_persistence_failed: "견적서 저장에 실패했습니다",
    master_prices_empty: "견적 가격 마스터에 제휴사 가격이 없습니다",
  };
  return labels[code] ?? code;
}

export function resolveAdminProxySendPlan(input: {
  latestSent: { status: string; version?: number } | null;
}): "retry_existing" | "create_version" {
  if (input.latestSent?.status === "finalized") {
    return "retry_existing";
  }
  return "create_version";
}

export function adminProxyMissingFixHint(code: AdminProxyQuoteMissingCode) {
  const hints: Record<AdminProxyQuoteMissingCode, string> = {
    proxy_consent_missing:
      "제휴사 관리에서 해당 제휴사를 열고 운영자 대행 발송 동의를 켜 주세요.",
    seal_missing:
      "제휴사 포털 또는 제휴사 관리에서 회계법인 직인을 등록해 주세요.",
    supplier_profile_invalid:
      "제휴사 관리에서 사업자등록번호, 사업장 주소, 담당자 연락처를 채워 주세요.",
    evaluation_defaults_missing:
      "제휴사가 한 번도 견적을 저장하지 않아 담당회계사·수행실적 기본값이 없습니다. 아래에서 평가 기본값을 입력해 저장하면 대행 발송에 사용됩니다.",
    master_price_missing:
      "견적 가격 마스터에서 해당 농협·제휴사의 예정 감사보수를 등록해 주세요.",
  };
  return hints[code] ?? "";
}
