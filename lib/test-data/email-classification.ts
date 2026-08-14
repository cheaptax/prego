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

/**
 * Map `local+tag@domain` aliases back to the allowlisted base address so
 * approved test customers can run fresh signup / quote flows without
 * colliding with an already-provisioned account. Gmail's googlemail.com
 * synonym is normalized to gmail.com for the same reason.
 */
export function testCustomerAllowlistBase(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const baseLocal = local.split("+")[0] ?? local;
  if (!baseLocal) return email;
  const normalizedDomain =
    domain === "googlemail.com" ? "gmail.com" : domain;
  return `${baseLocal}@${normalizedDomain}`;
}

/**
 * Gmail delivers `local+tag@gmail.com` to the base inbox. Naver and most
 * other hosts do not, so plus-alias test mail would never arrive. Keep the
 * account/login identity as the alias, but envelope-deliver to the base
 * address for non-Gmail test aliases.
 */
export function resolveTransactionalRecipient(accountEmail: string) {
  const email = normalizeEmail(accountEmail);
  const base = testCustomerAllowlistBase(email);
  if (base === email) return email;
  const domain = email.split("@")[1] ?? "";
  if (domain === "gmail.com" || domain === "googlemail.com") return email;
  if (TEST_CUSTOMER_EMAIL_SET.has(base)) return base;
  return email;
}

export function classifyCustomerEmail(
  raw: string,
): CustomerDataClassification {
  const email = normalizeEmail(raw);
  if (!isValidBusinessEmail(email)) return "UNSUPPORTED";
  if (TEST_CUSTOMER_EMAIL_SET.has(email)) return "TEST";
  if (TEST_CUSTOMER_EMAIL_SET.has(testCustomerAllowlistBase(email))) {
    return "TEST";
  }
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
