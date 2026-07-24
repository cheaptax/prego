import type { PartnerRecord, QuoteRecord } from "@/lib/firebase/schema";

export type QuoteSupplierProfile = {
  name: string;
  businessRegistrationNumber: string;
  address: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
};

export type QuoteSupplierProfileField = keyof QuoteSupplierProfile | "seal";

export type QuoteSupplierProfileValidation = {
  valid: boolean;
  fieldErrors: Partial<Record<QuoteSupplierProfileField, string>>;
  profile: QuoteSupplierProfile;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const BUSINESS_NUMBER_PATTERN = /^\d{3}-?\d{2}-?\d{5}$/u;
const PHONE_PATTERN = /^[+()0-9 -]{7,40}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

export function quoteSupplierProfileFrom(
  partner: PartnerRecord,
  quote?: QuoteRecord | null,
): QuoteSupplierProfile {
  return {
    name: quote?.supplierName || partner.name || partner.displayName,
    businessRegistrationNumber:
      quote?.supplierBusinessRegistrationNumber ||
      partner.businessRegistrationNumber ||
      "",
    address: quote?.supplierAddress || partner.businessAddress || "",
    contactName: quote?.supplierContactName || partner.managerName || "",
    contactEmail: quote?.supplierContactEmail || partner.contactEmail || "",
    contactPhone: quote?.supplierContactPhone || partner.contactPhone || "",
  };
}

export function validateQuoteSupplierProfile(
  value: unknown,
  options: { requireSeal?: boolean; sealPath?: string } = {},
): QuoteSupplierProfileValidation {
  const raw =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const profile: QuoteSupplierProfile = {
    name: clean(raw.name, 120),
    businessRegistrationNumber: clean(
      raw.businessRegistrationNumber,
      20,
    ),
    address: clean(raw.address, 300),
    contactName: clean(raw.contactName, 80),
    contactEmail: clean(raw.contactEmail, 254).toLowerCase(),
    contactPhone: clean(raw.contactPhone, 40),
  };
  const fieldErrors: QuoteSupplierProfileValidation["fieldErrors"] = {};
  if (!profile.name) fieldErrors.name = "회계법인명을 입력해 주세요.";
  if (!BUSINESS_NUMBER_PATTERN.test(profile.businessRegistrationNumber)) {
    fieldErrors.businessRegistrationNumber =
      "사업자등록번호 10자리를 확인해 주세요.";
  }
  if (!profile.address) fieldErrors.address = "사업장 주소를 입력해 주세요.";
  if (!profile.contactName) {
    fieldErrors.contactName = "견적 담당자 이름을 입력해 주세요.";
  }
  if (!EMAIL_PATTERN.test(profile.contactEmail)) {
    fieldErrors.contactEmail = "견적 담당자 이메일을 확인해 주세요.";
  }
  if (!PHONE_PATTERN.test(profile.contactPhone)) {
    fieldErrors.contactPhone = "견적 담당자 연락처를 확인해 주세요.";
  }
  if (options.requireSeal && !options.sealPath) {
    fieldErrors.seal = "회계법인 직인을 등록해 주세요.";
  }
  return {
    valid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
    profile,
  };
}

function clean(value: unknown, maxLength: number) {
  const text = String(value ?? "").trim().slice(0, maxLength);
  return CONTROL_CHARACTER_PATTERN.test(text) ? "" : text;
}
