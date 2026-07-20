import { cert, initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function privateKey() {
  return requiredEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n");
}

const ADMIN_EMAIL = requiredEnv("ADMIN_EMAIL").trim().toLowerCase();
const ADMIN_PASSWORD = requiredEnv("ADMIN_PASSWORD");
if (ADMIN_PASSWORD.length < 8) {
  throw new Error("ADMIN_PASSWORD must contain at least 8 characters");
}

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: requiredEnv("FIREBASE_PROJECT_ID"),
      clientEmail: requiredEnv("FIREBASE_CLIENT_EMAIL"),
      privateKey: privateKey(),
    }),
  });
}

const auth = getAuth();
const db = getFirestore();

let user;
try {
  user = await auth.getUserByEmail(ADMIN_EMAIL);
  const update = {
    emailVerified: true,
    displayName: "관리자",
    disabled: false,
  };
  update.password = ADMIN_PASSWORD;
  await auth.updateUser(user.uid, update);
} catch {
  const create = {
    email: ADMIN_EMAIL,
    emailVerified: true,
    displayName: "관리자",
    disabled: false,
  };
  create.password = ADMIN_PASSWORD;
  user = await auth.createUser(create);
}

await auth.setCustomUserClaims(user.uid, { admin: true });
await db.collection("users").doc(user.uid).set(
  {
    uid: user.uid,
    email: ADMIN_EMAIL,
    name: "관리자",
    role: "admin",
    status: "active",
    updatedAt: new Date().toISOString(),
  },
  { merge: true }
);

console.log(`Admin user ready: uid=${user.uid}`);
