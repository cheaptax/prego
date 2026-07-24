import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

function getPrivateKey() {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  return privateKey?.trim().replace(/\\n/g, "\n");
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function getFirebaseAdminApp() {
  if (getApps().length) return getApps()[0];
  if (
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    process.env.FIREBASE_STORAGE_EMULATOR_HOST
  ) {
    return initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID?.trim() ||
        process.env.GCLOUD_PROJECT?.trim() ||
        "demo-local",
      storageBucket: optionalEnv(
        "FIREBASE_STORAGE_BUCKET",
        "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"
      ),
    });
  }

  return initializeApp({
    credential: cert({
      projectId: requiredEnv("FIREBASE_PROJECT_ID"),
      clientEmail: requiredEnv("FIREBASE_CLIENT_EMAIL"),
      privateKey: getPrivateKey() ?? requiredEnv("FIREBASE_PRIVATE_KEY"),
    }),
    storageBucket: optionalEnv(
      "FIREBASE_STORAGE_BUCKET",
      "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"
    ),
  });
}

export const adminAuth = () => getAuth(getFirebaseAdminApp());
export const adminDb = () => getFirestore(getFirebaseAdminApp());
export const adminStorage = () => getStorage(getFirebaseAdminApp());
