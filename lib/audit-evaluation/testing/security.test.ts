import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";
import { AUDIT_EVALUATION_COLLECTIONS } from "@/lib/audit-evaluation/collections";
import { AUDIT_EVALUATION_STORAGE_PREFIXES } from "@/lib/audit-evaluation/upload-identity";

describe("audit-evaluation Firestore rules contract", () => {
  it("keeps every evaluation collection server-only", () => {
    const rules = readFileSync(
      join(process.cwd(), "firestore.rules"),
      "utf8",
    );
    for (const collection of Object.values(
      AUDIT_EVALUATION_COLLECTIONS,
    )) {
      assert.match(
        rules,
        new RegExp(
          `match /${collection}/\\{[^}]+\\} \\{\\s*allow read, write: if false;`,
        ),
      );
    }
    for (const collection of [
      "quoteRequests",
      "quoteAssignments",
      "quotes",
      "quoteEmailDeliveries",
    ]) {
      assert.match(
        rules,
        new RegExp(
          `match /${collection}/\\{[^}]+\\} \\{\\s*allow read, write: if false;`,
        ),
      );
    }
  });
});

describe("audit-evaluation Storage rules contract", () => {
  it("keeps originals, quarantine, reports and temporary files private", () => {
    const rules = readFileSync(
      join(process.cwd(), "storage.rules"),
      "utf8",
    );
    for (const prefix of Object.values(
      AUDIT_EVALUATION_STORAGE_PREFIXES,
    )) {
      assert.match(
        rules,
        new RegExp(
          `match /${prefix}/\\{allPaths=\\*\\*\\} \\{\\s*allow read, write: if false;`,
        ),
      );
    }
    assert.match(
      rules,
      /match \/quotes\/\{allPaths=\*\*\} \{\s*allow read, write: if false;/u,
    );
  });
});

const firestoreEmulatorHost =
  process.env.FIRESTORE_EMULATOR_HOST?.trim();
const storageEmulatorHost =
  process.env.FIREBASE_STORAGE_EMULATOR_HOST?.trim();

describe("audit-evaluation attack scenarios in Firebase Emulator", {
  skip: !firestoreEmulatorHost || !storageEmulatorHost
    ? "Firestore and Storage emulators are required"
    : false,
}, () => {
  let testEnv: RulesTestEnvironment;

  before(async () => {
    const firestore = parseHost(firestoreEmulatorHost!, 8080);
    const storage = parseHost(storageEmulatorHost!, 9199);
    testEnv = await initializeTestEnvironment({
      projectId: "demo-audit-evaluation-security",
      firestore: {
        ...firestore,
        rules: readFileSync(
          join(process.cwd(), "firestore.rules"),
          "utf8",
        ),
      },
      storage: {
        ...storage,
        rules: readFileSync(
          join(process.cwd(), "storage.rules"),
          "utf8",
        ),
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, "users", "admin-active"), {
          role: "admin",
          status: "active",
        }),
        setDoc(doc(db, "users", "admin-inactive"), {
          role: "admin",
          status: "rejected",
        }),
        setDoc(doc(db, "auditEvaluationCases", "case-a"), {
          owner: "customer-a",
          totalScore: 50,
        }),
        setDoc(doc(db, "auditEvaluationCases", "case-b"), {
          owner: "customer-b",
          totalScore: 80,
        }),
        setDoc(doc(db, "auditEvaluationConfigVersions", "config-1"), {
          status: "PUBLISHED",
        }),
        setDoc(doc(db, "cmsDraftPages", "home"), {
          status: "draft",
        }),
        setDoc(doc(db, "quoteRequests", "request-b"), {
          customerUid: "customer-b",
        }),
        setDoc(doc(db, "quoteAssignments", "assignment-b"), {
          partnerId: "partner-b",
        }),
        setDoc(doc(db, "quotes", "quote-b"), {
          quoteRequestId: "request-b",
          partnerId: "partner-b",
        }),
        setDoc(doc(db, "quoteEmailDeliveries", "delivery-b"), {
          quoteId: "quote-b",
        }),
      ]);
      await uploadBytes(
        ref(
          context.storage(),
          "audit-evaluation/reports/case-b/v1/report.pdf",
        ),
        new Uint8Array([37, 80, 68, 70]),
        { contentType: "application/pdf" },
      );
      await uploadBytes(
        ref(context.storage(), "quotes/quote-b/v1/quote.pdf"),
        new Uint8Array([37, 80, 68, 70]),
        { contentType: "application/pdf" },
      );
      await uploadBytes(
        ref(
          context.storage(),
          "audit-evaluation/originals/case-b/document-b/source.pdf",
        ),
        new Uint8Array([37, 80, 68, 70]),
        { contentType: "application/pdf" },
      );
    });
  });

  after(async () => {
    await testEnv.cleanup();
  });

  it("blocks A cooperative from guessing B cooperative caseId", async () => {
    const db = testEnv
      .authenticatedContext("customer-a", { cooperativeId: "a" })
      .firestore();
    await assertFails(getDoc(doc(db, "auditEvaluationCases", "case-b")));
  });

  it("blocks customers from changing scores or published criteria", async () => {
    const db = testEnv.authenticatedContext("customer-a").firestore();
    await assertFails(
      updateDoc(doc(db, "auditEvaluationCases", "case-a"), {
        totalScore: 100,
      }),
    );
    await assertFails(
      updateDoc(
        doc(db, "auditEvaluationConfigVersions", "config-1"),
        { status: "DRAFT" },
      ),
    );
  });

  it("blocks direct customer and partner access to quote-domain documents", async () => {
    const customer = testEnv.authenticatedContext("customer-b").firestore();
    const partner = testEnv
      .authenticatedContext("partner-b", {
        partner: true,
        partnerId: "partner-b",
      })
      .firestore();
    for (const [collection, documentId] of [
      ["quoteRequests", "request-b"],
      ["quoteAssignments", "assignment-b"],
      ["quotes", "quote-b"],
      ["quoteEmailDeliveries", "delivery-b"],
    ] as const) {
      await assertFails(getDoc(doc(customer, collection, documentId)));
      await assertFails(getDoc(doc(partner, collection, documentId)));
    }
  });

  it("requires both an active admin profile and admin claim for private reads", async () => {
    const active = testEnv
      .authenticatedContext("admin-active", { admin: true })
      .firestore();
    const inactive = testEnv
      .authenticatedContext("admin-inactive", { admin: true })
      .firestore();
    await getDoc(doc(active, "cmsDraftPages", "home"));
    await assertFails(getDoc(doc(inactive, "cmsDraftPages", "home")));
    await assertFails(
      getDoc(doc(active, "auditEvaluationCases", "case-a")),
    );
  });

  it("blocks direct report and cross-case original Storage access", async () => {
    const storage = testEnv.authenticatedContext("customer-a").storage();
    await assertFails(
      getBytes(
        ref(storage, "audit-evaluation/reports/case-b/v1/report.pdf"),
      ),
    );
    await assertFails(
      getBytes(
        ref(
          storage,
          "audit-evaluation/originals/case-b/document-b/source.pdf",
        ),
      ),
    );
    await assertFails(
      uploadBytes(
        ref(
          storage,
          "audit-evaluation/quarantine/case-a/intent/source.exe",
        ),
        new Uint8Array([1]),
        { contentType: "application/x-msdownload" },
      ),
    );
    await assertFails(
      getBytes(ref(storage, "quotes/quote-b/v1/quote.pdf")),
    );
  });
});

function parseHost(value: string, defaultPort: number) {
  const [host = "127.0.0.1", port = String(defaultPort)] = value.split(":");
  return { host, port: Number(port) };
}
