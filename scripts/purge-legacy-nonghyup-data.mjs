/**
 * One-time cleanup for the pre-launch @nonghyup.com dummy population.
 *
 * Default mode is read-only. Apply requires the exact checksum printed by the
 * dry run, so a changed dataset cannot be deleted accidentally.
 */
import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const DOMAIN = "nonghyup.com";
const MAX_SCANNED_DOCUMENTS = 50_000;
const CUSTOMER_DATA_COLLECTIONS = new Set([
  "users",
  "organizations",
  "memberships",
  "tenants",
  "testAuthSubjects",
  "pointLedger",
  "point_transactions",
  "consultRequests",
  "answers",
  "answerViews",
  "answerRatings",
  "partnerAssignments",
  "partnerAnswerDrafts",
  "quoteRequests",
  "quoteAssignments",
  "quotes",
  "quoteEmailDeliveries",
  "auditQuoteRequests",
  "auditQuoteIdempotency",
  "auditQuoteEmailDedup",
  "auditQuoteRateLimits",
  "auditQuoteNotifications",
  "auditEvaluationCases",
  "auditEvaluationCaseByQuoteRequest",
  "auditEvaluationAccessTokens",
  "auditEvaluationSessions",
  "auditEvaluationUploadIntents",
  "auditEvaluationDocuments",
  "auditEvaluationParsingQueue",
  "auditEvaluationExtractionRuns",
  "auditEvaluationCorrections",
  "auditEvaluationConfirmations",
  "auditEvaluationNormalizedQuotes",
  "auditEvaluationReportRuns",
  "auditEvaluationAuditLogs",
  "auditEvaluationRateLimits",
  "temporaryMemberActivations",
  "auditLogs",
]);
const REFERENCE_FIELDS = new Set([
  "uid",
  "user_id",
  "customerUid",
  "actorUid",
  "ownerUid",
  "primaryUserUid",
  "authUid",
  "requestId",
  "parentRequestId",
  "sourceId",
  "quoteRequestId",
  "quoteId",
  "assignmentId",
  "caseId",
  "emailHash",
]);
const STORAGE_FIELDS = new Set([
  "businessCardPath",
  "pdfPath",
  "storagePath",
  "quarantineStoragePath",
  "reportStoragePath",
  "viewModelStoragePath",
  "sealPath",
  "logoPath",
]);

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/gu, "");
  }
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const valueAfter = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1]?.trim() : "";
  };
  return {
    apply: args.includes("--apply"),
    expectedProject: valueAfter("--expected-project"),
    checksum: valueAfter("--checksum"),
  };
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isTargetEmail(value) {
  const email = normalizeEmail(value);
  const parts = email.split("@");
  return parts.length === 2 && parts[0] && parts[1] === DOMAIN;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function collectStrings(value, result = []) {
  if (typeof value === "string") {
    result.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, result);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, result);
  }
  return result;
}

function collectReferenceTokens(value, result = new Set()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [key, item] of Object.entries(value)) {
    if (REFERENCE_FIELDS.has(key)) {
      for (const text of collectStrings(item)) {
        const normalized = normalizeEmail(text);
        if (normalized.length >= 8) result.add(normalized);
      }
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      collectReferenceTokens(item, result);
    }
  }
  return result;
}

function collectStoragePaths(value, result = new Set()) {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    for (const item of value) collectStoragePaths(item, result);
    return result;
  }
  for (const [key, item] of Object.entries(value)) {
    if (STORAGE_FIELDS.has(key) && typeof item === "string" && item.trim()) {
      result.add(item.trim());
    }
    if (key === "attachments" && Array.isArray(item)) {
      for (const attachment of item) {
        if (
          attachment &&
          typeof attachment === "object" &&
          typeof attachment.path === "string"
        ) {
          result.add(attachment.path);
        }
      }
    }
    if (item && typeof item === "object") collectStoragePaths(item, result);
  }
  return result;
}

