import { loadEnvConfig } from "@next/env";
import { AUDIT_EVALUATION_COLLECTIONS } from "@/lib/audit-evaluation/collections";
import { getServerFeatureFlags } from "@/lib/audit-evaluation/feature-flags";
import { evaluationConfigSchema } from "@/lib/audit-evaluation/schemas";
import { AUDIT_QUOTE_REQUESTS } from "@/lib/audit-quote/collections";
import { adminDb } from "@/lib/firebase/admin";

loadEnvConfig(process.cwd(), false);

const MAX_REQUESTS = 10_000;
const CLOSED_STATUSES = new Set(["closed", "invalid"]);

async function main() {
  const environment = inspectEnvironment(process.env);
  if (!environment.summary.firebaseAdminConfigured) {
    const output = {
      ok: false,
      checkedAt: new Date().toISOString(),
      mode: "READ_ONLY_DRY_RUN",
      environment: environment.summary,
      featureFlags: getServerFeatureFlags().auditEvaluation,
      requestAudit: null,
      migration: null,
      activePublishedConfigCount: null,
      collectionCounts: [],
      blockers: environment.blockers,
      warnings: environment.warnings,
    };
    console.log(JSON.stringify(output, null, 2));
    process.exitCode = 1;
    return;
  }
  const db = adminDb();
  const [requestSnapshot, configSnapshot, collectionCounts] =
    await Promise.all([
      db.collection(AUDIT_QUOTE_REQUESTS).limit(MAX_REQUESTS + 1).get(),
      db.collection(AUDIT_EVALUATION_COLLECTIONS.configVersions).get(),
      Promise.all(
        Object.values(AUDIT_EVALUATION_COLLECTIONS).map(
          async (collection) => ({
            collection,
            count: (await db.collection(collection).count().get()).data().count,
          }),
        ),
      ),
    ]);
  const requests = requestSnapshot.docs.slice(0, MAX_REQUESTS);
  const requestAudit = {
    scannedCount: requests.length,
    truncated: requestSnapshot.size > MAX_REQUESTS,
    schemaVersion2Count: 0,
    missingEmailHashCount: 0,
    missingPublicReferenceCount: 0,
    eligibleStatusCount: 0,
    withRegisteredQuoteCount: 0,
  };
  for (const snapshot of requests) {
    const value = snapshot.data();
    if (value.schemaVersion === 2) requestAudit.schemaVersion2Count += 1;
    if (!isNonEmptyString(value.emailHash)) {
      requestAudit.missingEmailHashCount += 1;
    }
    if (!isNonEmptyString(value.publicReference)) {
      requestAudit.missingPublicReferenceCount += 1;
    }
    if (!CLOSED_STATUSES.has(String(value.status))) {
      requestAudit.eligibleStatusCount += 1;
    }
    if (Number.isInteger(value.quoteCount) && value.quoteCount > 0) {
      requestAudit.withRegisteredQuoteCount += 1;
    }
  }
  const now = Date.now();
  const publishedConfigs = configSnapshot.docs.flatMap((snapshot) => {
    const parsed = evaluationConfigSchema.safeParse(snapshot.data());
    return parsed.success && parsed.data.status === "PUBLISHED"
      ? [parsed.data]
      : [];
  });
  const activePublishedConfigCount = publishedConfigs.filter(
    ({ effectiveFrom, effectiveTo }) =>
      (!effectiveFrom || Date.parse(effectiveFrom) <= now) &&
      (!effectiveTo || Date.parse(effectiveTo) > now),
  ).length;
  const migrationRequired =
    requestAudit.missingEmailHashCount > 0 ||
    requestAudit.missingPublicReferenceCount > 0;
  const blockers = [...environment.blockers];
  if (requestAudit.truncated) blockers.push("request_scan_truncated");
  if (migrationRequired) blockers.push("legacy_request_review_required");
  if (
    getServerFeatureFlags().auditEvaluation.enabled &&
    activePublishedConfigCount === 0
  ) {
    blockers.push("no_active_published_evaluation_config");
  }
  const warnings = [...environment.warnings];
  if (activePublishedConfigCount === 0) {
    warnings.push("no_active_published_evaluation_config");
  }
  const output = {
    ok: blockers.length === 0,
    checkedAt: new Date().toISOString(),
    mode: "READ_ONLY_DRY_RUN",
    environment: environment.summary,
    featureFlags: getServerFeatureFlags().auditEvaluation,
    requestAudit,
    migration: {
      required: migrationRequired,
      writesPerformed: 0,
      rollbackRequired: false,
    },
    activePublishedConfigCount,
    collectionCounts,
    blockers,
    warnings,
  };
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}

