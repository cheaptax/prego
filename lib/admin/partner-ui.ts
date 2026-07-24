import { ANSWER_POINT_MAX, ANSWER_POINT_MIN } from "@/lib/answer-points";
import type {
  AdminStatus,
  PartnerProfession,
  PartnerRecord,
  UserRecord,
} from "@/lib/firebase/schema";
import { isPartnerProfession } from "@/lib/partner-professions";
import { normalizePartnerFields } from "@/lib/partners";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+()0-9 -]{7,40}$/;
const BUSINESS_REGISTRATION_NUMBER_PATTERN = /^\d{3}-?\d{2}-?\d{5}$/;

export type PartnerListView = PartnerRecord & {
  memberCount: number;
};

export type PartnerAccountView = Pick<
  UserRecord,
  | "uid"
  | "name"
  | "email"
  | "phone"
  | "position"
  | "duty"
  | "status"
  | "createdAt"
  | "updatedAt"
> & {
  accountStatus?: AdminStatus;
};

export type PartnerSummaryView = {
  memberCount: number;
  assignmentCount: number;
  activeAssignmentCount: number;
  draftCount: number;
  answerCount: number;
};

export type PartnerDetailView = {
  partner: PartnerRecord;
  accounts: PartnerAccountView[];
  summary: PartnerSummaryView;
};

export type PartnerFormInput = {
  name: string;
  displayName: string;
  partnerType: string;
  profession?: PartnerProfession;
  fields: string[];
  managerName: string;
  contactEmail: string;
  contactPhone: string;
  businessRegistrationNumber: string;
  businessAddress: string;
  status: PartnerRecord["status"];
  pointMin: number;
  pointMax: number;
  memo: string;
  createLoginAccount?: boolean;
  loginPassword?: string;
};

export type PartnerFormErrors = Partial<
  Record<
    | "name"
    | "partnerType"
    | "profession"
    | "fields"
    | "managerName"
    | "contactEmail"
    | "contactPhone"
    | "businessRegistrationNumber"
    | "businessAddress"
    | "pointRange"
    | "loginPassword",
    "required" | "invalid"
  >
>;

export function validatePartnerForm(input: PartnerFormInput) {
  const errors: PartnerFormErrors = {};
  if (!input.name.trim()) errors.name = "required";
  if (!input.partnerType.trim()) errors.partnerType = "required";
  if (
    input.profession !== undefined &&
    !isPartnerProfession(input.profession)
  ) {
    errors.profession = "invalid";
  }
  if (normalizePartnerFields(input.fields).length === 0) {
    errors.fields = "required";
  }
  if (!input.managerName.trim()) errors.managerName = "required";
  if (!EMAIL_PATTERN.test(input.contactEmail.trim())) {
    errors.contactEmail = input.contactEmail.trim() ? "invalid" : "required";
  }
  if (
    input.contactPhone.trim() &&
    !PHONE_PATTERN.test(input.contactPhone.trim())
  ) {
    errors.contactPhone = "invalid";
  }
  if (
    !BUSINESS_REGISTRATION_NUMBER_PATTERN.test(
      input.businessRegistrationNumber.trim(),
    )
  ) {
    errors.businessRegistrationNumber = input.businessRegistrationNumber.trim()
      ? "invalid"
      : "required";
  }
  if (!input.businessAddress.trim()) {
    errors.businessAddress = "required";
  }
  if (
    !Number.isInteger(input.pointMin) ||
    !Number.isInteger(input.pointMax) ||
    input.pointMin < ANSWER_POINT_MIN ||
    input.pointMax > ANSWER_POINT_MAX ||
    input.pointMin > input.pointMax
  ) {
    errors.pointRange = "invalid";
  }
  if (
    input.createLoginAccount &&
    (!input.loginPassword ||
      input.loginPassword.length < 8 ||
      !/[A-Za-z]/.test(input.loginPassword) ||
      !/[0-9]/.test(input.loginPassword))
  ) {
    errors.loginPassword = "invalid";
  }
  return errors;
}

export function isDangerousPartnerStatusChange(
  current: PartnerRecord["status"],
  next: PartnerRecord["status"],
) {
  return (
    (current === "active" && (next === "paused" || next === "terminated")) ||
    (current === "paused" && next === "terminated")
  );
}

export function partnerServerErrorCopyKey(error: string | undefined) {
  switch (error) {
    case "duplicate_partner_name":
      return "duplicateNameError";
    case "duplicate_partner_email":
      return "duplicateEmailError";
    case "partner_account_email_exists":
      return "accountDuplicateEmail";
    case "partner_account_create_failed":
      return "accountSaveFailed";
    case "invalid_partner_account_password":
      return "accountPasswordValidationError";
    case "invalid_partner_status_transition":
      return "invalidStatusTransitionError";
    case "terminated_partner_immutable":
      return "terminatedImmutableError";
    case "permission_denied":
    case "operator_management_denied":
      return "permissionDeniedError";
    case "partner_request_failed":
      return "partnerRequestFailed";
    default:
      return "partnerSaveFailed";
  }
}

export type PartnerAccountFormInput = {
  mode: "create" | "edit";
  name: string;
  email: string;
  password?: string;
  phone: string;
  accountStatus: AdminStatus;
};

export type PartnerAccountFormErrors = Partial<
  Record<"name" | "email" | "password" | "phone", "required" | "invalid">
>;

export function validatePartnerAccountForm(input: PartnerAccountFormInput) {
  const errors: PartnerAccountFormErrors = {};
  if (!input.name.trim()) errors.name = "required";
  if (!EMAIL_PATTERN.test(input.email.trim())) {
    errors.email = input.email.trim() ? "invalid" : "required";
  }
  if (
    input.mode === "create" &&
    ((input.password?.length ?? 0) < 8 ||
      !/[A-Za-z]/.test(input.password ?? "") ||
      !/[0-9]/.test(input.password ?? ""))
  ) {
    errors.password = "invalid";
  }
  if (input.phone.trim() && !PHONE_PATTERN.test(input.phone.trim())) {
    errors.phone = "invalid";
  }
  return errors;
}
