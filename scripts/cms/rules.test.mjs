import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const firestoreRules = readFileSync(path.join(root, "firestore.rules"), "utf8");
const storageRules = readFileSync(path.join(root, "storage.rules"), "utf8");
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST?.trim();
const storageEmulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST?.trim();

function parseHost(value, defaultPort) {
  const [host = "127.0.0.1", port = String(defaultPort)] = value.split(":");
  return { host, port: Number(port) };
}

describe("CMS rules static contract", () => {
  it("keeps public and private CMS Firestore collections physically separate", () => {
    assert.match(firestoreRules, /match \/cmsPublishedPages\/\{pageKey\}/);
    assert.match(firestoreRules, /match \/cmsDraftPages\/\{pageKey\}/);
    assert.match(firestoreRules, /match \/cmsPublishedGlobals\/\{documentKey\}/);
    assert.match(firestoreRules, /match \/cmsDraftGlobals\/\{documentKey\}/);
    assert.match(firestoreRules, /match \/cmsPageRevisions\/\{pageKey\}/);
    assert.match(firestoreRules, /match \/cmsGlobalRevisions\/\{documentKey\}/);
    assert.match(firestoreRules, /match \/cmsAuditLogs\/\{logId\}/);
    assert.match(firestoreRules, /match \/cmsAssets\/\{assetId\}/);
  });

  it("allows public reads only for published page/global content and blocks direct writes", () => {
    const publicBlocks = firestoreRules.match(
      /match \/cmsPublished(?:Pages|Globals)\/\{[^}]+\} \{[\s\S]*?allow read: if true;[\s\S]*?allow write: if false;[\s\S]*?\}/g,
    );
    assert.equal(publicBlocks?.length, 2);
    for (const name of [
      "cmsDraftPages",
      "cmsDraftGlobals",
      "cmsAuditLogs",
      "cmsAssets",
    ]) {
      assert.match(
        firestoreRules,
        new RegExp(
          `match /${name}/\\{[^}]+\\} \\{[\\s\\S]*?allow read: if isAdmin\\(\\);`,
        ),
      );
    }
  });

  it("separates published and draft storage paths with safe upload types", () => {
    assert.match(storageRules, /match \/cms\/published\/\{assetId\}\/\{fileName\}/);
    assert.match(storageRules, /allow read: if true;/);
    assert.match(storageRules, /allow write: if false;/);
    assert.match(storageRules, /match \/cms\/drafts\/\{assetId\}\/\{fileName\}/);
    assert.match(storageRules, /allow read: if isAdmin\(\);/);
    assert.doesNotMatch(storageRules, /image\/svg/);
    assert.doesNotMatch(storageRules, /text\/html/);
    assert.match(
      storageRules,
      /match \/business-cards\/\{userId\}\/\{fileName\} \{[\s\S]*?allow create:[\s\S]*?image\/jpeg\|image\/png\|image\/webp\|image\/gif\|application\/pdf[\s\S]*?allow update, delete: if false;/,
    );
  });

  it("keeps user approval, organizations, and point ledgers server-write only", () => {
    for (const name of ["users", "organizations", "pointLedger"]) {
      assert.match(
        firestoreRules,
        new RegExp(
          `match /${name}/\\{[^}]+\\} \\{[\\s\\S]*?allow create, update, delete: if false;`,
        ),
      );
    }
  });
});

