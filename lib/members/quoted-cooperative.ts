import { formatKrMobilePhoneInput } from "@/lib/phone";

type QuotedRequestLike = {
  cooperativeId?: string;
  cooperativeName?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  updatedAt?: string;
  createdAt?: string;
};

function latestQuotedRequest<T extends { updatedAt?: string; createdAt?: string }>(
  requests: ReadonlyArray<T>,
) {
  if (requests.length === 0) return null;
  return [...requests].sort((left, right) =>
    (right.updatedAt || right.createdAt || "").localeCompare(
      left.updatedAt || left.createdAt || "",
    ),
  )[0];
}

export type QuotedRequestProfile = {
  cooperativeId: string;
  cooperativeName: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
};

export function pickQuotedContact(
  requests: ReadonlyArray<QuotedRequestLike>,
) {
  const latest = latestQuotedRequest(requests);
  return {
    customerName: latest?.customerName?.trim() ?? "",
    customerPhone: latest?.customerPhone?.trim() ?? "",
    customerEmail: latest?.customerEmail?.trim() ?? "",
  };
}

export function pickQuotedCooperative(
  requests: ReadonlyArray<QuotedRequestLike>,
): QuotedRequestProfile | null {
  const quoted = requests.filter(
    (request) =>
      Boolean(request.cooperativeId?.trim()) &&
      Boolean(request.cooperativeName?.trim()),
  );
  const latest = latestQuotedRequest(quoted);
  if (!latest) return null;
  const contact = pickQuotedContact(requests);
  return {
    cooperativeId: latest.cooperativeId!.trim(),
    cooperativeName: latest.cooperativeName!.trim(),
    customerName: latest.customerName?.trim() || contact.customerName,
    customerPhone: latest.customerPhone?.trim() || contact.customerPhone,
    customerEmail: latest.customerEmail?.trim() || contact.customerEmail,
  };
}

export function displayQuotedPhone(value?: string) {
  const raw = value?.trim() ?? "";
  if (!raw) return "";
  return formatKrMobilePhoneInput(raw) || raw;
}
