/**
 * Read-only customer graph scan and purge manifest generator.
 *
 * This command never mutates Firestore, Firebase Auth, or Storage.
 * --apply is intentionally rejected.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { FirestorePurgeScanDataSource } from "../../lib/test-data/purge-firestore-source.ts";
import { PurgeScanService } from "../../lib/test-data/purge-scan-service.ts";

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;
  const content = readFileSync(".env.local", "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return "";
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value.trim();
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.includes("--apply")) {
    throw new Error(
      "--apply is not implemented. STEP 4 supports SCAN and DRY_RUN only.",
    );
  }
  return {
    help: args.includes("--help") || args.includes("-h"),
    mode: args.includes("--dry-run") ? "DRY_RUN" : "SCAN",
    institutionId: readOption(args, "--institution-id"),
    generatedBy: readOption(args, "--generated-by"),
    expectedProject: readOption(args, "--expected-project"),
    output: readOption(args, "--output"),
    productionConfirmation: readOption(args, "--confirm-production"),
  };
}

function help() {
  console.log(`Test data graph scan and purge manifest

Default mode: SCAN (read-only)

Options:
  --institution-id <id>          Required target cooperative ID
  --dry-run                      Build an exact DRY_RUN manifest
  --generated-by <uid>           Required manifest creator identifier
  --expected-project <id>        Required exact Firebase project ID
  --output <path>                Local JSON path (default: .artifacts/test-data-manifests/<manifestId>.json)
  --confirm-production <id>      Required exact institution ID in production
  --apply                        Rejected; deletion is not implemented

Production additionally requires:
  TEST_DATA_SCAN_PRODUCTION_ENABLED=true
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

function validate(args) {
  if (!args.institutionId) throw new Error("--institution-id is required");
  if (!args.generatedBy) throw new Error("--generated-by is required");
  if (!args.expectedProject) throw new Error("--expected-project is required");
  const actualProject = projectId();
  if (!actualProject) throw new Error("Firebase project ID is unavailable");
  if (actualProject !== args.expectedProject) {
    throw new Error("Expected project ID does not match the target project");
  }
  if (environment() === "production") {
    if (process.env.TEST_DATA_SCAN_PRODUCTION_ENABLED !== "true") {
      throw new Error("Production scan is disabled");
    }
    if (args.productionConfirmation !== args.institutionId) {
      throw new Error(
        "Production confirmation must exactly match the institution ID",
      );
    }
  }
}

function saveManifest(manifest, requestedPath) {
  const outputPath = resolve(
    requestedPath ||
      `.artifacts/test-data-manifests/${manifest.manifestId}.json`,
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  if (existsSync(outputPath)) {
    const existing = JSON.parse(readFileSync(outputPath, "utf8"));
    if (existing.checksum !== manifest.checksum) {
      throw new Error("Refusing to overwrite a manifest with another checksum");
    }
    return { outputPath, reused: true };
  }
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return { outputPath, reused: false };
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv);
  if (args.help) {
    help();
    return;
  }
  validate(args);
  console.log(`mode=${args.mode}`);
  console.log(`environment=${environment()}`);
  console.log(`projectId=${projectId()}`);
  console.log(`institutionId=${args.institutionId}`);

  const manifest = await new PurgeScanService(
    new FirestorePurgeScanDataSource(),
  ).scan({
    institutionId: args.institutionId,
    mode: args.mode,
    generatedBy: args.generatedBy,
    environment: environment(),
    projectId: projectId(),
  });
  const saved = saveManifest(manifest, args.output);
  console.log(`manifestId=${manifest.manifestId}`);
  console.log(`status=${manifest.executionStatus}`);
  console.log(`confirmedTargets=${manifest.totalTargetCount}`);
  console.log(`blockedReasons=${manifest.blockedReasons.length}`);
  console.log(`manifestArtifact=${saved.outputPath}`);
  console.log(`artifactReused=${saved.reused}`);
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Purge scan failed",
  );
  process.exitCode = 1;
});
