import {
  isNonghyupEmail,
  isValidBusinessEmail,
  normalizeEmail,
} from "@/lib/audit-quote/email-core";
import { normalizeKrMobilePhone } from "@/lib/phone";
import { getTestCooperativeDefinition } from "@/lib/cooperatives/demo-cooperative";

export const TEST_CUSTOMER_EMAILS = [
  "cheaptaxworld@gmail.com",
  "cheaptax@naver.com",
  "requiem77k@naver.com",
  "prego.ceo@gmail.com",
  "bsmta1277@gmail.com",
  "bsmta@naver.com",
] as const;

export const UNLIMITED_TEST_PHONE = "01063877780";

const TEST_CUSTOMER_EMAIL_SET = new Set<string>(TEST_CUSTOMER_EMAILS);

export type CustomerDataClassification =
  | "PRODUCTION"
  | "TEST"
  | "UNSUPPORTED";

export function classifyCustomerEmail(
  raw: string,
): CustomerDataClassification {
  const email = normalizeEmail(raw);
  if (!isValidBusinessEmail(email)) return "UNSUPPORTED";
  if (TEST_CUSTOMER_EMAIL_SET.has(email)) return "TEST";
  return isNonghyupEmail(email) ? "PRODUCTION" : "UNSUPPORTED";
}

export function isAllowedCustomerEmail(raw: string) {
  return classifyCustomerEmail(raw) !== "UNSUPPORTED";
}

export function isTestCustomerEmail(raw: string) {
  return classifyCustomerEmail(raw) === "TEST";
}

export function classifyCustomerDataRecord(input: {
  email: string;
  dataClassification?: unknown;
  cooperativeId?: unknown;
  nh_org_id?: unknown;
  sourceInstitutionId?: unknown;
}): CustomerDataClassification {
  const explicitlyTest =
    input.dataClassification === "DEMO" ||
    input.dataClassification === "TEST" ||
    input.dataClassification === "LEGACY_TEST";
  const referencesTestInstitution = [
    input.cooperativeId,
    input.nh_org_id,
    input.sourceInstitutionId,
  ].some(
    (value) =>
      typeof value === "string" &&
      Boolean(getTestCooperativeDefinition(value)),
  );
  return explicitlyTest || referencesTestInstitution
    ? "TEST"
    : classifyCustomerEmail(input.email);
}

export function hasUnlimitedTestSignup(input: {
  email: string;
  phone: string;
}) {
  return (
    isTestCustomerEmail(input.email) ||
    normalizeKrMobilePhone(input.phone) === UNLIMITED_TEST_PHONE
  );
}
