/**
 * Dry-run-first partner schema and unique-key migration.
 *
 * Default mode reports normalized partner fields and unique-key reservations.
 * Writes require both --apply and --confirm-production. The script is
 * idempotent and never deletes unknown legacy fields or partner documents.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const MIGRATION_ACTOR = "migration:partner-schema-v2";
const UNIQUE_COLLECTION = "partnerUniqueKeys";
const STATUSES = new Set(["pending", "active", "paused", "terminated"]);
const PROFESSIONS = new Set([
  "ACCOUNTANT",
  "TAX_ACCOUNTANT",
  "ATTORNEY",
  "JUDICIAL_SCRIVENER",
  "PATENT_ATTORNEY",
  "CUSTOMS_BROKER",
  "LABOR_ATTORNEY",
  "APPRAISER",
  "OTHER",
]);
const POINT_MIN = 30000;
const POINT_MAX = 100000;

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;
  const content = readFileSync(".env.local", "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    if (/PASSWORD|SECRET|TOKEN/.test(match[1])) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const expectedProjectIndex = args.indexOf("--expected-project");
  const expectedProject =
    expectedProjectIndex >= 0 ? args[expectedProjectIndex + 1] : undefined;
  if (
    expectedProjectIndex >= 0 &&
    (!expectedProject || expectedProject.startsWith("--"))
  ) {
    throw new Error("--expected-project requires a project ID value.");
  }
  return {
    help: args.includes("--help") || args.includes("-h"),
    apply: args.includes("--apply"),
    confirmProduction: args.includes("--confirm-production"),
    fillTestPlaceholders: args.includes("--fill-test-placeholders"),
    expectedProject:
      expectedProject?.trim() ||
      process.env.FIREBASE_MIGRATION_EXPECTED_PROJECT_ID?.trim() ||
      "",
  };
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizedUniqueValue(value) {
  return text(value).normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
}

function uniqueKeyId(kind, value) {
  const digest = createHash("sha256")
    .update(normalizedUniqueValue(value))
    .digest("hex");
  return `${kind}_${digest}`;
}

function normalizeStatus(value) {
  if (value === "suspended") return "paused";
  return STATUSES.has(value) ? value : "pending";
}

function normalizeProfession(value) {
  return PROFESSIONS.has(value) ? value : "OTHER";
}

function testBusinessRegistrationNumber(id) {
  const suffix =
    Number.parseInt(
      createHash("sha256").update(id).digest("hex").slice(0, 8),
      16,
    ) % 100000;
  return `000-00-${String(suffix).padStart(5, "0")}`;
}

function withoutUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
  );
}

function normalizePartner(id, data, now, options) {
  const name = text(data.name || data.displayName);
  const displayName = text(data.displayName || name);
  const createdAt = text(data.createdAt) || now;
  const updatedAt = text(data.updatedAt) || createdAt;
  const canFillTestPlaceholder =
    options.fillTestPlaceholders && /^test\d*$/i.test(name);
  const businessRegistrationNumber =
    text(
      data.businessRegistrationNumber ||
        data.businessNumber ||
        data.registrationNumber,
    ) ||
    (canFillTestPlaceholder ? testBusinessRegistrationNumber(id) : "");
  const businessAddress =
    text(data.businessAddress || data.officeAddress || data.address) ||
    (canFillTestPlaceholder
      ? "테스트용 제휴사 - 실제 견적 발행 금지"
      : "");
  return withoutUndefined({
    id,
    name,
    displayName,
    partnerType: text(data.partnerType) || "전문가",
    profession: normalizeProfession(data.profession),
    fields: Array.from(
      new Set(
        (Array.isArray(data.fields) ? data.fields : [])
          .map(text)
          .filter(Boolean),
      ),
    ),
    managerName: text(data.managerName),
    contactEmail: text(data.contactEmail || data.managerEmail).toLowerCase(),
    contactPhone: text(data.contactPhone || data.managerPhone),
    businessRegistrationNumber,
    businessAddress,
    status: normalizeStatus(data.status),
    pointMin: Number.isInteger(data.pointMin) ? data.pointMin : POINT_MIN,
    pointMax: Number.isInteger(data.pointMax) ? data.pointMax : POINT_MAX,
    memo: text(data.memo || data.notes),
    createdBy: text(data.createdBy) || MIGRATION_ACTOR,
    createdByEmail: text(data.createdByEmail) || undefined,
    createdAt,
    updatedBy: text(data.updatedBy || data.createdBy) || MIGRATION_ACTOR,
    updatedByEmail:
      text(data.updatedByEmail || data.createdByEmail) || undefined,
    updatedAt,
    statusChangedAt: text(data.statusChangedAt) || updatedAt,
    statusChangedBy:
      text(data.statusChangedBy || data.updatedBy || data.createdBy) ||
      MIGRATION_ACTOR,
    statusChangedByEmail:
      text(
        data.statusChangedByEmail ||
          data.updatedByEmail ||
          data.createdByEmail,
      ) || undefined,
  });
}

function changedFields(current, next) {
  return Object.keys(next).filter(
    (key) => JSON.stringify(current[key]) !== JSON.stringify(next[key]),
  );
}

loadLocalEnv();
const options = parseArgs(process.argv);
if (options.help) {
  console.log(`Partner schema migration

Options:
  --expected-project <id> Must match FIREBASE_PROJECT_ID
  --apply                 Apply normalized fields and unique-key reservations
  --confirm-production    Required together with --apply
  --fill-test-placeholders
                          Fill missing supplier fields only for names matching test/test1...
  --help

Default mode is dry-run. Unknown legacy fields are not deleted.
`);
  process.exit(0);
}
if (options.apply && !options.confirmProduction) {
  console.error("Refusing to write without --confirm-production.");
  process.exit(1);
}

const projectId = requiredEnv("FIREBASE_PROJECT_ID");
if (!options.expectedProject) {
  console.error(
    "Missing expected project. Pass --expected-project <id> or set FIREBASE_MIGRATION_EXPECTED_PROJECT_ID.",
  );
  process.exit(1);
}
if (options.expectedProject !== projectId) {
  console.error(
    `Project mismatch: expected=${options.expectedProject} actual=${projectId}. Aborting.`,
  );
  process.exit(1);
}
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId,
      clientEmail: requiredEnv("FIREBASE_CLIENT_EMAIL"),
      privateKey: requiredEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    }),
  });
}

const db = getFirestore();
const snapshot = await db.collection("partners").get();
const now = new Date().toISOString();
const rows = snapshot.docs.map((doc) => {
  const current = doc.data();
  const normalized = normalizePartner(doc.id, current, now, options);
  return {
    ref: doc.ref,
    current,
    normalized,
    changes: changedFields(current, normalized),
    invalidFields: [
      !normalized.name && "name",
      !normalized.displayName && "displayName",
      !normalized.partnerType && "partnerType",
      !normalized.managerName && "managerName",
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.contactEmail) &&
        "contactEmail",
      !/^\d{3}-?\d{2}-?\d{5}$/.test(
        normalized.businessRegistrationNumber,
      ) && "businessRegistrationNumber",
      !normalized.businessAddress && "businessAddress",
      normalized.fields.length === 0 && "fields",
    ].filter(Boolean),
    keys: {
      name: uniqueKeyId("name", normalized.name),
      contactEmail: uniqueKeyId(
        "contactEmail",
        normalized.contactEmail,
      ),
    },
  };
});

const keyOwners = new Map();
const conflicts = [];
for (const row of rows) {
  if (row.invalidFields.length > 0) continue;
  for (const [kind, key] of Object.entries(row.keys)) {
    const owner = keyOwners.get(key);
    if (owner && owner !== row.ref.id) {
      conflicts.push({ kind, key, partnerIds: [owner, row.ref.id] });
    } else {
      keyOwners.set(key, row.ref.id);
    }
  }
}

console.log(`mode=${options.apply ? "apply" : "dry-run"}`);
console.log(`projectId=${projectId}`);
console.log(`partnerDocuments=${rows.length}`);
console.log(`documentsWithChanges=${rows.filter((row) => row.changes.length).length}`);
console.log(`invalidDocuments=${rows.filter((row) => row.invalidFields.length).length}`);
console.log(`uniqueKeysPlanned=${keyOwners.size}`);
console.log(`conflicts=${conflicts.length}`);
for (const row of rows) {
  console.log(
    row.invalidFields.length
      ? `invalid partnerId=${row.ref.id} name=${JSON.stringify(row.normalized.name)} fields=${row.invalidFields.join(",")}`
      : row.changes.length
      ? `wouldUpdate partnerId=${row.ref.id} fields=${row.changes.join(",")}`
      : `unchanged partnerId=${row.ref.id}`,
  );
}
for (const conflict of conflicts) {
  console.error(
    `conflict kind=${conflict.kind} partnerIds=${conflict.partnerIds.join(",")}`,
  );
}
if (options.apply && conflicts.length > 0) {
  console.error("Refusing apply until duplicate partner keys are resolved.");
  process.exit(1);
}

const failures = [];
if (options.apply) {
  for (const row of rows) {
    if (row.invalidFields.length > 0) {
      failures.push({
        partnerId: row.ref.id,
        error: `invalid_fields:${row.invalidFields.join(",")}`,
      });
      console.error(`failed partnerId=${row.ref.id}`);
      continue;
    }
    try {
      await db.runTransaction(async (transaction) => {
        const keyEntries = Object.entries(row.keys);
        const keyRefs = keyEntries.map(([, key]) =>
          db.collection(UNIQUE_COLLECTION).doc(key),
        );
        const keySnapshots = await Promise.all(
          keyRefs.map((ref) => transaction.get(ref)),
        );
        for (const [index, keySnapshot] of keySnapshots.entries()) {
          if (
            keySnapshot.exists &&
            keySnapshot.data()?.partnerId !== row.ref.id
          ) {
            throw new Error(`unique_key_conflict:${keyEntries[index][0]}`);
          }
        }
        if (row.changes.length > 0) {
          transaction.set(row.ref, row.normalized, { merge: true });
        }
        for (const [index, [kind]] of keyEntries.entries()) {
          transaction.set(
            keyRefs[index],
            {
              kind,
              partnerId: row.ref.id,
              createdAt:
                keySnapshots[index].data()?.createdAt ?? now,
              updatedAt: now,
            },
            { merge: true },
          );
        }
      });
      console.log(`applied partnerId=${row.ref.id}`);
    } catch (error) {
      failures.push({
        partnerId: row.ref.id,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`failed partnerId=${row.ref.id}`);
    }
  }
}

console.log(`failures=${failures.length}`);
for (const failure of failures) {
  console.error(
    `failure partnerId=${failure.partnerId} error=${failure.error}`,
  );
}
if (failures.length > 0) process.exitCode = 1;
console.log("done");
