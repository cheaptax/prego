import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertAuditEvaluationCapabilityEnabled,
  AuditEvaluationFeatureDisabledError,
  getServerFeatureFlags,
  isAuditEvaluationCapabilityEnabled,
} from "@/lib/audit-evaluation/feature-flags";

describe("audit-evaluation server feature flags", () => {
  it("defaults every capability to false", () => {
    const flags = getServerFeatureFlags({}).auditEvaluation;
    assert.deepEqual(flags, {
      enabled: false,
      customerEntryEnabled: false,
      reportDownloadEnabled: false,
      adminEnabled: false,
      aiNarrativeEnabled: false,
    });
  });

  it("does not read NEXT_PUBLIC client variables", () => {
    const flags = getServerFeatureFlags({
      NEXT_PUBLIC_AUDIT_EVALUATION_ENABLED: "true",
      NEXT_PUBLIC_AUDIT_EVALUATION_ADMIN_ENABLED: "true",
    }).auditEvaluation;
    assert.equal(flags.enabled, false);
    assert.equal(flags.adminEnabled, false);
  });

  it("requires both the master flag and the capability flag", () => {
    const flags = getServerFeatureFlags({
      AUDIT_EVALUATION_ENABLED: "false",
      AUDIT_EVALUATION_ADMIN_ENABLED: "true",
    }).auditEvaluation;
    assert.equal(
      isAuditEvaluationCapabilityEnabled("adminEnabled", flags),
      false,
    );
    assert.throws(
      () =>
        assertAuditEvaluationCapabilityEnabled("adminEnabled", flags),
      AuditEvaluationFeatureDisabledError,
    );
  });
});
