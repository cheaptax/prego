import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterPartnerList,
  hardDeleteBlockReasons,
  isPartnerStatusTransitionAllowed,
  paginatePartnerList,
  partnerUniqueKeyIds,
  shouldEnablePartnerAccount,
  type PartnerListItem,
} from "@/lib/partner-management";
import { validatePartnerPayload } from "@/lib/partners";

function partner(input: Partial<PartnerListItem> = {}): PartnerListItem {
  return {
    id: "partner-1",
    name: "세무 제휴사",
    displayName: "세무 제휴사",
    partnerType: "전문가",
    fields: ["세무·회계"],
    managerName: "담당자",
    contactEmail: "manager@example.com",
    contactPhone: "02-1234-5678",
    businessRegistrationNumber: "123-45-67890",
    businessAddress: "서울특별시 중구 세종대로 1",
    status: "active",
    pointMin: 30000,
    pointMax: 100000,
    memo: "",
    createdBy: "admin-1",
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedBy: "admin-1",
    updatedAt: "2026-07-22T00:00:00.000Z",
    memberCount: 2,
    ...input,
  };
}

describe("partner management policy", () => {
  it("validates and normalizes the adopted partner schema", () => {
    const payload = validatePartnerPayload({
      name: "  세무 제휴사 ",
      displayName: " 세무 전문가 ",
      partnerType: "전문가",
      fields: ["세무·회계", "세무·회계"],
      managerName: " 담당자 ",
      contactEmail: " MANAGER@EXAMPLE.COM ",
      contactPhone: "02-1234-5678",
      businessRegistrationNumber: "123-45-67890",
      businessAddress: " 서울특별시 중구 세종대로 1 ",
      status: "pending",
      pointMin: 30000,
      pointMax: 100000,
      memo: " 내부 메모 ",
    });
    assert.deepEqual(payload, {
      name: "세무 제휴사",
      displayName: "세무 전문가",
      partnerType: "전문가",
      profession: "OTHER",
      fields: ["세무·회계"],
      managerName: "담당자",
      contactEmail: "manager@example.com",
      contactPhone: "02-1234-5678",
      businessRegistrationNumber: "123-45-67890",
      businessAddress: "서울특별시 중구 세종대로 1",
      status: "pending",
      pointMin: 30000,
      pointMax: 100000,
      memo: "내부 메모",
    });
    assert.equal(
      validatePartnerPayload({
        ...payload,
        contactEmail: "invalid",
      }),
      null,
    );
    assert.equal(
      validatePartnerPayload({
        ...payload,
        status: "unsupported",
      }),
      null,
    );
  });

  it("creates stable normalized unique keys for name and manager email", () => {
    assert.deepEqual(
      partnerUniqueKeyIds({
        name: "세무  제휴사",
        contactEmail: "MANAGER@example.com",
      }),
      partnerUniqueKeyIds({
        name: " 세무 제휴사 ",
        contactEmail: "manager@EXAMPLE.COM",
      }),
    );
  });

  it("filters and paginates partner list records with member counts", () => {
    const rows = [
      partner(),
      partner({
        id: "partner-2",
        name: "법률 제휴사",
        displayName: "법률 제휴사",
        fields: ["법률"],
        contactEmail: "legal@example.com",
        status: "paused",
        memberCount: 1,
      }),
    ];
    assert.deepEqual(
      filterPartnerList(rows, { search: "legal@example.com" }).map(
        (item) => item.id,
      ),
      ["partner-2"],
    );
    assert.deepEqual(
      filterPartnerList(rows, { status: "active" }).map((item) => item.id),
      ["partner-1"],
    );
    const paged = paginatePartnerList(rows, 2, 1);
    assert.equal(paged.items[0].id, "partner-2");
    assert.deepEqual(paged.pagination, {
      page: 2,
      pageSize: 1,
      total: 2,
      totalPages: 2,
    });
  });

  it("enforces status transitions and suspended partner access", () => {
    assert.equal(isPartnerStatusTransitionAllowed("pending", "active"), true);
    assert.equal(isPartnerStatusTransitionAllowed("active", "paused"), true);
    assert.equal(isPartnerStatusTransitionAllowed("paused", "active"), true);
    assert.equal(
      isPartnerStatusTransitionAllowed("terminated", "active"),
      false,
    );
    assert.equal(shouldEnablePartnerAccount("active", "active"), true);
    assert.equal(shouldEnablePartnerAccount("paused", "active"), false);
    assert.equal(shouldEnablePartnerAccount("terminated", "active"), false);
  });

  it("reports every linked-data hard-delete blocker", () => {
    assert.deepEqual(
      hardDeleteBlockReasons({
        memberCount: 1,
        assignmentCount: 2,
        activeAssignmentCount: 1,
        draftCount: 3,
        answerCount: 4,
      }),
      [
        "linked_members",
        "linked_assignments",
        "linked_drafts",
        "linked_answers",
      ],
    );
  });
});
