import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, describe, it } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  DEMO_COOPERATIVE_COLLECTION,
  DUNGGI_COOPERATIVE_ID,
  DUNGGI_COOPERATIVE_INTERNAL_CODE,
} from "../../lib/cooperatives/demo-cooperative.ts";

const PROJECT_ID = "demo-dunggi-local";
const app = initializeApp({ projectId: PROJECT_ID }, "demo-dunggi-seed-test");
const db = getFirestore(app);
const documentRef = db
  .collection(DEMO_COOPERATIVE_COLLECTION)
  .doc(DUNGGI_COOPERATIVE_ID);

function runSeed(...args) {
  return execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "scripts/demo-cooperative/seed-dunggi.mjs",
      "--expected-project",
      PROJECT_ID,
      ...args,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FIREBASE_PROJECT_ID: PROJECT_ID,
        GCLOUD_PROJECT: PROJECT_ID,
      },
      encoding: "utf8",
    },
  );
}

before(async () => {
  assert.ok(
    process.env.FIRESTORE_EMULATOR_HOST,
    "FIRESTORE_EMULATOR_HOST is required",
  );
  await documentRef.delete();
});

after(async () => {
  await documentRef.delete();
  await deleteApp(app);
});

describe("둥기농협 seed against Firestore Emulator", () => {
  it("dry-runs, creates once, and preserves usage fields on reapply", async () => {
    const dryRunOutput = runSeed();
    assert.match(dryRunOutput, /Mode: dry-run \(no writes\)/);
    assert.match(dryRunOutput, /"action": "create"/);
    assert.equal((await documentRef.get()).exists, false);

    const firstApplyOutput = runSeed("--apply");
    assert.match(firstApplyOutput, /Seed complete: action=create/);
    const firstSnapshot = await documentRef.get();
    assert.equal(firstSnapshot.exists, true);
    assert.equal(firstSnapshot.data()?.signupStatus, "AVAILABLE");

    await documentRef.set(
      {
        cooperativeName: "보정 전 이름",
        signupStatus: "REGISTERED",
        registeredAt: "2026-07-22T13:00:00.000Z",
        registeredBy: "demo-user",
        usageMarker: "keep-me",
      },
      { merge: true },
    );

    const secondApplyOutput = runSeed("--apply");
    assert.match(secondApplyOutput, /Seed complete: action=update/);
    assert.match(secondApplyOutput, /signupStatus/);

    const finalSnapshot = await documentRef.get();
    const finalData = finalSnapshot.data();
    assert.equal(finalData?.cooperativeName, "둥기농협");
    assert.equal(finalData?.signupStatus, "REGISTERED");
    assert.equal(finalData?.registeredAt, "2026-07-22T13:00:00.000Z");
    assert.equal(finalData?.registeredBy, "demo-user");
    assert.equal(finalData?.usageMarker, "keep-me");

    const matchingDocuments = await db
      .collection(DEMO_COOPERATIVE_COLLECTION)
      .where("internalCode", "==", DUNGGI_COOPERATIVE_INTERNAL_CODE)
      .get();
    assert.equal(matchingDocuments.size, 1);
    assert.equal(matchingDocuments.docs[0].id, DUNGGI_COOPERATIVE_ID);
  });
});
