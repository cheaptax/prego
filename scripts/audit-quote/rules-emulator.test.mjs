import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rules = readFileSync(path.join(root, "firestore.rules"), "utf8");
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST?.trim();

describe("audit-quote firestore rules (emulator)", {
  skip: !emulatorHost
    ? "Set FIRESTORE_EMULATOR_HOST and run Firebase Emulator to execute live rules assertions"
    : false,
}, () => {
  it("rejects unauthenticated client read/write against auditQuoteRequests", async () => {
    // Live emulator exercise: attempt REST access without auth token.
    // Emulator must be started with the repo firestore.rules loaded.
    const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "demo-audit-quote";
    const base = `http://${emulatorHost}/v1/projects/${projectId}/databases/(default)/documents`;
    const docPath = "auditQuoteRequests/rules-probe";

    const readRes = await fetch(`${base}/${docPath}`);
    assert.notEqual(readRes.status, 200);

    const writeRes = await fetch(`${base}/${docPath}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fields: {
          email: { stringValue: "should-not-persist@example.com" },
        },
      }),
    });
    assert.notEqual(writeRes.status, 200);

    // Ensure rules file still encodes deny-all for this collection.
    assert.match(rules, /match \/auditQuoteRequests\/\{requestId\}/);
    assert.match(rules, /allow read, write:\s*if false;/);
  });
});

describe("audit-quote firestore rules (static contract)", () => {
  it("keeps deny-all client access for intake collections", () => {
    for (const name of [
      "auditQuoteRequests",
      "auditQuoteIdempotency",
      "auditQuoteEmailDedup",
      "auditQuoteRateLimits",
      "auditQuoteNotifications",
    ]) {
      assert.match(rules, new RegExp(`match /${name}/`));
    }
    const matches = rules.match(/allow read, write:\s*if false;/g) ?? [];
    assert.ok(matches.length >= 5);
  });
});