describe("CMS Firestore rules emulator", {
  skip: !firestoreEmulatorHost
    ? "Set FIRESTORE_EMULATOR_HOST to execute live CMS Firestore rules tests"
    : false,
}, () => {
  let testEnv;

  before(async () => {
    const emulator = parseHost(firestoreEmulatorHost, 8080);
    testEnv = await initializeTestEnvironment({
      projectId: "demo-cms-firestore-rules",
      firestore: {
        ...emulator,
        rules: firestoreRules,
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, "cmsPublishedPages", "home"), {
          status: "published",
        }),
        setDoc(doc(db, "cmsDraftPages", "home"), { status: "draft" }),
        setDoc(doc(db, "cmsPublishedGlobals", "header"), {
          status: "published",
        }),
        setDoc(doc(db, "cmsDraftGlobals", "header"), { status: "draft" }),
        setDoc(
          doc(db, "cmsPageRevisions", "home", "revisions", "r1"),
          { status: "published" },
        ),
        setDoc(doc(db, "cmsAuditLogs", "a1"), { action: "published" }),
        setDoc(doc(db, "cmsAssets", "publicAsset"), {
          status: "published",
        }),
        setDoc(doc(db, "cmsAssets", "draftAsset"), { status: "draft" }),
        setDoc(doc(db, "users", "member-uid"), {
          status: "active",
          role: "member",
        }),
        setDoc(doc(db, "organizations", "org-1"), { pointBalance: 100 }),
        setDoc(doc(db, "pointLedger", "ledger-1"), {
          userId: "member-uid",
          points: 100,
        }),
      ]);
    });
  });

  after(async () => {
    await testEnv.cleanup();
  });

  it("lets guests read published pages and globals", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, "cmsPublishedPages", "home")));
    await assertSucceeds(getDoc(doc(db, "cmsPublishedGlobals", "header")));
  });

  it("blocks guests and members from draft, revision, audit, and asset metadata", async () => {
    for (const context of [
      testEnv.unauthenticatedContext(),
      testEnv.authenticatedContext("member-uid"),
    ]) {
      const db = context.firestore();
      await assertFails(getDoc(doc(db, "cmsDraftPages", "home")));
      await assertFails(getDoc(doc(db, "cmsDraftGlobals", "header")));
      await assertFails(
        getDoc(doc(db, "cmsPageRevisions", "home", "revisions", "r1")),
      );
      await assertFails(getDoc(doc(db, "cmsAuditLogs", "a1")));
      await assertFails(getDoc(doc(db, "cmsAssets", "publicAsset")));
      await assertFails(getDoc(doc(db, "cmsAssets", "draftAsset")));
    }
  });

  it("lets custom-claim admins read private CMS data but not write directly", async () => {
    const db = testEnv.authenticatedContext("admin-uid", { admin: true }).firestore();
    await assertSucceeds(getDoc(doc(db, "cmsDraftPages", "home")));
    await assertSucceeds(
      getDoc(doc(db, "cmsPageRevisions", "home", "revisions", "r1")),
    );
    await assertSucceeds(getDoc(doc(db, "cmsAuditLogs", "a1")));
    await assertSucceeds(getDoc(doc(db, "cmsAssets", "publicAsset")));
    await assertSucceeds(getDoc(doc(db, "cmsAssets", "draftAsset")));
    await assertFails(
      setDoc(doc(db, "cmsPublishedPages", "other"), { status: "published" }),
    );
    await assertFails(setDoc(doc(db, "cmsDraftPages", "other"), { status: "draft" }));
  });

  it("blocks member privilege escalation and ledger manipulation", async () => {
    const db = testEnv.authenticatedContext("member-uid").firestore();
    await assertFails(
      setDoc(
        doc(db, "users", "member-uid"),
        { status: "active", role: "admin" },
        { merge: true },
      ),
    );
    await assertFails(
      setDoc(
        doc(db, "organizations", "org-1"),
        { pointBalance: 1_000_000 },
        { merge: true },
      ),
    );
    await assertFails(
      setDoc(doc(db, "pointLedger", "member-created"), {
        userId: "member-uid",
        points: 1_000_000,
      }),
    );
  });
});

describe("CMS Storage rules emulator", {
  skip: !storageEmulatorHost
    ? "Set FIREBASE_STORAGE_EMULATOR_HOST to execute live CMS Storage rules tests"
    : false,
}, () => {
  let testEnv;

  before(async () => {
    const emulator = parseHost(storageEmulatorHost, 9199);
    testEnv = await initializeTestEnvironment({
      projectId: "demo-cms-storage-rules",
      storage: {
        ...emulator,
        rules: storageRules,
      },
    });
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await uploadBytes(
        ref(context.storage(), "cms/published/apublic/public.png"),
        new Uint8Array([1, 2, 3]),
        { contentType: "image/png" },
      );
    });
  });

  after(async () => {
    await testEnv.cleanup();
  });

  it("allows public published reads and admin-only safe draft creation", async () => {
    const guestStorage = testEnv.unauthenticatedContext().storage();
    const memberStorage = testEnv.authenticatedContext("member-uid").storage();
    const adminStorage = testEnv
      .authenticatedContext("admin-uid", { admin: true })
      .storage();
    await assertSucceeds(
      getBytes(ref(guestStorage, "cms/published/apublic/public.png")),
    );
    await assertFails(
      uploadBytes(
        ref(memberStorage, "cms/drafts/amember/member.png"),
        new Uint8Array([1]),
        { contentType: "image/png" },
      ),
    );
    await assertSucceeds(
      uploadBytes(
        ref(adminStorage, "cms/drafts/aadmin/admin.webp"),
        new Uint8Array([1]),
        { contentType: "image/webp" },
      ),
    );
    await assertFails(
      uploadBytes(
        ref(adminStorage, "cms/drafts/aunsafe/unsafe.svg"),
        new Uint8Array([1]),
        { contentType: "image/svg+xml" },
      ),
    );
  });

  it("allows one safe business-card upload and blocks unsafe or overwrite attempts", async () => {
    const ownerStorage = testEnv
      .authenticatedContext("member-uid")
      .storage();
    const safeRef = ref(
      ownerStorage,
      "business-cards/member-uid/card.png",
    );
    await assertSucceeds(
      uploadBytes(safeRef, new Uint8Array([1]), {
        contentType: "image/png",
      }),
    );
    await assertFails(
      uploadBytes(safeRef, new Uint8Array([2]), {
        contentType: "image/png",
      }),
    );
    await assertFails(
      uploadBytes(
        ref(ownerStorage, "business-cards/member-uid/card.svg"),
        new Uint8Array([1]),
        { contentType: "image/svg+xml" },
      ),
    );
  });
});