async function listAuthUsers(auth) {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1_000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

async function scanCollection(collection, documents, depth = 0) {
  const snapshot = await collection.get();
  for (const document of snapshot.docs) {
    documents.push({
      path: document.ref.path,
      id: document.id,
      collection: document.ref.parent.id,
      ref: document.ref,
      data: document.data(),
    });
    if (documents.length > MAX_SCANNED_DOCUMENTS) {
      throw new Error(`scan_limit_exceeded:${MAX_SCANNED_DOCUMENTS}`);
    }
    if (depth < 6) {
      for (const child of await document.ref.listCollections()) {
        await scanCollection(child, documents, depth + 1);
      }
    }
  }
}

async function scanAllDocuments(db) {
  const documents = [];
  for (const collection of await db.listCollections()) {
    await scanCollection(collection, documents);
  }
  return documents;
}

function buildPlan(authUsers, documents, pepper) {
  const targetAuthUsers = authUsers.filter((user) => isTargetEmail(user.email));
  const tokens = new Set();
  for (const user of targetAuthUsers) {
    const email = normalizeEmail(user.email);
    tokens.add(user.uid);
    tokens.add(user.uid.toLowerCase());
    tokens.add(email);
    tokens.add(sha256(email));
    if (pepper) tokens.add(createHmac("sha256", pepper).update(email).digest("hex"));
  }

  const selected = new Map();
  let changed = true;
  while (changed) {
    changed = false;
    for (const document of documents) {
      if (!CUSTOMER_DATA_COLLECTIONS.has(document.collection)) continue;
      if (selected.has(document.path)) continue;
      const values = collectStrings(document.data).map((value) =>
        normalizeEmail(value)
      );
      const pathTokens = document.path.split("/").map((value) =>
        normalizeEmail(value)
      );
      if (
        values.some((value) => isTargetEmail(value) || tokens.has(value)) ||
        pathTokens.some((value) => tokens.has(value))
      ) {
        selected.set(document.path, document);
        if (!["organizations", "tenants", "auditLogs"].includes(document.collection)) {
          tokens.add(document.id);
          tokens.add(document.id.toLowerCase());
        }
        for (const token of collectReferenceTokens(document.data)) {
          tokens.add(token);
        }
        changed = true;
      }
    }
  }

  const targetUids = new Set(targetAuthUsers.map((user) => user.uid));
  for (const document of selected.values()) {
    if (document.collection === "users") targetUids.add(document.id);
  }
  for (const document of selected.values()) {
    if (document.collection !== "testAuthSubjects") continue;
    const authUid = String(document.data.authUid ?? document.id);
    if (authUid) targetUids.add(authUid);
  }
  const targetAuth = authUsers.filter((user) => targetUids.has(user.uid));
  const sharedRootUpdates = [];
  const blockedResidualRoots = [];
  for (const document of selected.values()) {
    if (!["organizations", "tenants"].includes(document.collection)) continue;
    const updates = {};
    let hasRemainingMembers = false;
    for (const field of ["users", "userIds", "memberUids"]) {
      if (!Array.isArray(document.data[field])) continue;
      const remaining = document.data[field].filter(
        (value) => typeof value !== "string" || !targetUids.has(value),
      );
      updates[field] = remaining;
      if (remaining.length > 0) hasRemainingMembers = true;
    }
    if (hasRemainingMembers) {
      sharedRootUpdates.push({ path: document.path, ref: document.ref, updates });
      selected.delete(document.path);
      const simulated = { ...document.data, ...updates };
      if (
        collectStrings(simulated).some(
          (value) =>
            isTargetEmail(value) ||
            targetUids.has(value) ||
            targetUids.has(normalizeEmail(value)),
        )
      ) {
        blockedResidualRoots.push(document.path);
      }
    }
  }
  const storagePaths = new Set();
  for (const document of selected.values()) {
    collectStoragePaths(document.data, storagePaths);
  }
  const documentPaths = Array.from(selected.keys()).sort();
  const authUids = targetAuth.map((user) => user.uid).sort();
  const paths = Array.from(storagePaths).sort();
  const rootUpdates = sharedRootUpdates
    .map((update) => ({ path: update.path, updates: update.updates }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const checksum = sha256(
    JSON.stringify({ documentPaths, authUids, paths, rootUpdates }),
  );
  return {
    targetAuth,
    selected: Array.from(selected.values()),
    storagePaths: paths,
    sharedRootUpdates,
    blockedResidualRoots,
    targetUids: Array.from(targetUids),
    checksum,
  };
}

async function applyPlan(plan, db, auth, storage) {
  if (plan.blockedResidualRoots.length) {
    throw new Error("shared_customer_roots_retain_target_references");
  }
  for (const user of plan.targetAuth) {
    await auth.updateUser(user.uid, { disabled: true });
    await auth.revokeRefreshTokens(user.uid);
  }
  for (const path of plan.storagePaths) {
    await storage.bucket().file(path).delete({ ignoreNotFound: true });
  }
  const sortedDocuments = [...plan.selected].sort(
    (left, right) => right.path.split("/").length - left.path.split("/").length,
  );
  for (let index = 0; index < plan.sharedRootUpdates.length; index += 400) {
    const batch = db.batch();
    for (const update of plan.sharedRootUpdates.slice(index, index + 400)) {
      batch.update(update.ref, update.updates);
    }
    await batch.commit();
  }
  for (let index = 0; index < sortedDocuments.length; index += 400) {
    const batch = db.batch();
    for (const document of sortedDocuments.slice(index, index + 400)) {
      batch.delete(document.ref);
    }
    await batch.commit();
  }
  for (let index = 0; index < plan.targetAuth.length; index += 1_000) {
    await auth.deleteUsers(
      plan.targetAuth.slice(index, index + 1_000).map((user) => user.uid),
    );
  }
}

loadLocalEnv();
const args = parseArgs();
const projectId = requiredEnv("FIREBASE_PROJECT_ID");
if (!args.expectedProject || args.expectedProject !== projectId) {
  throw new Error(
    `Project mismatch: expected=${args.expectedProject || "<required>"} actual=${projectId}`,
  );
}
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId,
      clientEmail: requiredEnv("FIREBASE_CLIENT_EMAIL"),
      privateKey: requiredEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/gu, "\n"),
    }),
    storageBucket:
      process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim(),
  });
}

