import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Auth, UserRecord as FirebaseAuthUser } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { normalizePhoneDigits } from "@/lib/audit-quote/contact-core";
import type { UserRecord } from "@/lib/firebase/schema";

export const TEMPORARY_QUOTE_MEMBER_STATUS = "temporary_quote_member" as const;
export const TEMPORARY_MEMBER_ACTIVATIONS = "temporaryMemberActivations";
const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1000;

type ActivationRecord = {
  id: string;
  uid: string;
  email: string;
  quoteId: string;
  status: "ready" | "processing" | "used";
  processingNonce?: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
};

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function tokenSecret(explicit?: string) {
  const secret =
    explicit?.trim() ||
    process.env.TEMPORARY_MEMBER_TOKEN_SECRET?.trim() ||
    process.env.AUDIT_QUOTE_HASH_PEPPER?.trim();
  if (!secret || secret.length < 16) {
    throw new Error("temporary_member_token_secret_not_configured");
  }
  return secret;
}

function activationId(token: string, secret?: string) {
  return createHmac("sha256", tokenSecret(secret))
    .update(token, "utf8")
    .digest("hex");
}

function validPassword(password: string) {
  return (
    password.length >= 8 &&
    password.length <= 128 &&
    password.trim().length >= 8
  );
}

export function buildTemporaryQuoteMemberInitialPassword(phone: string) {
  const digits = normalizePhoneDigits(phone);
  if (digits.length < 4) return null;
  const lastFour = digits.slice(-4);
  return `nh${lastFour}${lastFour}`;
}

export function isTemporaryQuoteMember(
  profile: UserRecord | null | undefined,
): profile is UserRecord & { status: typeof TEMPORARY_QUOTE_MEMBER_STATUS } {
  return (
    profile?.role === "member" &&
    profile.status === TEMPORARY_QUOTE_MEMBER_STATUS
  );
}

async function resolveOrCreateAuthUser(
  auth: Auth,
  email: string,
  displayName: string,
  initialPassword: string | null,
): Promise<{ user: FirebaseAuthUser; created: boolean }> {
  try {
    return { user: await auth.getUserByEmail(email), created: false };
  } catch (error) {
    if ((error as { code?: string }).code !== "auth/user-not-found") {
      throw error;
    }
  }

  try {
    const user = await auth.createUser({
      email,
      displayName,
      emailVerified: false,
      password: initialPassword ?? randomBytes(48).toString("base64url"),
    });
    return { user, created: true };
  } catch (error) {
    if ((error as { code?: string }).code !== "auth/email-already-exists") {
      throw error;
    }
    return { user: await auth.getUserByEmail(email), created: false };
  }
}

export async function provisionTemporaryQuoteMember(input: {
  db: Firestore;
  auth: Auth;
  requestId: string;
  quoteRequestId: string;
  email: string;
  contactName: string;
  phone: string;
  marketingConsent: boolean;
  now?: string;
}) {
  const email = normalizedEmail(input.email);
  const now = input.now ?? new Date().toISOString();
  const initialPassword = buildTemporaryQuoteMemberInitialPassword(input.phone);
  const { user, created } = await resolveOrCreateAuthUser(
    input.auth,
    email,
    input.contactName.trim(),
    initialPassword,
  );
  const userRef = input.db.collection("users").doc(user.uid);
  const auditRequestRef = input.db
    .collection("auditQuoteRequests")
    .doc(input.requestId);
  const quoteRequestRef = input.db
    .collection("quoteRequests")
    .doc(input.quoteRequestId);

  const result = await input.db.runTransaction(async (transaction) => {
    const profileSnapshot = await transaction.get(userRef);
    const existing = profileSnapshot.exists
      ? (profileSnapshot.data() as UserRecord)
      : null;

    if (
      existing &&
      (existing.uid !== user.uid ||
        normalizedEmail(existing.email) !== email ||
        existing.role !== "member")
    ) {
      throw new Error("temporary_member_account_conflict");
    }

    if (!existing) {
      transaction.set(userRef, {
        uid: user.uid,
        name: input.contactName.trim(),
        phone: input.phone.trim(),
        email,
        position: "",
        duty: "",
        consents: {
          terms: false,
          privacy: true,
          marketing: input.marketingConsent,
          email: input.marketingConsent,
          sms: false,
          kakao: false,
        },
        role: "member",
        status: TEMPORARY_QUOTE_MEMBER_STATUS,
        temporaryMember: {
          source: "audit_quote_request",
          sourceRequestIds: [input.requestId],
        },
        createdAt: now,
        updatedAt: now,
      } satisfies UserRecord);
    } else if (isTemporaryQuoteMember(existing)) {
      transaction.set(
        userRef,
        {
          name: existing.name || input.contactName.trim(),
          phone: existing.phone || input.phone.trim(),
          temporaryMember: {
            source: "audit_quote_request",
            sourceRequestIds: Array.from(
              new Set([
                ...(existing.temporaryMember?.sourceRequestIds ?? []),
                input.requestId,
              ]),
            ),
            ...(existing.temporaryMember?.activatedAt
              ? { activatedAt: existing.temporaryMember.activatedAt }
              : {}),
            ...(existing.temporaryMember?.convertedAt
              ? { convertedAt: existing.temporaryMember.convertedAt }
              : {}),
          },
          updatedAt: now,
        } satisfies Partial<UserRecord>,
        { merge: true },
      );
    }

    transaction.set(
      auditRequestRef,
      { customerUid: user.uid, updatedAt: now },
      { merge: true },
    );
    transaction.set(
      quoteRequestRef,
      { customerUid: user.uid, updatedAt: now },
      { merge: true },
    );
    const shouldResetUnactivatedTemporaryPassword =
      Boolean(initialPassword) &&
      !created &&
      isTemporaryQuoteMember(existing) &&
      !existing.temporaryMember?.activatedAt;

    return {
      uid: user.uid,
      profileStatus: existing?.status ?? TEMPORARY_QUOTE_MEMBER_STATUS,
      initialPasswordIssued:
        Boolean(initialPassword) &&
        (created || shouldResetUnactivatedTemporaryPassword),
      shouldResetUnactivatedTemporaryPassword,
    };
  });

  let initialPasswordIssued = result.initialPasswordIssued;
  if (initialPassword && result.shouldResetUnactivatedTemporaryPassword) {
    try {
      await input.auth.updateUser(user.uid, { password: initialPassword });
    } catch (error) {
      console.error("[temporary-member] initial_password_reset_failed", {
        uid: user.uid,
        error: error instanceof Error ? error.message : "reset_failed",
      });
      initialPasswordIssued = false;
    }
  }

  return {
    uid: result.uid,
    profileStatus: result.profileStatus,
    authUserCreated: created,
    initialPasswordIssued,
    initialPassword: initialPasswordIssued ? initialPassword : null,
  };
}

