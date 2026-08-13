import "server-only";

import type { DecodedIdToken } from "firebase-admin/auth";
import {
  resolveAccountContextFromRecords,
  type FirebaseAccountIdentity,
} from "@/lib/auth/account-context";
import type { AuthenticatedAccountContext } from "@/lib/auth/portal";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type {
  PartnerRecord,
  UserRecord,
} from "@/lib/firebase/schema";
import { verifyBearerToken } from "@/lib/firebase/server";

export type PortalAccountResolverDependencies = {
  loadProfiles(uid: string): Promise<UserRecord[]>;
  loadPartner(partnerId: string): Promise<PartnerRecord | null>;
};

async function loadProfiles(uid: string) {
  const users = adminDb().collection("users");
  const directSnapshot = await users.doc(uid).get();
  if (directSnapshot.exists) {
    const direct = directSnapshot.data() as UserRecord;
    if (!direct.uid || direct.uid === uid) {
      return [direct];
    }
  }

  const matchingSnapshot = await users.where("uid", "==", uid).limit(3).get();
  const profiles = new Map<string, UserRecord>();
  if (directSnapshot.exists) {
    profiles.set(directSnapshot.id, directSnapshot.data() as UserRecord);
  }
  for (const snapshot of matchingSnapshot.docs) {
    profiles.set(snapshot.id, snapshot.data() as UserRecord);
  }

  return [...profiles.values()];
}

async function loadPartner(partnerId: string) {
  const snapshot = await adminDb()
    .collection("partners")
    .doc(partnerId)
    .get();
  return snapshot.exists
    ? {
        ...(snapshot.data() as PartnerRecord),
        id: partnerId,
      }
    : null;
}

const DEFAULT_DEPENDENCIES: PortalAccountResolverDependencies = {
  loadProfiles,
  loadPartner,
};

function decodedIdentity(
  decoded: DecodedIdToken,
): FirebaseAccountIdentity {
  return {
    uid: decoded.uid,
    email: decoded.email,
    admin: decoded.admin,
    partner: decoded.partner,
    partnerId: decoded.partnerId,
    multiRole: (decoded as { multiRole?: unknown }).multiRole,
  };
}

export async function resolveAccountContext(
  req: Request,
  dependencies: PortalAccountResolverDependencies = DEFAULT_DEPENDENCIES,
): Promise<AuthenticatedAccountContext> {
  const decoded = await verifyBearerToken(req);
  return resolveDecodedAccountContext(decoded, dependencies);
}

async function resolveDecodedAccountContext(
  decoded: DecodedIdToken,
  dependencies: PortalAccountResolverDependencies,
): Promise<AuthenticatedAccountContext> {
  const profiles = await dependencies.loadProfiles(decoded.uid);

  if (profiles.length !== 1) {
    return resolveAccountContextFromRecords({
      identity: decodedIdentity(decoded),
      profiles,
    });
  }

  const profile = profiles[0];
  const partnerId =
    profile.role === "partner" ||
    (profile.multiRoleTestAccount &&
      profile.enabledPortals?.includes("partner"))
      ? profile.partnerId?.trim()
      : "";
  const partner = partnerId
    ? await dependencies.loadPartner(partnerId)
    : undefined;

  return resolveAccountContextFromRecords({
    identity: decodedIdentity(decoded),
    profiles,
    partner,
  });
}

export async function resolveSessionAccountContext(
  sessionCookie: string,
  dependencies: PortalAccountResolverDependencies = DEFAULT_DEPENDENCIES,
): Promise<AuthenticatedAccountContext> {
  const decoded = await adminAuth().verifySessionCookie(
    sessionCookie,
    true,
  );
  return resolveDecodedAccountContext(decoded, dependencies);
}
