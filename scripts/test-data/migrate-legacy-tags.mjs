/**
 * Dry-run-first exact-document legacy test marker migration.
 *
 * Apply is never inferred. It requires --apply, an approved READY review
 * manifest, exact --document-path values, project matching and (in production)
 * a dedicated feature flag plus exact institution confirmation.
 */
import { existsSync, readFileSync } from "node:fs";
import {
  FirestoreLegacyTagMigrationRepository,
  LegacyTagMigrationService,
} from "../../lib/test-data/legacy-tag-migration.ts";

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;
  const content = readFileSync(".env.local", "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    if (/PASSWORD|SECRET|TOKEN|PRIVATE_KEY/.test(match[1])) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return "";
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value.trim();
}

function options(args, name) {
  return args.flatMap((value, index) =>
    value === name && args[index + 1] && !args[index + 1].startsWith("--")
      ? [args[index + 1].trim()]
      : []
  );
}

function parseArgs(argv) {
  const args = argv.slice(2);
  return {
    help: args.includes("--help") || args.includes("-h"),
    apply: args.includes("--apply"),
    reviewManifestId: option(args, "--review-manifest"),
    institutionId: option(args, "--institution-id"),
    documentPaths: options(args, "--document-path"),
    expectedProject: option(args, "--expected-project"),
    targetEnvironment: option(args, "--target-environment"),
    confirmProduction: option(args, "--confirm-production"),
    input: option(args, "--input"),
  };
}

function help() {
  console.log(`Legacy test marker migration

Default mode: dry-run

Options:
  --review-manifest <id>       Required approved READY review manifest
  --institution-id <id>        Required exact real cooperative ID
  --document-path <path>        Required exact path; repeat for each document
  --expected-project <id>       Required exact Firebase project ID
  --target-environment <name>   Explicit target environment for Firebase runs
  --input <json>                Optional sanitized offline dry-run input
  --apply                       Apply markers; omitted means dry-run
  --confirm-production <id>     Production apply exact institution confirmation

Production apply additionally requires:
  LEGACY_TEST_DATA_TAGGING_PRODUCTION_ENABLED=true
`);
}

function environment() {
  if (process.env.FIRESTORE_EMULATOR_HOST) return "emulator";
  return process.env.VERCEL_ENV?.trim() ||
    process.env.NODE_ENV?.trim() ||
    "local";
}

function projectId() {
  return process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    "";
}

class OfflineRepository {
  constructor(input) {
    this.input = input;
  }

  async getReviewManifest(reviewManifestId) {
    return this.input.manifest?.reviewManifestId === reviewManifestId
      ? this.input.manifest
      : null;
  }

  async loadApprovedDocumentReviews(reviewManifestId) {
    return (this.input.reviews || []).filter(
      (review) => review.reviewManifestId === reviewManifestId,
    );
  }

  async loadDocuments(documentPaths) {
    return documentPaths.map(
      (path) =>
        (this.input.documents || []).find(
          (document) => document.documentPath === path,
        ) || { documentPath: path, exists: false, data: {} },
    );
  }

  async apply() {
    throw new Error("Offline input cannot be applied");
  }
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv);
  if (args.help) {
    help();
    return;
  }
  if (
    !args.reviewManifestId ||
    !args.institutionId ||
    !args.expectedProject ||
    args.documentPaths.length === 0
  ) {
    throw new Error(
      "--review-manifest, --institution-id, --document-path and --expected-project are required",
    );
  }
  if (args.apply && args.input) {
    throw new Error("Offline --input is dry-run only");
  }
  const actualProject = args.input ? args.expectedProject : projectId();
  const targetEnvironment = args.input
    ? "offline"
    : args.targetEnvironment || environment();
  if (
    args.targetEnvironment &&
    !["development", "staging", "production", "emulator", "test", "local"]
      .includes(args.targetEnvironment)
  ) {
    throw new Error("Invalid --target-environment");
  }
  if (args.apply && !args.targetEnvironment) {
    throw new Error("--apply requires explicit --target-environment");
  }
  if (!actualProject || actualProject !== args.expectedProject) {
    throw new Error("Expected project ID does not match the target project");
  }
  if (args.apply && targetEnvironment === "production") {
    if (
      process.env.LEGACY_TEST_DATA_TAGGING_PRODUCTION_ENABLED !== "true"
    ) {
      throw new Error("Production legacy tagging is disabled");
    }
    if (args.confirmProduction !== args.institutionId) {
      throw new Error(
        "Production confirmation must exactly match the institution ID",
      );
    }
  }
  const repository = args.input
    ? new OfflineRepository(JSON.parse(readFileSync(args.input, "utf8")))
    : new FirestoreLegacyTagMigrationRepository();
  const plan = await new LegacyTagMigrationService(repository).run({
    reviewManifestId: args.reviewManifestId,
    institutionId: args.institutionId,
    documentPaths: args.documentPaths,
    projectId: actualProject,
    environment: targetEnvironment,
    apply: args.apply,
  });
  console.log(`mode=${plan.mode}`);
  console.log(`reviewManifestId=${plan.reviewManifestId}`);
  console.log(`institutionId=${plan.institutionId}`);
  console.log(`projectId=${plan.projectId}`);
  console.log(`total=${plan.totalCount}`);
  console.log(`updates=${plan.updateCount}`);
  console.log(`noops=${plan.noopCount}`);
  console.log(`blocked=${plan.blockedCount}`);
  for (const item of plan.items) {
    console.log(JSON.stringify(item));
  }
  if (plan.blockedCount > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
