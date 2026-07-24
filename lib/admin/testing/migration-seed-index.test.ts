import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const adminMigration = read("scripts/migrate-admin-rbac.mjs");
const partnerMigration = read("scripts/migrate-partners.mjs");
const seed = read("scripts/seed-admin.mjs");
const readiness = read("scripts/check-admin-ready.mjs");
const indexes = JSON.parse(read("firestore.indexes.json")) as {
  indexes: Array<{
    collectionGroup: string;
    fields: Array<{ fieldPath: string; order: string }>;
  }>;
};

describe("STEP 8 migration, seed, and index safety", () => {
  it("keeps only the composite index required by live assignment queries", () => {
    assert.deepEqual(
      indexes.indexes.map((index) => ({
        collectionGroup: index.collectionGroup,
        fields: index.fields.map((field) => field.fieldPath),
      })),
      [
        {
          collectionGroup: "partnerAssignments",
          fields: ["requestId", "status"],
        },
      ],
    );
    assert.match(
      read("app/api/partner/assignments/route.ts"),
      /\.where\("partnerId", "==", partnerId\)[\s\S]*?\.filter\(\(item\) => item\.status !== "revoked"\)/,
    );
    assert.match(
      read("app/api/admin/requests/[requestId]/partner-assignment/route.ts"),
      /\.where\("requestId", "==", requestId\)[\s\S]*?\.where\("status", "!=", "revoked"\)/,
    );
  });

  it("keeps both migrations dry-run-first and project-bound", () => {
    for (const source of [adminMigration, partnerMigration]) {
      assert.match(source, /Default mode is dry-run/);
      assert.match(source, /args\.includes\("--apply"\)/);
      assert.match(source, /args\.includes\("--confirm-production"\)/);
      assert.match(source, /--expected-project/);
      assert.match(source, /FIREBASE_MIGRATION_EXPECTED_PROJECT_ID/);
      assert.match(source, /Project mismatch:/);
      assert.match(source, /projectId=/);
    }
  });

  it("reports migration targets, changes, failures, and repeat-safe writes", () => {
    assert.match(adminMigration, /adminProfiles=/);
    assert.match(adminMigration, /missingAdminRole=/);
    assert.match(adminMigration, /beforeAdminRole=\(missing\) afterAdminRole=/);
    assert.match(adminMigration, /applied=/);
    assert.match(adminMigration, /failures=/);
    assert.match(adminMigration, /\{ merge: true \}/);
    assert.match(partnerMigration, /partnerDocuments=/);
    assert.match(partnerMigration, /documentsWithChanges=/);
    assert.match(partnerMigration, /conflicts=/);
    assert.match(partnerMigration, /failures=/);
    assert.match(partnerMigration, /runTransaction/);
  });

  it("does not print migration or seed passwords and tokens", () => {
    for (const source of [adminMigration, partnerMigration, seed]) {
      assert.doesNotMatch(
        source,
        /console\.(?:log|error|warn)\([^)]*(?:adminPassword|privateKey|FIREBASE_PRIVATE_KEY)/,
      );
    }
    assert.doesNotMatch(seed, /console\.log\(`email=/);
    assert.doesNotMatch(seed, /console\.log\(`uid=/);
    assert.doesNotMatch(seed, /console\.log\(`customClaims=/);
    assert.match(adminMigration, /if \(match\[1\] === "ADMIN_PASSWORD"\) continue/);
    assert.match(partnerMigration, /\/PASSWORD\|SECRET\|TOKEN\//);
  });

  it("preserves existing seeded roles and passwords unless reset is explicit", () => {
    assert.match(seed, /resetPassword: args\.includes\("--reset-password"\)/);
    assert.match(
      seed,
      /if \(options\.resetPassword\) authUpdate\.password = adminPassword/,
    );
    assert.match(seed, /validAdminRoles\.has\(previousProfile\.adminRole\)/);
    assert.match(seed, /accountStatus: "active"/);
    assert.match(seed, /adminCapabilityAllow: Array\.isArray/);
    assert.match(seed, /adminCapabilityDeny: Array\.isArray/);
  });

  it("checks Auth, claims, role, and canonical account status read-only", () => {
    assert.match(readiness, /getUserByEmail/);
    assert.match(readiness, /claims\.admin === true/);
    assert.match(readiness, /accountStatus \?\? status/);
    assert.match(readiness, /adminRole === "super_admin"/);
    assert.doesNotMatch(readiness, /console\.log\(`email=/);
    assert.doesNotMatch(readiness, /console\.log\(`uid=/);
    assert.doesNotMatch(readiness, /legacy missing|treated as super_admin/);
    assert.doesNotMatch(readiness, /\.set\(|updateUser|createUser/);
  });
});