export async function createTemporaryMemberActivationLink(input: {
  db: Firestore;
  uid: string;
  email: string;
  quoteId: string;
  baseUrl: string;
  nowMs?: number;
  secret?: string;
}) {
  const userSnapshot = await input.db.collection("users").doc(input.uid).get();
  if (!userSnapshot.exists) return null;
  const profile = userSnapshot.data() as UserRecord;
  if (!isTemporaryQuoteMember(profile)) return null;

  const token = randomBytes(32).toString("base64url");
  const id = activationId(token, input.secret);
  const nowMs = input.nowMs ?? Date.now();
  const record = {
    id,
    uid: input.uid,
    email: normalizedEmail(input.email),
    quoteId: input.quoteId,
    status: "ready",
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ACTIVATION_TTL_MS).toISOString(),
  } satisfies ActivationRecord;
  await input.db
    .collection(TEMPORARY_MEMBER_ACTIVATIONS)
    .doc(id)
    .set(record);
  const url = new URL("/signup", input.baseUrl);
  url.searchParams.set("activation", token);
  return url.toString();
}

export async function activateTemporaryMemberPassword(input: {
  db: Firestore;
  auth: Auth;
  token: string;
  password: string;
  now?: string;
  secret?: string;
}) {
  if (!validPassword(input.password)) {
    throw new Error("invalid_password");
  }
  const id = activationId(input.token.trim(), input.secret);
  const activationRef = input.db
    .collection(TEMPORARY_MEMBER_ACTIVATIONS)
    .doc(id);
  const processingNonce = randomUUID();
  const now = input.now ?? new Date().toISOString();

  const claimed = await input.db.runTransaction(async (transaction) => {
    const activationSnapshot = await transaction.get(activationRef);
    if (!activationSnapshot.exists) {
      throw new Error("invalid_activation");
    }
    const activation = activationSnapshot.data() as ActivationRecord;
    if (
      activation.status !== "ready" ||
      Date.parse(activation.expiresAt) <= Date.parse(now)
    ) {
      throw new Error(
        activation.status === "used"
          ? "activation_already_used"
          : "activation_expired",
      );
    }
    const userRef = input.db.collection("users").doc(activation.uid);
    const userSnapshot = await transaction.get(userRef);
    const profile = userSnapshot.exists
      ? (userSnapshot.data() as UserRecord)
      : null;
    if (
      !isTemporaryQuoteMember(profile) ||
      normalizedEmail(profile.email) !== normalizedEmail(activation.email)
    ) {
      throw new Error("invalid_activation");
    }
    transaction.update(activationRef, {
      status: "processing",
      processingNonce,
    } satisfies Partial<ActivationRecord>);
    return { activation, userRef, profile };
  });

  try {
    await input.auth.updateUser(claimed.activation.uid, {
      password: input.password,
      emailVerified: true,
    });
  } catch (error) {
    await activationRef.set(
      { status: "ready", processingNonce: null },
      { merge: true },
    );
    throw error;
  }

  await input.db.runTransaction(async (transaction) => {
    const activationSnapshot = await transaction.get(activationRef);
    const activation = activationSnapshot.data() as ActivationRecord;
    if (
      activation.status !== "processing" ||
      activation.processingNonce !== processingNonce
    ) {
      throw new Error("activation_state_conflict");
    }
    transaction.update(activationRef, {
      status: "used",
      usedAt: now,
      processingNonce: null,
    });
    transaction.set(
      claimed.userRef,
      {
        temporaryMember: {
          ...claimed.profile.temporaryMember,
          source: "audit_quote_request",
          sourceRequestIds:
            claimed.profile.temporaryMember?.sourceRequestIds ?? [],
          activatedAt: now,
        },
        updatedAt: now,
      } satisfies Partial<UserRecord>,
      { merge: true },
    );
  });

  return {
    uid: claimed.activation.uid,
    email: claimed.activation.email,
    quoteId: claimed.activation.quoteId,
  };
}
