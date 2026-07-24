import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addWonAmounts,
  compareWonAmounts,
  InvalidWonAmountError,
  isWonAmount,
  normalizeWonAmount,
} from "@/lib/audit-evaluation/money";

describe("won amount validation", () => {
  it("normalizes only integer won values", () => {
    assert.equal(normalizeWonAmount("0"), "0");
    assert.equal(normalizeWonAmount(12_345), "12345");
    assert.equal(normalizeWonAmount(9_007_199_254_740_992n), "9007199254740992");
  });

  it("rejects floating-point and non-canonical values", () => {
    for (const value of ["01", "1.0", "1e3", "1,000", "-1", " 1"]) {
      assert.equal(isWonAmount(value), false);
      assert.throws(
        () => normalizeWonAmount(value),
        InvalidWonAmountError,
      );
    }
    assert.throws(
      () => normalizeWonAmount(1.1),
      InvalidWonAmountError,
    );
    assert.throws(
      () => normalizeWonAmount(Number.MAX_SAFE_INTEGER + 1),
      InvalidWonAmountError,
    );
  });

  it("uses bigint arithmetic for deterministic totals and comparisons", () => {
    const first = normalizeWonAmount("9007199254740992");
    const second = normalizeWonAmount("8");
    assert.equal(addWonAmounts([first, second]), "9007199254741000");
    assert.equal(compareWonAmounts(first, second), 1);
    assert.equal(compareWonAmounts(second, second), 0);
  });
});
