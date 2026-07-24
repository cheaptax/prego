type EnvMap = Record<string, string | undefined>;

export type AuditEvaluationFeatureFlags = {
  enabled: boolean;
  customerEntryEnabled: boolean;
  reportDownloadEnabled: boolean;
  adminEnabled: boolean;
  aiNarrativeEnabled: boolean;
};

export type ServerFeatureFlags = {
  auditEvaluation: AuditEvaluationFeatureFlags;
};

export type AuditEvaluationCapability =
  keyof AuditEvaluationFeatureFlags;

function readBool(env: EnvMap, name: string, fallback: boolean) {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

export function getServerFeatureFlags(
  env: EnvMap = process.env,
): ServerFeatureFlags {
  return {
    auditEvaluation: {
      enabled: readBool(env, "AUDIT_EVALUATION_ENABLED", false),
      customerEntryEnabled: readBool(
        env,
        "AUDIT_EVALUATION_CUSTOMER_ENTRY_ENABLED",
        false,
      ),
      reportDownloadEnabled: readBool(
        env,
        "AUDIT_EVALUATION_REPORT_DOWNLOAD_ENABLED",
        false,
      ),
      adminEnabled: readBool(
        env,
        "AUDIT_EVALUATION_ADMIN_ENABLED",
        false,
      ),
      aiNarrativeEnabled: readBool(
        env,
        "AUDIT_EVALUATION_AI_NARRATIVE_ENABLED",
        false,
      ),
    },
  };
}

export function isAuditEvaluationCapabilityEnabled(
  capability: AuditEvaluationCapability,
  flags: AuditEvaluationFeatureFlags = getServerFeatureFlags().auditEvaluation,
) {
  if (capability === "enabled") return flags.enabled;
  return flags.enabled && flags[capability];
}

export class AuditEvaluationFeatureDisabledError extends Error {
  readonly code = "audit_evaluation_feature_disabled";
  readonly capability: AuditEvaluationCapability;

  constructor(capability: AuditEvaluationCapability) {
    super(capability);
    this.name = "AuditEvaluationFeatureDisabledError";
    this.capability = capability;
  }
}

export function assertAuditEvaluationCapabilityEnabled(
  capability: AuditEvaluationCapability,
  flags: AuditEvaluationFeatureFlags = getServerFeatureFlags().auditEvaluation,
) {
  if (!isAuditEvaluationCapabilityEnabled(capability, flags)) {
    throw new AuditEvaluationFeatureDisabledError(capability);
  }
}
