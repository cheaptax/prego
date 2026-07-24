import {
  ANSWER_POINT_MAX,
  ANSWER_POINT_MIN,
} from "@/lib/answer-points";
import type {
  PartnerAnswerDraftRecord,
  PartnerAssignmentRecord,
  PartnerRecord,
  PartnerStatus,
} from "@/lib/firebase/schema";
import { isValidSupportFieldLabel } from "@/lib/inquiry-categories";
import { normalizePartnerProfession } from "@/lib/partner-professions";

export const PARTNER_STATUSES = [
  "active",
  "paused",
  "pending",
  "terminated",
] as const satisfies readonly PartnerStatus[];

export const PARTNER_FIELD_LIMITS = {
  name: 120,
  displayName: 120,
  partnerType: 50,
  profession: 30,
  managerName: 80,
  email: 254,
  phone: 40,
  businessRegistrationNumber: 20,
  businessAddress: 300,
  memo: 2000,
} as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BUSINESS_REGISTRATION_NUMBER_PATTERN = /^\d{3}-?\d{2}-?\d{5}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export function isPartnerStatus(value: unknown): value is PartnerStatus {
  return (PARTNER_STATUSES as readonly unknown[]).includes(value);
}

export function normalizePartnerEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizePartnerFields(value: unknown) {
  const fields = Array.isArray(value)
    ? value
    : String(value ?? "").split(",");
  return Array.from(
    new Set(
      fields
        .map((field) => String(field).trim())
        .filter((field) => field && isValidSupportFieldLabel(field)),
    ),
  );
}

export function normalizePartnerStatus(
  value: unknown,
): PartnerRecord["status"] {
  return (PARTNER_STATUSES as readonly PartnerStatus[]).includes(
    value as PartnerStatus,
  )
    ? (value as PartnerRecord["status"])
    : "pending";
}

export function normalizePartnerPointRange(input: {
  pointMin?: unknown;
  pointMax?: unknown;
}) {
  const pointMin = Number(input.pointMin ?? ANSWER_POINT_MIN);
  const pointMax = Number(input.pointMax ?? ANSWER_POINT_MAX);
  if (
    !Number.isInteger(pointMin) ||
    !Number.isInteger(pointMax) ||
    pointMin < ANSWER_POINT_MIN ||
    pointMax > ANSWER_POINT_MAX ||
    pointMin > pointMax
  ) {
    return null;
  }
  return { pointMin, pointMax };
}

export function validatePartnerPayload(body: unknown) {
  const payload = (body ?? {}) as Record<string, unknown>;
  const name = String(payload.name ?? "").trim();
  const displayName = String(payload.displayName ?? name).trim();
  const partnerType = String(payload.partnerType ?? "").trim();
  const profession = normalizePartnerProfession(payload.profession);
  const managerName = String(payload.managerName ?? "").trim();
  const contactEmail = normalizePartnerEmail(payload.contactEmail);
  const contactPhone = String(payload.contactPhone ?? "").trim();
  const businessRegistrationNumber = String(
    payload.businessRegistrationNumber ?? "",
  ).trim();
  const businessAddress = String(payload.businessAddress ?? "").trim();
  const fields = normalizePartnerFields(payload.fields);
  const pointRange = normalizePartnerPointRange(payload);
  const memo = String(payload.memo ?? "").trim();
  const status = payload.status === undefined
    ? "pending"
    : isPartnerStatus(payload.status)
      ? payload.status
      : null;
  if (
    !name ||
    !displayName ||
    !partnerType ||
    !managerName ||
    !EMAIL_PATTERN.test(contactEmail) ||
    !BUSINESS_REGISTRATION_NUMBER_PATTERN.test(businessRegistrationNumber) ||
    !businessAddress ||
    fields.length === 0 ||
    !pointRange ||
    !status ||
    name.length > PARTNER_FIELD_LIMITS.name ||
    displayName.length > PARTNER_FIELD_LIMITS.displayName ||
    partnerType.length > PARTNER_FIELD_LIMITS.partnerType ||
    profession.length > PARTNER_FIELD_LIMITS.profession ||
    managerName.length > PARTNER_FIELD_LIMITS.managerName ||
    contactEmail.length > PARTNER_FIELD_LIMITS.email ||
    contactPhone.length > PARTNER_FIELD_LIMITS.phone ||
    businessRegistrationNumber.length >
      PARTNER_FIELD_LIMITS.businessRegistrationNumber ||
    businessAddress.length > PARTNER_FIELD_LIMITS.businessAddress ||
    memo.length > PARTNER_FIELD_LIMITS.memo ||
    [
      name,
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
    name,
    displayName,
    partnerType,
    profession,
    fields,
    managerName,
    contactEmail,
    contactPhone,
    businessRegistrationNumber,
    businessAddress,
    status,
    ...pointRange,
    memo,
  };
}

export function isPartnerActive(partner: PartnerRecord | null) {
  return partner?.status === "active";
}

export function canPartnerPriceAnswer(
  partner: PartnerRecord,
  pointCost: number,
) {
  return (
    Number.isInteger(pointCost) &&
    pointCost >= partner.pointMin &&
    pointCost <= partner.pointMax
  );
}

export function canApprovePartnerDraft(
  assignment: PartnerAssignmentRecord,
  draft: PartnerAnswerDraftRecord,
) {
  return (
    assignment.id === draft.assignmentId &&
    assignment.partnerId === draft.partnerId &&
    assignment.requestId === draft.requestId &&
    assignment.status === "submitted" &&
    draft.status === "submitted"
  );
}