const auth = getAuth();
const db = getFirestore();
const storage = getStorage();
const [authUsers, documents] = await Promise.all([
  listAuthUsers(auth),
  scanAllDocuments(db),
]);
const plan = buildPlan(
  authUsers,
  documents,
  process.env.AUDIT_QUOTE_HASH_PEPPER?.trim() || "",
);
const targetCountsByCollection = Object.fromEntries(
  Object.entries(
    plan.selected.reduce((counts, document) => {
      counts[document.collection] = (counts[document.collection] ?? 0) + 1;
      return counts;
    }, {}),
  ).sort(([left], [right]) => left.localeCompare(right)),
);

console.log(
  JSON.stringify(
    {
      mode: args.apply ? "APPLY" : "DRY_RUN",
      projectId,
      scannedAuthUsers: authUsers.length,
      scannedFirestoreDocuments: documents.length,
      targetAuthUsers: plan.targetAuth.length,
      targetFirestoreDocuments: plan.selected.length,
      targetStorageObjects: plan.storagePaths.length,
      sharedRootUpdates: plan.sharedRootUpdates.length,
      blockedResidualRoots: plan.blockedResidualRoots,
      targetCountsByCollection,
      checksum: plan.checksum,
      confirmation:
        `--apply --checksum ${plan.checksum} --expected-project ${projectId}`,
    },
    null,
    2,
  ),
);

if (!args.apply) process.exit(0);
if (!args.checksum || args.checksum !== plan.checksum) {
  throw new Error("checksum_mismatch");
}
await applyPlan(plan, db, auth, storage);

const remainingAuth = (await listAuthUsers(auth)).filter((user) =>
  isTargetEmail(user.email)
);
const remainingDocuments = (await scanAllDocuments(db)).filter(
  (document) =>
    CUSTOMER_DATA_COLLECTIONS.has(document.collection) &&
    collectStrings(document.data).some(
      (value) =>
        isTargetEmail(value) ||
        plan.targetUids.includes(value) ||
        plan.targetUids.includes(normalizeEmail(value)),
    ),
);
if (remainingAuth.length || remainingDocuments.length) {
  throw new Error(
    `orphan_verification_failed:auth=${remainingAuth.length}:documents=${remainingDocuments.length}`,
  );
}
console.log("legacy-nonghyup-purge-completed");
