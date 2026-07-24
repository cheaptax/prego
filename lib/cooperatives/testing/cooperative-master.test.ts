import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCooperativeSearchTokens,
  createProductionCooperativeMaster,
  normalizeCooperativeMasterInput,
  parseProductionCooperativeMaster,
} from "@/lib/cooperatives/master";

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
});