function inspectEnvironment(env: NodeJS.ProcessEnv) {
  const flags = getServerFeatureFlags(env).auditEvaluation;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const allowlistValues =
    env.AUDIT_EVALUATION_ACCESS_EMAIL_HASH_ALLOWLIST
      ?.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean) ?? [];
  const validAllowlistCount = allowlistValues.filter((value) =>
    /^[a-f0-9]{64}$/.test(value)
  ).length;
  const required = [
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "AUDIT_QUOTE_HASH_PEPPER",
  ];
  for (const name of required) {
    if (!isNonEmptyString(env[name])) blockers.push(`missing:${name}`);
  }
  for (const name of [
    "AUDIT_EVALUATION_DOCUMENT_SIGNING_SECRET",
    "AUDIT_EVALUATION_ACCESS_SECRET",
    "CRON_SECRET",
  ]) {
    if (Buffer.byteLength(env[name]?.trim() ?? "", "utf8") < 32) {
      blockers.push(`weak_or_missing:${name}`);
    }
  }
  if (
    env.AUDIT_EVALUATION_DOCUMENT_SIGNING_SECRET?.trim() ===
    env.AUDIT_EVALUATION_ACCESS_SECRET?.trim()
  ) {
    blockers.push("evaluation_secrets_must_be_distinct");
  }
  if (
    flags.customerEntryEnabled &&
    ![
      env.AUDIT_EVALUATION_BASE_URL,
      env.NH_SUPPORT_BASE_URL,
      env.VERCEL_PROJECT_PRODUCTION_URL,
      env.VERCEL_URL,
    ].some(isProductionBaseUrl)
  ) {
    blockers.push("invalid:AUDIT_EVALUATION_BASE_URL");
  }
  const emailProvider =
    env.AUDIT_EVALUATION_EMAIL_PROVIDER?.trim().toLowerCase();
  const emailWebhookConfigured =
    emailProvider === "webhook" &&
    isHttpsUrl(env.AUDIT_EVALUATION_EMAIL_WEBHOOK_URL) &&
    Buffer.byteLength(
      env.AUDIT_EVALUATION_EMAIL_WEBHOOK_TOKEN?.trim() ?? "",
      "utf8",
    ) >= 16;
  const resendEmailConfigured =
    emailProvider !== "webhook" &&
    isNonEmptyString(env.RESEND_API_KEY) &&
    (
      isNonEmptyString(env.RESEND_FROM_EMAIL) ||
      isNonEmptyString(env.NH_SUPPORT_FROM_EMAIL)
    );
  if (
    flags.customerEntryEnabled &&
    !emailWebhookConfigured &&
    !resendEmailConfigured
  ) {
    blockers.push("production_access_email_provider_not_configured");
  }
  if (
    !flags.enabled &&
    (
      flags.customerEntryEnabled ||
      flags.reportDownloadEnabled ||
      flags.adminEnabled ||
      flags.aiNarrativeEnabled
    )
  ) {
    blockers.push("audit_evaluation_feature_flags_inconsistent");
  }
  if (flags.reportDownloadEnabled && !flags.customerEntryEnabled) {
    blockers.push("report_download_requires_customer_entry");
  }
  const scanMode = env.AUDIT_EVALUATION_AV_SCAN_MODE?.trim() || "static";
  if (!["static", "external", "required"].includes(scanMode)) {
    blockers.push("invalid:AUDIT_EVALUATION_AV_SCAN_MODE");
  }
  if (
    scanMode === "required" &&
    !isHttpsUrl(env.AUDIT_EVALUATION_AV_SCAN_URL)
  ) {
    blockers.push("missing:AUDIT_EVALUATION_AV_SCAN_URL");
  }
  if (scanMode === "static") {
    warnings.push("static_pdf_scan_is_not_full_av");
  }
  if (!isNonEmptyString(env.AUDIT_EVALUATION_ACTIVE_CONFIG_ID)) {
    warnings.push("active_config_id_not_set");
  }
  if (
    allowlistValues.length > 0 &&
    validAllowlistCount !== allowlistValues.length
  ) {
    blockers.push("invalid:AUDIT_EVALUATION_ACCESS_EMAIL_HASH_ALLOWLIST");
  }
  if (env.AUDIT_EVALUATION_AI_NARRATIVE_ENABLED === "true") {
    warnings.push("ai_narrative_requires_separate_approval");
  }
  return {
    blockers,
    warnings,
    summary: {
      firebaseAdminConfigured: required.every((name) =>
        isNonEmptyString(env[name])
      ),
      evaluationSecretsConfigured: [
        env.AUDIT_EVALUATION_DOCUMENT_SIGNING_SECRET,
        env.AUDIT_EVALUATION_ACCESS_SECRET,
      ].every((value) => Buffer.byteLength(value?.trim() ?? "", "utf8") >= 32),
      cronSecretConfigured:
        Buffer.byteLength(env.CRON_SECRET?.trim() ?? "", "utf8") >= 32,
      emailWebhookConfigured:
        emailWebhookConfigured,
      resendEmailConfigured,
      accessEmailConfigured:
        emailWebhookConfigured || resendEmailConfigured,
      scanMode,
      activeConfigIdConfigured:
        isNonEmptyString(env.AUDIT_EVALUATION_ACTIVE_CONFIG_ID),
      stagedRolloutAllowlistCount: validAllowlistCount,
    },
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpsUrl(value: unknown) {
  if (!isNonEmptyString(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isProductionBaseUrl(value: unknown) {
  if (!isNonEmptyString(value)) return false;
  return isHttpsUrl(
    value.includes("://") ? value : `https://${value}`,
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
