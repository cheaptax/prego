import type {
  PartnerApplicationRecord,
  PartnerApplicationStatus,
} from "@/lib/firebase/schema";
import { normalizePartnerFields } from "@/lib/partners";
import { normalizePartnerProfession } from "@/lib/partner-professions";

export const PARTNER_APPLICATION_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
] as const satisfies readonly PartnerApplicationStatus[];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+()0-9 -]{7,40}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export type PartnerApplicationPayload = Pick<
  PartnerApplicationRecord,
  | "organizationName"
  | "displayName"
  | "profession"
  | "partnerType"
  | "fields"
  | "managerName"
  | "contactEmail"
  | "contactPhone"
  | "businessRegistrationNumber"
  | "businessAddress"
  | "memo"
  | "privacyConsent"
>;

export function isPartnerApplicationStatus(
  value: unknown,
): value is PartnerApplicationStatus {
  return (PARTNER_APPLICATION_STATUSES as readonly unknown[]).includes(value);
}

export function normalizePartnerApplicationPayload(body: unknown) {
  const payload = (body ?? {}) as Record<string, unknown>;
  const organizationName = String(payload.organizationName ?? payload.name ?? "")
    .trim();
  const displayName = String(payload.displayName ?? organizationName).trim();
  const profession = normalizePartnerProfession(payload.profession);
  const partnerType = String(payload.partnerType ?? "전문가").trim();
  const fields = normalizePartnerFields(payload.fields);
  const managerName = String(payload.managerName ?? "").trim();
  const contactEmail = String(payload.contactEmail ?? "")
    .trim()
    .toLowerCase();
  const contactPhone = String(payload.contactPhone ?? "").trim();
  const businessRegistrationNumber = String(
    payload.businessRegistrationNumber ?? "",
  ).trim();
  const businessAddress = String(payload.businessAddress ?? "").trim();
  const memo = String(payload.memo ?? "").trim();
  const privacyConsent = payload.privacyConsent === true;

  if (
    !organizationName ||
    !displayName ||
    !partnerType ||
    fields.length === 0 ||
    !managerName ||
    !EMAIL_PATTERN.test(contactEmail) ||
    (contactPhone && !PHONE_PATTERN.test(contactPhone)) ||
    !/^\d{3}-?\d{2}-?\d{5}$/.test(businessRegistrationNumber) ||
    !businessAddress ||
    !privacyConsent ||
    organizationName.length > 120 ||
    displayName.length > 120 ||
    partnerType.length > 50 ||
    managerName.length > 80 ||
    contactEmail.length > 254 ||
    contactPhone.length > 40 ||
    businessRegistrationNumber.length > 20 ||
    businessAddress.length > 300 ||
    memo.length > 2000 ||
    [
      organizationName,
      displayName,
      partnerType,
      managerName,
      contactPhone,
      businessRegistrationNumber,
      businessAddress,
      memo,
    ].some((value) => CONTROL_CHARACTER_PATTERN.test(value))
  ) {
    return null;
  }

  return {
    organizationName,
    displayName,
    profession,
    partnerType,
    fields,
    managerName,
    contactEmail,
    contactPhone,
    businessRegistrationNumber,
    businessAddress,
    memo,
    privacyConsent,
  } satisfies PartnerApplicationPayload;
}
