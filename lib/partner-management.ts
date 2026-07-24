import { createHash } from "node:crypto";
import type {
  AdminStatus,
  PartnerRecord,
  PartnerStatus,
} from "@/lib/firebase/schema";

export const PARTNER_UNIQUE_KEYS_COLLECTION = "partnerUniqueKeys";

export type PartnerUniqueKeyKind = "name" | "contactEmail";

export type PartnerListItem = PartnerRecord & {
  memberCount: number;
};

export type PartnerRelationSummary = {
  memberCount: number;
  assignmentCount: number;
  activeAssignmentCount: number;
  draftCount: number;
  answerCount: number;
};

export function normalizePartnerUniqueValue(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function partnerUniqueKeyId(
  kind: PartnerUniqueKeyKind,
  value: string,
) {
  const normalized = normalizePartnerUniqueValue(value);
  const digest = createHash("sha256").update(normalized).digest("hex");
  return `${kind}_${digest}`;
}

export function partnerUniqueKeyIds(input: {
  name: string;
  contactEmail: string;
}) {
  return {
    name: partnerUniqueKeyId("name", input.name),
    contactEmail: partnerUniqueKeyId("contactEmail", input.contactEmail),
  };
}

export function isPartnerStatusTransitionAllowed(
  current: PartnerStatus,
  next: PartnerStatus,
) {
  if (current === next) return true;
  if (current === "terminated") return false;
  if (current === "pending") {
    return next === "active" || next === "terminated";
  }
  if (current === "active") {
    return next === "paused" || next === "terminated";
  }
  return next === "active" || next === "terminated";
}

export function shouldEnablePartnerAccount(
  partnerStatus: PartnerStatus,
  accountStatus: AdminStatus,
) {
  return partnerStatus === "active" && accountStatus === "active";
}

export function filterPartnerList(
  partners: PartnerListItem[],
  filters: {
    search?: string;
    partnerType?: string;
    profession?: string;
    status?: PartnerStatus;
  },
) {
  const search = filters.search
    ? normalizePartnerUniqueValue(filters.search)
    : "";
  return partners.filter((partner) => {
    if (filters.partnerType && partner.partnerType !== filters.partnerType) {
      return false;
    }
    if (filters.profession && partner.profession !== filters.profession) {
      return false;
    }
    if (filters.status && partner.status !== filters.status) return false;
    if (!search) return true;
    return [
      partner.id,
      partner.name,
      partner.displayName,
      partner.partnerType,
      partner.profession ?? "",
      partner.managerName,
      partner.contactEmail,
      partner.contactPhone,
    ]
      .map(normalizePartnerUniqueValue)
      .some((value) => value.includes(search));
  });
}

export function paginatePartnerList(
  partners: PartnerListItem[],
  requestedPage: number,
  requestedPageSize: number,
) {
  const pageSize = Math.min(Math.max(Math.trunc(requestedPageSize) || 20, 1), 50);
  const total = partners.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(
    Math.max(Math.trunc(requestedPage) || 1, 1),
    totalPages,
  );
  return {
    items: partners.slice((page - 1) * pageSize, page * pageSize),
    pagination: { page, pageSize, total, totalPages },
  };
}

export function hardDeleteBlockReasons(summary: PartnerRelationSummary) {
  const reasons: string[] = [];
  if (summary.memberCount > 0) reasons.push("linked_members");
  if (summary.assignmentCount > 0) reasons.push("linked_assignments");
  if (summary.draftCount > 0) reasons.push("linked_drafts");
  if (summary.answerCount > 0) reasons.push("linked_answers");
  return reasons;
}
