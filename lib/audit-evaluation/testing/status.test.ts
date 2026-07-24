import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allowedAuditEvaluationNextStatuses,
  assertAuditEvaluationStatusTransition,
  AuditEvaluationTransitionError,
  canTransitionAuditEvaluationStatus,
} from "@/lib/audit-evaluation/status";

describe("audit-evaluation status transitions", () => {
  it("allows the defined workflow and idempotent writes", () => {
    assert.equal(
      canTransitionAuditEvaluationStatus("DRAFT", "ACCESS_PENDING"),
      true,
    );
    assert.equal(
      canTransitionAuditEvaluationStatus("PARSING", "READY"),
      true,
    );
    assert.equal(
      canTransitionAuditEvaluationStatus("UPLOADING", "READY"),
      true,
    );
    assert.equal(
      canTransitionAuditEvaluationStatus("READY", "GENERATING"),
      true,
    );
    assert.equal(
      canTransitionAuditEvaluationStatus("GENERATING", "COMPLETED"),
      true,
    );
    assert.equal(
      canTransitionAuditEvaluationStatus("COMPLETED", "COMPLETED"),
      true,
    );
    assert.equal(
      canTransitionAuditEvaluationStatus("EXPIRED", "COMPLETED"),
      true,
    );
  });

  it("blocks skips and terminal-state recovery", () => {
    assert.equal(
      canTransitionAuditEvaluationStatus("DRAFT", "COMPLETED"),
      false,
    );
    assert.equal(
      canTransitionAuditEvaluationStatus("EXPIRED", "UPLOADING"),
      false,
    );
    assert.deepEqual(allowedAuditEvaluationNextStatuses("DELETED"), []);
    assert.throws(
      () => assertAuditEvaluationStatusTransition("DELETED", "DRAFT"),
      AuditEvaluationTransitionError,
    );
  });
});
