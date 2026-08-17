import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCanonicalMasterRecord,
  applyCanonicalSearchItem,
  mergeAdminMasterSearchRecords,
  mergeProductionSearchItems,
} from "@/lib/cooperatives/catalog";
import {
  buildCooperativeSearchTokens,
  createProductionCooperativeMaster,
  normalizeCooperativeMasterInput,
  parseProductionCooperativeMaster,
} from "@/lib/cooperatives/master";
import { planStaticCooperativeMasterSync } from "@/lib/cooperatives/sync-static-master";
import { nonghyupMaster } from "@/lib/platform";
import { toRealCooperativeSearchItem } from "@/lib/cooperatives/demo-cooperative";

describe("dynamic production cooperative master", () => {
  it("builds normalized substring tokens for Korean master search", () => {
    const tokens = buildCooperativeSearchTokens({
      cooperativeId: "coop-001",
      cooperativeName: "서울축산농협",
      sido: "서울특별시",
      sigungu: "중구",
      address: "서울특별시 중구",
    });
    assert.ok(tokens.includes("서울축산농협"));
    assert.ok(tokens.includes("축산"));
    assert.ok(tokens.includes("중구"));
    assert.ok(tokens.includes("coop-001"));
  });

  it("requires an active successor when a cooperative is marked merged", () => {
    assert.equal(
      normalizeCooperativeMasterInput({
        cooperativeName: "통합대상농협",
        cooperativeType: "지역농협",
        sido: "서울특별시",
        sigungu: "중구",
        address: "",
        status: "merged",
      }),
      null,
    );
    assert.ok(
      normalizeCooperativeMasterInput({
        cooperativeName: "통합대상농협",
        cooperativeType: "지역농협",
        sido: "서울특별시",
        sigungu: "중구",
        address: "",
        status: "merged",
        successorCooperativeId: "coop-002",
      }),
    );
  });

  it("preserves stable IDs and increments revisions on administrator edits", () => {
    const value = normalizeCooperativeMasterInput({
      cooperativeName: "신설농협",
      cooperativeType: "지역농협",
      sido: "경기도",
      sigungu: "수원시",
      address: "경기도 수원시",
      status: "active",
    });
    assert.ok(value);
    const created = createProductionCooperativeMaster({
      cooperativeId: "coop-admin-fixed",
      value,
      source: "ADMIN",
      actorId: "admin-1",
      now: "2026-07-24T00:00:00.000Z",
    });
    const updated = createProductionCooperativeMaster({
      cooperativeId: created.cooperativeId,
      value: { ...value, cooperativeName: "신설중앙농협" },
      source: "ADMIN",
      actorId: "admin-2",
      now: "2026-07-25T00:00:00.000Z",
      existing: created,
    });
    assert.equal(updated.cooperativeId, created.cooperativeId);
    assert.equal(updated.createdAt, created.createdAt);
    assert.equal(updated.revision, 2);
    assert.equal(parseProductionCooperativeMaster(updated)?.cooperativeName, "신설중앙농협");
  });

  it("fills placeholder regions from the static master and keeps admin edits", () => {
    const daesan = nonghyupMaster.find(
      (item) =>
        item.cooperative_name === "대산농협" && item.sigungu === "서산시",
    );
    assert.ok(daesan);
    const stale = createProductionCooperativeMaster({
      cooperativeId: daesan.cooperative_id,
      value: {
        cooperativeName: daesan.cooperative_name,
        cooperativeType: daesan.cooperative_type,
        sido: "전국",
        sigungu: "",
        address: "전국",
        status: "active",
      },
      source: "STATIC_SEED",
      actorId: "seed",
      now: "2026-05-01T00:00:00.000Z",
    });
    const filled = applyCanonicalMasterRecord(stale);
    assert.equal(filled.sido, "충청남도");
    assert.equal(filled.sigungu, "서산시");
    assert.ok(filled.searchTokens.includes("서산시"));
    assert.equal(
      applyCanonicalSearchItem({
        ...toRealCooperativeSearchItem(daesan),
        sido: "전국",
        sigungu: "",
        address: "전국",
      }).sido,
      "충청남도",
    );

    const adminEdited = createProductionCooperativeMaster({
      cooperativeId: daesan.cooperative_id,
      value: {
        cooperativeName: daesan.cooperative_name,
        cooperativeType: daesan.cooperative_type,
        sido: "서울특별시",
        sigungu: "중구",
        address: "서울특별시 중구",
        status: "active",
      },
      source: "ADMIN",
      actorId: "admin-1",
      now: "2026-08-18T00:00:00.000Z",
    });
    assert.equal(applyCanonicalMasterRecord(adminEdited).sido, "서울특별시");
  });

  it("lets admin and signup search find the same cooperative by region", () => {
    const daesan = nonghyupMaster.find(
      (item) =>
        item.cooperative_name === "대산농협" && item.sigungu === "서산시",
    );
    assert.ok(daesan);
    const stale = createProductionCooperativeMaster({
      cooperativeId: daesan.cooperative_id,
      value: {
        cooperativeName: daesan.cooperative_name,
        cooperativeType: daesan.cooperative_type,
        sido: "전국",
        sigungu: "",
        address: "전국",
        status: "active",
      },
      source: "STATIC_SEED",
      actorId: "seed",
      now: "2026-05-01T00:00:00.000Z",
    });
    const signupHits = mergeProductionSearchItems({
      query: "서산",
      limit: 10,
      staticHits: [toRealCooperativeSearchItem(daesan)],
      firestoreRecords: [stale],
    });
    assert.deepEqual(
      signupHits.map((item) => [
        item.cooperative_id,
        `${item.sido} ${item.sigungu}`,
      ]),
      [[daesan.cooperative_id, "충청남도 서산시"]],
    );
    const adminHits = mergeAdminMasterSearchRecords({
      query: "서산",
      firestoreRecords: [stale],
    });
    assert.equal(adminHits[0]?.cooperativeId, daesan.cooperative_id);
    assert.equal(adminHits[0]?.sigungu, "서산시");
  });

  it("plans a static master sync that updates nationwide placeholders and preserves admin rows", () => {
    const first = nonghyupMaster[0];
    const stale = createProductionCooperativeMaster({
      cooperativeId: first.cooperative_id,
      value: {
        cooperativeName: first.cooperative_name,
        cooperativeType: first.cooperative_type,
        sido: "전국",
        sigungu: "",
        address: "전국",
        status: first.status,
      },
      source: "STATIC_SEED",
      sourceUpdatedAt: first.updated_at,
      actorId: "seed",
      now: "2026-05-01T00:00:00.000Z",
    });
    const adminRow = createProductionCooperativeMaster({
      cooperativeId: nonghyupMaster[1].cooperative_id,
      value: {
        cooperativeName: nonghyupMaster[1].cooperative_name,
        cooperativeType: nonghyupMaster[1].cooperative_type,
        sido: "관리자시",
        sigungu: "직접구",
        address: "관리자시 직접구",
        status: "active",
      },
      source: "ADMIN",
      actorId: "admin-1",
      now: "2026-08-01T00:00:00.000Z",
    });
    const existingById = new Map<
      string,
      ReturnType<typeof createProductionCooperativeMaster> | null
    >(nonghyupMaster.map((item) => [item.cooperative_id, null]));
    existingById.set(first.cooperative_id, stale);
    existingById.set(adminRow.cooperativeId, adminRow);
    const plans = planStaticCooperativeMasterSync({
      existingById,
      now: "2026-08-18T00:00:00.000Z",
    });
    const firstPlan = plans.find(
      (plan) => plan.cooperativeId === first.cooperative_id,
    );
    const adminPlan = plans.find(
      (plan) => plan.cooperativeId === adminRow.cooperativeId,
    );
    assert.equal(firstPlan?.action, "update");
    assert.equal(firstPlan?.record.sido, first.sido);
    assert.ok(firstPlan?.record.searchTokens.includes(first.sigungu));
    assert.equal(adminPlan?.action, "preserve");
    assert.equal(adminPlan?.record.sido, "관리자시");
  });
});
