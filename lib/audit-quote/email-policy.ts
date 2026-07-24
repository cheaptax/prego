import { isAllowedCustomerEmail } from "@/lib/test-data/email-classification";

export function isAllowedAuditQuoteRequesterEmail(raw: string): boolean {
  return isAllowedCustomerEmail(raw);
}
