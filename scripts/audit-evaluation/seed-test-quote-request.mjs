/**
 * Seed a delivered audit quote request for local evaluation access testing.
 * Usage:
 *   node --import tsx --env-file=.env.local scripts/audit-evaluation/seed-test-quote-request.mjs jason@nonghyup.com
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  AUDIT_QUOTE_EMAIL_DEDUP,
  AUDIT_QUOTE_REQUESTS,
  emailDedupDocId,
} from "../../lib/audit-quote/collections.ts";

const email = (process.argv[2] || "jason@nonghyup.com").trim().toLowerCase();
const pepper = process.env.AUDIT_QUOTE_HASH_PEPPER?.trim();
if (!pepper || pepper.length < 16) {
  throw new Error("AUDIT_QUOTE_HASH_PEPPER is required");
}

const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
if (!projectId || !clientEmail || !privateKey) {
  throw new Error("Firebase Admin env is required");
}

if (!getApps().length) {
  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

const db = getFirestore();
const emailHash = createHmac("sha256", pepper).update(email, "utf8").digest("hex");
const campaign = "fy27";
const existing = await db
  .collection(AUDIT_QUOTE_REQUESTS)
  .where("emailHash", "==", emailHash)
  .limit(1)
  .get();

if (!existing.empty) {
  const doc = existing.docs[0];
  const data = doc.data();
  console.log({
    seeded: false,
    requestId: doc.id,
    email: data.email,
    status: data.status,
    publicReference: data.publicReference,
  });
  process.exit(0);
}

const requestRef = db.collection(AUDIT_QUOTE_REQUESTS).doc();
const token = randomBytes(2).toString("hex").toUpperCase();
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const publicReference = `AQ-${stamp}-${token}`;
const now = FieldValue.serverTimestamp();

await db.runTransaction(async (transaction) => {
  transaction.set(requestRef, {
    schemaVersion: 2,
    requestId: requestRef.id,
    publicReference,
    email,
    emailHash,
    status: "delivered",
    quoteCount: 0,
    privacyPolicyVersion: "privacy-v1",
    marketingConsent: false,
    campaign,
    channel: "web",
    pagePath: "/events/audit-quote",
    idempotencyKeyHash: createHmac("sha256", pepper)
      .update(randomUUID(), "utf8")
      .digest("hex"),
    contactName: "테스트담당자",
    phone: "010-1234-5678",
    assignedTo: null,
    agreedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  transaction.set(
    db.collection(AUDIT_QUOTE_EMAIL_DEDUP).doc(emailDedupDocId(campaign, emailHash)),
    {
      requestId: requestRef.id,
      publicReference,
      emailHash,
      campaign,
      createdAtMs: Date.now(),
    },
  );
});

console.log({
  seeded: true,
  requestId: requestRef.id,
  email,
  publicReference,
  status: "delivered",
});
