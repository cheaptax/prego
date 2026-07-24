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
const emulatorProjectId =
  process.env.GCLOUD_PROJECT?.trim() ||
  process.env.FIREBASE_PROJECT_ID?.trim() ||
  "demo-cms-local";

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

  it("uses accountStatus for active gates and keeps administration internals server-only", () => {
    assert.match(firestoreRules, /function isActiveAccount\(user\)/);
    assert.match(storageRules, /function isActiveAccount\(user\)/);
    assert.match(
      firestoreRules,
      /'accountStatus' in user[\s\S]*?user\.accountStatus == 'active'/,
    );
    assert.match(
      firestoreRules,
      /match \/users\/\{userId\} \{[\s\S]*?request\.auth\.uid == userId[\s\S]*?allow create, update, delete: if false;/,
    );
    assert.doesNotMatch(
      firestoreRules,
      /allow read: if isAdmin\(\) \|\| \(signedIn\(\) && request\.auth\.uid == userId\);/,
    );
    for (const name of ["auditLogs", "partnerUniqueKeys"]) {
      assert.match(
        firestoreRules,
        new RegExp(
          `match /${name}/\\{[^}]+\\} \\{[\\s\\S]*?allow read, write: if false;`,
        ),
      );
    }
    assert.match(
      firestoreRules,
      /match \/consultRequests\/\{requestId\} \{[\s\S]*?allow create, update, delete: if false;/,
    );
    assert.match(
      storageRules,
      /match \/consult-attachments\/\{allPaths=\*\*\} \{[\s\S]*?allow write: if false;/,
    );
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
      projectId: emulatorProjectId,
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
        setDoc(doc(db, "users", "admin-uid"), {
          status: "active",
          accountStatus: "active",
          role: "admin",
        }),
        setDoc(doc(db, "users", "inactive-admin-uid"), {
          status: "active",
          accountStatus: "disabled",
          role: "admin",
        }),
        setDoc(doc(db, "users", "partner-a-uid"), {
          status: "active",
          accountStatus: "active",
          role: "partner",
          partnerId: "partner-a",
        }),
        setDoc(doc(db, "users", "partner-inactive-uid"), {
          status: "active",
          accountStatus: "suspended",
          role: "partner",
          partnerId: "partner-a",
        }),
        setDoc(doc(db, "partners", "partner-a"), {
          status: "active",
          displayName: "Partner A",
        }),
        setDoc(doc(db, "partners", "partner-b"), {
          status: "active",
          displayName: "Partner B",
        }),
        setDoc(doc(db, "partnerAssignments", "assignment-a"), {
          partnerId: "partner-a",
          status: "assigned",
        }),
        setDoc(doc(db, "partnerAssignments", "assignment-b"), {
          partnerId: "partner-b",
          status: "assigned",
        }),
        setDoc(doc(db, "auditLogs", "audit-1"), {
          action: "operator.updated",
        }),
        setDoc(doc(db, "partnerUniqueKeys", "key-1"), {
          partnerId: "partner-a",
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

  it("blocks inactive or role-mismatched custom-claim administrators", async () => {
    for (const uid of ["inactive-admin-uid", "member-uid"]) {
      const db = testEnv.authenticatedContext(uid, { admin: true }).firestore();
      await assertFails(getDoc(doc(db, "cmsDraftPages", "home")));
      await assertFails(getDoc(doc(db, "cmsAuditLogs", "a1")));
    }
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

  it("isolates partner reads and blocks inactive partner accounts", async () => {
    const partnerDb = testEnv
      .authenticatedContext("partner-a-uid", { partner: true })
      .firestore();
    await assertSucceeds(getDoc(doc(partnerDb, "partners", "partner-a")));
    await assertFails(getDoc(doc(partnerDb, "partners", "partner-b")));
    await assertSucceeds(
      getDoc(doc(partnerDb, "partnerAssignments", "assignment-a")),
    );
    await assertFails(
      getDoc(doc(partnerDb, "partnerAssignments", "assignment-b")),
    );
    await assertFails(
      setDoc(
        doc(partnerDb, "partners", "partner-a"),
        { status: "terminated" },
        { merge: true },
      ),
    );

    const inactiveDb = testEnv
      .authenticatedContext("partner-inactive-uid", { partner: true })
      .firestore();
    await assertFails(getDoc(doc(inactiveDb, "partners", "partner-a")));
    await assertFails(
      getDoc(doc(inactiveDb, "partnerAssignments", "assignment-a")),
    );
  });

  it("blocks client access to server-only administration collections", async () => {
    const adminDb = testEnv
      .authenticatedContext("admin-uid", { admin: true })
      .firestore();
    await assertFails(getDoc(doc(adminDb, "users", "member-uid")));
    await assertFails(getDoc(doc(adminDb, "auditLogs", "audit-1")));
    await assertFails(getDoc(doc(adminDb, "partnerUniqueKeys", "key-1")));
    await assertFails(
      setDoc(doc(adminDb, "partnerUniqueKeys", "client-key"), {
        partnerId: "partner-a",
      }),
    );
  });
});

describe("CMS Storage rules emulator", {
  skip: !storageEmulatorHost || !firestoreEmulatorHost
    ? "Set FIREBASE_STORAGE_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST to execute live CMS Storage rules tests"
    : false,
}, () => {
  let testEnv;

  before(async () => {
    const emulator = parseHost(storageEmulatorHost, 9199);
    const firestoreEmulator = parseHost(firestoreEmulatorHost, 8080);
    testEnv = await initializeTestEnvironment({
      projectId: emulatorProjectId,
      firestore: {
        ...firestoreEmulator,
        rules: firestoreRules,
      },
      storage: {
        ...emulator,
        rules: storageRules,
      },
    });
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await uploadBytes(
        ref(context.storage(), "cms/published/apublic/public.png"),
        new Uint8Array([1, 2, 3]),
        { contentType: "image/png" },
      );
      await uploadBytes(
        ref(context.storage(), "consult-attachments/request-1/file.pdf"),
        new Uint8Array([1, 2, 3]),
        { contentType: "application/pdf" },
      );
      await Promise.all([
        setDoc(doc(db, "users", "admin-uid"), {
          role: "admin",
          status: "active",
          accountStatus: "active",
        }),
        setDoc(doc(db, "users", "inactive-admin-uid"), {
          role: "admin",
          status: "active",
          accountStatus: "disabled",
        }),
        setDoc(doc(db, "users", "partner-uid"), {
          role: "partner",
          status: "active",
          accountStatus: "active",
          partnerId: "partner-a",
        }),
      ]);
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

  it("uses accountStatus for admin storage access and blocks partner attachments", async () => {
    const activeAdmin = testEnv
      .authenticatedContext("admin-uid", { admin: true })
      .storage();
    const inactiveAdmin = testEnv
      .authenticatedContext("inactive-admin-uid", { admin: true })
      .storage();
    const partner = testEnv
      .authenticatedContext("partner-uid", { partner: true })
      .storage();
    await assertSucceeds(
      getBytes(
        ref(activeAdmin, "consult-attachments/request-1/file.pdf"),
      ),
    );
    await assertFails(
      getBytes(
        ref(inactiveAdmin, "consult-attachments/request-1/file.pdf"),
      ),
    );
    await assertFails(
      getBytes(ref(partner, "consult-attachments/request-1/file.pdf")),
    );
  });
});
